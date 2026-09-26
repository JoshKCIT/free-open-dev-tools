import { it, expect, vi } from 'vitest';
import * as csstree from 'css-tree';
import { generateBorderRadius, BorderRadiusError, type BorderRadiusCorners } from '../src/index';
import { findUnsafeCss } from '../src/css-safe';
import { HOSTILE_VALUES } from './hostile-css';

function baseCorners(x = 24, y = 24): BorderRadiusCorners {
  return {
    topLeft: { x, y },
    topRight: { x, y },
    bottomRight: { x, y },
    bottomLeft: { x, y },
  };
}

/**
 * A deterministic PRNG hand-ported from `tools/mock-data/src/index.ts`
 * (mulberry32), used only to generate this test's own random corner sets --
 * never imported across tool packages (D-02).
 */
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

interface ExpandedCorner {
  x: string;
  y: string;
}
interface ExpandedCorners {
  topLeft: ExpandedCorner;
  topRight: ExpandedCorner;
  bottomRight: ExpandedCorner;
  bottomLeft: ExpandedCorner;
}

/** Applies CSS's 1-to-4-value expansion rule (top-left, top-right, bottom-right, bottom-left order). */
function expandList(values: string[]): [string, string, string, string] {
  if (values.length === 1) return [values[0]!, values[0]!, values[0]!, values[0]!];
  if (values.length === 2) return [values[0]!, values[1]!, values[0]!, values[1]!];
  if (values.length === 3) return [values[0]!, values[1]!, values[2]!, values[1]!];
  return [values[0]!, values[1]!, values[2]!, values[3]!];
}

/**
 * An independent expander (never calling into `../src/index`'s own
 * shortening code) that reverses a `border-radius` shorthand back to its
 * eight corner radii, per CSS Backgrounds and Borders Level 3 section 4.1:
 * "If values are given before and after the slash, then the values before
 * the slash set the horizontal radii and the values after the slash set
 * the vertical radii. If there is no slash, then the values set the radii
 * in both axes equally. The four values for each radii are given in the
 * order top-left, top-right, bottom-right, bottom-left. If bottom-left is
 * omitted it is the same as top-right. If bottom-right is omitted it is
 * the same as top-left. If top-right is omitted it is the same as
 * top-left."
 */
function expandShorthand(shorthand: string): ExpandedCorners {
  const [hPart, vPartRaw] = shorthand.split('/').map((s) => s.trim());
  const hVals = expandList(hPart!.split(/\s+/));
  const vVals = expandList((vPartRaw ?? hPart!).split(/\s+/));
  return {
    topLeft: { x: hVals[0], y: vVals[0] },
    topRight: { x: hVals[1], y: vVals[1] },
    bottomRight: { x: hVals[2], y: vVals[2] },
    bottomLeft: { x: hVals[3], y: vVals[3] },
  };
}

it('generates the plan default: 24px on every corner gives border-radius: 24px', () => {
  const result = generateBorderRadius({ corners: baseCorners(24, 24) });
  expect(result.shorthand).toBe('24px');
  expect(result.css).toContain('border-radius: 24px;');
  expect(result.css).toContain('width: 240px;');
  expect(result.css).toContain('height: 160px;');
  expect(result.css).toContain('background-color: #2563eb;');
});

it('the shorthand expands back to the same eight corner radii by the CSS Backgrounds and Borders Level 3 rules', () => {
  // CSS Backgrounds and Borders Level 3, section 4.1, quoted directly:
  // "border-radius: 2em 1em 4em / 0.5em 3em; is equivalent to
  // border-top-left-radius: 2em 0.5em; border-top-right-radius: 1em 3em;
  // border-bottom-right-radius: 4em 0.5em; border-bottom-left-radius: 1em 3em;"
  expect(expandShorthand('2em 1em 4em / 0.5em 3em')).toEqual({
    topLeft: { x: '2em', y: '0.5em' },
    topRight: { x: '1em', y: '3em' },
    bottomRight: { x: '4em', y: '0.5em' },
    bottomLeft: { x: '1em', y: '3em' },
  });
  // "border-radius: 4em; is equivalent to border-top-left-radius: 4em; ...
  // (all four)."
  expect(expandShorthand('4em')).toEqual({
    topLeft: { x: '4em', y: '4em' },
    topRight: { x: '4em', y: '4em' },
    bottomRight: { x: '4em', y: '4em' },
    bottomLeft: { x: '4em', y: '4em' },
  });

  const rand = mulberry32(0x7ab1e5);
  for (let i = 0; i < 500; i++) {
    const corners: BorderRadiusCorners = {
      topLeft: { x: Math.floor(rand() * 400), y: Math.floor(rand() * 400) },
      topRight: { x: Math.floor(rand() * 400), y: Math.floor(rand() * 400) },
      bottomRight: { x: Math.floor(rand() * 400), y: Math.floor(rand() * 400) },
      bottomLeft: { x: Math.floor(rand() * 400), y: Math.floor(rand() * 400) },
    };
    // A large box keeps the overlap rule from constraining these
    // corners; the shorthand round trip is independent of that rule.
    const result = generateBorderRadius({ corners, width: 480, height: 480 });
    const expanded = expandShorthand(result.shorthand);
    expect(`${expanded.topLeft.x} ${expanded.topLeft.y}`).toBe(result.longhands.topLeft);
    expect(`${expanded.topRight.x} ${expanded.topRight.y}`).toBe(result.longhands.topRight);
    expect(`${expanded.bottomRight.x} ${expanded.bottomRight.y}`).toBe(result.longhands.bottomRight);
    expect(`${expanded.bottomLeft.x} ${expanded.bottomLeft.y}`).toBe(result.longhands.bottomLeft);
  }
});

it('equal horizontal and vertical radii are written without a slash and the shortest value list is used', () => {
  // "corners 10, 20, 30, 40 px (horizontal equal to vertical) give
  // border-radius: 10px 20px 30px 40px" -- each corner's own x equals its
  // own y, but the four corners differ from each other, so the four-value
  // list survives unshortened.
  const distinct = generateBorderRadius({
    corners: {
      topLeft: { x: 10, y: 10 },
      topRight: { x: 20, y: 20 },
      bottomRight: { x: 30, y: 30 },
      bottomLeft: { x: 40, y: 40 },
    },
    width: 480,
    height: 480,
  });
  expect(distinct.shorthand).toBe('10px 20px 30px 40px');

  // "10, 20, 10, 20 give 10px 20px" -- the four-value list collapses to two.
  const collapsing = generateBorderRadius({
    corners: {
      topLeft: { x: 10, y: 10 },
      topRight: { x: 20, y: 20 },
      bottomRight: { x: 10, y: 10 },
      bottomLeft: { x: 20, y: 20 },
    },
    width: 480,
    height: 480,
  });
  expect(collapsing.shorthand).toBe('10px 20px');

  // "horizontal 10 and vertical 5 on every corner give 10px / 5px".
  const slash = generateBorderRadius({
    corners: {
      topLeft: { x: 10, y: 5 },
      topRight: { x: 10, y: 5 },
      bottomRight: { x: 10, y: 5 },
      bottomLeft: { x: 10, y: 5 },
    },
    width: 480,
    height: 480,
  });
  expect(slash.shorthand).toBe('10px / 5px');
});

it('overlapping corner radii are reported with the scale factor of the CSS Backgrounds and Borders Level 3 overlapping curves rule', () => {
  // The plan's own vector: two 150px corners on a 240px wide side.
  const simple = generateBorderRadius({
    corners: {
      topLeft: { x: 150, y: 0 },
      topRight: { x: 150, y: 0 },
      bottomRight: { x: 0, y: 0 },
      bottomLeft: { x: 0, y: 0 },
    },
    width: 240,
    height: 480,
  });
  expect(simple.overlapScale).not.toBeNull();
  expect(simple.overlapScale!).toBeCloseTo(0.8, 6);
  expect(simple.warnings.some((w) => /overlap/i.test(w))).toBe(true);

  // CSS Backgrounds and Borders Level 3's own worked example, translated
  // from em to px at a fixed 100px/em so the arithmetic is checkable: "if
  // the height is only 2em [with] border-radius: 0.5em 2em 0.5em 2em[,]
  // all corners need to be reduced by a factor 0.8 to make them fit."
  const spec = generateBorderRadius({
    corners: {
      topLeft: { x: 50, y: 50 },
      topRight: { x: 200, y: 200 },
      bottomRight: { x: 50, y: 50 },
      bottomLeft: { x: 200, y: 200 },
    },
    width: 600,
    height: 200,
  });
  expect(spec.overlapScale!).toBeCloseTo(0.8, 6);

  const noOverlap = generateBorderRadius({ corners: baseCorners(24, 24) });
  expect(noOverlap.overlapScale).toBeNull();
});

it('every declaration is valid for its property according to the css-tree lexer', () => {
  const samples = [
    generateBorderRadius({ corners: baseCorners(24, 24) }),
    generateBorderRadius({ corners: baseCorners(10, 5), unit: '%' }),
    generateBorderRadius({
      corners: {
        topLeft: { x: 150, y: 0 },
        topRight: { x: 150, y: 0 },
        bottomRight: { x: 0, y: 0 },
        bottomLeft: { x: 0, y: 0 },
      },
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
    expect(declarationCount).toBe(4);
  }
});

it('hostile field values never produce CSS that can load anything or break out of a rule', () => {
  for (const hostile of HOSTILE_VALUES) {
    let result;
    try {
      result = generateBorderRadius({ corners: baseCorners(), background: hostile });
    } catch (err) {
      expect(err).toBeInstanceOf(BorderRadiusError);
      continue;
    }
    expect(findUnsafeCss(result.css), result.css).toBeNull();
    expect(result.css).not.toContain('example.invalid');
    expect(result.css).not.toContain('url(');
  }

  const numericHostileValues = [NaN, Infinity, -Infinity, 1e21, -1e21, -400];
  for (const value of numericHostileValues) {
    const result = generateBorderRadius({
      corners: {
        topLeft: { x: value, y: value },
        topRight: { x: value, y: value },
        bottomRight: { x: value, y: value },
        bottomLeft: { x: value, y: value },
      },
      width: value,
      height: value,
    });
    expect(findUnsafeCss(result.css), result.css).toBeNull();
    expect(result.css).not.toContain('example.invalid');
  }
});

it('the generated CSS declares everything the preview needs, including the element size', () => {
  const result = generateBorderRadius({ corners: baseCorners() });
  expect(result.tree.className).toBe('box');
  expect(result.css).toContain('.box {');
  expect(result.css).toMatch(/width: \d+px;/);
  expect(result.css).toMatch(/height: \d+px;/);
});

it('nothing is written to the console while generating', () => {
  const spies = ['log', 'warn', 'error', 'info', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    generateBorderRadius({ corners: baseCorners(24, 24) });
    generateBorderRadius({ corners: baseCorners(10, 5), unit: '%', background: 'not-a-colour' });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  } finally {
    for (const s of spies) s.mockRestore();
  }
});
