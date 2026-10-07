import { readBer, type Asn1Node } from './ber';
import { MAX_DEPTH } from './limits';

/** The bytes still allowed to be tried as nested ASN.1, over every attempt on one input. */
export interface InsideBudget {
  left: number;
}

export interface InsideOptions {
  /** Most elements the guess may add; default is no limit beyond the reader's own. */
  maxNodes?: number;
}

/** Whether a node is an OCTET STRING, or a BIT STRING with no unused bits, whose contents are worth trying. */
export function canHoldAsn1(bytes: Uint8Array, node: Asn1Node): boolean {
  if (node.cls !== 'universal' || node.constructed || node.length === null || node.eoc) return false;
  // The contents of the string sit one level below it, and the line that says they are a guess takes another.
  if (node.depth + 2 >= MAX_DEPTH) return false;
  if (node.tag === 4) return node.length >= 2;
  if (node.tag === 3) return node.length >= 3 && bytes[node.offset + node.headerLength] === 0;
  return false;
}

/**
 * Tries the contents of an OCTET STRING, or of a BIT STRING with no unused bits, as BER. The elements are returned only
 * when the read ends exactly at the end of the contents with no finding and at least one element; anything else is
 * `null`, because contents that merely look like a start of ASN.1 would be a wrong answer. The offsets are those of the
 * whole data. Every attempt takes its size from `budget`, and an attempt that does not fit is not made.
 */
export function tryInside(
  bytes: Uint8Array,
  node: Asn1Node,
  budget: InsideBudget,
  options: InsideOptions = {},
): Asn1Node[] | null {
  if (!canHoldAsn1(bytes, node)) return null;
  const contentStart = node.offset + node.headerLength + (node.tag === 3 ? 1 : 0);
  const size = node.end - contentStart;
  if (size > budget.left) return null;
  budget.left -= size;
  const read = readBer(bytes, {
    from: contentStart,
    to: node.end,
    baseDepth: node.depth + 2,
    maxDepth: MAX_DEPTH,
    ...(options.maxNodes === undefined ? {} : { maxNodes: options.maxNodes }),
  });
  const cut = read.cut;
  if (read.nodes.length === 0 || read.findings.length > 0 || read.findingsLeftOut > 0) return null;
  if (cut.nodes !== null || cut.depth !== null || cut.stopped !== null) return null;
  return read.nodes;
}
