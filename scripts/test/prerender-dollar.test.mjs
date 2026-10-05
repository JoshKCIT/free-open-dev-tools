import { test, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from '../lib/catalog.mjs';

/** The shape of the template Vite writes: the encoding declaration first in the head, then the title and description. */
const TEMPLATE =
  '<!doctype html><html><head>\n    <meta charset="utf-8" />\n    <title>Template</title>\n<meta name="description" content="Template" />\n</head><body></body></html>';

/**
 * `String.replace` reads `$&`, `$1`, `` $` `` and `$$` in a replacement STRING as patterns. A tool name or summary with
 * a dollar sign in it (a price, a currency) must come out of the prerender step exactly as written. The script finds
 * its root from its own location, so it is copied with its library into a throwaway root with a one-row catalog.
 */
test('a dollar sign pattern in a tool name or summary is written to the page exactly as typed', () => {
  const root = mkdtempSync(join(tmpdir(), 'fodt-prerender-'));
  try {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    cpSync(join(ROOT, 'scripts', 'prerender.mjs'), join(root, 'scripts', 'prerender.mjs'));
    cpSync(join(ROOT, 'scripts', 'lib'), join(root, 'scripts', 'lib'), { recursive: true });
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(
      join(root, 'docs', 'catalog.json'),
      JSON.stringify([
        {
          id: 'price-tool',
          name: 'Price $& Tool $1 $$',
          category: 'money',
          tier: 2,
          summary: 'Shows $& and $` and $$ and $1 as typed.',
        },
      ]),
    );
    mkdirSync(join(root, 'apps', 'web', 'src', 'tools'), { recursive: true });
    writeFileSync(join(root, 'apps', 'web', 'src', 'tools', 'price-tool.ts'), '');
    mkdirSync(join(root, 'apps', 'web', 'dist'), { recursive: true });
    writeFileSync(join(root, 'apps', 'web', 'dist', 'index.html'), TEMPLATE);
    mkdirSync(join(root, 'tools', 'price-tool', 'src'), { recursive: true });
    writeFileSync(join(root, 'tools', 'price-tool', 'src', 'meta.json'), '{"id":"price-tool"}');

    execFileSync('node', [join(root, 'scripts', 'prerender.mjs')], { encoding: 'utf8', stdio: 'pipe' });

    const page = readFileSync(join(root, 'apps', 'web', 'dist', 'tools', 'price-tool', 'index.html'), 'utf8');
    expect(page).toContain('<title>Price $&amp; Tool $1 $$ — Free &amp; Open Dev Tools</title>');
    expect(page).toContain('content="Shows $&amp; and $` and $$ and $1 as typed. Runs entirely in your browser."');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** The smallest repository root the prerender step runs in: a one-row catalog, one built tool page and a template. */
function throwawayRoot() {
  const root = mkdtempSync(join(tmpdir(), 'fodt-prerender-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  cpSync(join(ROOT, 'scripts', 'prerender.mjs'), join(root, 'scripts', 'prerender.mjs'));
  cpSync(join(ROOT, 'scripts', 'lib'), join(root, 'scripts', 'lib'), { recursive: true });
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(
    join(root, 'docs', 'catalog.json'),
    JSON.stringify([{ id: 'price-tool', name: 'Price Tool', category: 'money', tier: 2, summary: 'Shows a price.' }]),
  );
  mkdirSync(join(root, 'apps', 'web', 'src', 'tools'), { recursive: true });
  writeFileSync(join(root, 'apps', 'web', 'src', 'tools', 'price-tool.ts'), '');
  mkdirSync(join(root, 'apps', 'web', 'dist'), { recursive: true });
  writeFileSync(join(root, 'apps', 'web', 'dist', 'index.html'), TEMPLATE);
  return root;
}

test('every written page opens its head with the policy meta, then the charset meta', () => {
  const root = throwawayRoot();
  try {
    mkdirSync(join(root, 'tools', 'price-tool', 'src'), { recursive: true });
    writeFileSync(join(root, 'tools', 'price-tool', 'src', 'meta.json'), '{"id":"price-tool","needs":["workers"]}');
    execFileSync('node', [join(root, 'scripts', 'prerender.mjs')], { encoding: 'utf8', stdio: 'pipe' });

    const dist = join(root, 'apps', 'web', 'dist');
    const opening =
      /<head>\s*<meta http-equiv="Content-Security-Policy" content="([^"]+)" \/>\s*<meta charset="utf-8" \/>/;
    const written = [
      join(dist, 'index.html'),
      join(dist, 'about', 'index.html'),
      join(dist, '404.html'),
      join(dist, 'tools', 'price-tool', 'index.html'),
      join(dist, 'tools', 'price-tool.html'),
    ];
    for (const file of written) expect(readFileSync(file, 'utf8'), file).toMatch(opening);

    const policyOf = (file) => readFileSync(file, 'utf8').match(opening)[1];
    // The two files of one route carry the same policy; a page that declares workers gets blob workers, the rest none.
    expect(policyOf(join(dist, 'tools', 'price-tool.html'))).toBe(
      policyOf(join(dist, 'tools', 'price-tool', 'index.html')),
    );
    expect(policyOf(join(dist, 'tools', 'price-tool.html'))).toContain('worker-src blob:');
    expect(policyOf(join(dist, '404.html'))).toContain("worker-src 'none'");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a built tool page with no meta file fails the step and the message names the tool', () => {
  const root = throwawayRoot();
  try {
    let failure = '';
    try {
      execFileSync('node', [join(root, 'scripts', 'prerender.mjs')], { encoding: 'utf8', stdio: 'pipe' });
    } catch (error) {
      failure = String(error.stderr);
    }
    expect(failure).toContain('tools/price-tool/src/meta.json is missing');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
