import { Cursor } from './cursor';
import { FindingList, WasmInspectorError } from './errors';
import { withCommas } from './limits';
import type { SectionInfo } from './sections';

const CORE = 'core specification';
const PROPOSAL = 'extended name section proposal';

/** The subsections of the name section: the core text defines 0, 1, 2, 4, 10 and 11, the extended name section proposal the rest. */
const SUBSECTIONS: Readonly<Record<number, { label: string; source: string; shape: 'name' | 'map' | 'indirect' }>> = {
  0: { label: 'module name', source: CORE, shape: 'name' },
  1: { label: 'function names', source: CORE, shape: 'map' },
  2: { label: 'local names', source: CORE, shape: 'indirect' },
  3: { label: 'label names', source: PROPOSAL, shape: 'indirect' },
  4: { label: 'type names', source: CORE, shape: 'map' },
  5: { label: 'table names', source: PROPOSAL, shape: 'map' },
  6: { label: 'memory names', source: PROPOSAL, shape: 'map' },
  7: { label: 'global names', source: PROPOSAL, shape: 'map' },
  8: { label: 'element segment names', source: PROPOSAL, shape: 'map' },
  9: { label: 'data segment names', source: PROPOSAL, shape: 'map' },
  10: { label: 'field names', source: CORE, shape: 'indirect' },
  11: { label: 'tag names', source: CORE, shape: 'map' },
  12: { label: 'parameter names', source: PROPOSAL, shape: 'indirect' },
  13: { label: 'tag parameter names', source: PROPOSAL, shape: 'indirect' },
};

/** One subsection of the name section that was read. */
export interface NameSubsection {
  id: number;
  label: string;
  /** Where the subsection is defined: the core specification or the extended name section proposal. */
  source: string;
  /** How many names (a name map) or how many groups of names (an indirect name map) it holds. */
  entries: number;
  /** Its size in bytes. */
  size: number;
  /** The offset of its id byte. */
  offset: number;
}

export interface NamesReport {
  /** The module's name, or null when the name section has none. */
  moduleName: string | null;
  subsections: NameSubsection[];
  /** Function names, kept only for the function indices asked for (the largest functions). */
  functionNames: Map<number, string>;
}

function nameMapRead(
  c: Cursor,
  note: (offset: number, text: string) => void,
  findings: FindingList,
  keep?: (index: number, name: string) => void,
): number {
  const n = c.count(2);
  let previous = -1;
  let ordered = true;
  for (let i = 0; i < n; i++) {
    const at = c.pos;
    const index = c.u32();
    const text = c.name(findings);
    if (index <= previous && ordered) {
      ordered = false;
      note(at, 'A name map is not in increasing order of index (not in increasing order).');
    }
    previous = index;
    keep?.(index, text);
  }
  return n;
}

function readSubsection(
  id: number,
  shape: 'name' | 'map' | 'indirect',
  c: Cursor,
  report: NamesReport,
  wanted: ReadonlySet<number>,
  note: (offset: number, text: string) => void,
  findings: FindingList,
): number {
  if (shape === 'name') {
    report.moduleName = c.name(findings);
    return 1;
  }
  if (shape === 'map') {
    return nameMapRead(
      c,
      note,
      findings,
      id === 1
        ? (index, text) => {
            if (wanted.has(index) && !report.functionNames.has(index)) report.functionNames.set(index, text);
          }
        : undefined,
    );
  }
  const n = c.count(2);
  let previous = -1;
  let ordered = true;
  for (let i = 0; i < n; i++) {
    const at = c.pos;
    const index = c.u32();
    if (index <= previous && ordered) {
      ordered = false;
      note(at, 'An indirect name map is not in increasing order of index (not in increasing order).');
    }
    previous = index;
    nameMapRead(c, note, findings);
  }
  return n;
}

/**
 * Reads the name section: its subsections one by one, each inside its own bounds, so one that cannot be read is a finding
 * and the next is still read. Subsections must come once each in increasing order of id; one that does not is a finding and
 * is still read. Only the function names asked for in `wanted` are kept, so a huge name section costs time and not memory.
 */
export function readNameSection(
  bytes: Uint8Array,
  section: SectionInfo,
  wanted: ReadonlySet<number>,
  findings: FindingList,
): NamesReport {
  const report: NamesReport = { moduleName: null, subsections: [], functionNames: new Map() };
  const end = section.bodyOffset + section.size;
  const c = new Cursor(bytes, section.payloadOffset, end);
  const seen = new Set<number>();
  let last = -1;
  const note = (offset: number, text: string): void => findings.add(offset, `${text} This is in the name section.`);
  while (!c.atEnd()) {
    const start = c.pos;
    let id: number;
    let size: number;
    try {
      id = c.u8();
      size = c.u32();
      if (size > c.left()) {
        throw new WasmInspectorError(
          `A name subsection is larger than the bytes that remain (length out of bounds): ${withCommas(size)} announced, ${withCommas(c.left())} bytes remain.`,
          start,
        );
      }
    } catch (error) {
      if (!(error instanceof WasmInspectorError)) throw error;
      note(error.offset ?? start, error.message);
      break;
    }
    const subEnd = c.pos + size;
    const known = SUBSECTIONS[id];
    if (known === undefined) {
      note(start, 'A name subsection has an id this page does not know, and is skipped.');
      c.pos = subEnd;
      continue;
    }
    if (seen.has(id)) note(start, `The ${known.label} subsection appears more than once.`);
    else if (id < last) note(start, `The ${known.label} subsection is out of order.`);
    seen.add(id);
    if (id > last) last = id;
    const sub = new Cursor(bytes, c.pos, subEnd);
    try {
      const entries = readSubsection(id, known.shape, sub, report, wanted, note, findings);
      if (sub.pos !== sub.end)
        note(sub.pos, `The ${known.label} subsection does not fill its size (section size mismatch).`);
      report.subsections.push({ id, label: known.label, source: known.source, entries, size, offset: start });
    } catch (error) {
      if (!(error instanceof WasmInspectorError)) throw error;
      note(error.offset ?? start, error.message);
    }
    c.pos = subEnd;
  }
  return report;
}
