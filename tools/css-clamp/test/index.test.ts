import { it, expect, vi } from 'vitest';
import * as csstree from 'css-tree';
import { fluidClamp, evaluateClamp, CssClampError } from '../src/index';

// Quoted from CSS Values and Units Module Level 4, https://www.w3.org/TR/css-values-4/,
// fetched this session:
//   "clamp() function takes three calculations -- a minimum value, a central value, and a
//   maximum value -- and represents its central calculation, clamped according to its min
//   and max calculations, favoring the min calculation if it conflicts with the max. (That
//   is, given clamp(MIN, VAL, MAX), it represents exactly the same value as
//   max(MIN, min(VAL, MAX)))."
//
// Quoted from WCAG 2.2, https://www.w3.org/TR/WCAG22/#resize-text, fetched this session:
//   "Success Criterion 1.4.4 Resize text: Except for captions and images of text, text can
//   be resized without assistive technology up to 200 percent without loss of content or
//   functionality."
//
// Quoted from Utopia's blog post "Preparing clamp() for typographic scales",
// https://utopia.fyi/blog/clamp/, fetched this session (crediting Pedro Rodriguez):
//   "Slope = (MaxSize - MinSize) / (MaxWidth - MinWidth)
//   yIntersection = (-1 * MinWidth) * Slope + MinSize
//   font-size: clamp(MinSize[rem], yIntersection[rem] + Slope * 100vw, MaxSize[rem])"
// Worked example given there: min 1rem, max 2rem, 320px to 1440px viewport.
//
// Quoted via Smashing Magazine, "Modern Fluid Typography Using CSS Clamp" (2022),
// https://www.smashingmagazine.com/2022/01/modern-fluid-typography-css-clamp/, fetched this
// session, quoting Adrian Roselli:
//   "When you use vw units or limit how large text can get with clamp(), there is a chance
//   a user may be unable to scale the text to 200% of its original size. If that happens,
//   it is WCAG failure under 1.4.4 Resize text (AA) so be certain to test the results with
//   zoom." -- Adrian Roselli

it('the preferred value is the straight line through both size and viewport pairs', () => {
  const result = fluidClamp({ minSize: 16, maxSize: 24, minViewport: 320, maxViewport: 1280 });
  expect(result.value).toBe('clamp(1rem, 0.8333rem + 0.8333vw, 1.5rem)');
  expect(result.slope).toBeCloseTo(8 / 960, 9);
  expect(result.intercept).toBeCloseTo(16 - 320 * (8 / 960), 9);
});

it('the output equals the minimum at and below the minimum viewport and the maximum at and above the maximum viewport, as CSS Values and Units Level 4 defines clamp', () => {
  const result = fluidClamp({ minSize: 16, maxSize: 24, minViewport: 320, maxViewport: 1280 });
  expect(evaluateClamp(result, 100)).toBeCloseTo(16, 9);
  expect(evaluateClamp(result, 320)).toBeCloseTo(16, 9);
  expect(evaluateClamp(result, 1280)).toBeCloseTo(24, 9);
  expect(evaluateClamp(result, 5000)).toBeCloseTo(24, 9);
  // In between lies on the straight line.
  const mid = 800;
  const expected = result.intercept + result.slope * mid;
  expect(evaluateClamp(result, mid)).toBeCloseTo(expected, 9);
  expect(evaluateClamp(result, mid)).toBeGreaterThan(16);
  expect(evaluateClamp(result, mid)).toBeLessThan(24);
});

it('rem output uses the stated root font size and keeps a rem term so the value follows zoom', () => {
  const result = fluidClamp({ minSize: 16, maxSize: 24, minViewport: 320, maxViewport: 1280, rootFontSize: 20 });
  expect(result.value).toContain('rem');
  expect(result.value).not.toContain('px');
  expect(result.value.startsWith('clamp(0.8rem,')).toBe(true); // 16 / 20
  expect(result.value.endsWith('1.2rem)')).toBe(true); // 24 / 20

  const pxResult = fluidClamp({ minSize: 16, maxSize: 24, minViewport: 320, maxViewport: 1280, unit: 'px' });
  expect(pxResult.value).toContain('px');
  expect(pxResult.value).not.toContain('rem');
});

it('a minimum above the maximum or an empty viewport range is refused with a message naming both fields', () => {
  expect(() => fluidClamp({ minSize: 30, maxSize: 20, minViewport: 320, maxViewport: 1280 })).toThrow(CssClampError);
  try {
    fluidClamp({ minSize: 30, maxSize: 20, minViewport: 320, maxViewport: 1280 });
  } catch (err) {
    expect((err as Error).message).toMatch(/minimum size/);
    expect((err as Error).message).toMatch(/maximum size/);
  }

  expect(() => fluidClamp({ minSize: 16, maxSize: 24, minViewport: 1280, maxViewport: 1280 })).toThrow(CssClampError);
  expect(() => fluidClamp({ minSize: 16, maxSize: 24, minViewport: 1280, maxViewport: 320 })).toThrow(CssClampError);
  try {
    fluidClamp({ minSize: 16, maxSize: 24, minViewport: 1280, maxViewport: 320 });
  } catch (err) {
    expect((err as Error).message).toMatch(/minimum viewport/);
    expect((err as Error).message).toMatch(/maximum viewport/);
  }
});

it('a maximum more than the fetched ratio above the minimum is warned about for WCAG 2.2 success criterion 1.4.4', () => {
  const risky = fluidClamp({ minSize: 16, maxSize: 48, minViewport: 320, maxViewport: 1280 });
  expect(risky.warnings.some((w) => w.includes('1.4.4'))).toBe(true);

  const safe = fluidClamp({ minSize: 16, maxSize: 24, minViewport: 320, maxViewport: 1280 });
  expect(safe.warnings.some((w) => w.includes('1.4.4'))).toBe(false);
});

it('the declaration is valid for font-size according to the css-tree lexer', () => {
  const samples = [
    fluidClamp({ minSize: 16, maxSize: 24, minViewport: 320, maxViewport: 1280 }),
    fluidClamp({ minSize: 16, maxSize: 24, minViewport: 320, maxViewport: 1280, unit: 'px' }),
    fluidClamp({ minSize: 16, maxSize: 48, minViewport: 320, maxViewport: 1280, rootFontSize: 20, precision: 6 }),
  ];
  for (const result of samples) {
    const ast = csstree.parse(`.x { ${result.declaration} }`, { positions: true });
    let declarationCount = 0;
    csstree.walk(ast, (node) => {
      if (node.type === 'Declaration') {
        declarationCount++;
        const match = csstree.lexer.matchProperty(node.property, node.value as never);
        expect(match.error, `${node.property}: ${result.declaration}`).toBeNull();
        expect(match.matched, `${node.property} did not match: ${result.declaration}`).not.toBeNull();
      }
    });
    expect(declarationCount).toBe(1);
  }
});

it('nothing is written to the console while generating', () => {
  const spies = ['log', 'warn', 'error', 'info', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    fluidClamp({ minSize: 16, maxSize: 24, minViewport: 320, maxViewport: 1280 });
    fluidClamp({ minSize: -5, maxSize: 5000, minViewport: -100, maxViewport: 500000 });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  } finally {
    for (const s of spies) s.mockRestore();
  }
});
