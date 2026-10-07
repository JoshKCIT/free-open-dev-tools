import { SourceMap } from 'node:module';
import { expect, it, vi } from 'vitest';
import {
  MAX_MAPS,
  SourceMapError,
  VlqError,
  checkInput,
  collectFindings,
  decodeMap,
  decodeNeededLines,
  decodeStackTrace,
  decodeVlq,
  lookup,
  parseMap,
  splitMaps,
  type ParsedMap,
} from '../src/index';
import { buildMappings, encodeVlq, mapText, v8Frame } from './helpers';
import { LIVE_MAP, LIVE_MAP_TEXT, LIVE_TRACE } from './live-map';

/*
 * The tracer: one stack trace from V8 and one esbuild map, decoded end to end. The expected positions are what Node's own
 * module.SourceMap gives for the same map (an independent reader), and the literals of the research recording
 * (src/math.ts 3:11 and 11:19, src/main.ts 6:9, 12:10 and 15:1), never the decoder's own output. The rest of the file
 * holds the rules of ECMA-426 the decoder applies, each stated from the text of the specification.
 */

/** What Node's source map reader answers for a position that has a mapping. */
interface NodeEntry {
  originalSource: string;
  originalLine: number;
  originalColumn: number;
  name?: string;
}

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

  const node = new SourceMap({ ...LIVE_MAP, file: 'min.js', sourceRoot: '' });
  report.rows.forEach((row, i) => {
    const expected = EXPECTED[i];
    const [line, column] = FRAMES[i] ?? [0, 0];
    // Node counts from zero; V8 prints one based lines and columns.
    const entry = node.findEntry(line - 1, column - 1) as NodeEntry;
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

  // A bad map beside a good one is a finding of its own map, not a refusal, and it names the map by number.
  const both = decodeStackTrace({ trace: LIVE_TRACE, maps: `${LIVE_MAP_TEXT}{${CANARY}}` });
  expect(both.maps.map((m) => m.usable)).toEqual([true, false]);
  expect(both.findings.some((f) => f.map === 2 && f.level === 'error')).toBe(true);

  // The canary appears in no message, note, finding or label of anything the decoder said.
  const said = JSON.stringify({
    messages,
    notes: text.notes,
    findings: [...text.findings, ...both.findings],
    maps: [...text.maps, ...both.maps],
  });
  // Not even the start of it: a cut-off copy of the input is still a copy.
  expect(said).not.toContain(CANARY.slice(0, 12));
});

it('VLQ values of 2 to the 31 or more are refused at their position and minus zero reads as the lowest 32-bit value', () => {
  // ECMA-426 5.1, "Decode a base64 VLQ": the sign is the lowest bit, the next four bits start the value, bit 5 says more.
  expect(decodeVlq('A', 0).value).toBe(0);
  expect(decodeVlq('C', 0).value).toBe(1);
  expect(decodeVlq('D', 0).value).toBe(-1);
  expect(decodeVlq('gB', 0).value).toBe(16);
  expect(decodeVlq('hB', 0).value).toBe(-16);
  // "If value is 0 and sign is -1, return -2147483648."
  expect(decodeVlq('B', 0).value).toBe(-2147483648);
  // The largest values the format can hold, built by the test's own encoder.
  for (const value of [2147483647, -2147483647, 1073741824, -1073741824, 123456789]) {
    expect(decodeVlq(encodeVlq(value), 0).value).toBe(value);
  }
  // The position after the value is reported, so a caller reads the next one from there.
  const two = decodeVlq('gBC', 0);
  expect(two.next).toBe(2);

  // "If value is greater than or equal to 2^31, throw an error": refused at the digit that carries it.
  const big = encodeVlq(2 ** 31);
  const text = `AAAA,${big},C`;
  let caught: unknown;
  try {
    decodeVlq(text, 5);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(VlqError);
  expect((caught as VlqError).problem).toBe('too-big');
  expect((caught as VlqError).position).toBe(5 + big.length - 1);
  // A negative value of the same size, and a value far past it, are refused alike.
  expect(() => decodeVlq(encodeVlq(-(2 ** 31)), 0)).toThrow(VlqError);
  expect(() => decodeVlq(encodeVlq(2 ** 40), 0)).toThrow(VlqError);
  // A digit outside the alphabet, and a value that ends early, are refused at their own positions.
  expect(() => decodeVlq('A!', 1)).toThrow(VlqError);
  try {
    decodeVlq('Ag', 1);
    throw new Error('expected a refusal');
  } catch (err) {
    expect((err as VlqError).problem).toBe('truncated');
    expect((err as VlqError).position).toBe(2);
  }
  // Padding digits (zero chunks) change no value and never overflow the weight.
  expect(decodeVlq('CggggggggggggggggggA', 0).value).toBe(1);

  // Inside a mappings string the same fault is a finding that names the 1-based position, and the lines read before
  // it are kept.
  const decoded = decodeNeededLines(`AAAA;AAAA,${big},C`, [0, 1], { sources: 1, names: 0 });
  expect(decoded.complete).toBe(false);
  expect(decoded.findings).toHaveLength(1);
  expect(decoded.findings[0]?.level).toBe('error');
  expect(decoded.findings[0]?.message).toContain(`position ${5 + 5 + big.length}`);
  expect(decoded.lines.get(0)?.count).toBe(1);
  expect(decoded.lines.get(1)?.count).toBe(1);
  // A character outside the alphabet is found in a first pass and nothing is read.
  const outside = decodeNeededLines('AAAA;AA!A', [0], { sources: 1, names: 0 });
  expect(outside.findings[0]?.message).toContain('position 8');
  expect(outside.lines.size).toBe(0);
});

/** An index map made of sections with the given offsets, each holding the same one-segment map. */
function indexMapText(offsets: [number, number][], extra: Record<string, unknown> = {}): string {
  const inner = JSON.parse(
    mapText({ mappings: buildMappings([[{ col: 0, source: 0, line: 0, ocol: 0 }]]) }),
  ) as unknown;
  return JSON.stringify({
    version: 3,
    sections: offsets.map(([line, column]) => ({ offset: { line, column }, map: inner })),
    ...extra,
  });
}
const errorsOf = (text: string): string[] =>
  collectFindings(parseMap(text, 'x'))
    .filter((f) => f.level === 'error')
    .map((f) => f.message);

it('an index map refuses equal or falling offsets, a top level mappings and a nested index map', () => {
  // The suite's indexMapInvalidOverlap case uses two equal offsets; the text says sections must not overlap.
  expect(
    errorsOf(
      indexMapText([
        [0, 0],
        [0, 0],
      ]),
    ).length,
  ).toBeGreaterThan(0);
  expect(
    errorsOf(
      indexMapText([
        [2, 0],
        [1, 0],
      ]),
    ).length,
  ).toBeGreaterThan(0);
  expect(
    errorsOf(
      indexMapText([
        [1, 5],
        [1, 3],
      ]),
    ).length,
  ).toBeGreaterThan(0);
  // A top level mappings beside sections (the suite's indexMapInvalidBaseMappings case).
  expect(errorsOf(indexMapText([[0, 0]], { mappings: 'AAAA' })).length).toBeGreaterThan(0);
  // A section whose map is itself an index map: "nested index maps are not read".
  const nested = JSON.stringify({
    version: 3,
    sections: [{ offset: { line: 0, column: 0 }, map: { version: 3, sections: [] } }],
  });
  expect(errorsOf(nested).join(' ')).toContain('nested index maps are not read');
  // An offset that is not a whole number from 0 up is refused too.
  for (const bad of [-1, 1.5, 4294967296, '3']) {
    const text = JSON.stringify({
      version: 3,
      sections: [{ offset: { line: bad, column: 0 }, map: JSON.parse(mapText({ mappings: 'AAAA' })) as unknown }],
    });
    expect(errorsOf(text).length).toBeGreaterThan(0);
  }
  // Strictly increasing offsets, on lines or on columns of one line, are fine.
  const fine = indexMapText([
    [0, 0],
    [0, 4],
    [3, 0],
  ]);
  expect(collectFindings(parseMap(fine, 'x'))).toEqual([]);

  // A section's column offset applies on its first line only, and the section holds its position by binary search.
  const one = mapText({ sources: ['one.ts'], mappings: buildMappings([[{ col: 0, source: 0, line: 0, ocol: 0 }]]) });
  const two = mapText({
    sources: ['two.ts'],
    mappings: buildMappings([
      [
        { col: 0, source: 0, line: 5, ocol: 1 },
        { col: 4, source: 0, line: 5, ocol: 9 },
      ],
      [
        { col: 0, source: 0, line: 6, ocol: 0 },
        { col: 3, source: 0, line: 6, ocol: 7 },
      ],
    ]),
  });
  const joined = parseMap(
    JSON.stringify({
      version: 3,
      sections: [
        { offset: { line: 0, column: 0 }, map: JSON.parse(one) as unknown },
        { offset: { line: 2, column: 10 }, map: JSON.parse(two) as unknown },
      ],
    }),
    'joined',
  );
  const positions = [
    [2, 10],
    [2, 13],
    [2, 14],
    [2, 9],
    [3, 0],
    [3, 2],
    [3, 3],
    [0, 0],
  ] as const;
  const decoded = decodeMap(
    joined,
    positions.map(([line, column]) => ({ line, column })),
  );
  const at = (line: number, column: number): string => {
    const found = lookup(decoded, line, column);
    return found.kind === 'mapped' ? `${found.source}:${found.line}:${found.column}` : found.kind;
  };
  expect(at(2, 10)).toBe('two.ts:5:1');
  expect(at(2, 13)).toBe('two.ts:5:1');
  expect(at(2, 14)).toBe('two.ts:5:9');
  // Before the second section starts, the position belongs to the first, which has no segment on that line.
  expect(at(2, 9)).toBe('no-line');
  // On the lines after the section's first line the offset column is not applied.
  expect(at(3, 0)).toBe('two.ts:6:0');
  expect(at(3, 2)).toBe('two.ts:6:0');
  expect(at(3, 3)).toBe('two.ts:6:7');
  expect(at(0, 0)).toBe('one.ts:0:0');

  // An offset of two billion lines costs nothing: sections are never expanded line by line.
  const far = parseMap(
    indexMapText([
      [0, 0],
      [2_000_000_000, 0],
    ]),
    'far',
  );
  const farDecoded = decodeMap(far, [
    { line: 1_999_999_999, column: 0 },
    { line: 2_000_000_000, column: 0 },
  ]);
  expect(lookup(farDecoded, 1_999_999_999, 0).kind).toBe('no-line');
  expect(lookup(farDecoded, 2_000_000_000, 0).kind).toBe('mapped');
});

it('sourceRoot is joined as ECMA-426 5.2 says and an XSSI first line is removed before parsing', () => {
  const sourcesOf = (sourceRoot: string | undefined): (string | null)[] =>
    (parseMap(mapText({ mappings: 'AAAA', sources: ['a.js', null], sourceRoot }), 'x') as ParsedMap).sources;
  // "Else, set sourceURLPrefix to the concatenation of sourceRoot and "/"" (so theroot joins as theroot/).
  expect(sourcesOf('theroot')).toEqual(['theroot/a.js', null]);
  // "the substring of sourceRoot from 0 to index + 1" for the last slash: a root that ends in a slash is used as it is.
  expect(sourcesOf('https://cdn.test/build/')).toEqual(['https://cdn.test/build/a.js', null]);
  expect(sourcesOf('/baz/quux')).toEqual(['/baz/a.js', null]);
  expect(sourcesOf('/')).toEqual(['/a.js', null]);
  // No sourceRoot, and an empty one (which adds nothing here), leave the sources as they are.
  expect(sourcesOf(undefined)).toEqual(['a.js', null]);
  expect(sourcesOf('')).toEqual(['a.js', null]);
  // A sourceRoot that is not a string is a finding.
  const wrong = parseMap(JSON.stringify({ version: 3, sources: ['a.js'], mappings: 'AAAA', sourceRoot: 5 }), 'x');
  expect(wrong.findings.map((f) => f.level)).toEqual(['warn']);

  // ECMA-426 7.2: a body that starts with )]}' loses its whole first line before it is parsed.
  const plain = mapText({ mappings: buildMappings([[{ col: 0, source: 0, line: 3, ocol: 4 }]]) });
  const trace = v8Frame('f', 'https://example.test/min.js', 1, 1);
  const rowOf = (maps: string, files?: { name: string; text: string }[]) =>
    decodeStackTrace({ trace, maps, ...(files ? { files } : {}) }).rows[0];
  const expectMapped = (row: ReturnType<typeof rowOf>) => {
    expect(row?.status).toBe('mapped');
    expect(row?.original).toBe('a.ts:4:5');
  };
  expectMapped(rowOf(plain));
  expectMapped(rowOf(`)]}'\n${plain}`));
  expectMapped(rowOf(`)]}'\r\n${plain}`));
  expectMapped(rowOf('', [{ name: 'min.js.map', text: `)]}'\n${plain}` }]));
  // A byte order mark in front is dropped too, from pasted text and from an opened file.
  const bom = String.fromCharCode(0xfeff);
  expectMapped(rowOf(`${bom}${plain}`));
  expectMapped(rowOf('', [{ name: 'min.js.map', text: `${bom})]}'\n${plain}` }]));
  // Without the prefix the same text would not be JSON.
  expect(parseMap(`)]}'\n${plain}`, 'x').usable).toBe(false);
  // A data address that holds a map is decoded here (Base64 and percent-encoded) and never requested.
  const base64 = Buffer.from(plain, 'utf8').toString('base64');
  expectMapped(rowOf(`data:application/json;base64,${base64}`));
  expectMapped(rowOf(`//# sourceMappingURL=data:application/json;charset=utf-8;base64,${base64}`));
  expectMapped(rowOf(`data:application/json,${encodeURIComponent(plain)}`));
  // An address that is not a data address is never followed: it is refused as text that is not a map.
  expect(() => splitMaps('//# sourceMappingURL=https://example.test/min.js.map')).toThrow(SourceMapError);
  expect(() => splitMaps('https://example.test/min.js.map')).toThrow(SourceMapError);
});

it('more than 20 maps, a map over 50 MiB, over 20,000 sections and over 5,000 trace lines are refused before parsing, naming the number', () => {
  const trace = v8Frame('f', 'https://example.test/min.js', 1, 1);
  const refusal = (run: () => unknown): SourceMapError => {
    try {
      run();
    } catch (err) {
      if (err instanceof SourceMapError) return err;
      throw err;
    }
    throw new Error('expected a refusal');
  };
  const parse = vi.spyOn(JSON, 'parse');
  try {
    // 21 maps, pasted: refused as the 21st is seen, naming 20.
    const many = refusal(() => decodeStackTrace({ trace, maps: '{}'.repeat(MAX_MAPS + 1) }));
    expect(many.part).toBe('maps');
    expect(many.message).toContain(`${MAX_MAPS} maps`);
    // 21 maps, pasted and opened together.
    const together = refusal(() =>
      decodeStackTrace({
        trace,
        maps: '{}'.repeat(10),
        files: Array.from({ length: 11 }, (_, i) => ({ name: `m${i}.map`, text: '{}' })),
      }),
    );
    expect(together.message).toContain(`${MAX_MAPS} maps`);
    // A map file over 50 MiB, from its size alone, and 80 MiB of maps in all.
    const fileSize = refusal(() => checkInput({ trace: '', maps: '', fileSizes: [52_428_801] }));
    expect(fileSize.part).toBe('map file');
    expect(fileSize.message).toContain('52,428,800');
    const total = refusal(() => checkInput({ trace: '', maps: '', fileSizes: [41_943_040, 41_943_040, 1] }));
    expect(total.message).toContain('83,886,080');
    const pastedTotal = refusal(() => checkInput({ trace: '', maps: 'x'.repeat(83_886_081) }));
    expect(pastedTotal.message).toContain('83,886,080');
    // One pasted map over 50 MiB.
    const huge = `{"a":"${'x'.repeat(52_428_800)}"}`;
    const pastedMap = refusal(() => decodeStackTrace({ trace, maps: huge }));
    expect(pastedMap.message).toContain('52,428,800');
    expect(pastedMap.map).toBe(1);
    // A trace of 5,001 lines, and one over 1 MiB.
    const lines = refusal(() => decodeStackTrace({ trace: 'x\n'.repeat(5000) + 'x', maps: '' }));
    expect(lines.message).toContain('5,000');
    const bytes = refusal(() => decodeStackTrace({ trace: 'a'.repeat(1_048_577), maps: '' }));
    expect(bytes.message).toContain('1,048,576');
    // Bytes, not characters: 400,000 euro signs are 1,200,000 bytes.
    const euros = refusal(() => decodeStackTrace({ trace: String.fromCodePoint(0x20ac).repeat(400_000), maps: '' }));
    expect(euros.message).toContain('1,200,000');
    // Not one of those reached JSON.parse.
    expect(parse).not.toHaveBeenCalled();
  } finally {
    parse.mockRestore();
  }

  // 20,001 sections: known only once the map is parsed, and refused naming 20,000 before any section is read.
  const sections = JSON.stringify({
    version: 3,
    sections: Array.from({ length: 20_001 }, (_, i) => ({ offset: { line: i, column: 0 }, map: {} })),
  });
  const tooMany = refusal(() => parseMap(sections, 'x', 3));
  expect(tooMany.message).toContain('20,000');
  expect(tooMany.map).toBe(3);
  // 20,000 sections are read.
  const allowed = parseMap(indexMapText(Array.from({ length: 20_000 }, (_, i) => [i, 0] as [number, number])), 'x');
  expect(allowed.kind === 'index' && allowed.sections.length).toBe(20_000);
  // More than a million entries in sources and names together.
  const entries = JSON.stringify({ version: 3, sources: new Array<null>(1_000_001).fill(null), mappings: '' });
  expect(() => parseMap(entries, 'x')).toThrow(/1,000,000/);
  // A bad number of lines of context is refused naming the field's words.
  expect(() => decodeStackTrace({ trace, maps: '', context: 6 })).toThrow(/Lines of context/);
  expect(() => decodeStackTrace({ trace, maps: '', context: 1.5 })).toThrow(/Lines of context/);
});

it('the 5,000 line limit counts lines the way the trace is split: a line feed, a carriage return and line feed, or a lone carriage return', () => {
  const refused = (trace: string): string => {
    try {
      checkInput({ trace, maps: '' });
    } catch (err) {
      if (err instanceof SourceMapError) return err.message;
      throw err;
    }
    return '';
  };
  const CR = String.fromCharCode(13);
  const LF = String.fromCharCode(10);
  // 5,001 lines ended by lone carriage returns, or by a mix of the three line ends, are refused naming the number.
  expect(refused(`x${CR}`.repeat(5000) + 'x')).toBe('The trace has 5,001 lines. The limit is 5,000 lines.');
  expect(refused(`x${CR}x${LF}x${CR}${LF}`.repeat(1667))).toBe('The trace has 5,002 lines. The limit is 5,000 lines.');
  // A carriage return and line feed is one line end, not two: 5,000 lines so ended are read.
  expect(refused(`x${CR}${LF}`.repeat(4999) + 'x')).toBe('');
  expect(refused(`x${CR}`.repeat(4999) + 'x')).toBe('');
  // A trace of a million lone carriage returns, under the 1 MiB limit, is refused before it is split.
  expect(refused(CR.repeat(1_000_000))).toBe('The trace has 1,000,001 lines. The limit is 5,000 lines.');
  expect(() => decodeStackTrace({ trace: CR.repeat(1_000_000), maps: '' })).toThrow(SourceMapError);
});

it('kept segments are stored as 32-bit integers and a position past 2,147,483,647 is a finding, never kept', () => {
  // Five 4 byte numbers per kept segment: 20 bytes, half of what eight byte numbers take at the 4,000,000 segment cap.
  const plain = decodeNeededLines(buildMappings([[{ col: 0, source: 0, line: 3, ocol: 4 }, { col: 9 }]]), [0], {
    sources: 1,
    names: 0,
  });
  const line = plain.lines.get(0)!;
  expect(line.data).toBeInstanceOf(Int32Array);
  expect(line.count).toBe(2);
  expect(Array.from(line.data.subarray(0, 10))).toEqual([0, 0, 3, 4, -1, 9, -1, -1, -1, -1]);

  // The largest value one VLQ holds is 2,147,483,647; a second one carries the generated column past it. That segment
  // is a finding and is not kept, so no stored number wraps around.
  const largest = 2_147_483_647;
  const past = decodeNeededLines(`${encodeVlq(largest)},${encodeVlq(1)},${encodeVlq(-largest)}`, [0], {
    sources: 1,
    names: 0,
  });
  const kept = past.lines.get(0)!;
  expect(kept.count).toBe(2);
  // The third segment comes back to column 1, so the line is sorted: column 1 first, then the largest.
  expect(Array.from(kept.data.subarray(0, 10))).toEqual([1, -1, -1, -1, -1, largest, -1, -1, -1, -1]);
  expect(past.findings.map((finding) => finding.message)).toEqual([
    'Generated line 1 has a segment whose position is past 2,147,483,647, the largest this page keeps.',
  ]);
  // The original line and column are held to the same rule.
  const original = buildMappings([
    [
      { col: 0, source: 0, line: largest, ocol: 0 },
      { col: 1, source: 0, line: largest, ocol: largest },
    ],
  ]);
  const deep = decodeNeededLines(`${original},${encodeVlq(1)}${encodeVlq(0)}${encodeVlq(1)}${encodeVlq(0)}`, [0], {
    sources: 1,
    names: 0,
  });
  expect(deep.lines.get(0)!.count).toBe(2);
  expect(deep.findings.map((finding) => finding.message)).toEqual([
    'Generated line 1 has a segment whose position is past 2,147,483,647, the largest this page keeps.',
  ]);
});
