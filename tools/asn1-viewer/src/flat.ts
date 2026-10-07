import type { Asn1Node } from './ber';
import { MAX_FLAT_ROWS } from './limits';
import { typeName } from './values';

export interface FlatTable {
  headers: string[];
  rows: (string | number)[][];
  /** Elements in all, guessed contents included. */
  total: number;
  /** Elements not in `rows` because of the row cap. */
  leftOut: number;
}

const HEADERS = ['Offset', 'Level', 'Header', 'Length', 'Class', 'Tag', 'Form', 'Type', 'Value'];

interface Cursor {
  list: readonly Asn1Node[];
  at: number;
  guess: boolean;
}

/**
 * Every element as one row, in reading order, with the contents of an OCTET STRING or BIT STRING that read as ASN.1 right
 * after the string (their Type says so). At most 5,000 rows are written and the rest are counted. Explicit stack: nothing
 * here makes a call per level.
 */
export function toFlatRows(nodes: readonly Asn1Node[]): FlatTable {
  const rows: (string | number)[][] = [];
  let total = 0;
  const stack: Cursor[] = [{ list: nodes, at: 0, guess: false }];
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    if (top.at >= top.list.length) {
      stack.pop();
      continue;
    }
    const node = top.list[top.at++]!;
    total++;
    if (rows.length < MAX_FLAT_ROWS) {
      rows.push([
        node.offset,
        node.depth + 1,
        node.headerLength,
        node.indefinite ? 'indefinite' : (node.length ?? 'unknown'),
        node.cls,
        node.tag,
        node.constructed ? 'constructed' : 'primitive',
        top.guess ? `${typeName(node)} (guess)` : typeName(node),
        node.value?.text ?? '',
      ]);
    }
    if (node.inside !== undefined && node.inside.length > 0) stack.push({ list: node.inside, at: 0, guess: true });
  }
  return { headers: HEADERS, rows, total, leftOut: total - rows.length };
}
