import { Cursor } from './cursor';
import { FindingList, WasmInspectorError } from './errors';
import { MAX_ROWS, MAX_SHOWN_NAME, withCommas } from './limits';
import { Capped } from './module';
import { readNameSection, type NamesReport } from './names';
import type { SectionInfo } from './sections';

export type CustomKind =
  | 'name'
  | 'producers'
  | 'target_features'
  | 'sourceMappingURL'
  | 'external_debug_info'
  | 'dylink.0'
  | 'linking'
  | 'reloc'
  | 'debug'
  | 'other';

/** One custom section: what it is called, what defines it, how big its payload is and a short decoded summary. */
export interface CustomRow {
  name: string;
  kind: CustomKind;
  /** What defines the section: the core specification, the tool conventions, ECMA-426, or nothing this page knows. */
  standard: string;
  /** The offset of the section's id byte. */
  offset: number;
  /** The size of the payload in bytes (after the name, as the JavaScript API counts custom sections). */
  size: number;
  summary: string;
}

export interface ProducerField {
  field: string;
  values: string[];
}

export interface TargetFeature {
  /** `+` (used), `-` (not allowed) or `=` (used and required), as the tool conventions define the prefix byte. */
  prefix: string;
  name: string;
}

export interface CustomReport {
  rows: Capped<CustomRow>;
  names: NamesReport;
  producers: ProducerField[];
  producersLeftOut: number;
  targetFeatures: TargetFeature[];
  targetFeaturesLeftOut: number;
  /** The address in a sourceMappingURL section, as text. It is never requested. */
  sourceMappingUrl: string | null;
  /** The address in an external_debug_info section, as text. It is never requested. */
  externalDebugInfo: string | null;
}

const TOOL_CONVENTIONS = 'tool conventions';

function kindOf(name: string): { kind: CustomKind; standard: string } {
  switch (name) {
    case 'name':
      return { kind: 'name', standard: 'core specification' };
    case 'producers':
    case 'target_features':
    case 'external_debug_info':
    case 'linking':
      return { kind: name, standard: TOOL_CONVENTIONS };
    case 'dylink.0':
      return { kind: 'dylink.0', standard: TOOL_CONVENTIONS };
    case 'sourceMappingURL':
      return { kind: 'sourceMappingURL', standard: 'ECMA-426' };
    default:
      if (name.startsWith('reloc.')) return { kind: 'reloc', standard: TOOL_CONVENTIONS };
      if (name.startsWith('.debug_')) return { kind: 'debug', standard: TOOL_CONVENTIONS };
      return { kind: 'other', standard: '' };
  }
}

/** The producers section: a vector of fields, each a name and a vector of versioned names. */
function readProducers(c: Cursor, report: CustomReport): string {
  const n = c.count(2);
  const fresh: ProducerField[] = [];
  for (let i = 0; i < n; i++) {
    const field = c.name();
    const m = c.count(2);
    const values: string[] = [];
    for (let j = 0; j < m; j++) {
      const product = c.name();
      const version = c.name();
      if (values.length < MAX_ROWS) values.push(version === '' ? product : `${product} ${version}`);
    }
    if (report.producers.length < MAX_ROWS) {
      report.producers.push({ field, values });
      fresh.push({ field, values });
    } else report.producersLeftOut++;
  }
  return fresh
    .slice(0, 8)
    .map((p) => `${p.field}: ${p.values.slice(0, 6).join(', ')}`)
    .join('; ');
}

/** The target_features section: a vector of a prefix byte and a name. */
function readTargetFeatures(c: Cursor, report: CustomReport): string {
  const n = c.count(2);
  const fresh: TargetFeature[] = [];
  for (let i = 0; i < n; i++) {
    const at = c.pos;
    const prefix = c.u8();
    if (prefix !== 0x2b && prefix !== 0x2d && prefix !== 0x3d) {
      throw new WasmInspectorError('A target feature has a prefix other than +, - or =.', at);
    }
    const feature = { prefix: String.fromCharCode(prefix), name: c.name() };
    if (report.targetFeatures.length < MAX_ROWS) {
      report.targetFeatures.push(feature);
      fresh.push(feature);
    } else report.targetFeaturesLeftOut++;
  }
  return fresh
    .slice(0, 12)
    .map((f) => `${f.prefix}${f.name}`)
    .join(', ');
}

function shortened(text: string): string {
  return text.length > MAX_SHOWN_NAME ? `${text.slice(0, MAX_SHOWN_NAME)}…` : text;
}

/**
 * Reads every custom section the walk kept: the name section is decoded subsection by subsection, `producers`,
 * `target_features`, `sourceMappingURL` and `external_debug_info` are decoded, and the dynamic linking, linking, relocation
 * and debug sections are listed with their sizes only. A fault inside one custom section is a finding that names the section
 * and never hides the module (errors in custom section data must not invalidate the module). Addresses are text and are never
 * requested. `wanted` names the function indices whose names the caller needs.
 */
export function readCustomSections(
  bytes: Uint8Array,
  sections: readonly SectionInfo[],
  total: number,
  wanted: ReadonlySet<number>,
  findings: FindingList,
): CustomReport {
  const report: CustomReport = {
    rows: new Capped(),
    names: { moduleName: null, subsections: [], functionNames: new Map() },
    producers: [],
    producersLeftOut: 0,
    targetFeatures: [],
    targetFeaturesLeftOut: 0,
    sourceMappingUrl: null,
    externalDebugInfo: null,
  };
  let haveNames = false;
  for (const section of sections) {
    if (section.id !== 0) continue;
    const { kind, standard } = kindOf(section.customName);
    const end = section.bodyOffset + section.size;
    const size = end - section.payloadOffset;
    const c = new Cursor(bytes, section.payloadOffset, end);
    let summary = size === 1 ? '1 byte' : `${withCommas(size)} bytes`;
    try {
      if (kind === 'name') {
        const names = readNameSection(bytes, section, wanted, findings);
        // Only the first name section is used for names; a repeated one is listed.
        if (!haveNames) report.names = names;
        haveNames = true;
        const labels = names.subsections.map((s) => s.label);
        summary =
          (names.moduleName !== null ? `module name: ${shortened(names.moduleName)}; ` : '') +
          `${names.subsections.length} subsection${names.subsections.length === 1 ? '' : 's'}` +
          (labels.length > 0 ? `: ${labels.slice(0, 8).join(', ')}${labels.length > 8 ? ', ...' : ''}` : '');
      } else if (kind === 'producers') {
        summary = readProducers(c, report);
        if (!c.atEnd())
          throw new WasmInspectorError('The section does not fill its size (section size mismatch).', c.pos);
      } else if (kind === 'target_features') {
        summary = readTargetFeatures(c, report);
        if (!c.atEnd())
          throw new WasmInspectorError('The section does not fill its size (section size mismatch).', c.pos);
      } else if (kind === 'sourceMappingURL' || kind === 'external_debug_info') {
        const address = c.name();
        if (!c.atEnd())
          throw new WasmInspectorError('The section does not fill its size (section size mismatch).', c.pos);
        if (kind === 'sourceMappingURL') report.sourceMappingUrl ??= address;
        else report.externalDebugInfo ??= address;
        summary = `address (shown as text, never requested): ${shortened(address)}`;
      } else if (kind === 'dylink.0' || kind === 'linking' || kind === 'reloc' || kind === 'debug') {
        summary = `${summary}, listed by size only`;
      }
    } catch (error) {
      if (!(error instanceof WasmInspectorError)) throw error;
      findings.add(error.offset ?? section.offset, `${error.message} This is in the ${section.customName} section.`);
      summary = `${summary}, could not be read`;
    }
    report.rows.add({ name: section.customName, kind, standard, offset: section.offset, size, summary });
  }
  // Custom sections beyond the rows kept by the walk are still counted.
  report.rows.count = Math.max(report.rows.count, total);
  return report;
}
