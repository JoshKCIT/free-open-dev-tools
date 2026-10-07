import { expect, it } from 'vitest';
import { inspect, type Report } from '../src/index';
import {
  GC_TYPES,
  MEMORY64,
  MULTI_MEMORY,
  SEGMENT_FORMS,
  SHARED_MEMORY,
  TAGS,
  handmadeBytes,
  type Handmade,
} from './fixtures/handmade';
import { custom, moduleOf, name, section, uleb, vec } from './helpers';

/*
 * Each module here is hand-assembled: a list of byte groups with a comment per group (see fixtures/handmade.ts). The
 * expected values below are what those comments say, group by group. Where V8 in Node 22 accepts a module the test also
 * compares V8's imports and exports with the reader's; where it refuses (64-bit memories and tables are newer than V8 12.4)
 * only the reader's answer is checked, and the test does not fail if a newer Node starts to accept it.
 */

const kindOf = (kind: string): string => (kind === 'func' ? 'function' : kind);

/** Reads a hand-assembled module, requires no finding, and compares with V8 where V8 accepts the bytes. */
function readWithV8(module: Handmade): { report: Report; v8: 'accepted' | 'refused' } {
  const bytes = handmadeBytes(module);
  const report = inspect(bytes);
  expect(report.kind).toBe('module');
  expect(report.findings).toEqual([]);
  let compiled: WebAssembly.Module | null = null;
  try {
    compiled = new WebAssembly.Module(bytes);
  } catch (error) {
    expect(module.v8, `V8 refused a module the comments say it accepts: ${String(error)}`).not.toBe('accepts');
  }
  if (compiled === null) return { report, v8: 'refused' };
  expect(module.v8).not.toBe('refuses');
  expect(report.imports.rows.map((i) => `${i.module}.${i.field}:${kindOf(i.kind)}`)).toEqual(
    WebAssembly.Module.imports(compiled).map((i) => `${i.module}.${i.name}:${i.kind}`),
  );
  expect(report.exports.rows.map((e) => `${e.name}:${kindOf(e.kind)}`)).toEqual(
    WebAssembly.Module.exports(compiled).map((e) => `${e.name}:${e.kind}`),
  );
  return { report, v8: 'accepted' };
}

it('hand-assembled GC, multi-memory, 64-bit memory and tag modules read as their byte comments say', () => {
  // Every group has a comment: the fixtures are readable, not bare bytes.
  for (const module of [GC_TYPES, MULTI_MEMORY, MEMORY64, SHARED_MEMORY, TAGS, SEGMENT_FORMS]) {
    for (const [hex, comment] of module.groups) {
      expect(hex).toMatch(/^[0-9a-f ]+$/);
      expect(comment.length).toBeGreaterThan(8);
    }
  }

  // GC: a recursive group of three subtypes, a function type with references, a plain array and an empty struct.
  const gc = readWithV8(GC_TYPES);
  expect(gc.v8).toBe('accepted');
  expect(gc.report.types.count).toBe(6);
  expect(gc.report.types.rows).toEqual([
    { index: 0, kind: 'struct', text: 'struct { mut i32, i8 }', supers: [], final: false, group: 'rec 0..2' },
    { index: 1, kind: 'struct', text: 'struct { mut i32, i8, mut i16 }', supers: [0], final: true, group: 'rec 0..2' },
    { index: 2, kind: 'array', text: 'array { mut i16 }', supers: [], final: false, group: 'rec 0..2' },
    { index: 3, kind: 'func', text: '((ref null 0)) -> ((ref i31))', supers: [], final: true, group: '' },
    { index: 4, kind: 'array', text: 'array { mut i8 }', supers: [], final: true, group: '' },
    { index: 5, kind: 'struct', text: 'struct {}', supers: [], final: true, group: '' },
  ]);
  expect(gc.report.globals.rows.map((g) => [g.index, g.type, g.mutable, g.init])).toEqual([
    [0, '(ref null 0)', true, 'ref.null 0'],
    [1, '(ref 0)', false, 'struct.new_default 0'],
  ]);
  expect(gc.report.features).toContain('garbage collection types');

  // Multi-memory: two memories, a data count, a segment in each memory.
  const mm = readWithV8(MULTI_MEMORY);
  expect(mm.v8).toBe('accepted');
  expect(mm.report.memories.rows.map((m) => [m.index, m.source, m.text])).toEqual([
    [0, 'defined', '1 or more pages'],
    [1, 'defined', '2 to 3 pages'],
  ]);
  expect(mm.report.dataCount).toBe(2);
  expect(mm.report.data.rows.map((d) => [d.index, d.flag, d.mode, d.memory, d.offset, d.size, d.previewText])).toEqual([
    [0, 0, 'active', 0, 'i32.const 0', 2, 'ab'],
    [1, 2, 'active', 1, 'i32.const 4', 2, 'xy'],
  ]);
  expect(mm.report.exports.rows).toEqual([{ name: 'b', kind: 'memory', index: 1 }]);
  expect(mm.report.features).toContain('multiple memories');

  // 64-bit memories and tables.
  const wide = readWithV8(MEMORY64);
  expect(wide.report.tables.rows.map((t) => [t.index, t.text])).toEqual([
    [0, 'funcref, 2 or more, 64-bit'],
    [1, 'funcref, 1 to 8, 64-bit'],
  ]);
  expect(wide.report.memories.rows.map((m) => [m.index, m.text, m.is64, m.shared])).toEqual([
    [0, '1 or more pages, 64-bit', true, false],
    [1, '2 to 64 pages, 64-bit', true, false],
  ]);
  expect(wide.report.data.rows[0]?.offset).toBe('i64.const 16');
  expect(wide.report.features).toContain('64-bit memory or table limits');

  // The shared forms of the threads proposal, labelled as such.
  const shared = readWithV8(SHARED_MEMORY);
  expect(shared.report.memories.rows.map((m) => m.text)).toEqual([
    '1 to 2 pages, shared (threads proposal)',
    '1 to 4 pages, 64-bit, shared (threads proposal)',
  ]);
  expect(shared.report.features).toContain('shared memory (threads proposal)');

  // Tags: one imported and two defined, in the section between memory and global.
  const tags = readWithV8(TAGS);
  expect(tags.v8).toBe('accepted');
  expect(tags.report.sections.map((s) => s.name)).toEqual(['type', 'import', 'memory', 'tag', 'global', 'export']);
  expect(tags.report.imports.rows).toEqual([
    { module: 'env', field: 't', kind: 'tag', index: 0, detail: 'type 0: (i32) -> ()' },
  ]);
  expect(tags.report.tags.rows.map((t) => [t.index, t.source, t.typeIndex, t.text])).toEqual([
    [0, 'import env.t', 0, 'type 0: (i32) -> ()'],
    [1, 'defined', 0, 'type 0: (i32) -> ()'],
    [2, 'defined', 0, 'type 0: (i32) -> ()'],
  ]);
  expect(tags.report.tags.count).toBe(3);
  expect(tags.report.exports.rows).toEqual([{ name: 'e', kind: 'tag', index: 2 }]);
  expect(tags.report.features).toContain('exception handling (tags)');
});

it('all eight element segment forms and three data segment forms are read by their flags', () => {
  const { report, v8 } = readWithV8(SEGMENT_FORMS);
  expect(v8).toBe('accepted');
  expect(report.elements.rows.map((e) => [e.index, e.flag, e.mode, e.table, e.offset, e.type, e.count])).toEqual([
    [0, 0, 'active', 0, 'i32.const 0', 'func', 1],
    [1, 1, 'passive', null, '', 'func', 1],
    [2, 2, 'active', 0, 'i32.const 1', 'func', 1],
    [3, 3, 'declarative', null, '', 'func', 1],
    [4, 4, 'active', 0, 'i32.const 2', 'funcref', 1],
    [5, 5, 'passive', null, '', 'funcref', 1],
    [6, 6, 'active', 0, 'i32.const 3', 'funcref', 1],
    [7, 7, 'declarative', null, '', 'funcref', 1],
  ]);
  expect(report.data.rows.map((d) => [d.index, d.flag, d.mode, d.memory, d.offset, d.size, d.previewText])).toEqual([
    [0, 0, 'active', 0, 'i32.const 0', 1, 'a'],
    [1, 1, 'passive', null, '', 3, 'bcd'],
    [2, 2, 'active', 1, 'i32.const 8', 1, 'e'],
  ]);
  expect(report.dataCount).toBe(3);
  expect(report.functions.defined).toBe(1);
  expect(report.functions.largest).toEqual([
    { index: 0, name: '', size: 2, offset: report.functions.largest[0]?.offset },
  ]);
});

it('a tag section after the global section is out of order and one between memory and global is not', () => {
  const globalSection = section(6, vec([[0x7f, 0x00, 0x41, 0x05, 0x0b]]));
  const tagSection = section(13, vec([[0x00, 0x00]]));
  const typeSection = section(1, vec([[0x60, 0x00, 0x00]]));
  const good = inspect(moduleOf(typeSection, tagSection, globalSection));
  expect(good.findings).toEqual([]);
  const bad = inspect(moduleOf(typeSection, globalSection, tagSection));
  const at = 8 + typeSection.length + globalSection.length;
  expect(bad.findings.map((f) => f.offset)).toEqual([at]);
  expect(bad.findings[0]?.message).toMatch(/tag section is out of order/);
  // The module still reads: its tag is listed.
  expect(bad.tags.count).toBe(1);
});

it('an unknown limits flag, import kind and element or data flag are refused naming the offset', () => {
  const cases: { label: string; bytes: Uint8Array; offset: number; phrase: RegExp }[] = [];
  const memorySection = section(5, vec([[0x08, 0x01]]));
  cases.push({
    label: 'limits flag 8',
    bytes: moduleOf(memorySection),
    offset: 8 + 3 + 0,
    phrase: /malformed limits flags/,
  });
  const importSection = section(2, vec([[...name('a'), ...name('b'), 0x09, 0x00]]));
  cases.push({
    label: 'import kind 9',
    bytes: moduleOf(importSection),
    offset: 8 + 2 + 1 + 2 + 2,
    phrase: /malformed import kind/,
  });
  const elemSection = section(9, vec([[0x08, 0x00]]));
  cases.push({
    label: 'element flag 8',
    bytes: moduleOf(elemSection),
    offset: 8 + 3 + 0,
    phrase: /malformed element segment flags/,
  });
  const dataSection = section(11, vec([[0x03, 0x00]]));
  cases.push({
    label: 'data flag 3',
    bytes: moduleOf(dataSection),
    offset: 8 + 3 + 0,
    phrase: /malformed data segment flags/,
  });
  for (const { label, bytes, offset, phrase } of cases) {
    const report = inspect(bytes);
    const finding = report.findings.find((f) => phrase.test(f.message));
    expect(finding, label).toBeDefined();
    expect(finding?.offset, label).toBe(offset);
    expect(finding?.message, label).toContain(`offset ${offset}`);
  }
  // A custom section next to them is unharmed.
  const safe = inspect(moduleOf(custom('note', uleb(7)), memorySection));
  expect(safe.customs.count).toBe(1);
});
