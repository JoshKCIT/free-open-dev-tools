import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { inspect, type Report } from '../src/index';
import { FIXTURE_BYTES, FIXTURE_SHA256, fixtureBytes } from './fixtures/fixture';
import { custom, moduleOf, name, section, uleb, vec } from './helpers';

const MAGIC = [0x00, 0x61, 0x73, 0x6d];
const VERSION_1 = [0x01, 0x00, 0x00, 0x00];
const COMPONENT = [0x0d, 0x00, 0x01, 0x00];

function oneSentence(sentence: string | null): void {
  expect(sentence, 'a sentence is given').not.toBeNull();
  expect(sentence).toMatch(/^[A-Z][^\n]*[.]$/);
}

it('an empty file, the magic alone and a component binary each give one plain sentence', () => {
  const empty = inspect(new Uint8Array(0));
  expect(empty.kind).toBe('unreadable');
  oneSentence(empty.sentence);
  expect(empty.sentence).toMatch(/empty/);

  const magicAlone = inspect(Uint8Array.from(MAGIC));
  expect(magicAlone.kind).toBe('unreadable');
  oneSentence(magicAlone.sentence);
  expect(magicAlone.sentence).toMatch(/version/);

  const component = inspect(Uint8Array.from([...MAGIC, ...COMPONENT]));
  expect(component.kind).toBe('component');
  oneSentence(component.sentence);
  expect(component.sentence).toMatch(/component/);

  for (const report of [empty, magicAlone, component]) {
    expect(report.findings, 'a sentence is the whole answer').toEqual([]);
    expect(report.sections).toEqual([]);
    expect(report.imports.rows).toEqual([]);
    expect(report.exports.rows).toEqual([]);
  }

  // Not a module at all, and a version the format does not have.
  const text = inspect(new TextEncoder().encode('hello, this is not a module'));
  expect(text.kind).toBe('unreadable');
  oneSentence(text.sentence);
  expect(text.sentence).toMatch(/signature/);
  const future = inspect(Uint8Array.from([...MAGIC, 0x02, 0x00, 0x00, 0x00]));
  expect(future.kind).toBe('unreadable');
  oneSentence(future.sentence);
  expect(future.sentence).toMatch(/version/);
});

it('the magic and the version alone are a valid empty module shown with zero of everything', () => {
  const report = inspect(Uint8Array.from([...MAGIC, ...VERSION_1]));
  expect(report.kind).toBe('module');
  expect(report.sentence).toBeNull();
  expect(report.size).toBe(8);
  expect(report.findings).toEqual([]);
  expect(report.sections).toEqual([]);
  expect(report.types.count).toBe(0);
  expect(report.imports.count).toBe(0);
  expect(report.exports.count).toBe(0);
  expect(report.functions.defined).toBe(0);
  expect(report.functions.largest).toEqual([]);
  expect(report.start).toBeNull();
  expect(report.customs.count).toBe(0);
  expect(report.strings.items).toEqual([]);
  expect(report.features).toEqual([]);
});

it('the 329 byte fixture module gives the imports and exports V8 gives', () => {
  const bytes = fixtureBytes();
  expect(bytes.length).toBe(FIXTURE_BYTES);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(FIXTURE_SHA256);

  const report = inspect(bytes);
  expect(report.kind).toBe('module');
  expect(report.findings).toEqual([]);

  // Tests may compile: V8 is the second opinion on this module, and the source under test never does.
  const compiled = new WebAssembly.Module(bytes);
  const kindOf = (kind: string): string => (kind === 'func' ? 'function' : kind);
  const v8Imports = WebAssembly.Module.imports(compiled).map((i) => `${i.module}.${i.name}:${i.kind}`);
  const v8Exports = WebAssembly.Module.exports(compiled).map((e) => `${e.name}:${e.kind}`);
  expect(report.imports.rows.map((i) => `${i.module}.${i.field}:${kindOf(i.kind)}`)).toEqual(v8Imports);
  expect(report.exports.rows.map((e) => `${e.name}:${kindOf(e.kind)}`)).toEqual(v8Exports);
  const v8Name = WebAssembly.Module.customSections(compiled, 'name').map((b) => b.byteLength);
  expect(report.customs.rows.filter((c) => c.name === 'name').map((c) => c.size)).toEqual(v8Name);

  // What the WAT text says, written out.
  expect(v8Imports).toEqual(['env.log:function', 'env.limit:global']);
  expect(v8Exports).toEqual(['memory:memory', 'add:function', 'twice:function', 'counter:global']);
  expect(report.functions.imported).toBe(1);
  expect(report.functions.defined).toBe(3);
  expect(report.sections.map((s) => s.name)).toEqual([
    'type',
    'import',
    'function',
    'table',
    'memory',
    'global',
    'export',
    'start',
    'element',
    'code',
    'data',
    'custom',
  ]);
  expect(report.start).toBe(3);

  // The rest of the module, as the WAT text says it.
  expect(report.types.rows.map((t) => t.text)).toEqual([
    '(i32) -> ()',
    '(i32, i32) -> (i32)',
    '(i32) -> (i32)',
    '() -> ()',
  ]);
  expect(report.memories.rows.map((m) => [m.index, m.source, m.text])).toEqual([[0, 'defined', '1 to 4 pages']]);
  expect(report.tables.rows.map((t) => [t.index, t.source, t.text])).toEqual([[0, 'defined', 'funcref, 2 or more']]);
  expect(report.globals.rows.map((g) => [g.index, g.source, g.type, g.mutable, g.init])).toEqual([
    [0, 'import env.limit', 'i32', false, ''],
    [1, 'defined', 'i32', true, 'i32.const 7'],
  ]);
  expect(report.data.rows.map((d) => [d.mode, d.memory, d.offset, d.size, d.previewText])).toEqual([
    ['active', 0, 'i32.const 16', 13, 'hello fixture'],
  ]);
  expect(report.elements.rows.map((e) => [e.mode, e.table, e.offset, e.count])).toEqual([
    ['active', 0, 'i32.const 0', 2],
  ]);
  expect(report.strings.items.map((s) => s.text)).toEqual(['hello fixture']);
  expect(report.names.moduleName).toBe('fixture');
  expect(report.names.subsections.map((s) => s.id)).toEqual([0, 1, 2, 4, 5, 6, 7, 8, 9]);
  expect(report.functions.largest.map((f) => [f.index, f.name, f.size])).toEqual([
    [1, 'add', 7],
    [2, 'twice', 7],
    [3, 'start', 6],
  ]);
});

// ---------------------------------------------------------------------------------------------------------------------
// Sections, numbers, counts, names, custom sections and the largest functions.
// ---------------------------------------------------------------------------------------------------------------------

const TYPE_SECTION = section(1, vec([[0x60, 0x00, 0x00]]));
const FUNCTION_SECTION = section(3, vec([[0x00]]));
const EXPORT_SECTION = section(7, vec([[...name('main'), 0x00, 0x00]]));
const CODE_SECTION = section(10, vec([[0x02, 0x00, 0x0b]]));

function expectFinding(report: Report, offset: number, phrase: RegExp): void {
  const found = report.findings.find((f) => f.offset === offset && phrase.test(f.message));
  expect(
    found,
    `a finding at offset ${offset} matching ${phrase}; findings: ${JSON.stringify(report.findings)}`,
  ).toBeDefined();
  expect(found?.message).toContain(`offset ${offset}`);
}

it('sections out of order, a repeated section, an unknown id and a size past the end are refused naming the offset', () => {
  // An export section before the function section: the function section is the one out of order.
  const outOfOrder = inspect(moduleOf(TYPE_SECTION, EXPORT_SECTION, FUNCTION_SECTION, CODE_SECTION));
  expectFinding(outOfOrder, 8 + TYPE_SECTION.length + EXPORT_SECTION.length, /function section is out of order/);
  expect(outOfOrder.sections.map((s) => s.name)).toEqual(['type', 'export', 'function', 'code']);

  // A section that appears twice: the second one is named.
  const repeated = inspect(moduleOf(TYPE_SECTION, TYPE_SECTION));
  expectFinding(repeated, 8 + TYPE_SECTION.length, /type section appears more than once/);

  // Custom sections may stand anywhere and any number of times.
  const customs = inspect(moduleOf(custom('a'), TYPE_SECTION, custom('a'), custom('b')));
  expect(customs.findings).toEqual([]);
  expect(customs.sectionCount).toBe(4);

  // An id that does not exist stops the walk there, with the sections before it kept.
  const unknown = inspect(moduleOf(TYPE_SECTION, [14, 0]));
  expectFinding(unknown, 8 + TYPE_SECTION.length, /malformed section id/);
  expect(unknown.sections.map((s) => s.name)).toEqual(['type']);

  // A size that runs past the end of the file.
  const pastEnd = inspect(moduleOf(TYPE_SECTION, [10, 100, 1, 2, 3]));
  expectFinding(pastEnd, 8 + TYPE_SECTION.length, /length out of bounds/);
  expect(pastEnd.sections.map((s) => s.name)).toEqual(['type']);

  // A size whose own number is cut off by the end of the file.
  const cutSize = inspect(moduleOf(TYPE_SECTION, [10, 0x80]));
  expect(cutSize.findings.some((f) => /ends in the middle of a value/.test(f.message))).toBe(true);

  // Content that does not fill the size of its section.
  const loose = inspect(moduleOf(section(8, [0x00, 0x00])));
  expectFinding(loose, 8 + 3, /start section does not fill its size/);

  // A section whose content stops short of what it announces.
  const short = inspect(moduleOf(section(1, [0x02, 0x60, 0x00, 0x00])));
  expect(
    short.findings.some((f) => /ends in the middle of a value/.test(f.message) && /type section/.test(f.message)),
  ).toBe(true);
});

it('LEB128 values that are too large or too long are refused at their offset and padded forms within the width are read', () => {
  const start = (...leb: number[]): Report => inspect(moduleOf(section(8, leb)));

  // The largest value, and zero padded out to the five bytes a 32-bit number may use.
  expect(start(0xff, 0xff, 0xff, 0xff, 0x0f).start).toBe(4_294_967_295);
  expect(start(0xff, 0xff, 0xff, 0xff, 0x0f).findings).toEqual([]);
  expect(start(0x80, 0x80, 0x80, 0x80, 0x00).start).toBe(0);
  expect(start(0x80, 0x80, 0x80, 0x80, 0x00).findings).toEqual([]);
  expect(start(0x81, 0x80, 0x00).start).toBe(1);

  // A fifth byte with bits beyond the 32nd: too large, at the fifth byte (offset 8 + 2 + 4).
  const tooLarge = start(0xff, 0xff, 0xff, 0xff, 0x1f);
  expectFinding(tooLarge, 14, /integer too large/);
  expect(tooLarge.start).toBeNull();

  // A sixth byte: the fifth still says more follows, which a 32-bit number may not.
  const tooLong = start(0x80, 0x80, 0x80, 0x80, 0x80, 0x00);
  expectFinding(tooLong, 14, /integer representation too long/);

  // Signed numbers: -1 padded to five bytes is within the width; a fifth byte whose unused bits differ from the sign is not.
  const global = (...leb: number[]): Report => inspect(moduleOf(section(6, vec([[0x7f, 0x00, 0x41, ...leb, 0x0b]]))));
  expect(global(0xff, 0xff, 0xff, 0xff, 0x7f).globals.rows[0]?.init).toBe('i32.const -1');
  expect(global(0x80, 0x80, 0x80, 0x80, 0x78).globals.rows[0]?.init).toBe('i32.const -2147483648');
  expect(global(0xff, 0xff, 0xff, 0xff, 0x07).globals.rows[0]?.init).toBe('i32.const 2147483647');
  expect(global(0x80, 0x80, 0x80, 0x80, 0x00).globals.rows[0]?.init).toBe('i32.const 0');
  expectFinding(global(0xff, 0xff, 0xff, 0xff, 0x4f), 8 + 2 + 1 + 3 + 4, /integer too large/);
  expectFinding(global(0x80, 0x80, 0x80, 0x80, 0x80, 0x00), 8 + 2 + 1 + 3 + 4, /integer representation too long/);

  // 64-bit limits in a 64-bit memory: ten bytes at most, the tenth carrying one bit.
  const memory = (...leb: number[]): Report => inspect(moduleOf(section(5, vec([[0x04, ...leb]]))));
  expect(memory(0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01).memories.rows[0]?.text).toBe(
    '18446744073709551615 or more pages, 64-bit',
  );
  expectFinding(memory(0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x02), 8 + 3 + 1 + 9, /integer too large/);
});

it('a count larger than the bytes that remain is refused before any array is sized', () => {
  const huge = [0xff, 0xff, 0xff, 0xff, 0x0f];
  // A count of 4,294,967,295 in a module of under 40 bytes: one sentence naming the count's offset, no rows.
  const forty = moduleOf(section(1, huge, [0x60, 0x00, 0x00]));
  expect(forty.length).toBeLessThan(40);
  const report = inspect(forty);
  expectFinding(report, 8 + 2, /length out of bounds/);
  expect(report.types.count).toBe(0);
  expect(report.types.rows).toEqual([]);

  // The same for every section that holds a vector, none of them throwing or sizing an array from the count.
  for (const id of [2, 3, 4, 5, 6, 7, 9, 10, 11, 13]) {
    const r = inspect(moduleOf(section(id, huge, [0x00, 0x00, 0x00, 0x00])));
    expect(r.findings.length, `section ${id}`).toBeGreaterThan(0);
    expect(r.findings[0]?.message, `section ${id}`).toMatch(/length out of bounds/);
    expect(r.functions.defined, `section ${id}`).toBe(0);
    expect(r.functions.largest, `section ${id}`).toEqual([]);
  }

  // A name longer than the rest of the module, and an inner vector longer than the rest of its type.
  const longName = inspect(moduleOf(section(7, vec([[...huge, 0x61]]))));
  expectFinding(longName, 8 + 3, /length out of bounds/);
  const innerVector = inspect(moduleOf(section(1, vec([[0x60, ...huge, 0x7f]]))));
  expectFinding(innerVector, 8 + 2 + 1 + 1, /length out of bounds/);

  // One function body that claims more bytes than the code section holds.
  const body = inspect(moduleOf(TYPE_SECTION, FUNCTION_SECTION, section(10, vec([[...huge, 0x00]]))));
  expect(body.findings.some((f) => /length out of bounds/.test(f.message))).toBe(true);
});

it('names must be valid UTF-8 and an invalid sequence is refused naming its offset, as the specification says', () => {
  const exportOf = (...nameBytes: number[]): Report =>
    inspect(moduleOf(section(7, vec([[...uleb(nameBytes.length), ...nameBytes, 0x00, 0x00]]))));
  const at = 8 + 3; // the offset of the name's length byte

  // Valid: a name is counted in bytes, so two bytes make one letter, four make one emoji, and NUL is fine.
  const accent = String.fromCodePoint(0xe9);
  const grin = String.fromCodePoint(0x1f600);
  const withNul = `a${String.fromCodePoint(0)}b`;
  const good = inspect(
    moduleOf(
      section(
        7,
        vec([
          [...name(accent), 0x00, 0x00],
          [...name(grin), 0x00, 0x01],
          [...name(withNul), 0x00, 0x02],
        ]),
      ),
    ),
  );
  expect(good.findings).toEqual([]);
  expect(good.exports.rows.map((e) => e.name)).toEqual([accent, grin, withNul]);

  // Invalid: a lone continuation byte, an overlong form, a surrogate, a cut-off sequence and a byte that never occurs.
  const bad: [string, number[]][] = [
    ['a lone continuation byte', [0x80]],
    ['an overlong form of NUL', [0xc0, 0x80]],
    ['an encoded surrogate', [0xed, 0xa0, 0x80]],
    ['a sequence cut short', [0xe2, 0x82]],
    ['a byte that never occurs', [0xff]],
  ];
  for (const [label, bytes] of bad) {
    const report = exportOf(...bytes);
    expectFinding(report, at, /not valid UTF-8 \(malformed UTF-8 encoding\)/);
    // The export is still listed, with the replacement character where the bytes are not UTF-8.
    expect(report.exports.count, label).toBe(1);
    expect(report.exports.rows[0]?.name, label).toContain(String.fromCodePoint(0xfffd));
  }

  // A custom section's name is held to the same rule, at its own offset.
  const badCustom = inspect(moduleOf(section(0, [0x01, 0xff])));
  expectFinding(badCustom, 8 + 2, /malformed UTF-8 encoding/);
  expect(badCustom.sectionCount).toBe(1);
});

const URL_TEXT = 'https://example.test/maps/app.wasm.map';
const DEBUG_URL = 'https://example.test/debug/app.debug.wasm';

it('producers, target_features, sourceMappingURL and external_debug_info sections are decoded and addresses are shown as text', () => {
  const realFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = ((): Promise<Response> => {
    requests++;
    return Promise.reject(new Error('nothing may be requested'));
  }) as typeof fetch;
  try {
    const bytes = moduleOf(
      TYPE_SECTION,
      custom(
        'producers',
        vec([
          [
            ...name('language'),
            ...vec([
              [...name('Rust'), ...name('1.81.0')],
              [...name('C'), ...name('')],
            ]),
          ],
          [...name('processed-by'), ...vec([[...name('rustc'), ...name('1.81.0 (eeb90cda1 2024-09-04)')]])],
        ]),
      ),
      custom(
        'target_features',
        vec([
          [0x2b, ...name('simd128')],
          [0x2b, ...name('bulk-memory')],
          [0x2d, ...name('atomics')],
          [0x3d, ...name('sign-ext')],
        ]),
      ),
      custom('sourceMappingURL', name(URL_TEXT)),
      custom('external_debug_info', name(DEBUG_URL)),
      custom('dylink.0', [0x01, 0x04, 0x01, 0x02, 0x03, 0x04]),
      custom('linking', [0x02, 0x01, 0x00]),
      custom('reloc.CODE', [0x00, 0x00]),
      custom('.debug_info', [0x00, 0x01, 0x02, 0x03, 0x04]),
      custom('something else', [0x01, 0x02, 0x03]),
    );
    const report = inspect(bytes);
    expect(report.findings).toEqual([]);

    expect(report.producers).toEqual([
      { field: 'language', values: ['Rust 1.81.0', 'C'] },
      { field: 'processed-by', values: ['rustc 1.81.0 (eeb90cda1 2024-09-04)'] },
    ]);
    expect(report.targetFeatures).toEqual([
      { prefix: '+', name: 'simd128' },
      { prefix: '+', name: 'bulk-memory' },
      { prefix: '-', name: 'atomics' },
      { prefix: '=', name: 'sign-ext' },
    ]);
    // Addresses are text in the report and nothing else.
    expect(report.sourceMappingUrl).toBe(URL_TEXT);
    expect(report.externalDebugInfo).toBe(DEBUG_URL);

    const row = (customName: string) => report.customs.rows.find((c) => c.name === customName);
    expect(row('producers')).toMatchObject({ kind: 'producers', standard: 'tool conventions' });
    expect(row('producers')?.summary).toContain('language: Rust 1.81.0, C');
    expect(row('target_features')?.summary).toContain('+simd128');
    expect(row('sourceMappingURL')).toMatchObject({
      kind: 'sourceMappingURL',
      standard: 'ECMA-426',
      size: URL_TEXT.length + 1,
    });
    expect(row('sourceMappingURL')?.summary).toContain(URL_TEXT);
    expect(row('external_debug_info')?.summary).toContain(DEBUG_URL);
    // The linking and debug sections are listed with their sizes only.
    expect(row('dylink.0')).toMatchObject({ kind: 'dylink.0', size: 6 });
    expect(row('linking')).toMatchObject({ kind: 'linking', size: 3 });
    expect(row('reloc.CODE')).toMatchObject({ kind: 'reloc', size: 2 });
    expect(row('.debug_info')).toMatchObject({ kind: 'debug', size: 5 });
    expect(row('.debug_info')?.summary).toMatch(/5 bytes/);
    expect(row('something else')).toMatchObject({ kind: 'other', size: 3 });
    expect(report.customs.count).toBe(9);

    // A broken producers section is a finding and leaves the module and the other sections read.
    const broken = inspect(
      moduleOf(TYPE_SECTION, custom('producers', [0x05, 0x01]), custom('sourceMappingURL', name(URL_TEXT))),
    );
    expect(broken.findings.some((f) => /producers section/.test(f.message))).toBe(true);
    expect(broken.types.count).toBe(1);
    expect(broken.sourceMappingUrl).toBe(URL_TEXT);
  } finally {
    globalThis.fetch = realFetch;
  }
  expect(requests, 'no address in the module is requested').toBe(0);
});

it('the name section reads core and proposal subsections in increasing order and a broken name section never hides the module', () => {
  const sub = (id: number, ...content: (readonly number[])[]): number[] => {
    const body = content.flat();
    return [id, ...uleb(body.length), ...body];
  };
  const nameMap = (entries: [number, string][]): number[] =>
    vec(entries.map(([index, text]) => [...uleb(index), ...name(text)]));
  const indirect = (entries: [number, [number, string][]][]): number[] =>
    vec(entries.map(([index, inner]) => [...uleb(index), ...nameMap(inner)]));

  const full = inspect(
    moduleOf(
      TYPE_SECTION,
      FUNCTION_SECTION,
      EXPORT_SECTION,
      CODE_SECTION,
      custom(
        'name',
        sub(0, name('app')),
        sub(1, nameMap([[0, 'main_function']])),
        sub(2, indirect([[0, [[0, 'x']]]])),
        sub(3, indirect([[0, [[0, 'loop']]]])),
        sub(4, nameMap([[0, 'void_fn']])),
        sub(5, nameMap([[0, 'table0']])),
        sub(6, nameMap([[0, 'memory0']])),
        sub(
          7,
          nameMap([
            [0, 'global0'],
            [1, 'global1'],
          ]),
        ),
        sub(8, nameMap([[0, 'elem0']])),
        sub(9, nameMap([[0, 'data0']])),
        sub(10, indirect([[0, [[0, 'field']]]])),
        sub(11, nameMap([[0, 'tag0']])),
        sub(12, indirect([[0, [[0, 'param']]]])),
        sub(13, indirect([[0, [[0, 'tagparam']]]])),
      ),
    ),
  );
  expect(full.findings).toEqual([]);
  expect(full.names.moduleName).toBe('app');
  expect(full.names.subsections.map((s) => [s.id, s.label, s.source, s.entries])).toEqual([
    [0, 'module name', 'core specification', 1],
    [1, 'function names', 'core specification', 1],
    [2, 'local names', 'core specification', 1],
    [3, 'label names', 'extended name section proposal', 1],
    [4, 'type names', 'core specification', 1],
    [5, 'table names', 'extended name section proposal', 1],
    [6, 'memory names', 'extended name section proposal', 1],
    [7, 'global names', 'extended name section proposal', 2],
    [8, 'element segment names', 'extended name section proposal', 1],
    [9, 'data segment names', 'extended name section proposal', 1],
    [10, 'field names', 'core specification', 1],
    [11, 'tag names', 'core specification', 1],
    [12, 'parameter names', 'extended name section proposal', 1],
    [13, 'tag parameter names', 'extended name section proposal', 1],
  ]);
  // The function name is used for the largest functions list.
  expect(full.functions.largest[0]?.name).toBe('main_function');

  // Out of order and repeated subsections are findings. One out of order is still read; one that appears again is read
  // only the first time, as a repeated section of the module is.
  const unordered = inspect(
    moduleOf(
      TYPE_SECTION,
      EXPORT_SECTION,
      custom('name', sub(1, nameMap([[0, 'f']])), sub(0, name('m')), sub(0, name('again'))),
    ),
  );
  expect(unordered.findings.filter((f) => /subsection/.test(f.message))).toHaveLength(2);
  expect(
    unordered.findings.some((f) => /appears more than once, and is read only the first time/.test(f.message)),
  ).toBe(true);
  expect(unordered.names.moduleName).toBe('m');
  expect(unordered.names.subsections.map((s) => s.id)).toEqual([1, 0]);

  // A name map whose indices do not increase is a finding, and the names are still read.
  const unsorted = inspect(
    moduleOf(
      TYPE_SECTION,
      custom(
        'name',
        sub(
          1,
          nameMap([
            [3, 'c'],
            [1, 'a'],
          ]),
        ),
      ),
    ),
  );
  expect(unsorted.findings.some((f) => /not in increasing order/.test(f.message))).toBe(true);
  expect(unsorted.names.subsections[0]?.entries).toBe(2);

  // A subsection that cannot be read is a finding naming its offset; the next subsection and the module are still read.
  const broken = inspect(
    moduleOf(
      TYPE_SECTION,
      FUNCTION_SECTION,
      EXPORT_SECTION,
      CODE_SECTION,
      custom('name', sub(1, [0xff, 0xff, 0xff, 0xff, 0x0f]), sub(4, nameMap([[0, 'still_read']]))),
    ),
  );
  expect(broken.findings.some((f) => /length out of bounds/.test(f.message) && /name section/.test(f.message))).toBe(
    true,
  );
  expect(broken.names.subsections.map((s) => s.id)).toEqual([4]);
  expect(broken.exports.rows.map((e) => e.name)).toEqual(['main']);
  expect(broken.types.count).toBe(1);
  expect(broken.functions.largest[0]?.name).toBe('main');

  // A subsection that claims more bytes than the section holds ends the name section's reading and nothing else.
  const cut = inspect(moduleOf(TYPE_SECTION, custom('name', [0x01, 0x40, 0x00])));
  expect(cut.findings.some((f) => /name section/.test(f.message))).toBe(true);
  expect(cut.types.count).toBe(1);

  // An id the format does not know is a finding too.
  const unknown = inspect(moduleOf(TYPE_SECTION, custom('name', sub(99, [0x00]))));
  expect(unknown.findings.some((f) => /name subsection/.test(f.message))).toBe(true);
});

it('the 50 largest function bodies are listed with their names and the rest are counted', () => {
  const COUNT = 120;
  // Function i has a body of (i % 40) + 2 bytes, and function 7 is 500 bytes larger: sizes repeat, so ties go to the lower index.
  const bodyOf = (i: number): number[] => {
    const size = (i % 40) + 2 + (i === 7 ? 500 : 0);
    return [...uleb(size), 0x00, ...new Array<number>(size - 2).fill(0x01), 0x0b];
  };
  const names: [number, string][] = [];
  for (let i = 0; i < COUNT; i += 3) names.push([i, `fn_${i}`]);
  const nameMap = vec(names.map(([index, text]) => [...uleb(index), ...name(text)]));
  const exports = section(
    7,
    vec([
      [...name('exported_five'), 0x00, 0x05],
      [...name('exported_seven'), 0x00, 0x07],
    ]),
  );
  const report = inspect(
    moduleOf(
      TYPE_SECTION,
      section(3, vec(Array.from({ length: COUNT }, () => [0x00]))),
      exports,
      section(10, vec(Array.from({ length: COUNT }, (_, i) => bodyOf(i)))),
      custom('name', [1, ...uleb(nameMap.length), ...nameMap]),
    ),
  );
  expect(report.findings).toEqual([]);
  expect(report.functions.defined).toBe(COUNT);
  expect(report.functions.largest).toHaveLength(50);
  expect(report.functions.largestLeftOut).toBe(70);
  // Largest first; sizes equal, the lower index first.
  const sizes = report.functions.largest.map((f) => f.size);
  expect([...sizes].sort((a, b) => b - a)).toEqual(sizes);
  expect(report.functions.largest[0]).toMatchObject({ index: 7, size: 509 });
  for (let i = 1; i < report.functions.largest.length; i++) {
    const a = report.functions.largest[i - 1]!;
    const b = report.functions.largest[i]!;
    if (a.size === b.size) expect(a.index).toBeLessThan(b.index);
  }
  // A name comes from the name section first, then from an export of the function. Function 7 is not a multiple of 3, so it
  // has no entry in the name section and takes its export name; function 39 has both a size in the list and a name.
  const byIndex = new Map(report.functions.largest.map((f) => [f.index, f.name]));
  expect(byIndex.get(7)).toBe('exported_seven');
  expect(byIndex.get(39)).toBe('fn_39');
  expect(byIndex.get(38)).toBe('');
  // Function 5 has a body of 7 bytes, so it is not among the 50 largest even though it is exported.
  expect(byIndex.has(5)).toBe(false);
  expect(report.functions.bodyBytes).toBeGreaterThan(0);
});

it('a custom section kept past the first 2,000 sections is read when it is the first of a name this page decodes', () => {
  // 2,000 empty custom sections, then the name, producers and sourceMappingURL sections, then a second name section.
  const filler: number[] = [];
  for (let i = 0; i < 2_000; i++) filler.push(...custom('x'));
  const names = custom('name', [0x00, ...uleb(name('late').length), ...name('late')]);
  const producers = custom('producers', [0x01, ...name('language'), 0x01, ...name('Rust'), ...name('')]);
  const address = custom('sourceMappingURL', name('https://example.test/late.map'));
  const again = custom('name', [0x00, ...uleb(name('again').length), ...name('again')]);
  const report = inspect(moduleOf(filler, names, producers, address, again, custom('x')));
  expect(report.sectionCount).toBe(2_005);
  expect(report.names.moduleName).toBe('late');
  expect(report.producers).toEqual([{ field: 'language', values: ['Rust'] }]);
  expect(report.sourceMappingUrl).toBe('https://example.test/late.map');
  // The second name section and the empty one after it are counted, not kept.
  expect(report.sections.filter((s) => s.id === 0)).toHaveLength(2_003);
  expect(report.customs.count).toBe(2_005);
});
