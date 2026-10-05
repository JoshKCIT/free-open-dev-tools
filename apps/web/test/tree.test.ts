import { describe, expect, it } from 'vitest';
import type { TreeNode } from '../src/lib/tool-ui';
import { TREE_DEPTH_CAP, TREE_NODE_CAP, capTree, copyTextOf, countNodes, initialOpen, treeText } from '../src/lib/tree';

/** A forest of exactly `total` nodes: roots of up to 100 nodes each (a root and 99 children), made without recursion. */
function forest(total: number): TreeNode[] {
  const roots: TreeNode[] = [];
  let made = 0;
  while (made < total) {
    const root: TreeNode = { label: `r${roots.length}`, children: [] };
    made++;
    for (let i = 0; i < 99 && made < total; i++) {
      root.children!.push({ label: `r${roots.length}c${i}` });
      made++;
    }
    roots.push(root);
  }
  return roots;
}

/** One node per level, `levels` levels deep, built from the bottom up without recursion. */
function chain(levels: number): TreeNode[] {
  let node: TreeNode = { label: `level${levels - 1}` };
  for (let i = levels - 2; i >= 0; i--) node = { label: `level${i}`, children: [node] };
  return [node];
}

const SMALL: TreeNode[] = [
  {
    label: 'root',
    detail: 'first',
    children: [{ label: 'a', children: [{ label: 'a1' }] }, { label: 'b' }],
  },
  { label: 'second' },
];

describe('tree helpers', () => {
  it('states the two caps as 5000 nodes and 64 levels', () => {
    expect(TREE_NODE_CAP).toBe(5000);
    expect(TREE_DEPTH_CAP).toBe(64);
  });

  it('counts a 5001 node forest as 5001 and a 10000 level chain without running out of stack', () => {
    expect(countNodes(forest(5001))).toBe(5001);
    expect(countNodes(chain(10_000))).toBe(10_000);
    expect(countNodes([])).toBe(0);
  });

  it('keeps exactly 5000 nodes of a 5001 node tree, in depth first order, and reports the totals', () => {
    const input = forest(5001);
    const out = capTree(input);
    expect(out.shown).toBe(5000);
    expect(out.total).toBe(5001);
    expect(out.nodeCut).toBe(true);
    expect(out.depthCut).toBe(false);
    expect(countNodes(out.nodes)).toBe(5000);
    expect(out.nodes).toHaveLength(50);
    const lines = treeText(out.nodes).split('\n');
    expect(lines).toHaveLength(5000);
    expect(lines[0]).toBe('r0');
    expect(lines[1]).toBe('  r0c0');
    expect(lines[4999]).toBe('  r49c98');
    expect(treeText(out.nodes)).not.toContain('r50');
    // the input is left exactly as it was given
    expect(input).toHaveLength(51);
    expect(input[50]).toEqual({ label: 'r50', children: [] });
  });

  it('cuts nothing at exactly 5000 nodes', () => {
    const out = capTree(forest(5000));
    expect(out.shown).toBe(5000);
    expect(out.total).toBe(5000);
    expect(out.nodeCut).toBe(false);
    expect(out.depthCut).toBe(false);
  });

  it('keeps 64 levels of a 65 level chain and reports that levels were cut', () => {
    const out = capTree(chain(65));
    expect(out.shown).toBe(64);
    expect(out.total).toBe(65);
    expect(out.depthCut).toBe(true);
    expect(out.nodeCut).toBe(false);
    const lines = treeText(out.nodes).split('\n');
    expect(lines).toHaveLength(64);
    expect(lines[63].trim()).toBe('level63');
    expect(capTree(chain(64)).depthCut).toBe(false);
  });

  it('caps a 10000 level chain at 64 levels without running out of stack', () => {
    const out = capTree(chain(10_000));
    expect(out.shown).toBe(64);
    expect(out.total).toBe(10_000);
    expect(out.depthCut).toBe(true);
  });

  it('honours caps given by the caller and keeps the order', () => {
    const out = capTree(SMALL, 3, 64);
    expect(treeText(out.nodes)).toBe('root\tfirst\n  a\n    a1');
    expect(out.shown).toBe(3);
    expect(out.total).toBe(5);
  });

  it('writes one line per node, two spaces per level, a tab before a detail, in depth first order', () => {
    expect(treeText(SMALL)).toBe('root\tfirst\n  a\n    a1\n  b\nsecond');
    expect(treeText([])).toBe('');
  });

  it('gives the page copy text when it has one and the indented text of the whole tree when it has not', () => {
    expect(copyTextOf('chosen by the page', SMALL)).toBe('chosen by the page');
    expect(copyTextOf('', SMALL)).toBe('');
    expect(copyTextOf(undefined, SMALL)).toBe(treeText(SMALL));
  });

  it('decides what is open from the mode, the node and its level', () => {
    const plain: TreeNode = { label: 'x', children: [{ label: 'y' }] };
    const asked: TreeNode = { label: 'x', open: true, children: [{ label: 'y' }] };
    const closed: TreeNode = { label: 'x', open: false, children: [{ label: 'y' }] };
    expect(initialOpen(plain, 0, 'all')).toBe(true);
    expect(initialOpen(plain, 5, 'all')).toBe(true);
    expect(initialOpen(asked, 0, 'none')).toBe(false);
    expect(initialOpen(plain, 0, 'none')).toBe(false);
    expect(initialOpen(plain, 0, 'default')).toBe(true);
    expect(initialOpen(plain, 1, 'default')).toBe(false);
    expect(initialOpen(asked, 3, 'default')).toBe(true);
    expect(initialOpen(closed, 0, 'default')).toBe(false);
  });
});
