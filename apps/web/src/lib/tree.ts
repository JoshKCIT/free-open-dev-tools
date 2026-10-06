import type { TreeNode } from './tool-ui';

/**
 * Pure helpers for the `tree` output block. Every walk uses an explicit stack, never a call per level, so a crafted
 * tree 10,000 levels deep is counted, cut and written out without running out of stack. No helper reads a network,
 * a store or the page.
 */

/** Most nodes the block draws. */
export const TREE_NODE_CAP = 5000;

/**
 * Most levels the block draws (the first level is level 1). 40 keeps well clear of the nested `details` depth at which
 * an older headless Chromium build was seen to end the page (47); no realistic ASN.1, WebAssembly or MIME structure
 * needs more drawn levels, and Copy and Download still give the whole tree.
 */
export const TREE_DEPTH_CAP = 40;

/** `default`: only the first level and nodes that ask to be open. `all` and `none` are Expand all and Collapse all. */
export type TreeMode = 'default' | 'all' | 'none';

export interface CappedTree {
  /** A copy of the part of the tree that is drawn. The input is never changed. */
  nodes: TreeNode[];
  /** How many nodes are in `nodes`. */
  shown: number;
  /** How many nodes the whole input holds. */
  total: number;
  /** True when the node cap left out nodes that sit within the level cap. */
  nodeCut: boolean;
  /** True when at least one node was left out because it sits below the level cap. */
  depthCut: boolean;
}

/** The number of nodes in the forest, children included. */
export function countNodes(nodes: readonly TreeNode[]): number {
  let count = 0;
  const stack: (readonly TreeNode[])[] = [nodes];
  while (stack.length > 0) {
    const level = stack.pop()!;
    count += level.length;
    for (const node of level) {
      if (node.children && node.children.length > 0) stack.push(node.children);
    }
  }
  return count;
}

interface Frame {
  node: TreeNode;
  depth: number;
  into: TreeNode[];
}

/**
 * The first `maxNodes` nodes in depth first order, none deeper than `maxDepth` levels, as a fresh tree. Nodes keep the
 * order they were given in. A node whose children are all left out is kept as a plain node.
 */
export function capTree(
  nodes: readonly TreeNode[],
  maxNodes: number = TREE_NODE_CAP,
  maxDepth: number = TREE_DEPTH_CAP,
): CappedTree {
  const total = countNodes(nodes);
  const out: TreeNode[] = [];
  let shown = 0;
  let nodeCut = false;
  let depthCut = false;

  const stack: Frame[] = [];
  for (let i = nodes.length - 1; i >= 0; i--) stack.push({ node: nodes[i]!, depth: 0, into: out });

  while (stack.length > 0) {
    const { node, depth, into } = stack.pop()!;
    if (depth >= maxDepth) {
      depthCut = true;
      continue;
    }
    if (shown >= maxNodes) {
      nodeCut = true;
      continue;
    }
    const copy: TreeNode = { label: node.label };
    if (node.detail !== undefined) copy.detail = node.detail;
    if (node.open !== undefined) copy.open = node.open;
    into.push(copy);
    shown++;
    const kids = node.children;
    if (kids && kids.length > 0) {
      copy.children = [];
      for (let i = kids.length - 1; i >= 0; i--) stack.push({ node: kids[i]!, depth: depth + 1, into: copy.children });
    }
  }

  return { nodes: out, shown, total, nodeCut, depthCut };
}

/**
 * The whole tree as text: one line per node in depth first order, two spaces per level, then the label, then a tab and
 * the detail when there is one. Lines are joined with a line feed and there is no line feed at the end.
 */
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

/** What Copy and Download give: the page's own text when it supplied one, otherwise the indented text of the tree. */
export function copyTextOf(copyText: string | undefined, nodes: readonly TreeNode[]): string {
  return copyText ?? treeText(nodes);
}

/** Whether the node starts open. `all` and `none` win over everything; by default a node's own `open` wins over its level. */
export function initialOpen(node: TreeNode, depth: number, mode: TreeMode): boolean {
  if (mode === 'all') return true;
  if (mode === 'none') return false;
  return node.open ?? depth === 0;
}
