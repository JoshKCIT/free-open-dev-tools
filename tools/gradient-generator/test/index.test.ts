import { it, expect, vi } from 'vitest';
import * as csstree from 'css-tree';
import { generateGradient, GradientError, type GradientStop } from '../src/index';
import { findUnsafeCss } from '../src/css-safe';
import { HOSTILE_VALUES } from './hostile-css';

function stops(overrides?: Partial<GradientStop>[]): GradientStop[] {
  const base: GradientStop[] = [
    { color: '#f97316', at: 0 },
    { color: '#ec4899', at: 50 },
    { color: '#6366f1', at: 100 },
  ];
  if (!overrides) return base;
  return overrides.map((o, i) => ({ ...base[i % base.length]!, ...o }));
}

it('the CSS Images Level 3 linear gradient example is produced from its own angle and colours', () => {
  // CSS Images Module Level 3 (https://www.w3.org/TR/css-images-3/), section
  // 3.1.2 "Linear Gradient Examples": "Below are various ways of specifying
  // a basic vertical gradient: linear-gradient(yellow, blue);
  // linear-gradient(to bottom, yellow, blue); linear-gradient(180deg,
  // yellow, blue); ..." -- all equivalent. This tool always writes the
  // explicit angle form.
  const result = generateGradient({
    type: 'linear',
    angle: 180,
    stops: [
      { color: '#ffff00', at: 0 },
      { color: '#0000ff', at: 100 },
    ],
  });
  expect(result.value).toBe('linear-gradient(180deg, #ffff00 0%, #0000ff 100%)');
  expect(result.css).toContain('background-image: linear-gradient(180deg, #ffff00 0%, #0000ff 100%);');
});

it('radial gradients write shape, size and position in the order the CSS Images Level 3 grammar gives', () => {
  // CSS Images Module Level 3, section 3.2.1 "radial-gradient() Syntax":
  // "<radial-gradient-syntax> = [ <radial-shape> || <radial-size> ]? [ at
  // <position> ]?, <color-stop-list>" -- this tool always writes shape, then
  // size, then position, in that order.
  const result = generateGradient({
    type: 'radial',
    shape: 'circle',
    size: 'closest-side',
    position: { x: 30, y: 40 },
    stops: stops(),
  });
  expect(result.value.startsWith('radial-gradient(circle closest-side at 30% 40%, ')).toBe(true);
});

it('conic gradients write the start angle and position as CSS Images Level 4 defines', () => {
  // CSS Images Module Level 4 (https://www.w3.org/TR/css-images-4/), section
  // 3.3.1 "conic-gradient() Syntax": "<conic-gradient-syntax> = [ [ [ from
  // [ <angle> | <zero> ] ]? [ at <position> ]? ] || <color-interpolation-method> ]?,
  // <angular-color-stop-list>".
  const result = generateGradient({
    type: 'conic',
    angle: 90,
    position: { x: 50, y: 50 },
    stops: stops(),
  });
  expect(result.value.startsWith('conic-gradient(from 90deg at 50% 50%, ')).toBe(true);
});

it('a stop placed before an earlier stop is warned about as the colour stop fix-up rule would move it', () => {
  // CSS Images Module Level 3, section 3.4.3 "Color Stop Fixup": "If a color
  // stop ... has a position that is less than the specified position of any
  // color stop ... before it in the list, set its position to be equal to
  // the largest specified position of any color stop ... before it."
  const result = generateGradient({
    type: 'linear',
    stops: [
      { color: '#000000', at: 50 },
      { color: '#ffffff', at: 10 },
    ],
  });
  // Written exactly as given -- never reordered by this tool itself.
  expect(result.value).toBe('linear-gradient(90deg, #000000 50%, #ffffff 10%)');
  expect(result.warnings.some((w) => /fix-up/i.test(w) && /Stop 2/.test(w) && /Stop 1/.test(w))).toBe(true);
});

it('repeating gradients use the repeating function of the chosen type', () => {
  const linear = generateGradient({ type: 'linear', repeating: true, stops: stops() });
  expect(linear.value.startsWith('repeating-linear-gradient(')).toBe(true);
  const radial = generateGradient({ type: 'radial', repeating: true, stops: stops() });
  expect(radial.value.startsWith('repeating-radial-gradient(')).toBe(true);
  const conic = generateGradient({ type: 'conic', repeating: true, stops: stops() });
  expect(conic.value.startsWith('repeating-conic-gradient(')).toBe(true);
});

it('every declaration is valid for its property according to the css-tree lexer', () => {
  const samples = [
    generateGradient({ type: 'linear', stops: stops() }),
    generateGradient({ type: 'radial', shape: 'circle', size: 'closest-corner', stops: stops() }),
    generateGradient({ type: 'conic', angle: 45, stops: stops() }),
    generateGradient({ type: 'linear', repeating: true, stops: stops() }),
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
    expect(declarationCount).toBe(3); // width, height, background-image
  }
});

it('hostile field values never produce CSS that can load anything or break out of a rule', () => {
  for (const hostile of HOSTILE_VALUES) {
    let result;
    try {
      result = generateGradient({
        type: 'linear',
        stops: [
          { color: hostile, at: 0 },
          { color: '#000000', at: 100 },
        ],
      });
    } catch (err) {
      expect(err).toBeInstanceOf(GradientError);
      continue;
    }
    expect(findUnsafeCss(result.css), result.css).toBeNull();
    expect(result.css).not.toContain('example.invalid');
    expect(result.css).not.toContain('url(');
  }

  const numericHostileValues = [NaN, Infinity, -Infinity, 1e21, -1e21, -400];
  for (const value of numericHostileValues) {
    const result = generateGradient({
      type: 'radial',
      angle: value,
      position: { x: value, y: value },
      width: value,
      height: value,
      stops: [
        { color: '#000000', at: value },
        { color: '#ffffff', at: value },
      ],
    });
    expect(findUnsafeCss(result.css), result.css).toBeNull();
    expect(result.css).not.toContain('example.invalid');
  }
});

it('the generated CSS declares everything the preview needs, including the element size', () => {
  const result = generateGradient({ type: 'linear', stops: stops() });
  expect(result.tree.className).toBe('box');
  expect(result.css).toContain('.box {');
  expect(result.css).toMatch(/width: \d+px;/);
  expect(result.css).toMatch(/height: \d+px;/);
  expect(result.css).toContain('background-image:');
});

it('nothing is written to the console while generating', () => {
  const spies = ['log', 'warn', 'error', 'info', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    generateGradient({ type: 'linear', stops: stops() });
    generateGradient({
      type: 'radial',
      stops: [
        { color: 'not-a-colour', at: 0 },
        { color: '#000000', at: 100 },
      ],
    });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  } finally {
    for (const s of spies) s.mockRestore();
  }
});
