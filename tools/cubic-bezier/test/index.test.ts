import { it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CubicBezierError, EASING_PRESETS, generateEasing } from '../src/index';
import {
  KEYWORD_CURVES,
  NAMED_CURVES,
  controlToPointField,
  curveSvg,
  pointFieldToControl,
  sampleCurve,
  solveProgress,
} from '../src/bezier';
import { assertSafeTree, findUnsafeCss } from '../src/css-safe';

const REDUCED_PRELUDE = '@media (prefers-reduced-motion: reduce) {';

/** A small seeded generator, so the curves below are the same on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The independent second opinion: x(t) = input solved by plain bisection on the Bezier polynomial with the end points
 * P0 = (0, 0) and P3 = (1, 1) that CSS Easing Functions Level 1 defines, then y at that t. It never calls the package.
 */
function bisectProgress(x1: number, y1: number, x2: number, y2: number, input: number): number {
  const bezier = (t: number, a: number, b: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    if (bezier(mid, x1, x2) < input) low = mid;
    else high = mid;
  }
  return bezier((low + high) / 2, y1, y2);
}

type Points = [number, number, number, number];

const KEYWORDS: [string, Points][] = [
  ['linear', [0, 0, 1, 1]],
  ['ease', [0.25, 0.1, 0.25, 1]],
  ['ease-in', [0.42, 0, 1, 1]],
  ['ease-out', [0, 0, 0.58, 1]],
  ['ease-in-out', [0.42, 0, 0.58, 1]],
];

const HOSTILE_FIELD_VALUES = [
  'url(https://example.invalid/x)', // a resource function
  '@import url(https://example.invalid/x);', // an import rule
  'red; background: url(https://example.invalid/x)', // a second declaration
  '</style><script>top.__fodtXss=1</script>', // closing the style element
  '/* */ red', // a comment
  'expression(alert(1))', // an old script expression
];

it('the five keywords give the control points CSS Easing Functions Level 1 defines', () => {
  // https://www.w3.org/TR/css-easing-1/ : linear is cubic-bezier(0, 0, 1, 1) here, ease (0.25, 0.1, 0.25, 1), ease-in
  // (0.42, 0, 1, 1), ease-out (0, 0, 0.58, 1) and ease-in-out (0.42, 0, 0.58, 1).
  expect([...KEYWORD_CURVES.keys()]).toEqual(KEYWORDS.map(([name]) => name));
  for (const [name, points] of KEYWORDS) {
    expect([...KEYWORD_CURVES.get(name)!], name).toEqual(points);
    const result = generateEasing({ preset: name });
    const value = `cubic-bezier(${points.join(', ')})`;
    expect(result.value, name).toBe(value);
    expect(result.declaration, name).toBe(`transition-timing-function: ${value};`);
    expect(result.warnings, name).toEqual([]);
    expect(result.points, name).toEqual({ x1: points[0], y1: points[1], x2: points[2], y2: points[3] });
  }

  // The named curves are this page's own, labelled with their numbers, and never offered as CSS keywords.
  expect([...NAMED_CURVES.keys()]).toEqual(['back-out', 'back-in', 'smooth']);
  for (const [name, curve] of NAMED_CURVES) {
    expect(KEYWORD_CURVES.has(name), name).toBe(false);
    expect(curve.label, name).toContain(`(${curve.points.join(', ')})`);
    expect(generateEasing({ preset: name }).value, name).toBe(`cubic-bezier(${curve.points.join(', ')})`);
  }
  expect([...EASING_PRESETS.keys()]).toEqual([
    'custom',
    'linear',
    'ease',
    'ease-in',
    'ease-out',
    'ease-in-out',
    'back-out',
    'back-in',
    'smooth',
  ]);

  // Custom curves use the points they are given, written with at most three decimals.
  const custom = generateEasing({ preset: 'custom', p1: { x: 0.34, y: 1.56 }, p2: { x: 0.64, y: 1 } });
  expect(custom.value).toBe('cubic-bezier(0.34, 1.56, 0.64, 1)');
  expect(
    generateEasing({ preset: 'custom', p1: { x: 0.1 + 0.2, y: 0.30000000000000004 }, p2: { x: 1, y: 0 } }).value,
  ).toBe('cubic-bezier(0.3, 0.3, 1, 0)');
  // A preset other than custom ignores the points it is given.
  expect(generateEasing({ preset: 'ease', p1: { x: 0.9, y: 0.9 }, p2: { x: 0.9, y: 0.9 } }).value).toBe(
    'cubic-bezier(0.25, 0.1, 0.25, 1)',
  );
  // With nothing given the editor starts from ease.
  expect(generateEasing({}).value).toBe('cubic-bezier(0.25, 0.1, 0.25, 1)');
});

it('the pad maps to the curve as x and 1 minus y and x is clamped to 0 to 1 with a warning', () => {
  expect(pointFieldToControl({ x: 0.25, y: 0.9 })).toEqual({ x: 0.25, y: 0.1, clamped: false });
  expect(controlToPointField({ x: 0.25, y: 0.1 })).toEqual({ x: 0.25, y: 0.9 });
  // The pad's y runs downward and a curve's y upward, so a handle at the top of the pad is a curve value of 2.
  expect(pointFieldToControl({ x: 0.5, y: -1 })).toEqual({ x: 0.5, y: 2, clamped: false });
  expect(pointFieldToControl({ x: 0.5, y: 2 })).toEqual({ x: 0.5, y: -1, clamped: false });
  expect(pointFieldToControl({ x: 0, y: 0 })).toEqual({ x: 0, y: 1, clamped: false });
  expect(pointFieldToControl({ x: 1, y: 1 })).toEqual({ x: 1, y: 0, clamped: false });

  // An x outside 0 to 1 is held at the nearest end and flagged; a y outside the pad's range is kept as it is.
  expect(pointFieldToControl({ x: 1.4, y: 0.9 })).toEqual({ x: 1, y: 0.1, clamped: true });
  expect(pointFieldToControl({ x: -0.3, y: 0.9 })).toEqual({ x: 0, y: 0.1, clamped: true });
  expect(pointFieldToControl({ x: Number.NaN, y: 0.5 }).clamped).toBe(true);

  // The round trip holds for every pad value on the two decimal grid.
  for (let xi = 0; xi <= 100; xi += 7) {
    for (let yi = -100; yi <= 200; yi += 13) {
      const pad = { x: xi / 100, y: yi / 100 };
      const control = pointFieldToControl(pad);
      expect(control.clamped).toBe(false);
      expect(controlToPointField(control)).toEqual(pad);
    }
  }

  // The warning reaches the result, and the value shows the held number.
  const held = generateEasing({
    preset: 'custom',
    p1: pointFieldToControl({ x: 1.4, y: 0.9 }),
    p2: pointFieldToControl({ x: -0.3, y: 0 }),
  });
  expect(held.value).toBe('cubic-bezier(1, 0.1, 0, 1)');
  expect(held.warnings).toEqual([
    'Handle 1 time (x) must stay between 0 and 1, so 1 was used.',
    'Handle 2 time (x) must stay between 0 and 1, so 0 was used.',
  ]);
  // A caller that hands over control points outside the ranges gets the same hold, with a warning.
  const direct = generateEasing({ preset: 'custom', p1: { x: 3, y: 5 }, p2: { x: -2, y: -9 } });
  expect(direct.value).toBe('cubic-bezier(1, 2, 0, -1)');
  expect(direct.warnings.length).toBe(4);
  for (const warning of direct.warnings) expect(warning).toMatch(/^Handle [12] /);
  const unusable = generateEasing({
    preset: 'custom',
    p1: { x: Number.NaN, y: Number.POSITIVE_INFINITY },
    p2: { x: 1, y: 1 },
  });
  expect(unusable.value).toBe('cubic-bezier(0.25, 0.1, 1, 1)');
  expect(unusable.warnings.length).toBe(2);
  // A duration outside 0.2 to 5 seconds is held, with a warning.
  expect(generateEasing({ duration: 0 }).css).toContain('animation-duration: 0.2s;');
  expect(generateEasing({ duration: 99 }).css).toContain('animation-duration: 5s;');
  expect(generateEasing({ duration: 99 }).warnings.length).toBe(1);
  expect(generateEasing({ duration: Number.NaN }).css).toContain('animation-duration: 1s;');
  expect(generateEasing({ duration: 2.5 }).warnings).toEqual([]);
});

it('progress is 0 at the start and 1 at the end and matches an independent bisection to 1e-6', () => {
  const curves: Points[] = KEYWORDS.map(([, points]) => points);
  for (const [, curve] of NAMED_CURVES) curves.push([...curve.points]);
  const random = mulberry32(20261003);
  for (let i = 0; i < 40; i++) {
    const x1 = Math.round(random() * 100) / 100;
    const x2 = Math.round(random() * 100) / 100;
    const y1 = Math.round((random() * 3 - 1) * 100) / 100;
    const y2 = Math.round((random() * 3 - 1) * 100) / 100;
    curves.push([x1, y1, x2, y2]);
  }
  // Curves with a flat or vertical start or end, where the slope is zero or large.
  curves.push([0, 0, 1, 1], [0, 1, 1, 0], [0, 2, 1, -1], [0.5, 0, 0.5, 1]);

  let worst = 0;
  for (const curve of curves) {
    const [x1, y1, x2, y2] = curve;
    expect(solveProgress(x1, y1, x2, y2, 0), `${curve} at 0`).toBe(0);
    expect(solveProgress(x1, y1, x2, y2, 1), `${curve} at 1`).toBe(1);
    for (let i = 0; i <= 100; i++) {
      const input = i / 100;
      const difference = Math.abs(solveProgress(x1, y1, x2, y2, input) - bisectProgress(x1, y1, x2, y2, input));
      worst = Math.max(worst, difference);
      expect(difference, `${curve} at ${input}`).toBeLessThanOrEqual(1e-6);
    }
  }
  expect(worst).toBeLessThanOrEqual(1e-6);

  // Two curves whose x(t) is flat at an input of one half (x1 = 1 and x2 = 0 make x(t) = 0.5 + 4(t - 0.5)^3 there): a
  // rounding error of one part in 1e16 in x moves t by about 3e-6, so no solver, the bisection above included, can say y
  // better than about 1e-5 at that one input. They are held to 1e-4 and every other input to 1e-6.
  for (const [x1, y1, x2, y2] of [
    [1, 0, 0, 1],
    [1, 2, 0, -1],
  ] as Points[]) {
    for (let i = 0; i <= 100; i++) {
      const input = i / 100;
      const difference = Math.abs(solveProgress(x1, y1, x2, y2, input) - bisectProgress(x1, y1, x2, y2, input));
      expect(difference, `flat curve ${[x1, y1, x2, y2]} at ${input}`).toBeLessThanOrEqual(input === 0.5 ? 1e-4 : 1e-6);
    }
  }

  // Linear is the identity; ease at one half is 0.802403 (0.802403387584857 by the bisection above, recomputed here).
  for (let i = 0; i <= 20; i++) expect(solveProgress(0, 0, 1, 1, i / 20)).toBeCloseTo(i / 20, 9);
  const half = bisectProgress(0.25, 0.1, 0.25, 1, 0.5);
  expect(half).toBeCloseTo(0.802403387584857, 12);
  expect(solveProgress(0.25, 0.1, 0.25, 1, 0.5)).toBeCloseTo(0.802403, 6);
  expect(solveProgress(0.25, 0.1, 0.25, 1, 0.5)).toBeCloseTo(half, 9);
  // An input outside 0 to 1 is held at the ends; anything that is not a number is refused.
  expect(solveProgress(0.25, 0.1, 0.25, 1, -3)).toBe(0);
  expect(solveProgress(0.25, 0.1, 0.25, 1, 7)).toBe(1);
  expect(() => solveProgress(0.25, 0.1, 0.25, 1, Number.NaN)).toThrow(CubicBezierError);
}, 60_000);

it('the sample table has 11 rows at six decimals and the curve picture carries a title and description', () => {
  const rows = sampleCurve(0.25, 0.1, 0.25, 1);
  expect(rows.length).toBe(11);
  expect(rows.map((row) => row[0])).toEqual([
    '0.0',
    '0.1',
    '0.2',
    '0.3',
    '0.4',
    '0.5',
    '0.6',
    '0.7',
    '0.8',
    '0.9',
    '1.0',
  ]);
  for (const [i, row] of rows.entries()) {
    expect(row.length).toBe(2);
    expect(row[1], `row ${i}`).toMatch(/^-?\d\.\d{6}$/);
    expect(Math.abs(Number(row[1]) - bisectProgress(0.25, 0.1, 0.25, 1, i / 10)), `row ${i}`).toBeLessThanOrEqual(1e-6);
  }
  expect(rows[0]![1]).toBe('0.000000');
  expect(rows[5]![1]).toBe('0.802403');
  expect(rows[10]![1]).toBe('1.000000');
  // A curve that dips below zero never prints a negative zero.
  const dip = sampleCurve(0.42, -0.00000001, 1, 1);
  for (const row of dip) expect(row[1]).not.toBe('-0.000000');
  expect(sampleCurve(0.36, 0, 0.66, -0.56).some((row) => Number(row[1]) < 0)).toBe(true);
  // The page table is the same rows.
  expect(generateEasing({ preset: 'ease' }).table).toEqual(rows);

  const svg = curveSvg(0.25, 0.1, 0.25, 1);
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  expect(svg).toContain('role="img"');
  expect(svg).toMatch(/<title id="[a-z-]+">[^<]+<\/title>/);
  const description = /<desc id="[a-z-]+">([^<]+)<\/desc>/.exec(svg);
  expect(description).not.toBeNull();
  expect(description![1]).toContain('(0.25, 0.1)');
  expect(description![1]).toContain('(0.25, 1)');
  expect(svg).toContain('aria-labelledby=');
  // The curve is drawn by the SVG's own cubic Bezier command from (0, 0) to (1, 1), and both handles are shown.
  expect(svg).toMatch(/<path [^>]*d="M [\d.-]+ [\d.-]+ C [\d.-]+ [\d.-]+, [\d.-]+ [\d.-]+, [\d.-]+ [\d.-]+"/);
  expect((svg.match(/<circle /g) ?? []).length).toBe(2);
  // Nothing in the picture can run or load: a fixed list of element names, no script, link, event or address.
  const names = new Set((svg.match(/<[a-z]+/g) ?? []).map((tag) => tag.slice(1)));
  for (const name of names)
    expect(['svg', 'title', 'desc', 'rect', 'line', 'path', 'circle', 'text'].includes(name), name).toBe(true);
  expect(svg).not.toMatch(/<script|href|onload|onclick|javascript|<image|<style|url\(/i);
  expect(svg.replace('http://www.w3.org/2000/svg', '')).not.toContain('http');
  expect(generateEasing({ preset: 'ease' }).svg).toBe(svg);
  // A curve that leaves 0 to 1 vertically still fits the picture.
  const tall = curveSvg(0.34, 2, 0.64, -1);
  const box = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(tall);
  expect(box).not.toBeNull();
  expect(Number(box![2])).toBeGreaterThan(Number(/viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)![2]));
});

it('the preview stylesheet carries the timing function and the reduced-motion rule and passes the safety check', () => {
  for (const [name, points] of [...KEYWORDS, ['custom', [0.34, 1.56, 0.64, 1] as Points]] as [string, Points][]) {
    const result = generateEasing({
      preset: name,
      p1: { x: points[0], y: points[1] },
      p2: { x: points[2], y: points[3] },
      duration: 1.5,
    });
    const value = `cubic-bezier(${points.join(', ')})`;
    expect(result.css, name).toContain('@keyframes move {');
    expect(result.css, name).toContain(`animation-timing-function: ${value};`);
    expect(result.css, name).toContain('animation-name: move;');
    expect(result.css, name).toContain('animation-duration: 1.5s;');
    expect(result.css, name).toContain('animation-iteration-count: infinite;');
    // One way only, with a pause at the end: a return trip would run the curve backwards, not the copied curve.
    expect(result.css, name).toContain('animation-direction: normal;');
    expect(result.css, name).not.toContain('alternate');
    // The dot moves during the first three quarters of a play and then waits; the timing function is on the dot, so it
    // shapes the move between the first two frames, the same curve on every play.
    const frames = [
      '  from {',
      '    transform: translateX(0px);',
      '  }',
      '  75% {',
      '    transform: translateX(216px);',
      '  }',
      '  to {',
      '    transform: translateX(216px);',
      '  }',
    ];
    expect(result.css, name).toContain(frames.join('\n'));
    // The exact reduced-motion block, last, stopping the dot.
    const at = result.css.indexOf(REDUCED_PRELUDE);
    expect(at, name).toBeGreaterThan(0);
    expect(result.css.slice(at), name).toBe(`${REDUCED_PRELUDE}\n.dot {\n  animation: none;\n}\n}`);
    expect(findUnsafeCss(result.css), name).toBeNull();
    expect(() => assertSafeTree(result.tree), name).not.toThrow();
    expect(result.tree, name).toEqual({ className: 'track', children: [{ className: 'dot' }] });
  }
  // The dot travels the track less its own width: 240 less 24.
  const css = generateEasing({ preset: 'ease' }).css;
  expect(css).toContain('width: 240px;');
  expect(css).toContain('transform: translateX(216px);');

  // Hostile text in the preset never reaches the CSS or the message.
  for (const hostile of HOSTILE_FIELD_VALUES) {
    let message = '';
    try {
      generateEasing({ preset: hostile });
    } catch (err) {
      expect(err).toBeInstanceOf(CubicBezierError);
      message = (err as Error).message;
    }
    expect(message, hostile).not.toBe('');
    expect(message).not.toContain(hostile);
    expect(message).not.toContain('example.invalid');
  }
  // Every curve any caller can reach writes a safe stylesheet.
  const random = mulberry32(77);
  for (let i = 0; i < 60; i++) {
    const result = generateEasing({
      preset: 'custom',
      p1: { x: random() * 3 - 1, y: random() * 8 - 3 },
      p2: { x: random() * 3 - 1, y: random() * 8 - 3 },
      duration: random() * 8,
    });
    expect(findUnsafeCss(result.css)).toBeNull();
    expect(result.css).not.toMatch(/NaN|Infinity/);
    expect(result.value).toMatch(/^cubic-bezier\(-?[\d.]+, -?[\d.]+, -?[\d.]+, -?[\d.]+\)$/);
  }
});

it('preset names are looked up safely for __proto__, constructor and toString', () => {
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    expect(KEYWORD_CURVES.has(name), name).toBe(false);
    expect(NAMED_CURVES.has(name), name).toBe(false);
    expect(EASING_PRESETS.has(name), name).toBe(false);
    expect(() => generateEasing({ preset: name }), name).toThrow(CubicBezierError);
    expect(() => generateEasing({ preset: name }), name).toThrow(/choices on offer/);
  }
  expect(() => generateEasing({ preset: 5 as unknown as string })).toThrow(CubicBezierError);
});

it('css-safe.ts is the canonical copy', () => {
  const bytes = readFileSync(new URL('../src/css-safe.ts', import.meta.url));
  expect(createHash('md5').update(bytes).digest('hex')).toBe('ad0bffed52987b6b331c6d39227b080f');
});

it('nothing is written to the console while shaping curves', () => {
  const spies = (['log', 'warn', 'error'] as const).map((name) =>
    vi.spyOn(console, name).mockImplementation(() => undefined),
  );
  try {
    for (const name of EASING_PRESETS.keys()) generateEasing({ preset: name });
    generateEasing({ preset: 'custom', p1: { x: 9, y: 9 }, p2: { x: Number.NaN, y: 0 }, duration: -1 });
    try {
      generateEasing({ preset: 'nope' });
    } catch {
      // The refusal is a thrown error, never a log line.
    }
    sampleCurve(0.1, 0.2, 0.3, 0.4);
    curveSvg(0.1, 0.2, 0.3, 0.4);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});
