import { useMemo, useState } from 'react';
import type { TreeNode } from '../lib/tool-ui';
import { TREE_DEPTH_CAP, capTree, initialOpen, type TreeMode } from '../lib/tree';

/**
 * The body of the `tree` output block: nested native `details` and `summary` elements, so the browser itself handles
 * opening, closing and the keyboard (Tab to a heading, Enter or Space to toggle).
 *
 * Labels and details are written as React text, which the browser never reads as markup; nothing here sets inner HTML.
 * Only the capped tree (at most 5,000 nodes and 64 levels, see lib/tree.ts) is drawn, so the recursion below is never
 * deeper than 64 calls whatever the page hands over. Expand all and Collapse all start the list over with a new key,
 * which is how every node takes the mode's open state again even after the visitor opened or closed some by hand.
 */

function Entry({ node }: { node: TreeNode }) {
  return (
    <>
      {node.label}
      {node.detail ? (
        <>
          {' '}
          <span className="tree-detail">{node.detail}</span>
        </>
      ) : null}
    </>
  );
}

function TreeList({ nodes, depth, mode }: { nodes: TreeNode[]; depth: number; mode: TreeMode }) {
  return (
    <ul className={depth === 0 ? 'tree' : undefined}>
      {nodes.map((node, i) => (
        <li key={i}>
          {node.children && node.children.length > 0 ? (
            <details open={initialOpen(node, depth, mode)}>
              <summary>
                <Entry node={node} />
              </summary>
              <TreeList nodes={node.children} depth={depth + 1} mode={mode} />
            </details>
          ) : (
            <span className="tree-leaf">
              <Entry node={node} />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

const formatCount = (n: number) => n.toLocaleString('en-US');

export default function TreeView({ nodes }: { nodes: TreeNode[] }) {
  const capped = useMemo(() => capTree(nodes), [nodes]);
  const [view, setView] = useState<{ mode: TreeMode; version: number }>({ mode: 'default', version: 0 });
  const choose = (mode: TreeMode) => setView((v) => ({ mode, version: v.version + 1 }));

  if (capped.total === 0) {
    return (
      <div className="tree-view">
        <p className="tree-empty">No entries.</p>
      </div>
    );
  }

  return (
    <div className="tree-view">
      <div className="toolbar toolbar-small">
        <button type="button" className="button" onClick={() => choose('all')}>
          Expand all
        </button>
        <button type="button" className="button" onClick={() => choose('none')}>
          Collapse all
        </button>
      </div>
      <TreeList key={view.version} nodes={capped.nodes} depth={0} mode={view.mode} />
      {capped.nodeCut ? (
        <p className="tree-cap">
          {`Showing the first ${formatCount(capped.shown)} of ${formatCount(capped.total)} nodes. Copy gives the whole tree.`}
        </p>
      ) : null}
      {capped.depthCut ? (
        <p className="tree-cap">{`Levels below ${TREE_DEPTH_CAP} are left out here. Copy gives the whole tree.`}</p>
      ) : null}
    </div>
  );
}
