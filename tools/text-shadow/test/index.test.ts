import { it, expect, vi } from 'vitest';
import * as csstree from 'css-tree';
import { generateTextShadow, TextShadowError, type TextShadowLayer } from '../src/index';
import { findUnsafeCss } from '../src/css-safe';
import { HOSTILE_VALUES } from './hostile-css';

function layer(overrides: Partial<TextShadowLayer> = {}): TextShadowLayer {
  return { x: 2, y: 2, blur: 4, color: '#000000', opacity: 50, ...overrides };
}

it('text shadows are written as the CSS Text Decoration Level 3 grammar allows, without spread or inset', () => {
  // CSS Text Decoration Module Level 3, section 4 "Text Shadows: the
  // text-shadow property", quoted directly from the fetched specification:
  // "Value: none | [ <color>? && <length>{2,3} ] # ... Values are
  // interpreted as for box-shadow [CSS-BACKGROUNDS-3]. (But note that
  // spread values and the inset keyword are not allowed.)"
  const result = generateTextShadow({ layers: [layer({ x: 2, y: 2, blur: 4, opacity: 50 })] });
  expect(result.value).toBe('2px 2px 4px #00000080');
  expect(result.css).toContain('text-shadow: 2px 2px 4px #00000080;');
  expect(result.value).not.toContain('inset');
});

it('layers are written in order and the first layer is painted on top as the specification states', () => {
  // "The shadow effects are applied front-to-back: the first shadow is on top."
  const result = generateTextShadow({
    layers: [layer({ x: 1, y: 1, color: '#111111' }), layer({ x: 2, y: 2, color: '#222222' })],
  });
  const [first, second] = result.value.split(', ');
  expect(first).toContain('1px 1px');
  expect(first).toContain('#111111');
  expect(second).toContain('2px 2px');
  expect(second).toContain('#222222');
});

it('the sample text reaches the preview as text and never the CSS, and a long sample is shortened with a warning', () => {
  const result = generateTextShadow({ layers: [layer()], sample: 'Hello Shadow' });
  expect(result.tree.text).toBe('Hello Shadow');
  expect(result.css).not.toContain('Hello Shadow');

  const long = 'x'.repeat(120);
  const shortened = generateTextShadow({ layers: [layer()], sample: long });
  expect(shortened.tree.text!.length).toBe(80);
  expect(shortened.warnings.some((w) => /shortened|80 characters/i.test(w))).toBe(true);
  expect(shortened.css).not.toContain(long);
});

it('only the CSS Fonts Level 4 generic families are offered for the preview font', () => {
  // CSS Fonts Module Level 4, section 2.1.5 "Generic font families":
  // <generic-family> = serif | sans-serif | system-ui | cursive | fantasy |
  // math | monospace | ... -- this tool offers the closed subset sans-serif,
  // serif, monospace and system-ui.
  for (const family of ['sans-serif', 'serif', 'monospace', 'system-ui'] as const) {
    const result = generateTextShadow({ layers: [layer()], fontFamily: family });
    expect(result.css).toContain(`font-family: ${family};`);
  }
  const fallback = generateTextShadow({ layers: [layer()], fontFamily: 'Comic Sans MS' as never });
  expect(fallback.css).toContain('font-family: sans-serif;');
  expect(fallback.warnings.some((w) => /generic/i.test(w))).toBe(true);
});

it('every declaration is valid for its property according to the css-tree lexer', () => {
  const samples = [
    generateTextShadow({ layers: [layer()] }),
    generateTextShadow({
      layers: [layer({ x: 1, y: 1, blur: 0, opacity: 100 }), layer({ x: -1, y: -1, blur: 0, opacity: 100 })],
      fontFamily: 'monospace',
      fontWeight: 700,
    }),
    generateTextShadow({
      layers: [layer({ x: -50, y: -50, blur: 80, opacity: 100 })],
      fontFamily: 'system-ui',
      fontWeight: 900,
    }),
  ];
  for (const result of samples) {
    const ast = csstree.parse(result.css, { positions: true });
    let declarationCount = 0;
    csstree.walk(ast, (node) => {
      if (node.type === 'Declaration') {
        declarationCount++;
        const match = csstree.lexer.matchProperty(node.property, node.value as never);
        expect(match.error, `${node.property}: ${result.css}`).toBeNull();
        expect(match.matched, `${node.property} did not match: ${result.css}`).not.toBeNull();
      }
    });
    // display, place-items, width, height, font-family, font-size,
    // font-weight, line-height, color, background-color, text-shadow
    expect(declarationCount).toBe(11);
  }
});

it('hostile field values never produce CSS that can load anything or break out of a rule', () => {
  for (const hostile of HOSTILE_VALUES) {
    for (const build of [
      () => generateTextShadow({ layers: [layer()], background: hostile }),
      () => generateTextShadow({ layers: [layer({ color: hostile })] }),
      () => generateTextShadow({ layers: [layer()], textColor: hostile }),
      () => generateTextShadow({ layers: [layer()], sample: hostile }),
    ]) {
      let result;
      try {
        result = build();
      } catch (err) {
        expect(err).toBeInstanceOf(TextShadowError);
        continue;
      }
      expect(findUnsafeCss(result.css), result.css).toBeNull();
      expect(result.css).not.toContain('example.invalid');
      expect(result.css).not.toContain('url(');
    }
  }

  const numericHostileValues = [NaN, Infinity, -Infinity, 1e21, -1e21, -400];
  for (const value of numericHostileValues) {
    const result = generateTextShadow({
      layers: [{ x: value, y: value, blur: value, color: '#000000', opacity: value }],
      fontSize: value,
      width: value,
      height: value,
    });
    expect(findUnsafeCss(result.css), result.css).toBeNull();
    expect(result.css).not.toContain('example.invalid');
  }
});

it('the generated CSS declares everything the preview needs, including the element size', () => {
  const result = generateTextShadow({ layers: [layer()] });
  expect(result.tree.className).toBe('text');
  expect(result.css).toContain('.text {');
  expect(result.css).toMatch(/width: \d+px;/);
  expect(result.css).toMatch(/height: \d+px;/);
  expect(result.css).toContain('text-shadow:');
});

it('nothing is written to the console while generating', () => {
  const spies = ['log', 'warn', 'error', 'info', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    generateTextShadow({ layers: [layer()] });
    generateTextShadow({ layers: [layer({ color: 'not-a-colour' })], fontFamily: 'not-a-family' as never });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  } finally {
    for (const s of spies) s.mockRestore();
  }
});
