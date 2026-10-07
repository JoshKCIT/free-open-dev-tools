import { expect, it } from 'vitest';
import {
  callSiteName,
  decodeStackTrace,
  matchMaps,
  parseFrame,
  parseTrace,
  splitMaps,
  type Frame,
  type MapClaim,
} from '../src/index';
import { buildMappings, mapText, v8Frame } from './helpers';
import { LIVE_MAP_TEXT, LIVE_TRACE } from './live-map';

/*
 * Reading traces, choosing maps and the positions that sit on the edge of a segment. Frame shapes are the ones the
 * three engines print (V8 documents its own at v8.dev/docs/stack-trace-api; the other two are shown in the recorded
 * stacks of the engines folder). Expected values are written out, never taken from the code under test.
 */

const URL_MIN = 'https://example.test/assets/min.js';

it('V8, SpiderMonkey and JavaScriptCore frames are read by their last two numbers and an unread line is kept unchanged', () => {
  type Expected = Pick<Frame, 'style' | 'functionName' | 'url' | 'line' | 'column'> &
    Partial<Pick<Frame, 'async' | 'inEval'>>;
  const read: [string, Expected][] = [
    [`    at e (${URL_MIN}:1:35)`, { style: 'v8', functionName: 'e', url: URL_MIN, line: 1, column: 35 }],
    [`    at ${URL_MIN}:1:234`, { style: 'v8', functionName: '', url: URL_MIN, line: 1, column: 234 }],
    [
      `    at async loadAll (${URL_MIN}:3:4)`,
      { style: 'v8', functionName: 'loadAll', url: URL_MIN, line: 3, column: 4, async: true },
    ],
    [
      `    at new Accumulator (${URL_MIN}:5:6)`,
      { style: 'v8', functionName: 'new Accumulator', url: URL_MIN, line: 5, column: 6 },
    ],
    [
      '    at Accumulator.add [as push] (file:///C:/work/app/a.js:7:8)',
      { style: 'v8', functionName: 'Accumulator.add [as push]', url: 'file:///C:/work/app/a.js', line: 7, column: 8 },
    ],
    [
      '    at Object.<anonymous> (C:\\work\\app\\a.js:9:10)',
      { style: 'v8', functionName: 'Object.<anonymous>', url: 'C:\\work\\app\\a.js', line: 9, column: 10 },
    ],
    [
      `    at eval (eval at build (${URL_MIN}:11:12), <anonymous>:1:1)`,
      { style: 'v8', functionName: 'eval', url: URL_MIN, line: 11, column: 12, inEval: true },
    ],
    [
      '    at webpack-internal:///(app-pages-browser)/./src/a.tsx:13:14',
      {
        style: 'v8',
        functionName: '',
        url: 'webpack-internal:///(app-pages-browser)/./src/a.tsx',
        line: 13,
        column: 14,
      },
    ],
    [
      '    at view (webpack-internal:///(app-pages-browser)/./src/a.tsx:15:16)',
      {
        style: 'v8',
        functionName: 'view',
        url: 'webpack-internal:///(app-pages-browser)/./src/a.tsx',
        line: 15,
        column: 16,
      },
    ],
    [`e@${URL_MIN}:1:35`, { style: 'gecko', functionName: 'e', url: URL_MIN, line: 1, column: 35 }],
    [`@${URL_MIN}:1:234`, { style: 'gecko', functionName: '', url: URL_MIN, line: 1, column: 234 }],
    [
      'render/<@https://example.test/a.js:2:3',
      { style: 'gecko', functionName: 'render/<', url: 'https://example.test/a.js', line: 2, column: 3 },
    ],
    [
      'async*main@https://example.test/a.js:4:5',
      { style: 'gecko', functionName: 'async*main', url: 'https://example.test/a.js', line: 4, column: 5 },
    ],
    [
      'u@file:///C:/work/a.js:6:7',
      { style: 'gecko', functionName: 'u', url: 'file:///C:/work/a.js', line: 6, column: 7 },
    ],
    [
      `global code@${URL_MIN}:1:240`,
      { style: 'gecko', functionName: 'global code', url: URL_MIN, line: 1, column: 240 },
    ],
    [
      'module code@https://example.test/m.js:2:2',
      { style: 'gecko', functionName: 'module code', url: 'https://example.test/m.js', line: 2, column: 2 },
    ],
  ];
  for (const [text, expected] of read) {
    const frame = parseFrame(text);
    expect(frame, text).not.toBeNull();
    expect(frame).toMatchObject(expected);
    // The white space in front is kept so the decoded line has the same shape.
    expect(frame?.indent).toBe(text.slice(0, text.length - text.trimStart().length));
  }

  // Lines that hold no readable position are not frames: they are kept where they are, unchanged.
  const unread = [
    'RangeError: value must be positive: -2',
    '',
    '    at <anonymous>',
    '    at fn (native)',
    '    at Array.map (<anonymous>)',
    'map@[native code]',
    `    at e (${URL_MIN}:0:5)`,
    `    at e (${URL_MIN}:1)`,
    'Error: write to me@example.test please',
    '    at '.padEnd(5_000, 'x'),
  ];
  for (const text of unread) expect(parseFrame(text), text).toBeNull();

  const trace = [unread[0], `    at e (${URL_MIN}:1:35)`, unread[2], '', `e@${URL_MIN}:1:35`].join('\r\n');
  const lines = parseTrace(trace);
  expect(lines.map((l) => l.text)).toEqual([
    unread[0],
    `    at e (${URL_MIN}:1:35)`,
    unread[2],
    '',
    `e@${URL_MIN}:1:35`,
  ]);
  expect(lines.map((l) => l.frame !== null)).toEqual([false, true, false, false, true]);

  // Through the whole decoder the unread lines stay in their places, word for word.
  const report = decodeStackTrace({ trace: `${LIVE_TRACE}\n    at <anonymous>\nend of trace`, maps: LIVE_MAP_TEXT });
  const decoded = report.decoded.split('\n');
  expect(decoded.slice(-2)).toEqual(['    at <anonymous>', 'end of trace']);
  expect(decoded[0]).toBe('RangeError: value must be positive: -2');

  // A position too big for the format is reported as out of range and is never looked up.
  const big = decodeStackTrace({
    trace: [
      `    at e (${URL_MIN}:1:4294967297)`,
      `    at e (${URL_MIN}:99999999999999999999:5)`,
      `    at e (${URL_MIN}:1:35)`,
    ].join('\n'),
    maps: LIVE_MAP_TEXT,
  });
  expect(big.rows.map((r) => r.status)).toEqual(['out-of-range', 'out-of-range', 'mapped']);
});

/** A map with four segments on generated line 0: names alpha, beta, none and gamma. */
const NAMED = mapText({
  sources: ['a.ts'],
  names: ['alpha', 'beta', 'gamma'],
  mappings: buildMappings([
    [
      { col: 0, source: 0, line: 0, ocol: 0, name: 0 },
      { col: 10, source: 0, line: 1, ocol: 0, name: 1 },
      { col: 20, source: 0, line: 2, ocol: 0 },
      { col: 30, source: 0, line: 3, ocol: 0, name: 2 },
    ],
  ]),
});

it('a frame is named from the next frame call site and the last frame gets no such name', () => {
  expect(callSiteName([{ name: 'a' }, { name: 'b' }, { name: null }], 0)).toBe('b');
  expect(callSiteName([{ name: 'a' }, { name: 'b' }, { name: null }], 1)).toBeNull();
  expect(callSiteName([{ name: 'a' }, { name: 'b' }, { name: null }], 2)).toBeNull();
  expect(callSiteName([{ name: 'a' }], 0)).toBeNull();
  expect(callSiteName([], 0)).toBeNull();

  const trace = [
    `    at new Foo (${URL_MIN}:1:1)`,
    `    at two (${URL_MIN}:1:11)`,
    `    at async three (${URL_MIN}:1:21)`,
    `    at four (${URL_MIN}:1:31)`,
  ].join('\n');
  const report = decodeStackTrace({ trace, maps: NAMED });
  // Frame 1 stands where beta was called; frame 2's caller has no name here; frame 3's caller says gamma; the last has none.
  expect(report.rows.map((r) => r.name)).toEqual(['alpha', 'beta', null, 'gamma']);
  expect(report.rows.map((r) => r.functionName)).toEqual(['beta', null, 'gamma', null]);
  expect(report.decoded.split('\n')).toEqual([
    '    at new beta (a.ts:1:1)',
    '    at two (a.ts:2:1)',
    '    at async gamma (a.ts:3:1)',
    '    at four (a.ts:4:1)',
  ]);
  // The same in the shape of the other two engines.
  const gecko = decodeStackTrace({
    trace: [`one@${URL_MIN}:1:1`, `two@${URL_MIN}:1:11`, `three@${URL_MIN}:1:21`, `@${URL_MIN}:1:31`].join('\n'),
    maps: NAMED,
  });
  expect(gecko.decoded.split('\n')).toEqual(['beta@a.ts:1:1', 'two@a.ts:2:1', 'gamma@a.ts:3:1', '@a.ts:4:1']);
});

it('maps are matched by file, then by opened file name, then by base name, and a frame no map claims is said, never guessed', () => {
  const claim = (file: string | null, openedName: string | null = null): MapClaim => ({ file, openedName });
  const frame = (url: string) => ({ url });

  // By the file field: the whole name, or its end after a slash; a name that is only the end of a word does not count.
  expect(matchMaps([frame('https://x.test/assets/b.js')], [claim('a.js'), claim('b.js')])).toEqual([
    { kind: 'matched', map: 1, how: 'file' },
  ]);
  expect(matchMaps([frame('https://x.test/assets/b.js?v=3#top')], [claim('/assets/b.js')])).toEqual([
    { kind: 'matched', map: 0, how: 'file' },
  ]);
  expect(matchMaps([frame('https://x.test/assets/bb.js')], [claim('b.js'), claim('c.js')])).toEqual([{ kind: 'none' }]);
  // By the name of an opened file without .map, when no file field names the address.
  expect(matchMaps([frame('https://x.test/a.js')], [claim(null, 'a.js.map'), claim(null, 'b.js.map')])).toEqual([
    { kind: 'matched', map: 0, how: 'opened' },
  ]);
  // The file field wins over an opened name that points at another map.
  expect(matchMaps([frame('https://x.test/a.js')], [claim(null, 'a.js.map'), claim('a.js', 'other.map')])).toEqual([
    { kind: 'matched', map: 1, how: 'file' },
  ]);
  // By base name last: the directories differ.
  expect(matchMaps([frame('https://x.test/assets/b.js')], [claim('dist/a.js'), claim('dist/b.js')])).toEqual([
    { kind: 'matched', map: 1, how: 'base' },
  ]);
  // Two maps that claim a file equally well are said, never chosen between.
  expect(matchMaps([frame('https://x.test/a.js')], [claim('a.js'), claim('a.js')])).toEqual([
    { kind: 'several', count: 2 },
  ]);
  // Maps were given and none claims the file; no map was given at all.
  expect(matchMaps([frame('https://x.test/c.js')], [claim('a.js'), claim('b.js')])).toEqual([{ kind: 'none' }]);
  expect(matchMaps([frame('https://x.test/c.js')], [])).toEqual([{ kind: 'no-maps' }]);
  // One map and no frame claimed: the map is applied to every frame, and says so.
  expect(matchMaps([frame('https://x.test/c.js'), frame('https://x.test/d.js')], [claim(null)])).toEqual([
    { kind: 'matched', map: 0, how: 'only' },
    { kind: 'matched', map: 0, how: 'only' },
  ]);
  // One map that claims some frames leaves the others alone: they are other files.
  expect(matchMaps([frame('https://x.test/a.js'), frame('https://x.test/other.js')], [claim('a.js')])).toEqual([
    { kind: 'matched', map: 0, how: 'file' },
    { kind: 'none' },
  ]);

  // Through the decoder: two maps, opened as files, a frame of each, and a frame of a third file.
  const mapA = mapText({
    sources: ['from-a.ts'],
    mappings: buildMappings([[{ col: 0, source: 0, line: 7, ocol: 0 }]]),
  });
  const mapB = mapText({
    sources: ['from-b.ts'],
    mappings: buildMappings([[{ col: 0, source: 0, line: 8, ocol: 0 }]]),
  });
  const trace = [
    `    at a (https://x.test/assets/a.js:1:1)`,
    `    at b (https://x.test/assets/b.js:1:1)`,
    `    at c (https://x.test/assets/c.js:1:1)`,
  ].join('\n');
  const report = decodeStackTrace({
    trace,
    maps: '',
    files: [
      { name: 'a.js.map', text: mapA },
      { name: 'b.js.map', text: mapB },
    ],
  });
  expect(report.rows.map((r) => [r.status, r.map, r.how, r.original])).toEqual([
    ['mapped', 1, 'opened', 'from-a.ts:8:1'],
    ['mapped', 2, 'opened', 'from-b.ts:9:1'],
    ['no-map', null, null, ''],
  ]);
  expect(report.rows[2]?.note).toBe('No map matches this file.');
  // The unmatched frame is left as pasted in the decoded trace.
  expect(report.decoded.split('\n')[2]).toBe('    at c (https://x.test/assets/c.js:1:1)');

  // Two maps that both claim a file: no map is used for it, and the row says how many matched.
  const twice = decodeStackTrace({
    trace: `    at a (https://x.test/a.js:1:1)`,
    maps: '',
    files: [
      { name: 'a.js.map', text: mapA },
      { name: 'a.js.map', text: mapB },
    ],
  });
  expect(twice.rows[0]?.status).toBe('several-maps');
  expect(twice.rows[0]?.note).toContain('2 maps match this file');

  // One map and a frame it does not claim, beside a frame it does: only the claimed frame is decoded.
  const single = decodeStackTrace({
    trace: [`    at a (https://x.test/assets/a.js:1:1)`, `    at c (https://x.test/assets/c.js:1:1)`].join('\n'),
    maps: '',
    files: [{ name: 'a.js.map', text: mapA }],
  });
  expect(single.rows.map((r) => r.status)).toEqual(['mapped', 'no-map']);

  // A map pasted for a trace whose file it does not name is used and flagged (it is the only map).
  const only = decodeStackTrace({ trace: `    at c (https://x.test/assets/c.js:1:1)`, maps: mapA });
  expect(only.rows[0]?.how).toBe('only');
  expect(only.rows[0]?.note).toContain('Only one map was given');
  expect(only.notes.some((n) => n.tone === 'warn')).toBe(true);
});

it('a position exactly on a segment maps to it and one column before maps to the segment before', () => {
  // Segments on generated line 0 at columns 0, 5 and 9, mapping to original lines 10, 20 and 30.
  const text = mapText({
    sources: ['a.ts'],
    mappings: buildMappings([
      [
        { col: 0, source: 0, line: 10, ocol: 0 },
        { col: 5, source: 0, line: 20, ocol: 0 },
        { col: 9, source: 0, line: 30, ocol: 0 },
      ],
    ]),
  });
  // One based columns as V8 prints them: 5 is zero based 4, 6 is zero based 5, and so on.
  const at = (column: number): string | null => {
    const row = decodeStackTrace({ trace: v8Frame('f', URL_MIN, 1, column), maps: text }).rows[0];
    return row?.original ?? null;
  };
  expect(at(1)).toBe('a.ts:11:1');
  expect(at(5)).toBe('a.ts:11:1');
  expect(at(6)).toBe('a.ts:21:1');
  expect(at(9)).toBe('a.ts:21:1');
  expect(at(10)).toBe('a.ts:31:1');
  expect(at(500)).toBe('a.ts:31:1');

  // Before the first segment of the line: a result that says where the line starts, never a guess from another line.
  const late = mapText({
    sources: ['a.ts'],
    mappings: buildMappings([[{ col: 3, source: 0, line: 4, ocol: 0 }], [{ col: 0, source: 0, line: 9, ocol: 0 }]]),
  });
  const early = decodeStackTrace({ trace: v8Frame('f', URL_MIN, 1, 3), maps: late }).rows[0];
  expect(early?.status).toBe('before-first');
  expect(early?.note).toContain('column 4');
  expect(early?.original).toBe('');
  // The first segment itself, and the line after it.
  expect(decodeStackTrace({ trace: v8Frame('f', URL_MIN, 1, 4), maps: late }).rows[0]?.original).toBe('a.ts:5:1');
  expect(decodeStackTrace({ trace: v8Frame('f', URL_MIN, 2, 1), maps: late }).rows[0]?.original).toBe('a.ts:10:1');
  // A line the map has no segment on is a result too, and a line past the end of the map.
  const gap = mapText({
    sources: ['a.ts'],
    mappings: buildMappings([[{ col: 0, source: 0, line: 0, ocol: 0 }], [], [{ col: 0, source: 0, line: 2, ocol: 0 }]]),
  });
  expect(decodeStackTrace({ trace: v8Frame('f', URL_MIN, 2, 1), maps: gap }).rows[0]?.status).toBe('no-line');
  expect(decodeStackTrace({ trace: v8Frame('f', URL_MIN, 99, 1), maps: gap }).rows[0]?.status).toBe('no-line');
});

it('two maps pasted back to back with nothing between them are read as two maps', () => {
  expect(splitMaps('{"a":1}{"b":2}')).toEqual(['{"a":1}', '{"b":2}']);
  expect(splitMaps(' \n{"a":1}\n\n  {"b":2}\n')).toEqual(['{"a":1}', '{"b":2}']);
  // Braces and quotes inside strings do not end or start a map.
  const tricky = ['{"a":"}{"}', '{"b":"\\"}"}', '{"c":{"d":[{}]}}'];
  expect(splitMaps(tricky.join(''))).toEqual(tricky);

  const mapA = mapText({
    file: 'a.js',
    sources: ['from-a.ts'],
    mappings: buildMappings([[{ col: 0, source: 0, line: 1, ocol: 0 }]]),
  });
  const mapB = mapText({
    file: 'b.js',
    sources: ['from-b.ts'],
    mappings: buildMappings([[{ col: 0, source: 0, line: 2, ocol: 0 }]]),
  });
  const report = decodeStackTrace({
    trace: [`    at a (https://x.test/a.js:1:1)`, `    at b (https://x.test/b.js:1:1)`].join('\n'),
    maps: mapA + mapB,
  });
  expect(report.maps.map((m) => [m.number, m.label, m.usable])).toEqual([
    [1, 'Map 1', true],
    [2, 'Map 2', true],
  ]);
  expect(report.rows.map((r) => r.original)).toEqual(['from-a.ts:2:1', 'from-b.ts:3:1']);
  expect(report.rows.map((r) => r.how)).toEqual(['file', 'file']);
});

it('an empty trace shows nothing, one frame decodes, and a map with empty mappings leaves the frame unmapped', () => {
  const empty = decodeStackTrace({ trace: '', maps: LIVE_MAP_TEXT });
  expect(empty.rows).toEqual([]);
  expect(empty.decoded).toBe('');
  expect(empty.excerpts).toEqual([]);
  expect(decodeStackTrace({ trace: '   \n  ', maps: LIVE_MAP_TEXT }).rows).toEqual([]);

  // A single frame decodes.
  const one = decodeStackTrace({ trace: v8Frame('e', URL_MIN, 1, 35), maps: LIVE_MAP_TEXT });
  expect(one.rows).toHaveLength(1);
  expect(one.rows[0]?.original).toBe('src/math.ts:3:11');
  expect(one.rows[0]?.functionName).toBeNull();

  // A map whose mappings is empty: a result for every frame, never an error.
  const blank = decodeStackTrace({ trace: LIVE_TRACE, maps: mapText({ mappings: '' }) });
  expect(blank.rows.map((r) => r.status)).toEqual(['no-line', 'no-line', 'no-line', 'no-line', 'no-line']);
  expect(blank.rows.every((r) => r.original === '' && r.note !== '')).toBe(true);
  expect(blank.maps[0]).toMatchObject({ usable: true, errors: 0, warnings: 0, segments: 0 });
  expect(blank.decoded).toBe(LIVE_TRACE);
  // Lines of nothing but separators are fine too.
  expect(decodeStackTrace({ trace: LIVE_TRACE, maps: mapText({ mappings: ';;;;' }) }).maps[0]?.errors).toBe(0);

  // A trace with frames but no map says that no map was given, and keeps every line.
  const none = decodeStackTrace({ trace: LIVE_TRACE, maps: '' });
  expect(none.rows.map((r) => r.status)).toEqual(['no-map', 'no-map', 'no-map', 'no-map', 'no-map']);
  expect(none.rows[0]?.note).toBe('No map was given.');
  expect(none.notes.map((n) => n.text)).toContain('No map was given, so the frames are shown as they are.');
  expect(none.decoded).toBe(LIVE_TRACE);
});

it('columns count UTF-16 code units, so a character outside the Basic Multilingual Plane counts as two', () => {
  // ECMA-426 section 4: a generated column is "computed as UTF-16 code units for JavaScript". The generated line below
  // holds a character outside the BMP, which JavaScript strings count as two code units, so x is at column 5.
  const generated = `"${String.fromCodePoint(0x1f600)}";x`;
  const unit = generated.indexOf('x');
  const point = Array.from(generated).indexOf('x');
  expect(unit).toBe(5);
  expect(point).toBe(4);

  // Segments at the start of the line and at x (counted in code units), then one more further on.
  const text = mapText({
    sources: ['a.ts'],
    mappings: buildMappings([
      [
        { col: 0, source: 0, line: 0, ocol: 0 },
        { col: unit, source: 0, line: 7, ocol: 0 },
        { col: unit + 4, source: 0, line: 9, ocol: 0 },
      ],
    ]),
  });
  const original = (zeroBasedColumn: number): string | null =>
    decodeStackTrace({ trace: v8Frame('f', URL_MIN, 1, zeroBasedColumn + 1), maps: text }).rows[0]?.original ?? null;
  // The position of x in code units hits its segment; the position counted in whole characters does not.
  expect(original(unit)).toBe('a.ts:8:1');
  expect(original(point)).toBe('a.ts:1:1');
  // The original column is a number of code units as well and is passed through untouched.
  const wide = mapText({ sources: ['a.ts'], mappings: buildMappings([[{ col: 0, source: 0, line: 0, ocol: 11 }]]) });
  expect(decodeStackTrace({ trace: v8Frame('f', URL_MIN, 1, 1), maps: wide }).rows[0]?.original).toBe('a.ts:1:12');
});

it('the same trace and maps give the same rows in trace order however many times and in whatever order they are decoded', () => {
  const inputs = [
    { trace: LIVE_TRACE, maps: LIVE_MAP_TEXT },
    { trace: [`    at b (https://x.test/b.js:1:1)`, `    at a (https://x.test/a.js:1:11)`].join('\n'), maps: NAMED },
    { trace: `one@${URL_MIN}:1:1\ntwo@${URL_MIN}:1:21`, maps: NAMED, context: 0, hideIgnored: true },
    { trace: LIVE_TRACE, maps: '' },
  ];
  const first = inputs.map((input) => decodeStackTrace(input));
  // Again, alone, in the same order; reversed; and interleaved with decodes of other input that fail.
  expect(inputs.map((input) => decodeStackTrace(input))).toEqual(first);
  const reversed = [...inputs].reverse().map((input) => decodeStackTrace(input));
  expect(reversed.reverse()).toEqual(first);
  for (let i = 0; i < inputs.length; i++) {
    expect(() => decodeStackTrace({ trace: LIVE_TRACE, maps: '{"never closed' })).toThrow();
    const input = inputs[i];
    if (input) expect(decodeStackTrace(input)).toEqual(first[i]);
  }
  // Rows follow the order of the frames in the trace, whichever map each came from.
  const mixed = decodeStackTrace({ trace: inputs[1]?.trace ?? '', maps: NAMED });
  expect(mixed.rows.map((r) => r.traceLine)).toEqual([1, 2]);
  expect(mixed.rows.map((r) => r.number)).toEqual([1, 2]);
});
