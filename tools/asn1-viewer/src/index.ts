import meta from './meta.json';
import { FindingList, readBer, type Asn1Node, type CutRecord, type Finding } from './ber';
import { derNotes } from './conformance';
import { toFlatRows, type FlatTable } from './flat';
import { tryInside } from './inside';
import { readInput, type InputFormat } from './input';
import { INSIDE_BUDGET_BYTES, MAX_NODES } from './limits';
import { toTree, type TreeNode } from './tree';
import { describeConstructedString, describeValue, isConstructedString } from './values';

export { meta };
export { Asn1Error } from './errors';
export {
  INSIDE_BUDGET_BYTES,
  MAX_DECIMAL_BYTES,
  MAX_DEPTH,
  MAX_FILE_BYTES,
  MAX_FLAT_ROWS,
  MAX_HEX_SHOWN,
  MAX_LENGTH_OCTETS,
  MAX_NODES,
  MAX_NOTES,
  MAX_OID_BYTES,
  MAX_PASTE_CHARS,
  MAX_PEM_BLOCKS,
  MAX_TAG_OCTETS,
  MAX_TEXT_SHOWN,
  TREE_DRAWN_NODES,
  withCommas,
} from './limits';
export { readBer } from './ber';
export type { Asn1Class, Asn1Node, BerOptions, BerResult, CutRecord, Finding } from './ber';
export { checkFileSize, checkPasteSize, readInput } from './input';
export type { InputFormat, ReadInputResult } from './input';
export {
  UNIVERSAL_NAMES,
  describeConstructedString,
  describeValue,
  hexOf,
  integerOf,
  isConstructedString,
  parseTime,
  typeName,
} from './values';
export type { ParsedTime, ValueInfo } from './values';
export { EXTRA_OID_NAMES, lookupOidName } from './oids-extra';
export { derNotes } from './conformance';
export type { DerNotes } from './conformance';
export { canHoldAsn1, tryInside } from './inside';
export type { InsideBudget, InsideOptions } from './inside';
export { INSIDE_LABEL, detailOf, labelOf, toTree, treeText } from './tree';
export type { TreeNode, TreeResult } from './tree';
export { toFlatRows } from './flat';
export type { FlatTable } from './flat';

export interface DescribeOptions {
  /** Try the contents of OCTET STRING and BIT STRING as ASN.1 and show those that read completely; default true. */
  tryInside?: boolean;
  /** Also build the table of every element; default false. */
  flat?: boolean;
}

export interface DescribeInput extends DescribeOptions {
  /** Pasted text (PEM, Base64 or hex), or the bytes of an opened file. */
  data: string | Uint8Array;
  /** How the text is read; default `auto`. */
  format?: InputFormat;
}

export interface Description {
  /** `PEM`, `Base64`, `Base64url`, `hex` or `the bytes of the file`. */
  form: string;
  /** The PEM block labels, in order. */
  labels: string[];
  /** Number of bytes of the structure. */
  bytes: number;
  /** Number of elements read, those guessed inside OCTET STRING and BIT STRING contents included. */
  elements: number;
  /** The deepest level read, counting the top level as 1. */
  deepest: number;
  /** The elements read from the data itself, in reading order; guessed contents hang off `inside`. */
  nodes: Asn1Node[];
  /** What could not be read or is odd (problems) and what is valid BER but not DER (notes), by offset, at most 200. */
  findings: Finding[];
  /** Findings and notes beyond the 200 kept. */
  findingsLeftOut: number;
  /** True when there is no finding and no note: the encoding follows every DER rule this page checks. */
  derClean: boolean;
  cut: CutRecord;
  tree: TreeNode[];
  /** Every element read as indented text, for Copy. */
  copyText: string;
  /** The table of every element, when asked for. */
  flat?: FlatTable;
}

/** Describes the bytes of a structure. Empty bytes are an empty description, not an error. */
export function describeBytes(bytes: Uint8Array, options: DescribeOptions = {}): Description {
  const result = readBer(bytes);
  const list = new FindingList();
  for (const finding of result.findings) list.add(finding.offset, finding.message, finding.kind);
  list.leftOut += result.findingsLeftOut;

  let deepest = 0;
  let elements = result.nodes.length;
  for (let index = 0; index < result.nodes.length; index++) {
    const node = result.nodes[index]!;
    node.value = isConstructedString(node)
      ? describeConstructedString(bytes, result.nodes, index)
      : describeValue(bytes, node);
    for (const problem of node.value.problems) list.add(node.offset, `At offset ${node.offset}: ${problem}`, 'problem');
    if (node.depth + 1 > deepest) deepest = node.depth + 1;
  }

  if (options.tryInside ?? true) {
    // Each string is tried once, in reading order, from one budget of bytes; what reads completely is described like the rest.
    const budget = { left: INSIDE_BUDGET_BYTES };
    const work: Asn1Node[][] = [result.nodes];
    while (work.length > 0) {
      const level = work.pop()!;
      for (const node of level) {
        const room = MAX_NODES - elements;
        if (room <= 0) break;
        const inside = tryInside(bytes, node, budget, { maxNodes: room });
        if (inside === null) continue;
        for (let index = 0; index < inside.length; index++) {
          const child = inside[index]!;
          child.value = isConstructedString(child)
            ? describeConstructedString(bytes, inside, index)
            : describeValue(bytes, child);
          if (child.depth + 1 > deepest) deepest = child.depth + 1;
        }
        node.inside = inside;
        elements += inside.length;
        work.push(inside);
      }
    }
  }

  const notes = derNotes(result.nodes, bytes);
  for (const note of notes.notes) list.add(note.offset, note.message, 'note');
  list.leftOut += notes.leftOut;

  const { tree, copyText } = toTree(result.nodes);
  // By offset; a problem comes before a note at the same offset. The sort is stable, so equal keys keep their order.
  const findings = list.items
    .slice()
    .sort((a, b) => a.offset - b.offset || (a.kind === b.kind ? 0 : a.kind === 'problem' ? -1 : 1));
  return {
    form: 'the bytes',
    labels: [],
    bytes: bytes.length,
    elements,
    deepest,
    nodes: result.nodes,
    findings,
    findingsLeftOut: list.leftOut,
    derClean: findings.length === 0 && list.leftOut === 0,
    cut: result.cut,
    tree,
    copyText,
    ...(options.flat === true ? { flat: toFlatRows(result.nodes) } : {}),
  };
}

/**
 * Reads pasted text or an opened file as a BER or DER structure and describes it: the elements with their offsets,
 * tags, lengths and values, the findings and notes, and the tree and copy text. The function holds no state, so the same
 * bytes give the same result however many times and in whatever order they are read.
 */
export function describeStructure(input: DescribeInput): Description {
  const read = readInput(input.data, input.format ?? 'auto');
  const options: DescribeOptions = {};
  if (input.tryInside !== undefined) options.tryInside = input.tryInside;
  if (input.flat !== undefined) options.flat = input.flat;
  return { ...describeBytes(read.bytes, options), form: read.form, labels: read.labels };
}
