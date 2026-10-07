import type { Asn1Node } from './ber';
import { typeName } from './values';

/** The shape the page's tree block draws: plain text label and detail, children that open and close. */
export interface TreeNode {
  label: string;
  detail?: string;
  children?: TreeNode[];
  open?: boolean;
}

export interface TreeResult {
  tree: TreeNode[];
  /** Every element read, one line each, two spaces per level, a tab before the detail. The block draws less; Copy gives this. */
  copyText: string;
  /** Number of elements in the tree, guessed contents included. */
  total: number;
}

/** The label of the guessed contents of an OCTET STRING or BIT STRING. */
export const INSIDE_LABEL = 'contents look like ASN.1 (a guess)';

/** A tree of up to this many elements starts fully open; a larger one starts with its top level open. */
const OPEN_ALL_UP_TO = 400;

function lengthText(node: Asn1Node): string {
  if (node.overrun !== undefined) return `${node.overrun} claimed, more than remain`;
  if (node.indefinite) return node.length === null ? 'indefinite' : `indefinite (${node.length} content bytes)`;
  return String(node.length ?? 0);
}

/** The line shown beside an element: where it is and how it is written. */
export function detailOf(node: Asn1Node): string {
  return (
    `offset ${node.offset}, header ${node.headerLength}, length ${lengthText(node)}, ` +
    `${node.cls} ${node.tag}, ${node.constructed ? 'constructed' : 'primitive'}`
  );
}

export function labelOf(node: Asn1Node): string {
  const text = node.value?.text ?? '';
  return text === '' ? typeName(node) : `${typeName(node)} ${text}`;
}

interface Work {
  list: readonly Asn1Node[];
  base: number;
  into: TreeNode[];
}

function countAll(nodes: readonly Asn1Node[]): number {
  let total = 0;
  const lists: (readonly Asn1Node[])[] = [nodes];
  while (lists.length > 0) {
    const list = lists.pop()!;
    total += list.length;
    for (const node of list) {
      if (node.inside !== undefined && node.inside.length > 0) {
        total++; // the line that says the contents are a guess
        lists.push(node.inside);
      }
    }
  }
  return total;
}

/** Builds the tree and its copy text with explicit stacks: nothing here makes a call per level. */
export function toTree(nodes: readonly Asn1Node[]): TreeResult {
  const total = countAll(nodes);
  const openAll = total <= OPEN_ALL_UP_TO;
  const roots: TreeNode[] = [];
  const work: Work[] = [{ list: nodes, base: 0, into: roots }];
  while (work.length > 0) {
    const { list, base, into } = work.pop()!;
    // The tree node most recently made at each level of this list.
    const levels: TreeNode[] = [];
    for (const node of list) {
      const made: TreeNode = { label: labelOf(node), detail: detailOf(node) };
      const level = Math.max(node.depth - base, 0);
      const holder = level === 0 ? undefined : levels[level - 1];
      if (holder === undefined) {
        into.push(made);
      } else {
        (holder.children ??= []).push(made);
      }
      levels[level] = made;
      levels.length = level + 1;
      if (node.constructed && openAll) made.open = true;
      if (node.inside !== undefined && node.inside.length > 0) {
        const guess: TreeNode = { label: INSIDE_LABEL, children: [], ...(openAll ? { open: true } : {}) };
        made.children = [guess];
        work.push({ list: node.inside, base: node.depth + 2, into: guess.children! });
      }
    }
  }
  return { tree: roots, copyText: treeText(roots), total };
}

/** One line per node in depth first order, two spaces per level, a tab and the detail after the label. */
export function treeText(nodes: readonly TreeNode[]): string {
  const lines: string[] = [];
  const stack: { node: TreeNode; depth: number }[] = [];
  for (let i = nodes.length - 1; i >= 0; i--) stack.push({ node: nodes[i]!, depth: 0 });
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    lines.push('  '.repeat(depth) + node.label + (node.detail ? `\t${node.detail}` : ''));
    const kids = node.children;
    if (kids) {
      for (let i = kids.length - 1; i >= 0; i--) stack.push({ node: kids[i]!, depth: depth + 1 });
    }
  }
  return lines.join('\n');
}
