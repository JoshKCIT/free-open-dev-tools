import { MAX_DEPTH, MAX_LENGTH_OCTETS, MAX_NODES, MAX_NOTES, MAX_TAG_OCTETS, withCommas } from './limits';
import type { ValueInfo } from './values';

/*
 * A tolerant reader of ITU-T X.690 Basic Encoding Rules. It reads definite and indefinite lengths with an explicit stack
 * (never a call per level), so a structure nested a million levels deep costs a loop and not the call stack. Every length
 * is read as a BigInt and compared with what remains in its container before anything is sliced or sized. It never throws
 * on its input: a fault is a finding with an offset, and reading stops at the first structure it cannot follow.
 *
 * RULE, stated once and enforced by a test: no message holds a byte of the input. A message names an offset and a rule.
 */

export type Asn1Class = 'universal' | 'application' | 'context' | 'private';

const CLASSES: readonly Asn1Class[] = ['universal', 'application', 'context', 'private'];

export interface Asn1Node {
  /** Position in reading order, from 0, within the list this node sits in. */
  index: number;
  /** Index of the container, or -1 at the top level. */
  parent: number;
  /** Offset of the first identifier octet. */
  offset: number;
  /** Nesting level from 0 at the top. */
  depth: number;
  cls: Asn1Class;
  tag: number;
  constructed: boolean;
  /** Identifier octets plus length octets. */
  headerLength: number;
  /** Content octets (for an indefinite length, those before the end-of-contents octets); null when the length was never known. */
  length: number | null;
  indefinite: boolean;
  /** Offset just after the element, end-of-contents octets included. */
  end: number;
  /** True for the two end-of-contents octets that close an indefinite length. */
  eoc: boolean;
  /** The length octets use more octets than needed, or the tag number is not in its shortest form. */
  lengthNotMinimal: boolean;
  tagNotMinimal: boolean;
  /** Number of elements read directly inside this one. */
  childCount: number;
  /** The contents were not read because the element sits at the deepest level read. */
  notRead?: 'nesting';
  /** The data ended before the end-of-contents octets of an indefinite length. */
  missingEoc?: boolean;
  /** The length claims more bytes than remain in the container (the claim as digits). */
  overrun?: string;
  /** Set by the page-level description: the decoded value. */
  value?: ValueInfo;
  /** Set by the page-level description: contents that read completely as ASN.1, a guess. Offsets are absolute. */
  inside?: Asn1Node[];
}

export interface Finding {
  offset: number;
  message: string;
  /** `problem`: the reader could not follow the data or a value is wrong. `note`: valid BER that DER does not allow. */
  kind: 'problem' | 'note';
}

export interface CutRecord {
  /** Reading stopped at the element cap: where the next element would have started, and how many bytes were left. */
  nodes: { offset: number; bytesLeft: number } | null;
  /** Elements whose contents were not read for nesting: how many, the first offset and the bytes skipped or left. */
  depth: { count: number; firstOffset: number; bytes: number } | null;
  /** Reading stopped because the structure could not be followed: the offset and how many bytes were left. */
  stopped: { offset: number; bytesLeft: number } | null;
}

export interface BerOptions {
  /** First byte read; default 0. */
  from?: number;
  /** One past the last byte read; default the length of the data. */
  to?: number;
  /** Most levels read; default 40. */
  maxDepth?: number;
  /** Most elements read; default 100,000. */
  maxNodes?: number;
  /** Level of the first element read; default 0. Used to read the contents of an OCTET STRING one level down. */
  baseDepth?: number;
}

export interface BerResult {
  nodes: Asn1Node[];
  findings: Finding[];
  /** Problems beyond the findings kept. */
  findingsLeftOut: number;
  cut: CutRecord;
}

interface Frame {
  node: Asn1Node;
  /** Where the container's data stops: its own end when definite, the enclosing container's limit when indefinite. */
  limit: number;
}

/** Collects findings up to a cap and counts the rest. */
export class FindingList {
  readonly items: Finding[] = [];
  leftOut = 0;
  add(offset: number, message: string, kind: 'problem' | 'note' = 'problem'): void {
    if (this.items.length < MAX_NOTES) this.items.push({ offset, message, kind });
    else this.leftOut++;
  }
}

/** Reads the elements of `bytes` from `options.from` to `options.to`. */
export function readBer(bytes: Uint8Array, options: BerOptions = {}): BerResult {
  const total = Math.min(options.to ?? bytes.length, bytes.length);
  const maxDepth = options.maxDepth ?? MAX_DEPTH;
  const maxNodes = options.maxNodes ?? MAX_NODES;
  const baseDepth = options.baseDepth ?? 0;
  const nodes: Asn1Node[] = [];
  const list = new FindingList();
  const cut: CutRecord = { nodes: null, depth: null, stopped: null };
  const stack: Frame[] = [];
  let pos = options.from ?? 0;
  let stopped = false;

  const stopAt = (offset: number, message: string): void => {
    list.add(offset, message);
    cut.stopped = { offset, bytesLeft: Math.max(0, total - offset) };
    stopped = true;
  };

  while (!stopped && pos < total) {
    // Definite containers that end here are closed first.
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      if (top.node.indefinite || pos < top.node.end) break;
      stack.pop();
    }
    const parent = stack.length > 0 ? stack[stack.length - 1]! : null;
    const limit = parent === null ? total : parent.limit;
    if (pos >= limit) {
      if (parent === null) break;
      // The data of an indefinite container ended before its end-of-contents octets.
      const open = parent.node;
      open.missingEoc = true;
      open.end = pos;
      open.length = pos - open.offset - open.headerLength;
      list.add(
        pos,
        `The element at offset ${open.offset} has an indefinite length but its end-of-contents octets (00 00) are missing.`,
      );
      stack.pop();
      continue;
    }
    if (nodes.length >= maxNodes) {
      cut.nodes = { offset: pos, bytesLeft: total - pos };
      list.add(
        pos,
        `Reading stops at offset ${pos}: this page reads at most ${withCommas(maxNodes)} elements here, and ${withCommas(total - pos)} bytes were left unread.`,
      );
      stopped = true;
      break;
    }

    const start = pos;
    const first = bytes[pos++]!;
    const cls = CLASSES[first >> 6]!;
    const constructed = (first & 0x20) !== 0;
    let tag = first & 0x1f;
    let tagNotMinimal = false;
    if (tag === 0x1f) {
      // High tag number form (X.690 8.1.2.4): 7 bits per octet, the last octet has bit 8 clear.
      tag = 0;
      let octets = 0;
      let complete = false;
      while (pos < limit && octets < MAX_TAG_OCTETS) {
        const octet = bytes[pos++]!;
        if (octets === 0 && octet === 0x80) tagNotMinimal = true;
        tag = tag * 128 + (octet & 0x7f);
        octets++;
        if ((octet & 0x80) === 0) {
          complete = true;
          break;
        }
      }
      if (!complete) {
        if (octets >= MAX_TAG_OCTETS) {
          stopAt(
            start,
            `The tag number at offset ${start} has more than ${MAX_TAG_OCTETS} octets, so reading stops there.`,
          );
        } else {
          stopAt(start, `The data ends inside the tag number that starts at offset ${start}.`);
        }
        break;
      }
      if (tag < 31) tagNotMinimal = true;
    }

    if (pos >= limit) {
      stopAt(pos, `The data ends where the length of the element at offset ${start} should start, at offset ${pos}.`);
      break;
    }
    const lengthOffset = pos;
    const lengthOctet = bytes[pos++]!;
    let indefinite = false;
    let lengthNotMinimal = false;
    let claimed = BigInt(lengthOctet);
    if (lengthOctet === 0x80) {
      indefinite = true;
      claimed = 0n;
    } else if (lengthOctet > 0x80) {
      const count = lengthOctet & 0x7f;
      if (lengthOctet === 0xff) {
        stopAt(
          lengthOffset,
          `The length at offset ${lengthOffset} is the reserved octet FF (X.690 clause 8.1.3.5), so reading stops there.`,
        );
        break;
      }
      if (count > MAX_LENGTH_OCTETS) {
        stopAt(
          lengthOffset,
          `The length at offset ${lengthOffset} has more than ${MAX_LENGTH_OCTETS} length octets, so reading stops there.`,
        );
        break;
      }
      if (pos + count > limit) {
        stopAt(lengthOffset, `The data ends inside the length that starts at offset ${lengthOffset}.`);
        break;
      }
      claimed = 0n;
      for (let i = 0; i < count; i++) claimed = (claimed << 8n) | BigInt(bytes[pos + i]!);
      lengthNotMinimal = bytes[pos] === 0 || claimed < 128n;
      pos += count;
    }

    const depth = baseDepth + stack.length;
    const node: Asn1Node = {
      index: nodes.length,
      parent: parent === null ? -1 : parent.node.index,
      offset: start,
      depth,
      cls,
      tag,
      constructed,
      headerLength: pos - start,
      length: 0,
      indefinite,
      end: pos,
      eoc: false,
      lengthNotMinimal,
      tagNotMinimal,
      childCount: 0,
    };

    if (indefinite) {
      node.length = null;
      node.end = limit;
      if (!constructed) {
        // X.690 8.1.3.6: an indefinite length belongs to a constructed encoding only.
        nodes.push(node);
        if (parent !== null) parent.node.childCount++;
        stopAt(
          lengthOffset,
          `The element at offset ${start} has an indefinite length but is not constructed (X.690 clause 8.1.3.6), so reading stops there.`,
        );
        break;
      }
    } else {
      // The length is compared with what remains in the container before anything is sliced.
      if (claimed > BigInt(limit - pos)) {
        node.length = null;
        node.end = limit;
        node.overrun = claimed.toString();
        nodes.push(node);
        if (parent !== null) parent.node.childCount++;
        stopAt(
          start,
          `The element at offset ${start} claims ${claimed.toString()} bytes but only ${limit - pos} remain in its container, so reading stops there.`,
        );
        break;
      }
      node.length = Number(claimed);
      node.end = pos + node.length;
    }

    // End-of-contents octets: tag 0, primitive, length 0, inside an indefinite container (X.690 8.1.5).
    if (
      parent !== null &&
      parent.node.indefinite &&
      cls === 'universal' &&
      tag === 0 &&
      !constructed &&
      !indefinite &&
      lengthOctet === 0
    ) {
      node.eoc = true;
      nodes.push(node);
      parent.node.childCount++;
      parent.node.end = node.end;
      parent.node.length = start - parent.node.offset - parent.node.headerLength;
      stack.pop();
      pos = node.end;
      continue;
    }
    if (cls === 'universal' && tag === 0) {
      list.add(
        start,
        `Tag number 0 of the universal class at offset ${start} is reserved for end-of-contents octets (X.690 clause 8.1.5), which only close an indefinite length.`,
      );
    }

    nodes.push(node);
    if (parent !== null) parent.node.childCount++;

    if (!constructed) {
      pos = node.end;
      continue;
    }
    if (depth + 1 >= maxDepth) {
      // The element is shown but its contents are not entered.
      node.notRead = 'nesting';
      const skipped = indefinite ? total - start : node.end - start;
      cut.depth =
        cut.depth === null
          ? { count: 1, firstOffset: start, bytes: skipped }
          : { ...cut.depth, count: cut.depth.count + 1, bytes: cut.depth.bytes + skipped };
      if (!indefinite) {
        list.add(
          start,
          `The contents of the element at offset ${start} are not read: it is nested more than ${maxDepth} levels deep, and ${withCommas(node.end - start)} bytes were skipped.`,
        );
        pos = node.end;
        continue;
      }
      stopAt(
        start,
        `The contents of the element at offset ${start} are not read: it is nested more than ${maxDepth} levels deep, its indefinite length gives no end to skip to, and ${withCommas(total - start)} bytes were left unread.`,
      );
      break;
    }
    stack.push({ node, limit: indefinite ? limit : node.end });
  }

  if (!stopped) {
    // The data ended: every indefinite container still open is missing its end-of-contents octets.
    for (let i = stack.length - 1; i >= 0; i--) {
      const open = stack[i]!.node;
      if (!open.indefinite) continue;
      open.missingEoc = true;
      open.end = pos;
      open.length = pos - open.offset - open.headerLength;
      list.add(
        pos,
        `The element at offset ${open.offset} has an indefinite length but its end-of-contents octets (00 00) are missing.`,
      );
    }
  }

  return { nodes, findings: list.items, findingsLeftOut: list.leftOut, cut };
}
