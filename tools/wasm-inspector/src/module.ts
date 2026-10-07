import { MARK_GC, MARK_SIMD, readConstExpr } from './const-expr';
import { Cursor } from './cursor';
import { FindingList, WasmInspectorError } from './errors';
import { MAX_PREVIEW_BYTES, MAX_ROWS, MAX_STRING_SCAN_BYTES, MIN_STRING_LENGTH, withCommas } from './limits';
import type { SectionInfo } from './sections';
import { SoftReader } from './soft';
import {
  readGlobalType,
  readMemType,
  readRefType,
  readRecType,
  readTableType,
  readTagType,
  type TypeRow,
} from './types';

/** A list that keeps its first `MAX_ROWS` rows and counts the rest, so a huge section never builds a huge array. */
export class Capped<T> {
  readonly rows: T[] = [];
  /** How many there were in all, those not kept included. */
  count = 0;

  add(row: T): void {
    this.count++;
    if (this.rows.length < MAX_ROWS) this.rows.push(row);
  }

  /** How many were not kept. */
  get leftOut(): number {
    return this.count - this.rows.length;
  }
}

export type ExternKind = 'func' | 'table' | 'memory' | 'global' | 'tag';
const EXTERN_KINDS: readonly ExternKind[] = ['func', 'table', 'memory', 'global', 'tag'];

export interface ImportRow {
  module: string;
  field: string;
  kind: ExternKind;
  /** The index in the index space of its kind (imports come first), for example the function index. */
  index: number;
  /** The type of what is imported, as text. */
  detail: string;
}

export interface ExportRow {
  name: string;
  kind: ExternKind;
  /** The index of the exported thing in the index space of its kind. */
  index: number;
}

export interface TableRow {
  index: number;
  /** `defined`, or `import module.name`. */
  source: string;
  /** The element type and the limits, for example `funcref, 2 or more`. */
  text: string;
  /** The initialiser expression of a table that has one, else the empty string. */
  init: string;
}

export interface MemoryRow {
  index: number;
  source: string;
  /** The limits in pages, for example `1 to 4 pages`. */
  text: string;
  is64: boolean;
  shared: boolean;
}

export interface GlobalRow {
  index: number;
  source: string;
  type: string;
  mutable: boolean;
  /** The initialiser expression, empty for an imported global. */
  init: string;
}

export interface TagRow {
  index: number;
  source: string;
  typeIndex: number;
  /** For example `type 0: (i32) -> ()`. */
  text: string;
}

export interface ElementRow {
  index: number;
  /** The flag, 0 to 7, that says which of the eight forms of element segment this is. */
  flag: number;
  mode: 'active' | 'passive' | 'declarative';
  /** The table of an active segment, else null. */
  table: number | null;
  /** The offset expression of an active segment, else the empty string. */
  offset: string;
  /** `func` for the forms that list function indices, else the reference type of the expressions. */
  type: string;
  /** How many items it lists. */
  count: number;
}

export interface DataRow {
  index: number;
  /** The flag, 0 to 2. */
  flag: number;
  mode: 'active' | 'passive';
  /** The memory of an active segment, else null. */
  memory: number | null;
  offset: string;
  size: number;
  /** The offset in the file of the first byte of the segment. */
  fileOffset: number;
  /** The first bytes as hex and as text (a dot for a byte that is not printable). */
  previewHex: string;
  previewText: string;
}

/** What the sections of a module hold, kept in caps. */
export interface ModuleData {
  types: Capped<TypeRow>;
  imports: Capped<ImportRow>;
  /** How many of each kind are imported. */
  importCounts: Record<ExternKind, number>;
  /** How many of each kind the module defines itself (the function section declares the functions). */
  definedCounts: Record<ExternKind, number>;
  exports: Capped<ExportRow>;
  exportSection: SectionInfo | null;
  tables: Capped<TableRow>;
  memories: Capped<MemoryRow>;
  globals: Capped<GlobalRow>;
  tags: Capped<TagRow>;
  /** The start function's index, or null. */
  start: number | null;
  elements: Capped<ElementRow>;
  data: Capped<DataRow>;
  /** The number the data count section gives, or null when there is none. */
  dataCount: number | null;
  /** Function bodies: where each begins in the file and how long it is, as typed arrays. */
  bodyOffsets: Uint32Array;
  bodySizes: Uint32Array;
  /** How many bodies were measured (fewer than the code section announces when its reading stopped early). */
  bodyCount: number;
  /** The total size of the bodies measured. */
  bodyBytes: number;
  /** Segments worth looking at for text: three numbers each (index, offset in the file, size), up to 8 MiB of them. */
  dataSpans: number[];
  /** The bytes of data segments left out of `dataSpans` because of the 8 MiB limit. */
  dataSpansSkipped: number;
  /** The features the sections show. */
  marks: Set<string>;
}

function newModuleData(): ModuleData {
  return {
    types: new Capped(),
    imports: new Capped(),
    importCounts: { func: 0, table: 0, memory: 0, global: 0, tag: 0 },
    definedCounts: { func: 0, table: 0, memory: 0, global: 0, tag: 0 },
    exports: new Capped(),
    exportSection: null,
    tables: new Capped(),
    memories: new Capped(),
    globals: new Capped(),
    tags: new Capped(),
    start: null,
    elements: new Capped(),
    data: new Capped(),
    dataCount: null,
    bodyOffsets: new Uint32Array(0),
    bodySizes: new Uint32Array(0),
    bodyCount: 0,
    bodyBytes: 0,
    dataSpans: [],
    dataSpansSkipped: 0,
    marks: new Set(),
  };
}

/** The signature of a type if it was kept, else a plain mention of its index. */
function typeText(data: ModuleData, index: number): string {
  const row = data.types.rows[index];
  return row === undefined ? `type ${index}` : `type ${index}: ${row.text}`;
}

/** Marks the features a piece of type text shows: a vector value, an externref or exnref, a reference to a type index. */
function markText(data: ModuleData, text: string): void {
  if (text.includes('v128')) data.marks.add(MARK_SIMD);
  if (text.includes('externref') || text.includes('exnref')) data.marks.add('reference types');
  if (/[(]ref (?:null )?[0-9]/.test(text)) data.marks.add(MARK_GC);
}

function markType(data: ModuleData, row: TypeRow): void {
  markText(data, row.text);
  if (row.kind !== 'func' || !row.final || row.supers.length > 0 || row.group !== '') data.marks.add(MARK_GC);
}

function markLimits(data: ModuleData, is64: boolean, shared: boolean): void {
  if (is64) data.marks.add('64-bit memory or table limits');
  if (shared) data.marks.add('shared memory (threads proposal)');
}

function readTypes(c: Cursor, data: ModuleData): void {
  const n = c.count(1);
  for (let entry = 0; entry < n; entry++) {
    readRecType(c, data.types.count, (row) => {
      markType(data, row);
      data.types.add(row);
    });
  }
}

function readImports(c: Cursor, data: ModuleData, findings: FindingList): void {
  const n = c.count(3);
  for (let i = 0; i < n; i++) {
    const module = c.name(findings);
    const field = c.name(findings);
    const at = c.pos;
    const kind = EXTERN_KINDS[c.u8()];
    if (kind === undefined)
      throw new WasmInspectorError('An import has a kind that does not exist (malformed import kind).', at);
    const source = `import ${module}.${field}`;
    const index = data.importCounts[kind];
    let detail: string;
    if (kind === 'func') detail = typeText(data, c.u32());
    else if (kind === 'table') {
      const table = readTableType(c);
      detail = table.text;
      markText(data, table.ref);
      markLimits(data, table.limits.is64, table.limits.shared);
      data.tables.add({ index, source, text: table.text, init: '' });
    } else if (kind === 'memory') {
      const memory = readMemType(c);
      detail = memory.text;
      markLimits(data, memory.limits.is64, memory.limits.shared);
      data.memories.add({ index, source, text: memory.text, is64: memory.limits.is64, shared: memory.limits.shared });
    } else if (kind === 'global') {
      const global = readGlobalType(c);
      detail = global.text;
      markText(data, global.type);
      data.globals.add({ index, source, type: global.type, mutable: global.mutable, init: '' });
    } else {
      const typeIndex = readTagType(c);
      detail = typeText(data, typeIndex);
      data.tags.add({ index, source, typeIndex, text: detail });
    }
    data.importCounts[kind]++;
    data.imports.add({ module, field, kind, index, detail });
  }
}

function readFunctions(c: Cursor, data: ModuleData): void {
  const n = c.count(1);
  for (let i = 0; i < n; i++) c.u32();
  data.definedCounts.func = n;
}

function readTables(c: Cursor, data: ModuleData): void {
  const n = c.count(3);
  for (let i = 0; i < n; i++) {
    let initialised = false;
    if (c.peek() === 0x40) {
      const at = c.pos;
      c.pos++;
      if (c.u8() !== 0x00) {
        throw new WasmInspectorError(
          'A table with an initialiser has a byte other than 0 after its marker (malformed table).',
          at,
        );
      }
      initialised = true;
    }
    const table = readTableType(c);
    const init = initialised ? readConstExpr(c, data.marks) : '';
    if (initialised || table.ref !== 'funcref') data.marks.add('reference types');
    markText(data, table.ref);
    markLimits(data, table.limits.is64, table.limits.shared);
    const index = data.importCounts.table + data.definedCounts.table++;
    data.tables.add({ index, source: 'defined', text: table.text, init });
  }
}

function readMemories(c: Cursor, data: ModuleData): void {
  const n = c.count(2);
  for (let i = 0; i < n; i++) {
    const memory = readMemType(c);
    markLimits(data, memory.limits.is64, memory.limits.shared);
    const index = data.importCounts.memory + data.definedCounts.memory++;
    data.memories.add({
      index,
      source: 'defined',
      text: memory.text,
      is64: memory.limits.is64,
      shared: memory.limits.shared,
    });
  }
}

function readTags(c: Cursor, data: ModuleData): void {
  const n = c.count(2);
  for (let i = 0; i < n; i++) {
    const typeIndex = readTagType(c);
    const index = data.importCounts.tag + data.definedCounts.tag++;
    data.tags.add({ index, source: 'defined', typeIndex, text: typeText(data, typeIndex) });
  }
}

function readGlobals(c: Cursor, data: ModuleData): void {
  const n = c.count(3);
  for (let i = 0; i < n; i++) {
    const global = readGlobalType(c);
    markText(data, global.type);
    const init = readConstExpr(c, data.marks);
    const index = data.importCounts.global + data.definedCounts.global++;
    data.globals.add({ index, source: 'defined', type: global.type, mutable: global.mutable, init });
  }
}

function readExports(c: Cursor, data: ModuleData, findings: FindingList): void {
  const n = c.count(3);
  for (let i = 0; i < n; i++) {
    const name = c.name(findings);
    const at = c.pos;
    const kind = EXTERN_KINDS[c.u8()];
    if (kind === undefined)
      throw new WasmInspectorError('An export has a kind that does not exist (malformed export kind).', at);
    data.exports.add({ name, kind, index: c.u32() });
  }
}

function readElements(c: Cursor, data: ModuleData): void {
  const n = c.count(2);
  for (let i = 0; i < n; i++) {
    const flagAt = c.pos;
    const flag = c.u32();
    if (flag > 7) {
      throw new WasmInspectorError(
        'The flag of an element segment is not one the format defines (malformed element segment flags).',
        flagAt,
      );
    }
    const active = (flag & 1) === 0;
    const explicitTable = (flag & 3) === 2;
    const usesExpressions = (flag & 4) !== 0;
    const mode = active ? 'active' : (flag & 2) !== 0 ? 'declarative' : 'passive';
    let table: number | null = null;
    let offset = '';
    if (active) {
      table = explicitTable ? c.u32() : 0;
      offset = readConstExpr(c, data.marks);
    }
    // Forms 1, 2 and 3 name the kind of the function indices; forms 5, 6 and 7 name the reference type of the expressions.
    let type = usesExpressions ? 'funcref' : 'func';
    if ((flag & 3) !== 0) {
      const at = c.pos;
      if (usesExpressions) {
        type = readRefType(c);
        markText(data, type);
      } else if (c.u8() !== 0x00) {
        throw new WasmInspectorError('An element segment has a kind other than function (malformed element kind).', at);
      }
    }
    const count = c.count(1);
    for (let j = 0; j < count; j++) {
      if (usesExpressions) readConstExpr(c, data.marks);
      else c.u32();
    }
    data.elements.add({ index: data.elements.count, flag, mode, table, offset, type, count });
  }
}

function previewOf(bytes: Uint8Array, start: number, size: number): { hex: string; text: string } {
  const shown = Math.min(size, MAX_PREVIEW_BYTES);
  const hex: string[] = [];
  let text = '';
  for (let i = 0; i < shown; i++) {
    const byte = bytes[start + i]!;
    hex.push(byte.toString(16).padStart(2, '0'));
    text += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.';
  }
  return { hex: hex.join(' '), text };
}

function readDataSegments(c: Cursor, data: ModuleData): void {
  const n = c.count(2);
  let scanned = 0;
  for (let i = 0; i < n; i++) {
    const flagAt = c.pos;
    const flag = c.u32();
    if (flag > 2) {
      throw new WasmInspectorError(
        'The flag of a data segment is not one the format defines (malformed data segment flags).',
        flagAt,
      );
    }
    const memory = flag === 2 ? c.u32() : flag === 0 ? 0 : null;
    const offset = flag === 1 ? '' : readConstExpr(c, data.marks);
    const size = c.count(1);
    const fileOffset = c.pos;
    const index = data.data.count;
    if (data.data.rows.length < MAX_ROWS) {
      const preview = previewOf(c.bytes, fileOffset, size);
      data.data.add({
        index,
        flag,
        mode: flag === 1 ? 'passive' : 'active',
        memory,
        offset,
        size,
        fileOffset,
        previewHex: preview.hex,
        previewText: preview.text,
      });
    } else data.data.count++;
    if (size >= MIN_STRING_LENGTH) {
      if (scanned < MAX_STRING_SCAN_BYTES) {
        data.dataSpans.push(index, fileOffset, size);
        scanned += size;
      } else data.dataSpansSkipped += size;
    }
    c.pos += size;
  }
}

/**
 * The locals declaration at the start of a function body: a vector of a count and a value type. It is the only part of a
 * body this reader looks at. The counts must not add up to more than 4,294,967,295. It runs once per body, so a fault is
 * recorded in the reader, never thrown.
 */
function checkLocals(r: SoftReader): void {
  const groups = r.count(2);
  let total = 0;
  for (let i = 0; i < groups && !r.failed; i++) {
    const at = r.pos;
    total += r.u32();
    if (!r.failed) r.valType();
    if (!r.failed && total > 0xffffffff)
      r.fail(at, 'A function declares more than 4,294,967,295 locals (too many locals).');
  }
}

function readCode(c: Cursor, data: ModuleData, findings: FindingList): void {
  const n = c.count(3);
  const offsets = new Uint32Array(n);
  const sizes = new Uint32Array(n);
  data.bodyOffsets = offsets;
  data.bodySizes = sizes;
  const locals = new SoftReader(c.bytes);
  for (let i = 0; i < n; i++) {
    const at = c.pos;
    const size = c.u32();
    if (size > c.left()) {
      throw new WasmInspectorError(
        `A function body is larger than the bytes that remain (length out of bounds): ${withCommas(size)} announced, ${withCommas(c.left())} bytes remain.`,
        at,
      );
    }
    offsets[i] = c.pos;
    sizes[i] = size;
    data.bodyCount = i + 1;
    data.bodyBytes += size;
    const start = c.pos;
    locals.reset(start, start + size);
    checkLocals(locals);
    if (locals.failed) {
      const fault = locals.fault;
      findings.add(
        locals.faultAt,
        () =>
          `${typeof fault === 'string' ? fault : fault()} This is in the code section, in the body that starts at offset ${start}.`,
      );
    }
    c.pos += size;
  }
}

function readSection(section: SectionInfo, c: Cursor, data: ModuleData, findings: FindingList): void {
  switch (section.id) {
    case 1:
      readTypes(c, data);
      break;
    case 2:
      readImports(c, data, findings);
      break;
    case 3:
      readFunctions(c, data);
      break;
    case 4:
      readTables(c, data);
      break;
    case 5:
      readMemories(c, data);
      break;
    case 6:
      readGlobals(c, data);
      break;
    case 7:
      data.exportSection = section;
      readExports(c, data, findings);
      break;
    case 8:
      data.start = c.u32();
      break;
    case 9:
      readElements(c, data);
      break;
    case 10:
      readCode(c, data, findings);
      break;
    case 11:
      readDataSegments(c, data);
      break;
    case 12:
      data.dataCount = c.u32();
      break;
    case 13:
      readTags(c, data);
      break;
    default:
      c.pos = c.end;
  }
}

/**
 * Reads the sections the walk found, one after another, each inside its own bounds. A fault in one section is a finding
 * and ends the reading of that section only; the others are still read. A section whose content does not fill its size is
 * a finding too, and so are a function section and a code section that disagree, and a data count that is not the number of
 * data segments. Custom sections are read elsewhere.
 */
export function readModule(bytes: Uint8Array, sections: readonly SectionInfo[], findings: FindingList): ModuleData {
  const data = newModuleData();
  const failed = new Set<number>();
  const seen = new Set<number>();
  for (const section of sections) {
    if (section.id === 0) continue;
    // A section that appears again is a finding already (the walk); its content is not read twice.
    if (seen.has(section.id)) continue;
    seen.add(section.id);
    const c = new Cursor(bytes, section.bodyOffset, section.bodyOffset + section.size);
    try {
      readSection(section, c, data, findings);
      if (c.pos !== c.end) {
        findings.add(c.pos, `The ${section.name} section does not fill its size (section size mismatch).`);
      }
    } catch (error) {
      if (!(error instanceof WasmInspectorError)) throw error;
      failed.add(section.id);
      findings.add(error.offset ?? section.bodyOffset, `${error.message} This is in the ${section.name} section.`);
    }
  }
  const functionSection = sections.find((s) => s.id === 3);
  const codeSection = sections.find((s) => s.id === 10);
  if ((functionSection !== undefined || codeSection !== undefined) && !failed.has(3) && !failed.has(10)) {
    const declared = data.definedCounts.func;
    const bodies = codeSection === undefined ? 0 : data.bodyCount;
    if (declared !== bodies) {
      findings.add(
        (codeSection ?? functionSection)!.bodyOffset,
        `The function section declares ${withCommas(declared)} functions but the code section holds ${withCommas(bodies)} bodies (function and code section have inconsistent lengths).`,
      );
    }
  }
  if (data.dataCount !== null && !failed.has(11) && !failed.has(12) && data.dataCount !== data.data.count) {
    const dataSection = sections.find((s) => s.id === 11) ?? sections.find((s) => s.id === 12);
    findings.add(
      dataSection!.bodyOffset,
      `The data count section says ${withCommas(data.dataCount)} but the data section holds ${withCommas(data.data.count)} segments (data count and data section have inconsistent lengths).`,
    );
  }
  return data;
}

/** The names of the exported functions among `wanted`, found by one pass over the export section. */
export function exportedFunctionNames(
  bytes: Uint8Array,
  section: SectionInfo | null,
  wanted: ReadonlySet<number>,
): Map<number, string> {
  const names = new Map<number, string>();
  if (section === null || wanted.size === 0) return names;
  const c = new Cursor(bytes, section.bodyOffset, section.bodyOffset + section.size);
  try {
    const n = c.count(3);
    for (let i = 0; i < n; i++) {
      const name = c.name();
      const kind = c.u8();
      const index = c.u32();
      if (kind === 0 && wanted.has(index) && !names.has(index)) names.set(index, name);
    }
  } catch (error) {
    // The same fault is already a finding from the first reading; the names found before it are kept.
    if (!(error instanceof WasmInspectorError)) throw error;
  }
  return names;
}
