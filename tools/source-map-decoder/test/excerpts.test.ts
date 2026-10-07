import { expect, it } from 'vitest';
import { decodeStackTrace } from '../src/index';
import { buildMappings, mapText, v8Frame } from './helpers';
import { LIVE_MAP_TEXT, LIVE_TRACE } from './live-map';

/*
 * The original source shown around a frame (0 to 5 lines either side, at most 10 frames, 200 characters a line), and the
 * map's ignore list. Expected lines are the literals of the live map's sourcesContent.
 */

const URL_MIN = 'https://example.test/assets/min.js';

it('a source excerpt shows the frame line with the requested lines of context, cut at the file ends and at 200 characters', () => {
  const report = decodeStackTrace({ trace: LIVE_TRACE, maps: LIVE_MAP_TEXT, context: 2 });
  expect(report.excerpts.map((e) => [e.frame, e.source, e.startLine, e.marker])).toEqual([
    [1, 'src/math.ts', 1, 2],
    [2, 'src/math.ts', 9, 2],
    [3, 'src/main.ts', 4, 2],
    [4, 'src/main.ts', 10, 2],
    [5, 'src/main.ts', 13, 2],
  ]);
  expect(report.excerpts[0]?.lines).toEqual([
    'export function checkPositive(value: number): number {',
    '  if (value <= 0) {',
    "    throw new RangeError('value must be positive: ' + value);",
    '  }',
    '  return value;',
  ]);
  // The last frame stands on line 15 of 15: two lines before it, none after (the empty piece after the final line
  // feed is not a line).
  expect(report.excerpts[4]?.lines).toEqual(['}', '', 'run();']);

  // No context: the frame's own line.
  const none = decodeStackTrace({ trace: LIVE_TRACE, maps: LIVE_MAP_TEXT, context: 0 });
  expect(none.excerpts[0]).toMatchObject({
    startLine: 3,
    marker: 0,
    lines: ["    throw new RangeError('value must be positive: ' + value);"],
  });
  // Five lines of context at the start of a file: the file's first lines, and the marker still on the frame's line.
  const five = decodeStackTrace({ trace: LIVE_TRACE, maps: LIVE_MAP_TEXT, context: 5 });
  expect(five.excerpts[0]).toMatchObject({ startLine: 1, marker: 2 });
  expect(five.excerpts[0]?.lines).toHaveLength(8);

  // Lines end at a line feed, a carriage return, a pair of them and U+2028; a long line is cut at 200 characters.
  const content =
    ['one', 'two', 'x'.repeat(300), 'four', 'five'].join('\r\n') + String.fromCodePoint(0x2028) + 'six\rseven';
  const text = mapText({
    sources: ['a.ts'],
    sourcesContent: [content],
    mappings: buildMappings([
      [
        { col: 0, source: 0, line: 2, ocol: 0 },
        { col: 10, source: 0, line: 6, ocol: 0 },
        { col: 20, source: 0, line: 40, ocol: 0 },
      ],
    ]),
  });
  const cut = decodeStackTrace({ trace: v8Frame('f', URL_MIN, 1, 1), maps: text, context: 1 });
  expect(cut.excerpts[0]?.lines).toEqual(['two', `${'x'.repeat(200)}${String.fromCodePoint(0x2026)}`, 'four']);
  const ends = decodeStackTrace({ trace: v8Frame('f', URL_MIN, 1, 11), maps: text, context: 1 });
  expect(ends.excerpts[0]).toMatchObject({ startLine: 6, marker: 1, lines: ['six', 'seven'] });
  // A line past the end of the source, a source that is null and a map with no sourcesContent give no excerpt.
  expect(decodeStackTrace({ trace: v8Frame('f', URL_MIN, 1, 21), maps: text }).excerpts).toEqual([]);
  const bare = mapText({ mappings: buildMappings([[{ col: 0, source: 0, line: 0, ocol: 0 }]]) });
  expect(decodeStackTrace({ trace: v8Frame('f', URL_MIN, 1, 1), maps: bare }).excerpts).toEqual([]);
  const nulls = mapText({
    sources: ['a.ts'],
    sourcesContent: [null],
    mappings: buildMappings([[{ col: 0, source: 0, line: 0, ocol: 0 }]]),
  });
  expect(decodeStackTrace({ trace: v8Frame('f', URL_MIN, 1, 1), maps: nulls }).excerpts).toEqual([]);

  // At most 10 frames get an excerpt, the first 10 that have one.
  const many = Array.from({ length: 12 }, () => v8Frame('f', URL_MIN, 1, 1)).join('\n');
  const capped = decodeStackTrace({ trace: many, maps: text });
  expect(capped.excerpts).toHaveLength(10);
  expect(capped.excerpts.map((e) => e.frame)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

it('frames whose source is on the ignore list are marked, and can be hidden with a count', () => {
  const map = (key: string): string =>
    JSON.stringify({
      ...(JSON.parse(
        mapText({
          sources: ['app.ts', 'vendor.ts'],
          mappings: buildMappings([
            [
              { col: 0, source: 0, line: 1, ocol: 0 },
              { col: 10, source: 1, line: 2, ocol: 0 },
              { col: 20, source: 0, line: 3, ocol: 0 },
            ],
          ]),
        }),
      ) as object),
      [key]: [1],
    });
  const trace = [1, 11, 21].map((column) => v8Frame('f', URL_MIN, 1, column)).join('\n');
  for (const key of ['ignoreList', 'x_google_ignoreList']) {
    const shown = decodeStackTrace({ trace, maps: map(key) });
    expect(shown.rows.map((r) => [r.original, r.ignored])).toEqual([
      ['app.ts:2:1', false],
      ['vendor.ts:3:1', true],
      ['app.ts:4:1', false],
    ]);
    expect(shown.rows[1]?.note).toContain('ignore list');
    expect(shown.hiddenIgnored).toBe(0);

    const hidden = decodeStackTrace({ trace, maps: map(key), hideIgnored: true });
    expect(hidden.rows.map((r) => r.original)).toEqual(['app.ts:2:1', 'app.ts:4:1']);
    expect(hidden.decoded.split(String.fromCharCode(10))).toEqual(['    at f (app.ts:2:1)', '    at f (app.ts:4:1)']);
    expect(hidden.hiddenIgnored).toBe(1);
    expect(hidden.notes.map((n) => n.text)).toContain('1 frame from ignored sources was hidden.');
  }
});
