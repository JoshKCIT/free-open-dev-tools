import meta from './meta.json';
import { FindingList, readBer, type Asn1Node, type CutRecord, type Finding } from './ber';
import { readInput, type InputFormat } from './input';
import { toTree, type TreeNode } from './tree';
import { describeValue } from './values';

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
export { UNIVERSAL_NAMES, describeValue, hexOf, integerOf, typeName } from './values';
export type { ValueInfo } from './values';
export { INSIDE_LABEL, detailOf, labelOf, toTree, treeText } from './tree';
export type { TreeNode, TreeResult } from './tree';

export interface DescribeInput {
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
  /** Number of elements read. */
  elements: number;
  /** The deepest level read, counting the top level as 1. */
  deepest: number;
  nodes: Asn1Node[];
  findings: Finding[];
  /** Findings and notes beyond the 200 kept. */
  findingsLeftOut: number;
  /** True when nothing was found and no note applies: the encoding follows every DER rule this page checks. */
  derClean: boolean;
  cut: CutRecord;
  tree: TreeNode[];
  copyText: string;
}

/**
 * Reads pasted text or an opened file as a BER or DER structure and describes it: the elements with their offsets,
 * tags, lengths and values, the findings, and the tree and copy text. The function holds no state, so the same bytes give
 * the same result however many times and in whatever order they are read.
 */
export function describeStructure(input: DescribeInput): Description {
  const read = readInput(input.data, input.format ?? 'auto');
  const result = readBer(read.bytes);
  const list = new FindingList();
  for (const finding of result.findings) list.add(finding.offset, finding.message, finding.kind);
  list.leftOut += result.findingsLeftOut;

  let deepest = 0;
  for (const node of result.nodes) {
    node.value = describeValue(read.bytes, node);
    for (const problem of node.value.problems) list.add(node.offset, problem, 'problem');
    if (node.depth + 1 > deepest) deepest = node.depth + 1;
  }
  const { tree, copyText, total } = toTree(result.nodes);
  const findings = list.items.slice().sort((a, b) => a.offset - b.offset);
  return {
    form: read.form,
    labels: read.labels,
    bytes: read.bytes.length,
    elements: total,
    deepest,
    nodes: result.nodes,
    findings,
    findingsLeftOut: list.leftOut,
    derClean: findings.length === 0 && list.leftOut === 0,
    cut: result.cut,
    tree,
    copyText,
  };
}
