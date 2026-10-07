import { SourceMap } from 'node:module';
import { AnyMap, TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { expect, it } from 'vitest';
import { collectFindings, decodeFindings, decodeMap, decodeStackTrace, lookup, parseMap } from '../src/index';
import { buildMappings, mapText, mulberry32, readFixture } from './helpers';

/*
 * Second opinions on the lookup. Node's own module.SourceMap and @jridgewell/trace-mapping are used here as lookup
 * oracles only: a library is lenient about maps that are not valid (the suite shows it), so no validity verdict ever
 * comes from one. The real stacks of four engines were recorded by the scripts in fixtures/engines.
 */

interface Stacks {
  recordedAt: string;
  browsers: { recordedAt: string; playwright: string; engines: Record<string, { version: string; stack: string }> };
  node: { recordedAt: string; version: string; plain: string[]; mapped: string[] };
}
const STACKS = JSON.parse(readFixture('engines', 'stacks.json')) as Stacks;
const MIN_MAP = readFixture('engines', 'min.js.map');
const NAMES_ON_MIN = new TraceMap(MIN_MAP);
const NODE_ON_MIN = new SourceMap({
  ...(JSON.parse(MIN_MAP) as object),
  file: 'min.js',
  sourceRoot: '',
} as ConstructorParameters<typeof SourceMap>[0]);

/** What Node's reader answers for a position with a mapping; an unmapped position gives an object without these. */
interface NodeEntry {
  generatedLine?: number;
  originalSource?: string;
  originalLine?: number;
  originalColumn?: number;
  name?: string;
}

/** The line and column (one based) of every min.js position a recorded stack names, read by the test's own pattern. */
function positionsIn(text: string): [number, number][] {
  return [...text.matchAll(/min\.js:(\d+):(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

it('the recorded Chromium, Firefox, WebKit and Node stacks decode to the positions Node gives with source maps on', () => {
  const engines = STACKS.browsers.engines;
  expect(Object.keys(engines)).toEqual(['chromium', 'firefox', 'webkit']);
  expect(STACKS.recordedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  for (const engine of Object.values(engines)) expect(engine.version).toMatch(/^\d+\./);

  const originals: Record<string, string[]> = {};
  for (const [name, { stack }] of Object.entries(engines)) {
    const report = decodeStackTrace({ trace: stack, maps: '', files: [{ name: 'min.js.map', text: MIN_MAP }] });
    const expected = positionsIn(stack);
    expect(report.rows, name).toHaveLength(6);
    expect(
      report.rows.every((row) => row.how === 'opened'),
      name,
    ).toBe(true);
    report.rows.forEach((row, i) => {
      const [line, column] = expected[i] ?? [0, 0];
      const entry = NODE_ON_MIN.findEntry(line - 1, column - 1) as NodeEntry;
      expect(row.status, `${name} frame ${i + 1}`).toBe('mapped');
      expect(row.source).toBe(entry.originalSource);
      expect(row.originalLine).toBe((entry.originalLine ?? -2) + 1);
      expect(row.originalColumn).toBe((entry.originalColumn ?? -2) + 1);
      // Node repeats the last name it read for a segment that has no name field, so its name is only compared where the
      // segment has one; trace-mapping follows the specification and gives no name, as the decoder does.
      if (row.name !== null) expect(row.name).toBe(entry.name);
      expect(row.name).toBe(originalPositionFor(NAMES_ON_MIN, { line, column: column - 1 }).name);
    });
    originals[name] = report.rows.map((row) => row.original);
  }
  // The same six places, in the literals of the recording (the map names its sources as ../src/...).
  const same = [
    '../src/math.ts:3:11',
    '../src/math.ts:11:19',
    '../src/main.ts:6:9',
    '../src/main.ts:12:10',
    '../src/main.ts:15:1',
    '../src/main.ts:15:5',
  ];
  expect(originals['chromium']).toEqual(same);
  expect(originals['firefox']).toEqual(same);
  // WebKit differs only where the recording notes it: JavaScriptCore points the first throw at the call parenthesis,
  // column 49 instead of 35, which decodes to the name RangeError (3:15) instead of the new before it (3:11).
  const webkit = originals['webkit'] ?? [];
  expect(webkit.map((place, i) => (place === same[i] ? null : i + 1)).filter((n) => n !== null)).toEqual([1]);
  expect(webkit[0]).toBe('../src/math.ts:3:15');

  // Node: the plain stack decodes to Node's own --enable-source-maps frames, places and function names alike.
  const plain = `RangeError: value must be positive: -2\n${STACKS.node.plain.join('\n')}`;
  const report = decodeStackTrace({ trace: plain, maps: '', files: [{ name: 'min.js.map', text: MIN_MAP }] });
  const mapped = STACKS.node.mapped;
  const frames = report.rows.filter((row) => row.status === 'mapped');
  expect(frames).toHaveLength(6);
  // Node prints the file it resolved; the map's sources are relative to the map (../src/math.ts next to out/min.js).
  const shown = (row: (typeof frames)[number]): string => {
    const name = row.functionName ?? row.traceFunction;
    const place = `<dir>/${row.original.replace('../', '')}`;
    return name === '' ? `    at ${place}` : `    at ${name} (${place})`;
  };
  // Five of the six frames are word for word what Node prints. The fifth differs only in its function name: Node writes
  // run because its reader gives a segment with no name field the last name it read (the one at 15:1), where ECMA-426
  // 5.1 gives no name, so the decoder leaves the anonymous top level call anonymous.
  const written = frames.map(shown);
  const differing = written.map((line, i) => (line === mapped[i] ? null : i + 1)).filter((n) => n !== null);
  expect(differing).toEqual([5]);
  expect(written[4]).toBe('    at <dir>/src/main.ts:15:1');
  expect(mapped[4]).toBe('    at run (<dir>/src/main.ts:15:1)');
  // The frames inside Node itself are not claimed by the map and are left as they were.
  const inside = report.rows.filter((row) => row.status !== 'mapped');
  expect(inside.length).toBe(STACKS.node.plain.length - 6);
  expect(inside.every((row) => row.status === 'no-map')).toBe(true);
  const decodedLines = report.decoded.split('\n');
  expect(decodedLines.slice(7)).toEqual(STACKS.node.plain.slice(6));
});

/** One case of fixtures/generators/maps.json. */
interface GeneratedCase {
  name: string;
  tool: string;
  generated: string;
  map: Record<string, unknown>;
}
const GENERATED = JSON.parse(readFixture('generators', 'maps.json')) as { cases: GeneratedCase[] };

it('Node module SourceMap and trace-mapping agree with the lookup on 2,000 seeded positions', () => {
  expect(GENERATED.cases.map((c) => c.name)).toEqual([
    'esbuild-minified-typescript',
    'tsc-es2019-typescript',
    'terser-mangled-javascript',
    'index-map-by-lines',
    'index-map-by-column',
  ]);
  let mappedSeen = 0;
  for (const [index, c] of GENERATED.cases.entries()) {
    const lines = c.generated.split('\n');
    const random = mulberry32(19_000 + index);
    const positions = Array.from({ length: 2000 }, () => {
      const line = Math.floor(random() * lines.length);
      const column = Math.floor(random() * ((lines[line] ?? '').length + 3));
      return { line, column };
    });
    const map = parseMap(JSON.stringify(c.map), c.name);
    // The maps are made by real tools, so the strict reader finds nothing wrong with them.
    const decoded = decodeMap(map, positions);
    expect([...collectFindings(map), ...decodeFindings(decoded)], c.name).toEqual([]);
    const node = new SourceMap(c.map as unknown as ConstructorParameters<typeof SourceMap>[0]);
    // AnyMap reads index maps too (it flattens the sections); for an ordinary map it is the same as TraceMap.
    const trace = new AnyMap(c.map as unknown as ConstructorParameters<typeof AnyMap>[0], '');
    for (const { line, column } of positions) {
      const ours = lookup(decoded, line, column);
      const where = `${c.name} ${line}:${column}`;
      // Node looks across lines (the nearest earlier entry); this decoder never leaves the generated line, so an entry
      // of another line is read as "nothing on this line at or before the column".
      const entry = node.findEntry(line, column) as NodeEntry;
      const entryHere = entry.generatedLine === line ? entry : null;
      const other = originalPositionFor(trace, { line: line + 1, column });
      if (ours.kind === 'mapped') {
        mappedSeen++;
        expect(entryHere?.originalSource, where).toBe(ours.source);
        expect(entryHere?.originalLine, where).toBe(ours.line);
        expect(entryHere?.originalColumn, where).toBe(ours.column);
        // Node repeats the last name it read for a segment with no name field (see the engines test), so its name is
        // only compared where the segment has one.
        if (ours.name !== null) expect(entryHere?.name, where).toBe(ours.name);
        expect(other.source, where).toBe(ours.source);
        expect(other.line, where).toBe(ours.line + 1);
        expect(other.column, where).toBe(ours.column);
        expect(other.name ?? null, where).toBe(ours.name);
      } else {
        // Nothing to give here: either no earlier entry on the line, or the nearest one has no original position.
        expect(entryHere?.originalSource, where).toBeUndefined();
        expect(other.source, where).toBeNull();
      }
    }
  }
  // The comparison really looked at answers: most positions land on a mapping.
  expect(mappedSeen).toBeGreaterThan(5000);
});

it('when two segments share a generated column the lookup returns the one Node module SourceMap returns', () => {
  // Line 0: two segments at column 0 (original lines 10 then 20), a mapped and a bare segment at column 4, and three
  // mapped segments at column 8 (original lines 40, 41 and 42).
  const text = mapText({
    sources: ['a.ts'],
    mappings: buildMappings([
      [
        { col: 0, source: 0, line: 10, ocol: 1 },
        { col: 0, source: 0, line: 20, ocol: 5 },
        { col: 4, source: 0, line: 30, ocol: 0 },
        { col: 4 },
        { col: 8, source: 0, line: 40, ocol: 1 },
        { col: 8, source: 0, line: 41, ocol: 2 },
        { col: 8, source: 0, line: 42, ocol: 3 },
      ],
    ]),
  });
  const node = new SourceMap(JSON.parse(text) as unknown as ConstructorParameters<typeof SourceMap>[0]);
  const map = parseMap(text, 'x');
  const columns = [0, 1, 3, 4, 5, 7, 8, 9, 40];
  const decoded = decodeMap(
    map,
    columns.map((column) => ({ line: 0, column })),
  );
  const seen: string[] = [];
  for (const column of columns) {
    const ours = lookup(decoded, 0, column);
    const entry = node.findEntry(0, column) as NodeEntry;
    if (ours.kind === 'mapped') {
      expect(entry.originalLine, `column ${column}`).toBe(ours.line);
      expect(entry.originalColumn, `column ${column}`).toBe(ours.column);
      seen.push(`${column}:${ours.line}:${ours.column}`);
    } else {
      // The bare segment: Node gives an entry without an original position, as the decoder does.
      expect(ours.kind, `column ${column}`).toBe('unmapped');
      expect(entry.originalSource, `column ${column}`).toBeUndefined();
      seen.push(`${column}:${ours.kind}`);
    }
  }
  // What Node returns, written out so a change in either is noticed: the segment written last at a shared column wins.
  // (trace-mapping is not asked to agree here: on an exact match among equal columns it returns the first one written.)
  expect(seen).toEqual([
    '0:20:5',
    '1:20:5',
    '3:20:5',
    '4:unmapped',
    '5:unmapped',
    '7:unmapped',
    '8:42:3',
    '9:42:3',
    '40:42:3',
  ]);
});
