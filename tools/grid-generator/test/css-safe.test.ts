import { it, expect } from 'vitest';
import {
  CssSafetyError,
  ALLOWED_FUNCTIONS,
  findUnsafeCss,
  assertSafeValue,
  assertSafeSelector,
  assertSafeTree,
  formatNumber,
  formatLength,
  parseHexColor,
  formatHexColor,
  clampNumber,
  stylesheetText,
} from '../src/css-safe';
import { HOSTILE_VALUES } from './hostile-css';

it('a value built from numbers, keywords, hash colours and allowed functions passes the safety check', () => {
  const values = [
    '10px',
    '10px 20px 30px 40px',
    '10px / 5px',
    '#2563eb',
    'rgb(37 99 235 / 50%)',
    'linear-gradient(#2563eb, #ffffff)',
    'calc(10px + 2%)',
    'blur(4px)',
    'translate(10px, 20px) rotate(45deg)',
  ];
  for (const v of values) {
    expect(() => assertSafeValue('border-radius', v), `expected "${v}" to be accepted`).not.toThrow();
  }
  expect(ALLOWED_FUNCTIONS).toContain('linear-gradient');
  expect(ALLOWED_FUNCTIONS).toContain('calc');
});

it('a resource reference, an import, an image set, an escape, a comment or a rule breakout is refused', () => {
  for (const hostile of HOSTILE_VALUES) {
    let threw = false;
    try {
      assertSafeValue('background-color', hostile);
    } catch (err) {
      threw = err instanceof CssSafetyError;
    }
    if (!threw) {
      // Some hostile strings are only unsafe once they reach whole-text
      // scanning (an at-rule or a comment cannot appear as a single
      // declaration's value at all under assertSafeValue's own character
      // set, so those are refused there instead).
      expect(findUnsafeCss(hostile), `expected "${hostile}" to be refused by one of the two checks`).not.toBeNull();
    }
  }
});

it('a hash colour is accepted in three, four, six or eight digits as CSS Color 4 defines and written back in lower case', () => {
  expect(parseHexColor('#123')).toEqual({ r: 0x11, g: 0x22, b: 0x33, alpha: 1 });
  expect(parseHexColor('#1234')).toEqual({ r: 0x11, g: 0x22, b: 0x33, alpha: 0x44 / 255 });
  expect(parseHexColor('#112233')).toEqual({ r: 0x11, g: 0x22, b: 0x33, alpha: 1 });
  expect(parseHexColor('#11223344')).toEqual({ r: 0x11, g: 0x22, b: 0x33, alpha: 0x44 / 255 });
  // CSS Color 4: "the case of the letters doesn't matter -- #00ff00 is
  // identical to #00FF00" -- and this project always writes back lower case.
  expect(formatHexColor(parseHexColor('#2563EB'))).toBe('#2563eb');
  expect(formatHexColor({ r: 0, g: 255, b: 0, alpha: 1 })).toBe('#00ff00');
  expect(formatHexColor({ r: 0, g: 0, b: 255, alpha: 0.8 })).toBe('#0000ffcc');
  expect(() => parseHexColor('not-a-colour')).toThrow(CssSafetyError);
  expect(() => parseHexColor('#12')).toThrow(CssSafetyError);
});

it('numbers are written without exponents or negative zero and a non-finite number is refused', () => {
  expect(formatNumber(24)).toBe('24');
  expect(formatNumber(24.5)).toBe('24.5');
  expect(formatNumber(24.12345)).toBe('24.123');
  expect(formatNumber(-0.0001)).toBe('0');
  expect(formatNumber(0)).toBe('0');
  expect(formatNumber(-24.5)).toBe('-24.5');
  expect(formatNumber(1e21)).not.toMatch(/e/i);
  expect(() => formatNumber(NaN)).toThrow(CssSafetyError);
  expect(() => formatNumber(Infinity)).toThrow(CssSafetyError);
  expect(() => formatNumber(-Infinity)).toThrow(CssSafetyError);
  expect(formatLength(24, 'px')).toBe('24px');
  expect(formatLength(0, 'px', { bareZero: true })).toBe('0');
  expect(formatLength(0, 'px')).toBe('0px');
});

it('only keyframes and the reduced motion media rule are allowed as at-rules', () => {
  expect(findUnsafeCss('@keyframes spin { from { opacity: 0; } to { opacity: 1; } }')).toBeNull();
  expect(findUnsafeCss('@media (prefers-reduced-motion: reduce) {\n.box { opacity: 1; }\n}')).toBeNull();
  expect(findUnsafeCss('@import url(https://example.invalid/x);')).not.toBeNull();
  expect(findUnsafeCss('@font-face { src: local(x); }')).not.toBeNull();
  expect(findUnsafeCss('@media (min-width: 10px) { .box {} }')).not.toBeNull();
});

it('the stylesheet writer checks every selector, property and value before writing', () => {
  const text = stylesheetText({
    rules: [
      {
        selector: '.box',
        declarations: [
          ['width', '240px'],
          ['height', '160px'],
          ['background-color', '#2563eb'],
          ['border-radius', '24px'],
        ],
      },
    ],
  });
  expect(text).toContain('.box {');
  expect(text).toContain('border-radius: 24px;');
  expect(findUnsafeCss(text)).toBeNull();

  expect(() => stylesheetText({ rules: [{ selector: '#not-a-class', declarations: [] }] })).toThrow(CssSafetyError);
  expect(() =>
    stylesheetText({ rules: [{ selector: '.box', declarations: [['background', 'url(https://example.invalid/x)']] }] }),
  ).toThrow(CssSafetyError);

  // .box { border-radius: 10px 20px / 5px; } from the plan's own behaviour list.
  expect(findUnsafeCss('.box { border-radius: 10px 20px / 5px; }')).toBeNull();
});

it('assertSafeTree refuses more than two levels of children, more than 32 nodes, and a bad class name', () => {
  expect(() => assertSafeTree({ className: 'box' })).not.toThrow();
  expect(() => assertSafeTree({ className: 'box corner-tl' })).not.toThrow();
  expect(() => assertSafeTree({ className: 'Box' })).toThrow(CssSafetyError);
  expect(() =>
    assertSafeTree({
      className: 'box',
      children: [{ className: 'a', children: [{ className: 'b', children: [{ className: 'c' }] }] }],
    }),
  ).toThrow(CssSafetyError);
  const manyChildren = Array.from({ length: 33 }, () => ({ className: 'leaf' }));
  expect(() => assertSafeTree({ className: 'box', children: manyChildren })).toThrow(CssSafetyError);
});

it('clampNumber clamps out-of-range and non-finite values with a warning naming the field', () => {
  expect(clampNumber('width', 240, 40, 480, 240)).toEqual({ value: 240, warning: null });
  const low = clampNumber('width', 1, 40, 480, 240);
  expect(low.value).toBe(40);
  expect(low.warning).toMatch(/width/);
  const high = clampNumber('width', 10000, 40, 480, 240);
  expect(high.value).toBe(480);
  expect(high.warning).toMatch(/width/);
  const nan = clampNumber('width', NaN, 40, 480, 240);
  expect(nan.value).toBe(240);
  expect(nan.warning).toMatch(/width/);
});

it('assertSafeSelector accepts class selectors optionally ending in :hover and refuses anything else', () => {
  expect(() => assertSafeSelector('.box')).not.toThrow();
  expect(() => assertSafeSelector('.box.corner-tl:hover')).not.toThrow();
  expect(() => assertSafeSelector('div')).toThrow(CssSafetyError);
  expect(() => assertSafeSelector('#id')).toThrow(CssSafetyError);
  expect(() => assertSafeSelector('.box, .other')).toThrow(CssSafetyError);
});
