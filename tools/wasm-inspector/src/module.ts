import { Cursor } from './cursor';
import { FindingList, WasmInspectorError } from './errors';
import { MAX_ROWS } from './limits';
import type { SectionInfo } from './sections';
import { readGlobalType, readMemType, readRecType, readTableType, readTagType, type TypeRow } from './types';

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

/** What the sections of a module hold, kept in caps. */
export interface ModuleData {
  types: Capped<TypeRow>;
  imports: Capped<ImportRow>;
  /** How many of each kind are imported. */
  importCounts: Record<ExternKind, number>;
  /** The number of functions the function section defines. */
  functionCount: number;
  exports: Capped<ExportRow>;
  /** The start function's index, or null. */
  start: number | null;
}

function newModuleData(): ModuleData {
  return {
    types: new Capped(),
    imports: new Capped(),
    importCounts: { func: 0, table: 0, memory: 0, global: 0, tag: 0 },
    functionCount: 0,
    exports: new Capped(),
    start: null,
  };
}

/** The signature of a type if it was kept, else a plain mention of its index. */
function typeText(data: ModuleData, index: number): string {
  const row = data.types.rows[index];
  return row === undefined ? `type ${index}` : `type ${index}: ${row.text}`;
}

function readTypes(c: Cursor, data: ModuleData): void {
  const n = c.count(1);
  let defined = 0;
  while (defined < n) defined += readRecType(c, data.types.count, (row) => data.types.add(row));
}

function readImports(c: Cursor, data: ModuleData, findings: FindingList): void {
  const n = c.count(3);
  for (let i = 0; i < n; i++) {
    const module = c.name(findings);
    const field = c.name(findings);
    const at = c.pos;
    const code = c.u8();
    const kind = EXTERN_KINDS[code];
    if (kind === undefined)
      throw new WasmInspectorError('An import has a kind that does not exist (malformed import kind).', at);
    let detail: string;
    if (kind === 'func') detail = typeText(data, c.u32());
    else if (kind === 'table') detail = readTableType(c).text;
    else if (kind === 'memory') detail = readMemType(c).text;
    else if (kind === 'global') detail = readGlobalType(c).text;
    else detail = typeText(data, readTagType(c));
    const index = data.importCounts[kind]++;
    data.imports.add({ module, field, kind, index, detail });
  }
}

function readFunctions(c: Cursor, data: ModuleData): void {
  const n = c.count(1);
  for (let i = 0; i < n; i++) c.u32();
  data.functionCount = n;
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
    case 7:
      readExports(c, data, findings);
      break;
    case 8:
      data.start = c.u32();
      break;
    default:
      // Sections not read yet are left alone; their size is known from the walk.
      c.pos = c.end;
  }
}

/**
 * Reads the sections the walk found, one after another, each inside its own bounds. A fault in one section is a finding
 * and ends the reading of that section only; the others are still read. A section whose content does not fill its size is
 * a finding too.
 */
export function readModule(bytes: Uint8Array, sections: readonly SectionInfo[], findings: FindingList): ModuleData {
  const data = newModuleData();
  for (const section of sections) {
    if (section.id === 0) continue;
    const c = new Cursor(bytes, section.bodyOffset, section.bodyOffset + section.size);
    try {
      readSection(section, c, data, findings);
      if (c.pos !== c.end) {
        findings.add(c.pos, `The ${section.name} section does not fill its size (section size mismatch).`);
      }
    } catch (error) {
      if (!(error instanceof WasmInspectorError)) throw error;
      findings.add(error.offset ?? section.bodyOffset, `${error.message} (in the ${section.name} section)`);
    }
  }
  return data;
}
