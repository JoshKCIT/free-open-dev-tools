import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import {
  buildGraph,
  catalogImpact,
  grepInvertPattern,
  importsOf,
  lockfileImpact,
  pathRule,
  reach,
  resolveImport,
  sameIgnoringComments,
} from '../lib/affected.mjs';

const ts = createRequire(import.meta.url)('typescript');

/** Applies a pattern the way Playwright does: a /.../ string becomes a RegExp with the flags after the last slash. */
function playwrightMatches(pattern, line) {
  const [, body, flags] = /^\/(.*)\/([gi]*)$/.exec(pattern);
  return new RegExp(body, flags).test(line);
}

describe('pathRule', () => {
  it("sorts a tool's own files by whether a page could notice the change", () => {
    expect(pathRule('tools/base64/src/index.ts')).toEqual({ kind: 'tool', id: 'base64', browser: true, trace: true });
    expect(pathRule('tools/base64/package.json')).toEqual({ kind: 'tool', id: 'base64', browser: true, trace: false });
    expect(pathRule('tools/base64/test/index.test.ts')).toMatchObject({ kind: 'tool', id: 'base64', browser: false });
    expect(pathRule('tools/base64/README.md')).toMatchObject({ kind: 'tool', id: 'base64', browser: false });
  });

  it('gives browser fixtures and test files to the tool or file they belong to', () => {
    expect(pathRule('e2e/privacy-fixtures/uuid.json')).toEqual({ kind: 'fixture', id: 'uuid' });
    expect(pathRule('e2e/live-fixtures/data-size.json')).toEqual({ kind: 'fixture', id: 'data-size' });
    expect(pathRule('e2e/site.spec.ts')).toEqual({ kind: 'spec' });
    expect(pathRule('e2e/fixture-files.ts')).toEqual({ kind: 'trace' });
  });

  it('leaves the shared set-up of the site and the browser tests to a full run', () => {
    expect(pathRule('playwright.config.ts').kind).toBe('everything');
    expect(pathRule('package.json').kind).toBe('everything');
    expect(pathRule('apps/web/vite.config.ts').kind).toBe('everything');
    expect(pathRule('tools/README.md').kind).toBe('everything');
  });

  it('treats a file no rule covers as affecting everything, never as affecting nothing', () => {
    expect(pathRule('some-new-top-level-file.yaml').kind).toBe('everything');
    expect(pathRule('e2e/new-fixture-folder/thing.json').kind).toBe('trace');
  });

  it('skips documentation and checks the static job always runs in full', () => {
    for (const path of [
      'README.md',
      'docs/DEPLOYMENT.md',
      '.planning/STATE.md',
      'eslint.config.js',
      '.gitleaksignore',
    ]) {
      expect(pathRule(path).kind, path).toBe('nothing');
    }
  });

  it('hands the catalog files and the lockfile to their own entry-by-entry rules', () => {
    expect(pathRule('docs/catalog.json')).toEqual({ kind: 'catalog' });
    expect(pathRule('apps/web/src/generated-catalog.json')).toEqual({ kind: 'catalog' });
    expect(pathRule('pnpm-lock.yaml')).toEqual({ kind: 'lockfile' });
  });
});

describe('sameIgnoringComments', () => {
  it('recognises an edit that only touches comments or layout', () => {
    const before = '// old note\nexport const a = 1;\n';
    const after = '/** A longer, rewritten note. */\nexport const a =\n  1;\n';
    expect(sameIgnoringComments('x.ts', before, after, ts)).toBe(true);
  });

  it('counts any change to code, including text inside a string that looks like a comment', () => {
    expect(sameIgnoringComments('x.ts', 'export const a = 1;', 'export const a = 2;', ts)).toBe(false);
    expect(sameIgnoringComments('x.ts', "const u = 'http://a';", "const u = 'http://b';", ts)).toBe(false);
  });

  it('counts a change to JSX text, which an ordinary token scanner could mistake for a comment', () => {
    const before = 'export const A = () => <a>http://example.com/one</a>;';
    const after = 'export const A = () => <a>http://example.com/two</a>;';
    expect(sameIgnoringComments('x.tsx', before, after, ts)).toBe(false);
  });

  it('counts a change to a comment a bundler reads', () => {
    const before = 'const m = import(/* @vite-ignore */ path);';
    const after = 'const m = import(path);';
    expect(sameIgnoringComments('x.ts', before, after, ts)).toBe(false);
  });

  it('compares JSON by value, and treats a new or deleted file as a real change', () => {
    expect(sameIgnoringComments('a.json', '{"a":1,"b":[1,2]}', '{\n  "a": 1,\n  "b": [1, 2]\n}\n', ts)).toBe(true);
    expect(sameIgnoringComments('a.json', '{"a":1}', '{"a":2}', ts)).toBe(false);
    expect(sameIgnoringComments('x.ts', null, 'export {};', ts)).toBe(false);
    expect(sameIgnoringComments('x.ts', 'export {};', null, ts)).toBe(false);
  });

  it('without TypeScript, counts every code edit as real', () => {
    expect(sameIgnoringComments('x.ts', '// a\nexport {};', '// b\nexport {};', null)).toBe(false);
  });
});

describe('imports and reach', () => {
  it('finds static, re-exported, dynamic, worker and URL imports', () => {
    const text = [
      "import { a } from './a';",
      "import type { T } from '../lib/types';",
      "export * from './b.js';",
      "import W from './workers/x.worker.ts?worker&inline';",
      "const m = await import('./lazy');",
      "const u = new URL('../tools/qr/package.json', import.meta.url);",
      "import React from 'react';",
      "import './styles.css';",
    ].join('\n');
    expect(importsOf(text).sort()).toEqual(
      [
        './a',
        '../lib/types',
        './b.js',
        './workers/x.worker.ts?worker&inline',
        './lazy',
        '../tools/qr/package.json',
        'react',
        './styles.css',
      ].sort(),
    );
  });

  it("resolves relative paths, ESM-style .js names and the web app's @fodt alias", () => {
    const files = new Set(['apps/web/src/lib/b.ts', 'apps/web/src/lib/workers/x.worker.ts', 'tools/qr/src/index.ts']);
    expect(resolveImport('apps/web/src/lib/a.ts', './b.js', files)).toBe('apps/web/src/lib/b.ts');
    expect(resolveImport('apps/web/src/lib/a.ts', './workers/x.worker.ts?worker&inline', files)).toBe(
      'apps/web/src/lib/workers/x.worker.ts',
    );
    expect(resolveImport('apps/web/src/tools/qr.ts', '@fodt/qr', files)).toBe('tools/qr/src/index.ts');
    expect(resolveImport('apps/web/src/lib/a.ts', 'react', files)).toBeNull();
  });

  it('walks up from a helper to every page that uses it, however indirectly', () => {
    const sources = new Map([
      ['apps/web/src/tools/one.ts', "import { run } from '../lib/run-one';"],
      ['apps/web/src/lib/run-one.ts', "import W from './workers/one.worker.ts?worker&inline';"],
      ['apps/web/src/tools/two.ts', "import { x } from '../lib/other';"],
    ]);
    const files = new Set([...sources.keys(), 'apps/web/src/lib/workers/one.worker.ts', 'apps/web/src/lib/other.ts']);
    const { reverse } = buildGraph(sources, files);
    expect([...reach('apps/web/src/lib/workers/one.worker.ts', reverse)].sort()).toEqual([
      'apps/web/src/lib/run-one.ts',
      'apps/web/src/lib/workers/one.worker.ts',
      'apps/web/src/tools/one.ts',
    ]);
  });
});

describe('catalogImpact', () => {
  const entry = (id, summary = 's') => ({ id, name: id, category: 'text', tier: 1, summary });

  it('names only the tools whose entries changed, were added or were removed', () => {
    const before = JSON.stringify([entry('a'), entry('b'), entry('c')]);
    const after = JSON.stringify([entry('a'), entry('b', 'changed'), entry('d')]);
    const impact = catalogImpact('docs/catalog.json', before, after);
    expect([...impact.ids].sort()).toEqual(['b', 'c', 'd']);
    expect(impact.site).toBe(false);
  });

  it('flags a reordering, which only the site-wide listing shows', () => {
    const impact = catalogImpact(
      'docs/catalog.json',
      JSON.stringify([entry('a'), entry('b')]),
      JSON.stringify([entry('b'), entry('a')]),
    );
    expect(impact.ids.size).toBe(0);
    expect(impact.site).toBe(true);
  });

  it('reads the generated files in their own shapes', () => {
    const impact = catalogImpact(
      'apps/web/src/generated-tools.json',
      JSON.stringify({ a: { id: 'a', version: '1.0.0' } }),
      JSON.stringify({ a: { id: 'a', version: '1.1.0' } }),
    );
    expect([...impact.ids]).toEqual(['a']);
  });

  it('gives up to a full run when a version cannot be read', () => {
    expect(catalogImpact('docs/catalog.json', '[', '[]').everything).toMatch(/could not be read/);
  });
});

describe('lockfileImpact', () => {
  const lock = ({ importers, packages = '', snapshots = '' }) =>
    [
      "lockfileVersion: '9.0'",
      '',
      'settings:',
      '  autoInstallPeers: true',
      '',
      'importers:',
      '',
      importers,
      'packages:',
      '',
      packages,
      'snapshots:',
      '',
      snapshots,
    ].join('\n');

  const importer = (path, deps = {}, devDeps = {}) => {
    const group = (name, list) =>
      Object.keys(list).length === 0
        ? ''
        : `    ${name}:\n` +
          Object.entries(list)
            .map(
              ([n, v]) =>
                `      ${n.startsWith('@') ? `'${n}'` : n}:\n        specifier: ^${v}\n        version: ${v}\n`,
            )
            .join('');
    return `  ${path}:\n${group('dependencies', deps)}${group('devDependencies', devDeps)}\n`;
  };

  const base = lock({
    importers:
      importer('.', {}, { '@playwright/test': '1.0.0', vitest: '3.0.0' }) +
      importer('tools/a', { lib: '1.0.0' }, { vitest: '3.0.0' }) +
      importer('tools/b', {}, { vitest: '3.0.0' }),
    packages:
      "  lib@1.0.0:\n    resolution: {integrity: sha512-a}\n\n  leaf@1.0.0:\n    resolution: {integrity: sha512-b}\n\n  vitest@3.0.0:\n    resolution: {integrity: sha512-c}\n\n  '@playwright/test@1.0.0':\n    resolution: {integrity: sha512-d}\n",
    snapshots:
      "  lib@1.0.0:\n    dependencies:\n      leaf: 1.0.0\n\n  leaf@1.0.0: {}\n\n  vitest@3.0.0: {}\n\n  '@playwright/test@1.0.0': {}\n",
  });

  it('finds the tool that depends on a package through a changed transitive dependency', () => {
    const after = base.replace('sha512-b', 'sha512-b2');
    const impact = lockfileImpact(base, after);
    expect([...impact.importers.keys()]).toEqual(['tools/a']);
    expect(impact.importers.get('tools/a')).toEqual({ runtime: ['lib'], dev: [] });
  });

  it('separates a change to development tools from a change to what ships', () => {
    const after = base.replace('sha512-c', 'sha512-c2');
    const impact = lockfileImpact(base, after);
    expect([...impact.importers.keys()].sort()).toEqual(['.', 'tools/a', 'tools/b']);
    expect(impact.importers.get('tools/b')).toEqual({ runtime: [], dev: ['vitest'] });
    expect(impact.importers.get('.')).toEqual({ runtime: [], dev: ['vitest'] });
  });

  it('reports a newly added tool as a change to both kinds', () => {
    const after = base.replace('packages:', `${importer('tools/c', { lib: '1.0.0' }, { vitest: '3.0.0' })}packages:`);
    const impact = lockfileImpact(base, after);
    expect(impact.importers.get('tools/c')).toEqual({ runtime: ['lib'], dev: ['vitest'] });
    expect(impact.importers.has('tools/a')).toBe(false);
  });

  it('gives up to a full run on a settings change or an unreadable file', () => {
    expect(
      lockfileImpact(base, base.replace('autoInstallPeers: true', 'autoInstallPeers: false')).everything,
    ).toBeTruthy();
    expect(lockfileImpact(base, 'importers:\n    stray: line\n').everything).toMatch(/could not be read/);
  });
});

describe('grepInvertPattern', () => {
  const allIds = new Set(['hash-file', 'hash-text', 'base64', 'uuid', 'data-size']);
  const line = (project, file, ...titles) => [' ', project, file, ...titles].join(' ');

  it('leaves out tests of unselected tools, by file name or by title', () => {
    const pattern = grepInvertPattern({ allIds, selected: new Set(['hash-file']), wholeFiles: new Set() });
    expect(playwrightMatches(pattern, line('chromium', 'base64.spec.ts', 'encodes'))).toBe(true);
    expect(
      playwrightMatches(
        pattern,
        line('chromium', 'privacy.spec.ts', 'local processing', 'uuid: input never leaves the page'),
      ),
    ).toBe(true);
    expect(playwrightMatches(pattern, line('webkit', 'hash-file.spec.ts', 'digest'))).toBe(false);
    expect(
      playwrightMatches(
        pattern,
        line('firefox', 'privacy.spec.ts', 'local processing', 'hash-file: input never leaves the page'),
      ),
    ).toBe(false);
  });

  it('keeps a test that names no tool, since it is about the whole site', () => {
    const pattern = grepInvertPattern({ allIds, selected: new Set(['hash-file']), wholeFiles: new Set() });
    expect(
      playwrightMatches(
        pattern,
        line('chromium', 'site.spec.ts', 'routes', 'every tool page has a unique meta description'),
      ),
    ).toBe(false);
  });

  it('does not mistake one tool id for part of a longer one, or a capitalised word for an id', () => {
    const pattern = grepInvertPattern({ allIds, selected: new Set(['hash-file']), wholeFiles: new Set() });
    expect(playwrightMatches(pattern, line('chromium', 'x.spec.ts', 'hash-file-extra: renders'))).toBe(false);
    expect(playwrightMatches(pattern, line('chromium', 'site.spec.ts', 'Base64: encode, then decode back'))).toBe(
      false,
    );
  });

  it('keeps every test of a file that runs whole', () => {
    const pattern = grepInvertPattern({
      allIds,
      selected: new Set(),
      wholeFiles: new Set(['privacy.spec.ts', 'uuid.spec.ts']),
    });
    expect(
      playwrightMatches(
        pattern,
        line('chromium', 'privacy.spec.ts', 'local processing', 'base64: input never leaves the page'),
      ),
    ).toBe(false);
    expect(playwrightMatches(pattern, line('chromium', 'uuid.spec.ts', 'generates'))).toBe(false);
    expect(playwrightMatches(pattern, line('chromium', 'live-catalog.spec.ts', 'base64: first use'))).toBe(true);
  });

  it('is empty when every tool is selected, so nothing is left out', () => {
    expect(grepInvertPattern({ allIds, selected: new Set(allIds), wholeFiles: new Set() })).toBe('');
  });
});
