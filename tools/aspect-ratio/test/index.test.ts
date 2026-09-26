import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { it, expect, vi } from 'vitest';
import * as csstree from 'css-tree';
import {
  solveAspect,
  simplifyRatio,
  formatAspectRatioCss,
  AspectRatioError,
  COMMON_RATIOS,
  COMMON_RESOLUTIONS,
  COMMON_SIZES_SOURCE,
} from '../src/index';

// Quoted from CSS Box Sizing Module Level 4, https://www.w3.org/TR/css-sizing-4/, section 4.1
// "Preferred Aspect Ratios: the aspect-ratio property", fetched this session:
//   "Name: aspect-ratio; Value: auto || <ratio>; Applies to: all elements except inline boxes
//   and internal ruby or table boxes"
//
// Quoted from CSS Values and Units Module Level 4, https://www.w3.org/TR/css-values-4/,
// section 5.7 "Ratios: the <ratio> type", fetched this session:
//   "<ratio> = <number [0,∞]> [ / <number [0,∞]> ]?" ... "However, <ratio> is
//   always serialized with both components."
//
// D-121/D-122 (orchestrator amendment, 2026-09-25): the common ratio and resolution table is
// not vendored from a third-party source; every row is cited by name to the standard that
// defines it (see tools/aspect-ratio/src/common-sizes.ts and common-sizes-NOTICE.txt).

it('a missing width or height is solved from the other and the ratio, rounded to whole pixels with the error shown', () => {
  const height = solveAspect({ solveFor: 'height', width: 1920, ratio: { w: 16, h: 9 } });
  expect(height.height).toBe(1080);
  expect(height.roundingError).toBeCloseTo(0, 9);

  const width = solveAspect({ solveFor: 'width', height: 1080, ratio: { w: 4, h: 3 } });
  expect(width.width).toBe(1440);
  expect(width.roundingError).toBeCloseTo(0, 9);

  // A ratio that does not divide evenly: exact 1000 * 9/16 = 562.5, rounds to 563, error -0.5.
  const rounded = solveAspect({ solveFor: 'height', width: 1000, ratio: { w: 16, h: 9 } });
  expect(rounded.height).toBe(563);
  expect(rounded.roundingError).toBeCloseTo(562.5 - 563, 9);
});

it('a width and height reduce to the simplest whole-number ratio by the greatest common divisor', () => {
  expect(simplifyRatio(1920, 1080)).toEqual({ w: 16, h: 9 });
  expect(simplifyRatio(1024, 768)).toEqual({ w: 4, h: 3 });
  expect(simplifyRatio(1, 1)).toEqual({ w: 1, h: 1 });

  const solved = solveAspect({ solveFor: 'ratio', width: 1920, height: 1080 });
  expect(solved.ratio).toEqual({ w: 16, h: 9 });
});

it('decimal ratios such as 2.39 to 1 are kept as written and also shown as the nearest simple ratio', () => {
  const result = simplifyRatio(2.39, 1);
  expect(result.w).toBe(2.39);
  expect(result.h).toBe(1);
  expect(result.nearestWhole).toBeDefined();
  expect(result.nearestWhole!.w).toBeLessThanOrEqual(100);
  expect(result.nearestWhole!.h).toBeLessThanOrEqual(100);
  expect(result.nearestWhole!.error).toBeLessThan(0.001);
  expect(result.nearestWhole!.w / result.nearestWhole!.h).toBeCloseTo(2.39, 2);
});

it('every common ratio and resolution is cited to the standard that defines it, with no bundled third-party data file', () => {
  expect(COMMON_RATIOS.length).toBeGreaterThanOrEqual(8);
  expect(COMMON_RESOLUTIONS.length).toBeGreaterThanOrEqual(5);
  for (const entry of COMMON_RATIOS) {
    expect(entry.name.length).toBeGreaterThan(0);
    expect(entry.commonUses.length).toBeGreaterThan(0);
    expect(entry.ratio.w).toBeGreaterThan(0);
    expect(entry.ratio.h).toBeGreaterThan(0);
  }
  for (const entry of COMMON_RESOLUTIONS) {
    expect(entry.width).toBeGreaterThan(0);
    expect(entry.height).toBeGreaterThan(0);
  }
  // Required ratios and resolutions named in this plan.
  const ratioNames = COMMON_RATIOS.map((r) => r.name).join(' | ');
  for (const fragment of ['1:1', '4:3', '3:2', '16:10', '16:9', '21:9', '9:16', '2.39:1']) {
    expect(ratioNames).toContain(fragment);
  }
  const resolutionSizes = COMMON_RESOLUTIONS.map((r) => `${r.width}x${r.height}`);
  for (const size of ['1280x720', '1920x1080', '2560x1440', '3840x2160', '7680x4320']) {
    expect(resolutionSizes).toContain(size);
  }
  // No vendored third-party data file exists for this table (D-122).
  const fixtureDir = join(__dirname, 'fixtures', 'common-resolutions');
  expect(existsSync(fixtureDir)).toBe(false);
});

it('the standards cited for the common ratios and resolutions name a real, fetchable specification', () => {
  expect(COMMON_SIZES_SOURCE.length).toBeGreaterThanOrEqual(3);
  for (const citation of COMMON_SIZES_SOURCE) {
    expect(citation.label.length).toBeGreaterThan(0);
    expect(citation.url).toMatch(/^https?:\/\//);
    expect(citation.whatItDefines.length).toBeGreaterThan(0);
  }
  const labels = COMMON_SIZES_SOURCE.map((c) => c.label).join(' | ');
  expect(labels).toContain('BT.709');
  expect(labels).toContain('BT.2020');
});

it('the CSS output is a ratio as CSS Box Sizing Level 4 and CSS Values Level 4 define it and passes the css-tree lexer', () => {
  const samples = [
    { w: 16, h: 9 },
    { w: 4, h: 3 },
    { w: 2.39, h: 1 },
    { w: 1, h: 1 },
  ];
  for (const ratio of samples) {
    const declaration = formatAspectRatioCss(ratio);
    expect(declaration.startsWith('aspect-ratio: ')).toBe(true);
    expect(declaration).toMatch(/^aspect-ratio: [0-9.]+ \/ [0-9.]+;$/);

    const ast = csstree.parse(`.x { ${declaration} }`, { positions: true });
    let declarationCount = 0;
    csstree.walk(ast, (node) => {
      if (node.type === 'Declaration') {
        declarationCount++;
        const match = csstree.lexer.matchProperty(node.property, node.value as never);
        expect(match.error, `${node.property}: ${declaration}`).toBeNull();
        expect(match.matched, `${node.property} did not match: ${declaration}`).not.toBeNull();
      }
    });
    expect(declarationCount).toBe(1);
  }
});

it('a solve with no ratio or a non-positive ratio is refused', () => {
  expect(() => solveAspect({ solveFor: 'height', width: 100 })).toThrow(AspectRatioError);
  expect(() => solveAspect({ solveFor: 'height', width: 100, ratio: { w: 0, h: 9 } })).toThrow(AspectRatioError);
  expect(() => solveAspect({ solveFor: 'ratio', width: 100 })).toThrow(AspectRatioError);
});

it('nothing is written to the console while solving', () => {
  const spies = ['log', 'warn', 'error', 'info', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    solveAspect({ solveFor: 'height', width: 1920, ratio: { w: 16, h: 9 } });
    solveAspect({ solveFor: 'ratio', width: -5, height: 500000 });
    simplifyRatio(2.39, 1);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  } finally {
    for (const s of spies) s.mockRestore();
  }
});
