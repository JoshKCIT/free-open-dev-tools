import { readCustomSections, type CustomRow, type ProducerField, type TargetFeature } from './custom';
import { FindingList, WasmInspectorError, type Finding } from './errors';
import { usedFeatures } from './features';
import { MAX_MODULE_BYTES, withCommas } from './limits';
import {
  Capped,
  exportedFunctionNames,
  readModule,
  type DataRow,
  type ElementRow,
  type ExportRow,
  type GlobalRow,
  type ImportRow,
  type MemoryRow,
  type TableRow,
  type TagRow,
} from './module';
import type { NamesReport } from './names';
import { readHeader, walkSections, type SectionInfo } from './sections';
import { findStrings, type StringsReport } from './strings';
import type { TypeRow } from './types';

export type ReportKind = 'module' | 'component' | 'unreadable';

/** One function body, by its place in the function index space. */
export interface FunctionRow {
  /** The function index (imported functions come first, so the first defined function follows them). */
  index: number;
  /** From the name section, else from an export of the function, else the empty string. */
  name: string;
  /** The size of the body in bytes. */
  size: number;
  /** The offset in the file where the body begins. */
  offset: number;
}

export interface FunctionsReport {
  imported: number;
  /** How many functions the function section declares. */
  defined: number;
  /** The largest bodies, largest first (equal sizes: the lower index first), at most 50. */
  largest: FunctionRow[];
  /** How many measured bodies are not in `largest`. */
  largestLeftOut: number;
  /** The total size of the bodies in bytes. */
  bodyBytes: number;
}

/** Everything the reader found in a file. Plain data: nothing in it can run, and nothing holds state between calls. */
export interface Report {
  /** `module` for a core module, `component` for a component model binary (header only), `unreadable` for anything else. */
  kind: ReportKind;
  /** One plain sentence when the file is not a module that can be read; null for a module. */
  sentence: string | null;
  /** The size of the file in bytes. */
  size: number;
  /**
   * The sections, in file order: the first 2,000, then the first of each kind and the first custom section of each name
   * this page decodes.
   */
  sections: SectionInfo[];
  /** How many sections the file holds in all. */
  sectionCount: number;
  types: Capped<TypeRow>;
  imports: Capped<ImportRow>;
  exports: Capped<ExportRow>;
  functions: FunctionsReport;
  tables: Capped<TableRow>;
  memories: Capped<MemoryRow>;
  globals: Capped<GlobalRow>;
  tags: Capped<TagRow>;
  elements: Capped<ElementRow>;
  data: Capped<DataRow>;
  /** The number the data count section gives, or null. */
  dataCount: number | null;
  /** The start function's index, or null. */
  start: number | null;
  customs: Capped<CustomRow>;
  names: NamesReport;
  producers: ProducerField[];
  targetFeatures: TargetFeature[];
  /** The address in a sourceMappingURL section, as text. It is never requested. */
  sourceMappingUrl: string | null;
  /** The address in an external_debug_info section, as text. It is never requested. */
  externalDebugInfo: string | null;
  /** Printable text found in data segments. */
  strings: StringsReport;
  /** The features the module uses, worked out from what its sections hold. */
  features: string[];
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
    functions: { imported: 0, defined: 0, largest: [], largestLeftOut: 0, bodyBytes: 0 },
    tables: new Capped(),
    memories: new Capped(),
    globals: new Capped(),
    tags: new Capped(),
    elements: new Capped(),
    data: new Capped(),
    dataCount: null,
    start: null,
    customs: new Capped(),
    names: { moduleName: null, subsections: [], functionNames: new Map() },
    producers: [],
    targetFeatures: [],
    sourceMappingUrl: null,
    externalDebugInfo: null,
    strings: { items: [], total: 0, scanned: 0, truncated: false },
    features: [],
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

  // The names of the largest functions come from the name section first and from an export of the function second.
  const importedFunctions = data.importCounts.func;
  const largest = data.largest;
  const wanted = new Set(largest.map((body) => importedFunctions + body.index));
  const custom = readCustomSections(bytes, walk.sections, walk.customTotal, wanted, findings);
  const exported = exportedFunctionNames(bytes, data.exportSection, wanted);
  const functions: FunctionsReport = {
    imported: importedFunctions,
    defined: data.definedCounts.func,
    largest: largest.map((body) => {
      const index = importedFunctions + body.index;
      return {
        index,
        name: custom.names.functionNames.get(index) ?? exported.get(index) ?? '',
        size: body.size,
        offset: body.offset,
      };
    }),
    largestLeftOut: data.bodyCount - largest.length,
    bodyBytes: data.bodyBytes,
  };

  return {
    kind: 'module',
    sentence: null,
    size: bytes.length,
    sections: walk.sections,
    sectionCount: walk.total,
    types: data.types,
    imports: data.imports,
    exports: data.exports,
    functions,
    tables: data.tables,
    memories: data.memories,
    globals: data.globals,
    tags: data.tags,
    elements: data.elements,
    data: data.data,
    dataCount: data.dataCount,
    start: data.start,
    customs: custom.rows,
    names: custom.names,
    producers: custom.producers,
    targetFeatures: custom.targetFeatures,
    sourceMappingUrl: custom.sourceMappingUrl,
    externalDebugInfo: custom.externalDebugInfo,
    strings: findStrings(bytes, data.dataSpans, data.dataSpansSkipped),
    features: usedFeatures(data),
    // By offset; the sort is stable, so findings at one offset keep the order they were found in.
    findings: findings.items.slice().sort((a, b) => a.offset - b.offset),
    findingsLeftOut: findings.leftOut,
  };
}
