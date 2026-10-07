import { FindingList, WasmInspectorError, type Finding } from './errors';
import { MAX_MODULE_BYTES, withCommas } from './limits';
import { Capped, readModule, type ExportRow, type ImportRow } from './module';
import { readHeader, walkSections, type SectionInfo } from './sections';
import type { TypeRow } from './types';

export type ReportKind = 'module' | 'component' | 'unreadable';

/** Everything the reader found in a file. Plain data: nothing in it can run, and nothing holds state between calls. */
export interface Report {
  /** `module` for a core module, `component` for a component model binary (header only), `unreadable` for anything else. */
  kind: ReportKind;
  /** One plain sentence when the file is not a module that can be read; null for a module. */
  sentence: string | null;
  /** The size of the file in bytes. */
  size: number;
  /** The sections, in file order (at most 2,000, always the first of each kind). */
  sections: SectionInfo[];
  /** How many sections the file holds in all. */
  sectionCount: number;
  types: Capped<TypeRow>;
  imports: Capped<ImportRow>;
  exports: Capped<ExportRow>;
  /** Functions imported and defined; the function index space holds the imported ones first. */
  functions: { imported: number; defined: number };
  /** The start function's index, or null. */
  start: number | null;
  /** What could not be read or is odd, by offset, at most 200. */
  findings: Finding[];
  /** Findings beyond the 200 kept. */
  findingsLeftOut: number;
}

/** Refuses a file over 64 MiB from its size alone, before any byte is read. */
export function checkModuleSize(size: number): void {
  if (size > MAX_MODULE_BYTES) {
    throw new WasmInspectorError(
      `This file is ${withCommas(size)} bytes, larger than the 64 MiB this page reads. It was not read.`,
    );
  }
}

function emptyReport(kind: ReportKind, sentence: string | null, size: number): Report {
  return {
    kind,
    sentence,
    size,
    sections: [],
    sectionCount: 0,
    types: new Capped(),
    imports: new Capped(),
    exports: new Capped(),
    functions: { imported: 0, defined: 0 },
    start: null,
    findings: [],
    findingsLeftOut: 0,
  };
}

/**
 * Reads the bytes of a file as a WebAssembly module, section by section. The module is never compiled, validated,
 * instantiated or run: this reads bytes and nothing else. Faults in the structure are findings, never thrown; only a file
 * over 64 MiB is refused.
 */
export function inspect(bytes: Uint8Array): Report {
  checkModuleSize(bytes.length);
  const header = readHeader(bytes);
  if (header.kind !== 'module') return emptyReport(header.kind, header.sentence, bytes.length);

  const findings = new FindingList();
  const walk = walkSections(bytes, findings);
  const data = readModule(bytes, walk.sections, findings);
  return {
    kind: 'module',
    sentence: null,
    size: bytes.length,
    sections: walk.sections,
    sectionCount: walk.total,
    types: data.types,
    imports: data.imports,
    exports: data.exports,
    functions: { imported: data.importCounts.func, defined: data.functionCount },
    start: data.start,
    // By offset; the sort is stable, so findings at one offset keep the order they were found in.
    findings: findings.items.slice().sort((a, b) => a.offset - b.offset),
    findingsLeftOut: findings.leftOut,
  };
}
