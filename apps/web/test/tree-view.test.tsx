import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import OutputView from '../src/components/OutputView';
import type { OutputBlock, TreeNode } from '../src/lib/tool-ui';

type TreeBlock = Extract<OutputBlock, { kind: 'tree' }>;

function render(nodes: TreeNode[], extra: Partial<TreeBlock> = {}): string {
  return renderToStaticMarkup(<OutputView block={{ kind: 'tree', label: 'Parts', nodes, ...extra }} />);
}

function count(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length;
}

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

function chain(levels: number): TreeNode[] {
  let node: TreeNode = { label: `level${levels - 1}` };
  for (let i = levels - 2; i >= 0; i--) node = { label: `level${i}`, children: [node] };
  return [node];
}

describe('tree block markup', () => {
  it('shows a label that looks like markup as escaped text and creates no element from it', () => {
    const hostile = '<img src="x" onerror="alert(1)">';
    const html = render([{ label: hostile, detail: hostile, children: [{ label: hostile }] }]);
    expect(html).toContain('&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror="');
  });

  it('shows the label and No entries for an empty tree and offers no Expand all or Collapse all', () => {
    const html = render([]);
    expect(html).toContain('Parts');
    expect(html).toContain('No entries.');
    expect(html).not.toContain('Expand all');
    expect(html).not.toContain('Collapse all');
    expect(html).not.toContain('<details');
    expect(html).not.toContain('Showing the first');
  });

  it('draws 5000 nodes of a 5001 node tree and says how many are shown and that Copy gives the whole tree', () => {
    const html = render(forest(5001));
    expect(count(html, /<li[ >]/g)).toBe(5000);
    expect(html).toContain('Showing the first 5,000 of 5,001 nodes. Copy gives the whole tree.');
    expect(html).not.toContain('r50<');
  });

  it('draws exactly 5000 nodes with no cap line', () => {
    const html = render(forest(5000));
    expect(count(html, /<li[ >]/g)).toBe(5000);
    expect(html).not.toContain('Showing the first');
    expect(html).not.toContain('left out here');
  });

  it('draws 40 levels of a 41 level chain with a line saying deeper levels are in the copy text', () => {
    const html = render(chain(41));
    expect(count(html, /<li[ >]/g)).toBe(40);
    expect(html).toContain('level39');
    expect(html).not.toContain('level40');
    expect(html).toContain('Levels below 40 are left out here. Copy gives the whole tree.');
    expect(html).not.toContain('Showing the first');
  });

  it('draws a 40 level chain whole and a 10000 level chain as 40 levels without failing', () => {
    expect(render(chain(40))).not.toContain('left out here');
    const html = render(chain(10_000));
    expect(count(html, /<li[ >]/g)).toBe(40);
    expect(html).toContain('Levels below 40 are left out here.');
  });

  it('draws nodes in the order given, depth first', () => {
    const html = render([
      { label: 'first', children: [{ label: 'first-a', children: [{ label: 'first-a-1' }] }, { label: 'first-b' }] },
      { label: 'second' },
    ]);
    const order = ['first<', 'first-a<', 'first-a-1<', 'first-b<', 'second<'].map((s) => html.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('opens the first level by default, lets a node ask to be open, and offers Expand all and Collapse all', () => {
    const html = render([
      {
        label: 'top',
        children: [
          { label: 'mid-closed', children: [{ label: 'leaf' }] },
          { label: 'mid-open', open: true, children: [{ label: 'leaf2' }] },
        ],
      },
    ]);
    expect(count(html, /<details/g)).toBe(3);
    expect(count(html, /<details open=""/g)).toBe(2);
    expect(html).toContain('Expand all');
    expect(html).toContain('Collapse all');
    expect(html).toContain('<summary>top</summary>');
  });

  it('puts the detail beside the label in its own muted element, as text', () => {
    const html = render([{ label: 'cert', detail: 'valid <until> 2030', children: [{ label: 'leaf', detail: 'x' }] }]);
    expect(html).toContain('<span class="tree-detail">valid &lt;until&gt; 2030</span>');
    expect(html).toContain('<span class="tree-detail">x</span>');
  });

  it('offers Copy always, and Download only when the page names a file', () => {
    expect(render([{ label: 'a' }])).toContain('>Copy<');
    expect(render([{ label: 'a' }])).not.toContain('>Download<');
    expect(render([{ label: 'a' }], { download: 'parts.txt' })).toContain('>Download<');
  });
});
