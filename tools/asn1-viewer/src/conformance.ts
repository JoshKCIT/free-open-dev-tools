import { FindingList, type Asn1Node, type Finding } from './ber';
import { isConstructedString, parseTime } from './values';

/*
 * Notes for encodings that are valid BER and that DER (ITU-T X.690 clauses 10 and 11) does not allow. Each one names the
 * clause. They are notes and never errors: BER allows them all. Nothing here reads an element's content beyond what the
 * rule needs, and a note never repeats the content.
 */

export interface DerNotes {
  /** The notes, in the order the elements appear, at most 200. */
  notes: Finding[];
  /** Notes beyond the 200 kept. */
  leftOut: number;
}

/** The class of an element in the order X.680 clause 8.6 sorts the components of a SET: universal, application, context, private. */
const CLASS_RANK: Record<Asn1Node['cls'], number> = { universal: 0, application: 1, context: 2, private: 3 };

/** The encoding of an element, compared as octet strings with the shorter padded at its trailing end with zeros (clause 11.6). */
function compareEncodings(bytes: Uint8Array, a: Asn1Node, b: Asn1Node): number {
  const lengthA = a.end - a.offset;
  const lengthB = b.end - b.offset;
  const longest = Math.max(lengthA, lengthB);
  for (let i = 0; i < longest; i++) {
    const x = i < lengthA ? bytes[a.offset + i]! : 0;
    const y = i < lengthB ? bytes[b.offset + i]! : 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/** The elements directly inside a constructed element, found by walking the nodes that follow it. */
function childrenOf(nodes: readonly Asn1Node[], index: number): Asn1Node[] {
  const parent = nodes[index]!;
  const children: Asn1Node[] = [];
  for (let i = index + 1; i < nodes.length && nodes[i]!.depth > parent.depth; i++) {
    const node = nodes[i]!;
    if (node.depth === parent.depth + 1 && !node.eoc) children.push(node);
  }
  return children;
}

/** Everything in `nodes` (read from `bytes`) that is BER and not DER. */
export function derNotes(nodes: readonly Asn1Node[], bytes: Uint8Array): DerNotes {
  const list = new FindingList();
  const note = (offset: number, message: string): void => list.add(offset, message, 'note');

  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!;
    if (node.eoc) continue;
    if (node.indefinite) {
      note(
        node.offset,
        `The element at offset ${node.offset} has an indefinite length: valid BER, but DER wants a definite length (X.690 clause 10.1).`,
      );
    } else if (node.lengthNotMinimal) {
      note(
        node.offset,
        `The length of the element at offset ${node.offset} is written with more octets than it needs: valid BER (X.690 clause 8.1.3.5), but DER wants the fewest octets (X.690 clause 10.1).`,
      );
    }
    if (node.cls !== 'universal' || node.length === null) continue;

    if (node.constructed) {
      if (isConstructedString(node)) {
        note(
          node.offset,
          `The element at offset ${node.offset} is a constructed string: valid BER, but DER wants the primitive form (X.690 clause 10.2).`,
        );
      } else if (node.tag === 17) {
        const children = childrenOf(nodes, index);
        if (children.length >= 2) checkSet(bytes, children, note);
      }
      continue;
    }

    const content = bytes.subarray(node.offset + node.headerLength, node.end);
    switch (node.tag) {
      case 1:
        if (content.length === 1 && content[0] !== 0x00 && content[0] !== 0xff) {
          note(
            node.offset,
            `The BOOLEAN at offset ${node.offset} is TRUE written with an octet other than ff: valid BER (X.690 clause 8.2.2), but DER wants ff (X.690 clause 11.1).`,
          );
        }
        break;
      case 2:
      case 10:
        if (
          content.length >= 2 &&
          ((content[0] === 0x00 && content[1]! < 0x80) || (content[0] === 0xff && content[1]! >= 0x80))
        ) {
          note(
            node.offset,
            `The ${node.tag === 2 ? 'INTEGER' : 'ENUMERATED'} at offset ${node.offset} has a first octet that adds nothing: valid BER, but DER wants the fewest octets (X.690 clause 8.3.2).`,
          );
        }
        break;
      case 3: {
        const unused = content[0] ?? 0;
        if (
          content.length >= 2 &&
          unused >= 1 &&
          unused <= 7 &&
          (content[content.length - 1]! & ((1 << unused) - 1)) !== 0
        ) {
          note(
            node.offset,
            `The unused bits of the BIT STRING at offset ${node.offset} are not zero: valid BER, but DER wants them zero (X.690 clause 11.2.1).`,
          );
        }
        break;
      }
      case 23:
      case 24: {
        const generalized = node.tag === 24;
        const parsed = parseTime(content, generalized);
        if (parsed === null) break;
        const clause = generalized ? '11.7' : '11.8';
        const name = generalized ? 'GeneralizedTime' : 'UTCTime';
        const faults: string[] = [];
        if (!parsed.seconds) faults.push('the seconds are missing');
        if (parsed.zone !== 'Z')
          faults.push(parsed.zone === 'local' ? 'it has no Z' : 'it gives an offset instead of Z');
        if (generalized && parsed.fraction.endsWith('0')) faults.push('the fraction ends in a zero');
        if (generalized && parsed.comma) faults.push('the decimal mark is a comma');
        if (faults.length > 0) {
          note(
            node.offset,
            `The ${name} at offset ${node.offset} is valid BER, but DER wants seconds, a final Z${generalized ? ' and a fraction without trailing zeros' : ''}: ${faults.join(', ')} (X.690 clause ${clause}).`,
          );
        }
        break;
      }
      default:
        break;
    }
  }

  // One data value, one element (X.690 clause 8.1.1.1).
  const roots = nodes.filter((node) => node.depth === 0);
  const first = roots[0];
  if (first !== undefined) {
    if (first.end < bytes.length) {
      note(
        first.end,
        `There are ${bytes.length - first.end} bytes after the first element, which ends at offset ${first.end}: an encoding holds one data value (X.690 clause 8.1.1.1).`,
      );
    }
    if (roots.length > 1) {
      note(
        roots[1]!.offset,
        `There are ${roots.length} elements at the top level, the second at offset ${roots[1]!.offset}: an encoding holds one data value (X.690 clause 8.1.1.1).`,
      );
    }
  }
  return { notes: list.items, leftOut: list.leftOut };
}

/** A SET: its components in the order of their tags (clause 10.3), or, when they share a tag, a SET OF in ascending order (clause 11.6). */
function checkSet(bytes: Uint8Array, children: Asn1Node[], note: (offset: number, message: string) => void): void {
  const first = children[0]!;
  const sameTag = children.every((child) => child.cls === first.cls && child.tag === first.tag);
  for (let i = 1; i < children.length; i++) {
    const before = children[i - 1]!;
    const after = children[i]!;
    if (sameTag) {
      if (compareEncodings(bytes, before, after) > 0) {
        note(
          after.offset,
          `The element at offset ${after.offset} is out of order among the elements of its SET, which share one tag. If it is a SET OF, DER wants them in ascending order of their encodings (X.690 clause 11.6).`,
        );
        return;
      }
    } else if (CLASS_RANK[before.cls] > CLASS_RANK[after.cls] || (before.cls === after.cls && before.tag > after.tag)) {
      note(
        after.offset,
        `The element at offset ${after.offset} is out of order among the elements of its SET: DER wants them in the order of their tags (X.690 clause 10.3).`,
      );
      return;
    }
  }
}
