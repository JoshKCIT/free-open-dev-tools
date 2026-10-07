import { Cursor } from './cursor';
import { FindingList, WasmInspectorError } from './errors';
import { MAX_ROWS, withCommas } from './limits';

/** The section ids of the WebAssembly 3.0 core binary format. */
export const SECTION_NAMES: readonly string[] = [
  'custom',
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
  'data count',
  'tag',
];

/**
 * Where each section id sits in the module grammar. The rank is not the id: the tag section (13) sits between memory (5)
 * and global (6), and the data count section (12) sits before code (10).
 */
const RANK: Readonly<Record<number, number>> = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  13: 6,
  6: 7,
  7: 8,
  8: 9,
  9: 10,
  12: 11,
  10: 12,
  11: 13,
};

/** A section found by walking the file: where it starts, where its content starts, and how long the content is. */
export interface SectionInfo {
  id: number;
  name: string;
  /** The offset of the section id byte. */
  offset: number;
  /** The offset of the first content byte (after the id and the size). */
  bodyOffset: number;
  /** The size of the content in bytes. */
  size: number;
  /** For a custom section, its name; empty for the others. */
  customName: string;
  /** The offset of the first byte after the name of a custom section (the payload); the content offset for the others. */
  payloadOffset: number;
}

export type Header =
  { kind: 'module' } | { kind: 'component'; sentence: string } | { kind: 'unreadable'; sentence: string };

const MAGIC = [0x00, 0x61, 0x73, 0x6d];

/** What the first eight bytes say: a module, a component model binary, or a plain sentence about what the file is. */
export function readHeader(bytes: Uint8Array): Header {
  if (bytes.length === 0) {
    return { kind: 'unreadable', sentence: 'The file is empty, so there is no module to read.' };
  }
  for (let i = 0; i < MAGIC.length && i < bytes.length; i++) {
    if (bytes[i] !== MAGIC[i]) {
      return {
        kind: 'unreadable',
        sentence: 'This file does not start with the WebAssembly signature, so it is not a module.',
      };
    }
  }
  if (bytes.length === 4) {
    return {
      kind: 'unreadable',
      sentence:
        'The file holds only the four byte WebAssembly signature; a module goes on with a four byte version field.',
    };
  }
  if (bytes.length < 8) {
    return {
      kind: 'unreadable',
      sentence: `The file is cut off inside its eight byte header (it is ${bytes.length} bytes long), so there is no module to read.`,
    };
  }
  if (bytes[4] === 0x0d && bytes[5] === 0x00 && bytes[6] === 0x01 && bytes[7] === 0x00) {
    return {
      kind: 'component',
      sentence:
        'This is a component model binary. This page recognises it by its header and does not read it; open the core module inside it instead.',
    };
  }
  if (bytes[4] !== 0x01 || bytes[5] !== 0x00 || bytes[6] !== 0x00 || bytes[7] !== 0x00) {
    return {
      kind: 'unreadable',
      sentence:
        'The version field at offset 4 is not 1, the only version of the binary format this page reads, so there is no module to read.',
    };
  }
  return { kind: 'module' };
}

/** The sections found, in file order, and how many there were in all. */
export interface SectionWalk {
  /** At most `MAX_ROWS` sections, and always the first section of each kind, so every section the reader needs is here. */
  sections: SectionInfo[];
  /** How many sections the file holds, those not kept included. */
  total: number;
  /** How many of them are custom sections. */
  customTotal: number;
}

/**
 * Walks the sections of a module whose header is already known to be good: the id, the size and the place of every
 * section, with the order of the grammar, repeats, and sizes checked against the bytes that remain. A fault is a finding;
 * the walk stops where the next section cannot be found, and every section found before that is returned.
 */
export function walkSections(bytes: Uint8Array, findings: FindingList): SectionWalk {
  const sections: SectionInfo[] = [];
  let total = 0;
  let customTotal = 0;
  const seen = new Set<number>();
  let lastRank = 0;
  let pos = 8;
  while (pos < bytes.length) {
    const start = pos;
    const id = bytes[pos]!;
    if (id > 13) {
      findings.add(start, 'A section has an id that does not exist (malformed section id).');
      break;
    }
    const head = new Cursor(bytes, pos + 1);
    let size: number;
    try {
      size = head.u32();
    } catch (error) {
      if (error instanceof WasmInspectorError) {
        findings.add(error.offset ?? start, error.message);
        break;
      }
      throw error;
    }
    const bodyOffset = head.pos;
    if (size > bytes.length - bodyOffset) {
      findings.add(
        start,
        `A section is larger than the bytes that remain (length out of bounds): ${withCommas(size)} announced, ${withCommas(bytes.length - bodyOffset)} bytes remain.`,
      );
      break;
    }
    total++;
    if (id === 0) customTotal++;
    // Past MAX_ROWS sections only the first section of each kind is kept, so a file of empty sections stays small.
    const keep = sections.length < MAX_ROWS || (id !== 0 && !seen.has(id));
    let customName = '';
    let payloadOffset = bodyOffset;
    if (id === 0) {
      payloadOffset = bodyOffset + size;
      if (keep) {
        try {
          const reader = new Cursor(bytes, bodyOffset, bodyOffset + size);
          customName = reader.name(findings);
          payloadOffset = reader.pos;
        } catch (error) {
          if (!(error instanceof WasmInspectorError)) throw error;
          findings.add(error.offset ?? bodyOffset, error.message);
        }
      }
    } else {
      if (seen.has(id)) findings.add(start, `The ${SECTION_NAMES[id]} section appears more than once.`);
      seen.add(id);
      const rank = RANK[id]!;
      if (rank < lastRank) findings.add(start, `The ${SECTION_NAMES[id]} section is out of order.`);
      if (rank > lastRank) lastRank = rank;
    }
    if (keep)
      sections.push({ id, name: SECTION_NAMES[id]!, offset: start, bodyOffset, size, customName, payloadOffset });
    pos = bodyOffset + size;
  }
  return { sections, total, customTotal };
}
