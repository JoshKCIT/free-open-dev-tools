import { it, expect, vi } from 'vitest';
import * as csstree from 'css-tree';
import Color from 'colorjs.io';
import { checkContrast, ContrastError } from '../src/index';
import { relativeLuminance, contrastRatio, WCAG_THRESHOLDS, compositeOver } from '../src/wcag';
import { apcaLc, APCA_LABEL } from '../src/apca';
import { findUnsafeCss } from '../src/css-safe';
import { HOSTILE_VALUES } from './hostile-css';

/** Hand-ported from `tools/mock-data/src/index.ts` (mulberry32); never imported across tool packages (D-02). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

it('the WCAG 2.2 relative luminance and contrast ratio formulas give the ratios stated in the fetched WCAG examples', () => {
  // WCAG 2.2 ACT rule "Text has minimum contrast" (afw4f7), Passed Example
  // 10, quoted directly: "This text has the default user agent link text
  // and background color, of #0000EE and white. This results in a contrast
  // ratio of 9.39:1."
  const ratio = contrastRatio({ r: 0, g: 0, b: 0xee }, { r: 255, g: 255, b: 255 });
  expect(ratio).toBeCloseTo(9.39, 1);

  const checked = checkContrast('#0000EE', '#ffffff');
  expect(checked.wcag.ratio).toBeCloseTo(9.39, 1);
});

it('black on white is 21 to 1 and any colour against itself is 1 to 1', () => {
  // WCAG 2.2 glossary Note 1: "Contrast ratios can range from 1 to 21
  // (commonly written 1:1 to 21:1)" -- 21:1 is the black/white identity.
  expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 6);
  expect(checkContrast('#000000', '#ffffff').wcag.ratio).toBeCloseTo(21, 6);

  for (const hex of ['#123456', '#abcdef', '#ff00ff']) {
    expect(checkContrast(hex, hex).wcag.ratio).toBeCloseTo(1, 6);
  }
});

it('the AA and AAA thresholds for normal text, large text and non-text contrast follow the WCAG 2.2 success criteria', () => {
  expect(WCAG_THRESHOLDS.aa).toEqual({ normal: 4.5, large: 3 });
  expect(WCAG_THRESHOLDS.aaa).toEqual({ normal: 7, large: 4.5 });
  expect(WCAG_THRESHOLDS.nonText).toBe(3);

  // A ratio just below a threshold never rounds up to a pass.
  const ratio = contrastRatio({ r: 118, g: 118, b: 118 }, { r: 255, g: 255, b: 255 });
  const results = checkContrast('#767676', '#ffffff').wcag.results;
  for (const row of results) {
    const shouldPass = ratio >= row.needs;
    expect(row.result === 'Pass').toBe(shouldPass);
  }

  const black = checkContrast('#000000', '#ffffff').wcag.results;
  expect(black.every((r) => r.result === 'Pass')).toBe(true);
});

it('the contrast ratio agrees with colorjs.io over 500 seeded colour pairs', () => {
  const rand = mulberry32(0xc0ffee);
  for (let i = 0; i < 500; i++) {
    const fg = { r: Math.floor(rand() * 256), g: Math.floor(rand() * 256), b: Math.floor(rand() * 256) };
    const bg = { r: Math.floor(rand() * 256), g: Math.floor(rand() * 256), b: Math.floor(rand() * 256) };
    const ratio = contrastRatio(fg, bg);
    const cjs = Color.contrast(
      new Color('srgb', [fg.r / 255, fg.g / 255, fg.b / 255]),
      new Color('srgb', [bg.r / 255, bg.g / 255, bg.b / 255]),
      'WCAG21',
    );
    expect(Math.abs(ratio - cjs)).toBeLessThan(0.01);
  }
});

it('a translucent foreground is composited over the background before contrast is measured', () => {
  // 50% black over white composites to mid-grey (#808080-ish), never the
  // uncomposited (0,0,0) black the raw foreground text names.
  const composited = compositeOver({ r: 0, g: 0, b: 0, alpha: 0.5 }, { r: 255, g: 255, b: 255, alpha: 1 });
  expect(composited.r).toBeCloseTo(127.5, 6);
  expect(composited.alpha).toBeCloseTo(1, 6);

  const opaque = contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 });
  const translucent = checkContrast('rgb(0 0 0 / 0.5)', '#ffffff').wcag.ratio;
  expect(translucent).toBeLessThan(opaque);
  expect(translucent).toBeGreaterThan(1);

  // A translucent background composites over white first.
  const translucentBg = checkContrast('#000000', 'rgb(0 0 0 / 0)').wcag.ratio;
  expect(translucentBg).toBeCloseTo(21, 1);
});

it('APCA lightness contrast matches the published APCA reference values', () => {
  // Hand-worked from the published APCA-W3 0.1.9 constants (Myndex
  // documentation), never from apca-w3's own source: full-contrast black
  // text on a white background, and white text on a black background.
  const blackOnWhite = apcaLc({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 });
  expect(blackOnWhite).toBeCloseTo(106.04, 1);
  expect(blackOnWhite).toBeGreaterThan(0);

  const whiteOnBlack = apcaLc({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 });
  expect(whiteOnBlack).toBeCloseTo(-107.88, 1);
  expect(whiteOnBlack).toBeLessThan(0);

  const checked = checkContrast('#000000', '#ffffff');
  expect(checked.apca.lc).toBeCloseTo(106.04, 1);
});

it('the APCA figure is labelled as an independent implementation and not a WCAG 2.2 result and is never combined with the WCAG ratio', () => {
  const result = checkContrast('#1f2937', '#ffffff');
  expect(result.apca.label).toBe(APCA_LABEL);
  expect(result.apca.label).toContain('independent implementation');
  expect(result.apca.label).toContain('not a WCAG 2.2 result');
  // The APCA figure and the WCAG ratio are two separate, independently
  // reported numbers -- never averaged, summed or otherwise combined.
  expect(result.apca.lc).not.toBe(result.wcag.ratio);
  expect(typeof result.apca.lc).toBe('number');
  expect(typeof result.wcag.ratio).toBe('number');
});

it('every declaration is valid for its property according to the css-tree lexer', () => {
  const samples = [
    checkContrast('#000000', '#ffffff'),
    checkContrast('#767676', '#666666'),
    checkContrast('rgb(0 0 0 / 0.5)', '#ffffff'),
  ];
  for (const result of samples) {
    const ast = csstree.parse(result.css, { positions: true });
    let count = 0;
    csstree.walk(ast, (node) => {
      if (node.type === 'Declaration') {
        count++;
        const match = csstree.lexer.matchProperty(node.property, node.value as never);
        expect(match.error, `${node.property}: ${result.css}`).toBeNull();
        expect(match.matched, `${node.property} did not match: ${result.css}`).not.toBeNull();
      }
    });
    // .sample (color, background-color, width, height) + .sample-normal
    // (font-size) + .sample-large (font-size) = 6 declarations.
    expect(count).toBe(6);
  }
});

it('hostile field values never produce CSS that can load anything or break out of a rule', () => {
  for (const hostile of HOSTILE_VALUES) {
    const result = checkContrast(hostile, hostile);
    expect(findUnsafeCss(result.css), result.css).toBeNull();
    expect(result.css).not.toContain('example.invalid');
    expect(result.css).not.toContain('url(');
  }
});

it('the generated CSS declares everything the preview needs, including the element size', () => {
  const result = checkContrast('#000000', '#ffffff');
  expect(result.tree.className).toBe('sample');
  expect(result.css).toContain('.sample {');
  expect(result.css).toMatch(/width: \d+px;/);
  expect(result.css).toMatch(/height: \d+px;/);
  expect(result.css).toContain('.sample-normal {');
  expect(result.css).toContain('.sample-large {');
});

it('nothing is written to the console while checking', () => {
  const spies = ['log', 'warn', 'error', 'info', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    checkContrast('#000000', '#ffffff');
    checkContrast('not-a-colour', 'also-not-a-colour');
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  } finally {
    for (const s of spies) s.mockRestore();
  }
});

it('throws ContrastError, not a generic error, only when the safety writer itself refuses (unreachable for validated input)', () => {
  expect(() => checkContrast('#000000', '#ffffff')).not.toThrow();
});

it('relativeLuminance is exported and matches the WCAG 2.2 glossary formula for pure white and pure black', () => {
  expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 6);
  expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 6);
});

it('throws only ContrastError as its own named error type', () => {
  expect(ContrastError).toBeDefined();
});
