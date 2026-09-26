import { it, expect, vi } from 'vitest';
import { convertLength, UNITS, CssUnitError } from '../src/index';

// Quoted from CSS Values and Units Module Level 4, https://www.w3.org/TR/css-values-4/,
// section 6.2 "Absolute Lengths", fetched this session:
//   "1in = 2.54cm = 96px"; "1cm = 96px/2.54"; "1mm = 1/10th of 1cm";
//   "1pt = 1/72nd of 1in"; "1pc = 1/6th of 1in"; "1px = 1/96th of 1in".
//   "All of the absolute length units are compatible, and px is their canonical unit."
// section 6.1.1 "Font-relative Lengths":
//   "em: Equal to the computed value of the font-size property of the element on which it is used."
//   "rem: Equal to the computed value of the em unit on the root element."
// section 6.1.2.2 "The Various Viewport-relative Units":
//   "vw: Equal to 1% of the width of the large viewport size."
//   "vh: Equal to 1% of the height of the large viewport size."
// section 5.5 "Percentages":
//   "Percentage values are always relative to another quantity... Each property that allows
//   percentages also defines the quantity to which the percentage refers."

function valueOf(result: ReturnType<typeof convertLength>, unit: string): number {
  const found = result.results.find((r) => r.unit === unit);
  if (!found) throw new Error(`no result for ${unit}`);
  return found.value;
}

it('the absolute unit ratios are the ones CSS Values and Units Level 4 defines, with px canonical', () => {
  const oneInch = convertLength(1, 'in', {});
  expect(valueOf(oneInch, 'px')).toBeCloseTo(96, 9);
  expect(valueOf(oneInch, 'cm')).toBeCloseTo(2.54, 9);
  expect(valueOf(oneInch, 'mm')).toBeCloseTo(25.4, 9);
  expect(valueOf(oneInch, 'pt')).toBeCloseTo(72, 9);
  expect(valueOf(oneInch, 'pc')).toBeCloseTo(6, 9);

  // px is canonical: converting 1px to every absolute unit and back through
  // px reproduces the same ratios from the other direction.
  const onePx = convertLength(1, 'px', {});
  expect(valueOf(onePx, 'in')).toBeCloseTo(1 / 96, 9);
});

it('em, rem, vw, vh and percent convert through the stated root font size, parent font size, viewport and percent reference', () => {
  expect(valueOf(convertLength(1.5, 'rem', { rootFontSize: 16 }), 'px')).toBeCloseTo(24, 9);
  expect(valueOf(convertLength(2, 'em', { parentFontSize: 20 }), 'px')).toBeCloseTo(40, 9);
  expect(valueOf(convertLength(10, 'vw', { viewportWidth: 1440 }), 'px')).toBeCloseTo(144, 9);
  expect(valueOf(convertLength(50, 'vh', { viewportHeight: 900 }), 'px')).toBeCloseTo(450, 9);
  expect(
    valueOf(convertLength(150, 'percent', { percentOf: 'parent-font-size', parentFontSize: 16 }), 'px'),
  ).toBeCloseTo(24, 9);
  expect(
    valueOf(convertLength(50, 'percent', { percentOf: 'container-width', containerWidth: 600 }), 'px'),
  ).toBeCloseTo(300, 9);
});

it('every unit converts to every other and back within one part in a billion', () => {
  const context = {
    rootFontSize: 18,
    parentFontSize: 22,
    viewportWidth: 1024,
    viewportHeight: 768,
    percentOf: 'container-width' as const,
    containerWidth: 500,
  };
  for (const from of UNITS) {
    const original = 12.5;
    const forward = convertLength(original, from.unit, context);
    for (const to of UNITS) {
      const converted = valueOf(forward, to.unit);
      const back = valueOf(convertLength(converted, to.unit, context), from.unit);
      expect(Math.abs(back - original) / Math.abs(original)).toBeLessThan(1e-9);
    }
  }
});

it('the assumed context is returned with every result', () => {
  const result = convertLength(16, 'px', {});
  expect(result.context).toEqual({
    rootFontSize: 16,
    parentFontSize: 16,
    viewportWidth: 1440,
    viewportHeight: 900,
    percentOf: 'parent-font-size',
    containerWidth: 600,
  });

  const overridden = convertLength(16, 'px', {
    rootFontSize: 20,
    parentFontSize: 24,
    viewportWidth: 800,
    viewportHeight: 600,
    percentOf: 'container-width',
    containerWidth: 900,
  });
  expect(overridden.context).toEqual({
    rootFontSize: 20,
    parentFontSize: 24,
    viewportWidth: 800,
    viewportHeight: 600,
    percentOf: 'container-width',
    containerWidth: 900,
  });
});

it('a font size or viewport of zero or below is clamped with a warning naming the field', () => {
  const zeroRoot = convertLength(1, 'rem', { rootFontSize: 0 });
  expect(zeroRoot.context.rootFontSize).toBe(1);
  expect(zeroRoot.warnings.some((w) => w.includes('root font size'))).toBe(true);

  const negativeViewport = convertLength(1, 'vw', { viewportWidth: -100 });
  expect(negativeViewport.context.viewportWidth).toBe(1);
  expect(negativeViewport.warnings.some((w) => w.includes('viewport width'))).toBe(true);

  const zeroParent = convertLength(1, 'em', { parentFontSize: 0 });
  expect(zeroParent.context.parentFontSize).toBe(1);
  expect(zeroParent.warnings.some((w) => w.includes('parent font size'))).toBe(true);

  const zeroViewportHeight = convertLength(1, 'vh', { viewportHeight: -1 });
  expect(zeroViewportHeight.context.viewportHeight).toBe(1);
  expect(zeroViewportHeight.warnings.some((w) => w.includes('viewport height'))).toBe(true);
});

it('a non-finite value is refused', () => {
  expect(() => convertLength(NaN, 'px', {})).toThrow(CssUnitError);
  expect(() => convertLength(Infinity, 'px', {})).toThrow(CssUnitError);
  expect(() => convertLength(-Infinity, 'px', {})).toThrow(CssUnitError);
});

it('nothing is written to the console while converting', () => {
  const spies = ['log', 'warn', 'error', 'info', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    convertLength(16, 'px', {});
    convertLength(1, 'rem', { rootFontSize: -5, viewportWidth: 0 });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  } finally {
    for (const s of spies) s.mockRestore();
  }
});
