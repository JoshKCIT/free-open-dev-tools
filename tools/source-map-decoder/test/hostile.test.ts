import { expect, it } from 'vitest';
import { decodeNeededLines, decodeStackTrace, parseMap, parseTrace, splitMaps, type ParsedMap } from '../src/index';
import { buildMappings, mapText } from './helpers';
import { LIVE_MAP_TEXT, LIVE_TRACE } from './live-map';
import { HOSTILE, MAX_SCALING_RATIO, scalingRatio } from './scaling';

/*
 * Hostile input. A pasted text can be built to make a parser slow, or to hit a name a plain object already has
 * (__proto__, constructor, toString). The expectations are stated from the rules, not from the output: every lookup keyed
 * by a pasted name must treat these names as any other, and doubling a hostile input must not make a parser take more
 * than 6 times as long (a parser that reads its input once takes about 2 times as long), nor four times the input more
 * than 12 times as long (the doubling rule alone does not catch growth that is only quadratic over a short range).
 */

const NAMES = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];

it('file names and frame names __proto__, constructor and toString are plain names', () => {
  const polluted = Object.keys(Object.prototype);

  // Names in the map: its file, its sources and its names are these words, and so are two JSON keys.
  const text = JSON.stringify(
    JSON.parse(
      mapText({
        file: '__proto__',
        sources: ['constructor', 'toString'],
        names: ['__proto__', 'constructor', 'toString'],
        mappings: buildMappings([
          [
            { col: 0, source: 0, line: 1, ocol: 0, name: 0 },
            { col: 10, source: 1, line: 2, ocol: 0, name: 1 },
            { col: 20, source: 1, line: 3, ocol: 0, name: 2 },
            { col: 30, source: 0, line: 4, ocol: 0 },
          ],
        ]),
      }),
    ),
  ).replace('{"version"', '{"__proto__":{"sections":[1]},"constructor":{"mappings":1},"version"');
  const map = parseMap(text, 'x');
  expect(map.kind).toBe('map');
  expect(map.usable).toBe(true);
  expect(map.findings).toEqual([]);
  expect((map as ParsedMap).names).toEqual(['__proto__', 'constructor', 'toString']);

  // Frames named the same, from files named the same. Four opened files hold this map, whose file field says
  // __proto__: the first frame is claimed by all four (none is chosen), the others by their own file name.
  const trace = [
    '    at __proto__ (https://x.test/__proto__:1:1)',
    '    at constructor (https://x.test/constructor.js:1:11)',
    '    at toString (https://x.test/toString.js:1:21)',
    '    at hasOwnProperty (https://x.test/hasOwnProperty.js:1:31)',
  ].join('\n');
  const asFile = (name: string) => ({ name, text });
  const byFile = decodeStackTrace({
    trace,
    maps: '',
    files: [
      asFile('__proto__.map'),
      asFile('constructor.js.map'),
      asFile('toString.js.map'),
      asFile('hasOwnProperty.js.map'),
    ],
  });
  expect(byFile.rows.map((r) => r.status)).toEqual(['several-maps', 'mapped', 'mapped', 'mapped']);
  expect(byFile.rows.map((r) => r.how)).toEqual([null, 'opened', 'opened', 'opened']);
  // The same map pasted once: the file field names the first frame, and the other files are not its own.
  const single = decodeStackTrace({ trace, maps: text });
  expect(single.rows.map((r) => r.status)).toEqual(['mapped', 'no-map', 'no-map', 'no-map']);
  expect(single.rows[0]?.how).toBe('file');
  expect(single.rows[0]?.source).toBe('constructor');
  expect(single.rows[0]?.name).toBe('__proto__');
  expect(typeof single.rows[0]?.name).toBe('string');

  // Frames at the positions of the segments: the names come back as the plain strings they are.
  const positions = [1, 11, 21, 31]
    .map((column, i) => `    at ${NAMES[i]} (https://x.test/other.js:1:${column})`)
    .join('\n');
  const named = decodeStackTrace({ trace: positions, maps: text });
  expect(named.rows.map((r) => r.name)).toEqual(['__proto__', 'constructor', 'toString', null]);
  expect(named.rows.map((r) => r.source)).toEqual(['constructor', 'toString', 'toString', 'constructor']);
  expect(named.rows.map((r) => r.functionName)).toEqual(['constructor', 'toString', null, null]);
  expect(named.decoded.split('\n')[0]).toBe('    at constructor (constructor:2:1)');

  // Nothing was added to Object.prototype and no plain object gained a key.
  expect(Object.keys(Object.prototype)).toEqual(polluted);
  expect(({} as Record<string, unknown>)['sections']).toBeUndefined();
  expect(({} as Record<string, unknown>)['mappings']).toBeUndefined();
});

/** Time ratio of a function on an input four times as long, median of five samples. */
function fourTimes(fn: (input: string) => unknown, make: (n: number) => string, n: number): number {
  const guarded = (input: string): void => {
    try {
      fn(input);
    } catch {
      // A refusal is a valid outcome of a hostile input.
    }
  };
  const time = (input: string, reps: number): number => {
    const start = performance.now();
    for (let i = 0; i < reps; i++) guarded(input);
    return performance.now() - start;
  };
  const small = make(n);
  const large = make(4 * n);
  time(small, 1);
  time(large, 1);
  const probe = time(small, 1);
  const reps = Math.min(200, Math.max(1, Math.ceil(2 / Math.max(probe, 0.001))));
  const median = (input: string): number => {
    const samples = Array.from({ length: 5 }, () => time(input, reps)).sort((a, b) => a - b);
    return samples[2] ?? 0;
  };
  return median(large) / Math.max(median(small), 0.0005);
}

/** A ratio over the limit is measured twice more and the median of the three is judged; the limit is never raised. */
function judged(measure: () => number, limit: number): number {
  const first = measure();
  if (first <= limit) return first;
  const all = [first, measure(), measure()].sort((a, b) => a - b);
  return all[1] ?? first;
}

/** Texts that are built to hurt a parser, each for a size n, on top of the six every parser is held to. */
const OWN_TEXTS: ReadonlyArray<(n: number) => string> = [
  (n) => ','.repeat(n),
  (n) => ';'.repeat(n),
  (n) => 'A'.repeat(n),
  (n) => 'a'.repeat(n),
  (n) => 'g'.repeat(n),
  (n) => 'AAAA,'.repeat(Math.floor(n / 5)),
  (n) => 'AAAA;'.repeat(Math.floor(n / 5)),
  (n) => 'AAAAgAAAAD,E;'.repeat(Math.floor(n / 13)),
  (n) => '{"a":"'.repeat(Math.floor(n / 6)),
  (n) => '[{'.repeat(Math.floor(n / 2)),
  (n) => '"\\'.repeat(Math.floor(n / 2)),
  (n) => '{}'.repeat(Math.floor(n / 2)),
  (n) => `{"version":3,"sources":["a"],"names":[],"mappings":"${'A'.repeat(n)}"}`,
  (n) => `{"version":3,"sources":["a"],"names":[],"mappings":"${';'.repeat(n)}"}`,
  (n) => `{"version":3,"sources":["a"],"names":[],"mappings":"${',AAAA'.repeat(Math.floor(n / 5))}"}`,
  (n) => `{"version":3,"sections":[${'{"offset":{"line":0,"column":0},"map":{}},'.repeat(Math.floor(n / 40))}{}]}`,
];
const TEXTS: ReadonlyArray<(n: number) => string> = [...HOSTILE, ...OWN_TEXTS];

/** Trace texts: many short lines, built to hurt the frame reader. */
const TRACE_TEXTS: ReadonlyArray<(n: number) => string> = [
  (n) => ' at x (f.js:1:1)\n'.repeat(n),
  (n) => '@'.repeat(8).concat('\n').repeat(n),
  (n) => 'at '.repeat(4).concat('\n').repeat(n),
  (n) => ':1:'.repeat(6).concat('\n').repeat(n),
  (n) => ' ('.repeat(8).concat('\n').repeat(n),
  (n) => 'eval at '.repeat(3).concat('\n').repeat(n),
  (n) => `    at e (${'9'.repeat(30)}:${'9'.repeat(30)})\n`.repeat(n),
  (n) => '\r\n'.repeat(n),
  (n) => `x@y:1:2\n`.repeat(n),
  (n) => `    at async new e (eval at f (eval at g (h.js:1:2)), <anonymous>:3:4)\n`.repeat(n),
];

it('every parser stays linear on hostile input', { timeout: 120_000 }, () => {
  const shape = { sources: 1, names: 1 };
  const subjects: [string, (text: string) => unknown, ReadonlyArray<(n: number) => string>, number][] = [
    ['splitMaps', (text) => splitMaps(text), TEXTS, 20_000],
    ['parseMap', (text) => parseMap(text, 'x'), TEXTS, 20_000],
    ['decodeNeededLines', (text) => decodeNeededLines(text, [0, 5, 1_000_000], shape), TEXTS, 20_000],
    [
      'decodeStackTrace with hostile maps',
      (text) => decodeStackTrace({ trace: LIVE_TRACE, maps: text }),
      TEXTS,
      20_000,
    ],
    ['parseTrace', (text) => parseTrace(text), TRACE_TEXTS, 2_000],
    [
      'decodeStackTrace with a hostile trace',
      (text) => decodeStackTrace({ trace: text, maps: LIVE_MAP_TEXT }),
      TRACE_TEXTS,
      400,
    ],
  ];
  const slow: string[] = [];
  for (const [name, fn, makers, n] of subjects) {
    makers.forEach((make, i) => {
      const doubling = judged(() => scalingRatio(fn, make, n), MAX_SCALING_RATIO);
      if (doubling > MAX_SCALING_RATIO)
        slow.push(`${name} text ${i}: doubling took ${doubling.toFixed(1)} times as long`);
      const quadrupling = judged(() => fourTimes(fn, make, n), 12);
      if (quadrupling > 12)
        slow.push(`${name} text ${i}: four times the input took ${quadrupling.toFixed(1)} times as long`);
    });
  }
  expect(slow).toEqual([]);
});
