import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import type { TreeNode } from '../apps/web/src/lib/tool-ui';

/**
 * The rendered markup of the `tree` output block, checked in each engine the site supports (HARD-09).
 *
 * No tool page returns a tree yet (the first real use is a later phase), so nothing else would show a browser-only
 * defect in this block. The check renders the real `TreeView` component to markup inside the test process with
 * `react-dom/server`, loads that markup with `page.setContent` next to the stylesheet of the production build, and
 * looks at what the browser itself does with it: native details and summary elements opened and closed from the
 * keyboard, labels that look like markup shown as plain text without creating an element or running anything, and the
 * cap line at 5,001 nodes.
 *
 * How the component is loaded: Playwright compiles any `.tsx` file it imports with its own JSX runtime, which makes
 * objects for its component testing and not React elements, so importing `TreeView.tsx` directly cannot render. The
 * spec therefore compiles the two real source files (`lib/tree.ts` and `components/TreeView.tsx`) in memory with the
 * repository's own TypeScript, the same way `scripts/lib/csp.mjs` compiles the Mermaid frame builder, and runs them
 * against the installed React. It is the shipped source, not a copy.
 *
 * What this cannot test: the React click handlers of Expand all and Collapse all (static markup has none). Those are
 * the mode decision `initialOpen`, covered by apps/web/test/tree.test.ts, and the remount through a key.
 *
 * Needs a production build (`pnpm run build:web`) for the stylesheet. No page is opened on the site and no request is
 * made, so the privacy harness has nothing to add here.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// react and react-dom are installed under apps/web, the same copies the component itself imports.
const webRequire = createRequire(join(root, 'apps', 'web', 'package.json'));
const ts = createRequire(join(root, 'package.json'))('typescript') as typeof import('typescript');
// react and its types live under apps/web, out of reach of this folder's type check, so the few calls used are typed here.
const React = webRequire('react') as { createElement(type: unknown, props: unknown): unknown };
const { renderToStaticMarkup } = webRequire('react-dom/server') as { renderToStaticMarkup(element: unknown): string };

/** Compiles one source file of the web app to CommonJS in memory and runs it; `deps` answers its relative imports. */
function loadSource(file: string, deps: Record<string, unknown>): Record<string, unknown> {
  const source = readFileSync(join(root, 'apps', 'web', 'src', file), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  const mod: { exports: Record<string, unknown> } = { exports: {} };
  const localRequire = (id: string): unknown => (id in deps ? deps[id] : webRequire(id));
  const run = vm.runInThisContext(`(function (require, module, exports) {${outputText}\n})`, { filename: file }) as (
    r: typeof localRequire,
    m: typeof mod,
    e: typeof mod.exports,
  ) => void;
  run(localRequire, mod, mod.exports);
  return mod.exports;
}

const treeLib = loadSource('lib/tree.ts', {});
const TreeView = loadSource('components/TreeView.tsx', { '../lib/tree': treeLib }).default;

function builtStyles(): string {
  const dir = join(root, 'apps', 'web', 'dist', 'assets');
  if (!existsSync(dir)) throw new Error('apps/web/dist/assets is missing: run pnpm run build:web first');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');
}

function documentFor(nodes: TreeNode[], styles: string): string {
  const body = renderToStaticMarkup(React.createElement(TreeView, { nodes }));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>tree</title><style>${styles}</style></head><body><main id="host">${body}</main></body></html>`;
}

function forest(total: number): TreeNode[] {
  const roots: TreeNode[] = [];
  let made = 0;
  while (made < total) {
    const rootNode: TreeNode = { label: `r${roots.length}`, children: [] };
    made++;
    for (let i = 0; i < 99 && made < total; i++) {
      rootNode.children!.push({ label: `r${roots.length}c${i}` });
      made++;
    }
    roots.push(rootNode);
  }
  return roots;
}

function chain(levels: number): TreeNode[] {
  let node: TreeNode = { label: `level${levels - 1}` };
  for (let i = levels - 2; i >= 0; i--) node = { label: `level${i}`, children: [node] };
  return [node];
}

const SMALL: TreeNode[] = [
  {
    label: 'Message',
    detail: 'multipart/mixed',
    children: [
      { label: 'Headers', detail: '4 fields', children: [{ label: 'Subject', detail: 'hello' }] },
      { label: 'Body', detail: 'text/plain' },
    ],
  },
  { label: 'Trailer' },
];

test.describe('tree output block markup', () => {
  test('opens and closes native details from the keyboard and lists its labels to assistive technology', async ({
    page: tab,
  }) => {
    await tab.setContent(documentFor(SMALL, builtStyles()));
    const first = tab.locator('details').first();
    const firstSummary = first.locator('> summary');
    const nested = tab.locator('details', { hasText: 'Subject' }).last();

    // the first level starts open, deeper levels start closed
    await expect(first).toHaveJSProperty('open', true);
    await expect(nested).toHaveJSProperty('open', false);

    const names = await tab.locator('ul.tree').ariaSnapshot();
    for (const label of ['Message', 'multipart/mixed', 'Headers', 'Body', 'Trailer']) {
      expect(names).toContain(label);
    }

    // Enter closes the first heading and Space opens it again
    await firstSummary.focus();
    await tab.keyboard.press('Enter');
    await expect(first).toHaveJSProperty('open', false);
    await expect(tab.locator('.tree-leaf', { hasText: 'Body' })).toBeHidden();
    await tab.keyboard.press('Space');
    await expect(first).toHaveJSProperty('open', true);

    // the nested heading opens from the keyboard too and then shows its child
    await nested.locator('> summary').focus();
    await tab.keyboard.press('Enter');
    await expect(nested).toHaveJSProperty('open', true);
    await expect(tab.getByText('Subject')).toBeVisible();
  });

  test('shows a label that looks like markup as plain text and creates no element or script run from it', async ({
    page: tab,
  }) => {
    const hostile = '<img src="x" onerror="window.__tree_pwned = 1"><script>window.__tree_pwned = 2</script>';
    await tab.setContent(
      documentFor(
        [{ label: hostile, detail: hostile, children: [{ label: hostile, detail: hostile }] }],
        builtStyles(),
      ),
    );
    await expect(tab.locator('ul.tree')).toContainText(hostile);
    await expect(tab.locator('img')).toHaveCount(0);
    await expect(tab.locator('script')).toHaveCount(0);
    // an image with a broken source would have run its error handler by now
    await tab.waitForTimeout(200);
    expect(await tab.evaluate(() => (window as unknown as { __tree_pwned?: number }).__tree_pwned)).toBeUndefined();
    const summaryText = await tab.locator('summary').first().textContent();
    expect(summaryText).toContain(hostile);
  });

  test('draws 5000 of 5001 nodes with the cap line saying how many are shown', async ({ page: tab }) => {
    await tab.setContent(documentFor(forest(5001), builtStyles()));
    await expect(tab.locator('ul.tree li')).toHaveCount(5000);
    await expect(tab.getByText('Showing the first 5,000 of 5,001 nodes. Copy gives the whole tree.')).toBeVisible();
    await expect(tab.getByText('r50', { exact: true })).toHaveCount(0);
  });

  // Measured on 2026-10-05 (Playwright 1.63, Windows): the old headless build that the chromium and mobile-chrome
  // projects launch ends the page ("Target crashed") once 47 native details elements are nested, even when all are
  // closed, with or without this block's stylesheet. Full Chromium 153, Firefox and WebKit draw 100 nested levels. The
  // 64 level markup is therefore drawn here in Firefox and WebKit only; the markup test in
  // apps/web/test/tree-view.test.tsx covers the same chain without a browser. Phase 18 and 19 tool specs that return
  // a deep tree must keep it under 47 levels in the chromium project or use the full Chromium build.
  test('draws 64 levels of a 65 level chain with a line saying deeper levels are in the copy text', async ({
    page: tab,
    browserName,
  }) => {
    test.skip(browserName === 'chromium', 'the old headless Chromium build ends the page at 47 nested details');
    await tab.setContent(documentFor(chain(65), builtStyles()));
    await expect(tab.locator('ul.tree li')).toHaveCount(64);
    await expect(tab.getByText('Levels below 64 are left out here. Copy gives the whole tree.')).toBeVisible();
    await expect(tab.getByText('Showing the first')).toHaveCount(0);
  });

  test('shows No entries and no Expand all or Collapse all for an empty tree', async ({ page: tab }) => {
    await tab.setContent(documentFor([], builtStyles()));
    await expect(tab.getByText('No entries.')).toBeVisible();
    await expect(tab.getByRole('button', { name: 'Expand all' })).toHaveCount(0);
    await expect(tab.getByRole('button', { name: 'Collapse all' })).toHaveCount(0);
  });
});
