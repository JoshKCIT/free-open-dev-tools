import { test, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from '../lib/catalog.mjs';

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
    writeFileSync(
      join(root, 'apps', 'web', 'dist', 'index.html'),
      '<!doctype html><html><head><title>Template</title>\n<meta name="description" content="Template" />\n</head><body></body></html>',
    );

    execFileSync('node', [join(root, 'scripts', 'prerender.mjs')], { encoding: 'utf8', stdio: 'pipe' });

    const page = readFileSync(join(root, 'apps', 'web', 'dist', 'tools', 'price-tool', 'index.html'), 'utf8');
    expect(page).toContain('<title>Price $&amp; Tool $1 $$ — Free &amp; Open Dev Tools</title>');
    expect(page).toContain('content="Shows $&amp; and $` and $$ and $1 as typed. Runs entirely in your browser."');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
