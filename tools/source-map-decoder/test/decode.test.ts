import { SourceMap } from 'node:module';
import { expect, it } from 'vitest';
import { SourceMapError, decodeStackTrace } from '../src/index';
import { LIVE_MAP, LIVE_MAP_TEXT, LIVE_TRACE } from './live-map';

/*
 * The tracer: one stack trace from V8 and one esbuild map, decoded end to end. The expected positions are what Node's own
 * module.SourceMap gives for the same map (an independent reader), and the literals of the research recording
 * (src/math.ts 3:11 and 11:19, src/main.ts 6:9, 12:10 and 15:1), never the decoder's own output.
 */

const CANARY = 'CANARY-7f3a91-source-map-decoder-d4e8b2';

/** [line, column] of each frame of LIVE_TRACE, one based as V8 prints them. */
const FRAMES: [number, number][] = [
  [1, 35],
  [1, 128],
  [1, 178],
  [1, 220],
  [1, 234],
];
const EXPECTED = [
  { source: 'src/math.ts', line: 3, column: 11 },
  { source: 'src/math.ts', line: 11, column: 19 },
  { source: 'src/main.ts', line: 6, column: 9 },
  { source: 'src/main.ts', line: 12, column: 10 },
  { source: 'src/main.ts', line: 15, column: 1 },
];

it('the esbuild map of the live fixture decodes its five V8 frames to the positions Node gives', () => {
  const report = decodeStackTrace({ trace: LIVE_TRACE, maps: LIVE_MAP_TEXT });
  expect(report.rows).toHaveLength(5);

  const node = new SourceMap(LIVE_MAP);
  report.rows.forEach((row, i) => {
    const expected = EXPECTED[i];
    const [line, column] = FRAMES[i] ?? [0, 0];
    // Node counts from zero; V8 prints one based lines and columns.
    const entry = node.findEntry(line - 1, column - 1);
    expect(row.status).toBe('mapped');
    expect(row.source).toBe(expected?.source);
    expect(row.originalLine).toBe(expected?.line);
    expect(row.originalColumn).toBe(expected?.column);
    expect(row.source).toBe(entry.originalSource);
    expect(row.originalLine).toBe(entry.originalLine + 1);
    expect(row.originalColumn).toBe(entry.originalColumn + 1);
    expect(row.name).toBe(entry.name ?? null);
    expect(row.original).toBe(`${expected?.source}:${expected?.line}:${expected?.column}`);
  });

  // The call sites name the functions: frame 2 stands where checkPositive was called, frame 4 where sumAll was called,
  // frame 5 where run was called; n.add has no name at its caller's position and the last frame has no caller.
  expect(report.rows.map((row) => row.functionName)).toEqual(['checkPositive', null, 'sumAll', 'run', null]);
  expect(report.decoded.split('\n')).toEqual([
    'RangeError: value must be positive: -2',
    '    at checkPositive (src/math.ts:3:11)',
    '    at n.add (src/math.ts:11:19)',
    '    at sumAll (src/main.ts:6:9)',
    '    at run (src/main.ts:12:10)',
    '    at src/main.ts:15:1',
  ]);
  expect(report.maps).toHaveLength(1);
  expect(report.maps[0]?.errors).toBe(0);
  expect(report.maps[0]?.warnings).toBe(0);
  // One map and no name that matches the file: it is used for every frame, and the rows say so.
  expect(report.rows.every((row) => row.how === 'only')).toBe(true);
});

it('refusals name the map or the line and never repeat pasted text', () => {
  const messages: string[] = [];
  const refusal = (run: () => unknown): SourceMapError => {
    try {
      run();
    } catch (err) {
      if (err instanceof SourceMapError) {
        messages.push(err.message);
        return err;
      }
      throw err;
    }
    throw new Error('expected a refusal');
  };

  // A map that never closes: refused, naming the map and the character where it starts.
  const open = refusal(() => decodeStackTrace({ trace: LIVE_TRACE, maps: `{"version":3,"sources":["${CANARY}` }));
  expect(open.part).toBe('maps');
  expect(open.map).toBe(1);
  expect(open.message).toMatch(/Map 1 /);

  // Text that is not a map, after a good map: refused, naming the map before it.
  const stray = refusal(() => decodeStackTrace({ trace: LIVE_TRACE, maps: `${LIVE_MAP_TEXT}\n${CANARY}` }));
  expect(stray.map).toBe(1);

  // Closed but not JSON, and nothing else to decode with: refused naming map 1; the canary is in no message.
  const notJson = refusal(() => decodeStackTrace({ trace: LIVE_TRACE, maps: `{${CANARY}}` }));
  expect(notJson.map).toBe(1);

  // A trace over 5,000 lines: refused naming the number.
  const longTrace = refusal(() => decodeStackTrace({ trace: `${CANARY}\n`.repeat(5001), maps: '' }));
  expect(longTrace.part).toBe('trace');
  expect(longTrace.message).toContain('5,000');

  // A trace of pasted text that is not a trace holds no frames: a result, never an error, and nothing is repeated.
  const text = decodeStackTrace({ trace: CANARY, maps: LIVE_MAP_TEXT });
  expect(text.rows).toHaveLength(0);
  expect(text.notes.length).toBeGreaterThan(0);

  // The canary appears in no message, note, finding or label of anything the decoder said.
  const said = JSON.stringify({ messages, notes: text.notes, findings: text.findings, maps: text.maps });
  // Not even the start of it: a cut-off copy of the input is still a copy.
  expect(said).not.toContain(CANARY.slice(0, 12));
});
