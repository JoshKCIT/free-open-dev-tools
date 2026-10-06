import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../lib/catalog.mjs';

/**
 * HARD-01 and HARD-09 (D-217): every page whose background helper enforces a time limit declares that limit as
 * `runLimit`, from the helper's own exported constant, so the working cue states the number the helper really enforces
 * and no page can drift to a second number.
 *
 * A static scan, with no browser: each page under `apps/web/src/tools` is read together with the run helpers it imports
 * from `../lib`. A helper limit constant is an exported `*_TIME_LIMIT_MS`, `*_STALL_LIMIT_MS` or
 * `MERMAID_REPLY_LIMIT_MS`; a start limit (`*_START_LIMIT_MS`, `*_READY_LIMIT_MS`) guards the worker starting and is never
 * accepted. When a page imports helpers with both a total and a stall limit it names the total one.
 */

const TOOLS_DIR = join(ROOT, 'apps', 'web', 'src', 'tools');
const LIB_DIR = join(ROOT, 'apps', 'web', 'src', 'lib');

const LIMIT_NAME = /^[A-Z0-9_]*(?:_TIME_LIMIT_MS|_STALL_LIMIT_MS)$|^MERMAID_REPLY_LIMIT_MS$/;
const IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'(\.\.\/lib\/[A-Za-z0-9._-]+)'/g;

/** The names a page imports from each `../lib/<file>` module, as { module -> Set of local names }. */
export function importsOf(source) {
  const byModule = new Map();
  for (const m of source.matchAll(IMPORT)) {
    const names = byModule.get(m[2]) ?? new Set();
    for (const part of m[1].split(',')) {
      const piece = part.trim().replace(/^type\s+/, '');
      if (!piece) continue;
      const alias = piece.split(/\s+as\s+/);
      names.add((alias[1] ?? alias[0]).trim());
    }
    byModule.set(m[2], names);
  }
  return byModule;
}

/** The limit constants a helper source exports: `{ name, stall }`, in file order. */
export function exportedLimits(helperSource) {
  const found = [];
  for (const m of helperSource.matchAll(/export\s+const\s+([A-Z0-9_]+)\s*(?::[^=]+)?=/g)) {
    if (LIMIT_NAME.test(m[1])) found.push({ name: m[1], stall: m[1].endsWith('_STALL_LIMIT_MS') });
  }
  return found;
}

/** The page's declared `runLimit`: null when absent, otherwise { ms, kind } with `ms` the text written for it. */
export function declaredRunLimit(source) {
  const at = source.search(/\brunLimit\s*:/);
  if (at < 0) return null;
  const m = /\brunLimit\s*:\s*\{\s*ms\s*:\s*([^,}\s]+)\s*(?:,\s*kind\s*:\s*'([a-z]+)'\s*)?,?\s*\}/.exec(
    source.slice(at),
  );
  return m ? { ms: m[1], kind: m[2] ?? null } : { ms: '', kind: null, unreadable: true };
}

/**
 * Checks one page against the helpers it imports. `readHelper(module)` returns a helper's source or null. Returns a list
 * of problems (empty when the page is right) and the expectation the page was held to.
 */
export function checkPage(source, readHelper) {
  const problems = [];
  const imports = importsOf(source);
  const available = [];
  for (const [module] of imports) {
    if (!/^\.\.\/lib\/(?:run-|mermaid-frame)/.test(module)) continue;
    const helper = readHelper(module);
    if (helper === null) continue;
    for (const limit of exportedLimits(helper)) available.push({ ...limit, module });
  }
  const declared = declaredRunLimit(source);

  if (available.length === 0) {
    if (declared) problems.push('declares a runLimit but no imported helper exports a limit constant');
    return { problems, expected: null };
  }

  const totals = available.filter((l) => !l.stall);
  const chosen = totals.length > 0 ? totals[0] : available[0];
  const expected = { name: chosen.name, kind: chosen.stall ? 'quiet' : null };

  if (!declared) {
    problems.push(`imports a helper that exports ${chosen.name} and declares no runLimit`);
    return { problems, expected };
  }
  if (declared.unreadable) {
    problems.push('runLimit is not written as { ms: <CONSTANT>, kind? }');
    return { problems, expected };
  }
  if (/^[0-9(]/.test(declared.ms)) {
    problems.push(`runLimit writes a number (${declared.ms}) instead of naming ${chosen.name}`);
    return { problems, expected };
  }
  if (!available.some((l) => l.name === declared.ms)) {
    problems.push(`runLimit names ${declared.ms}, which no imported helper exports as a limit`);
  } else if (declared.ms !== chosen.name) {
    problems.push(`runLimit names ${declared.ms} but the page must name ${chosen.name}`);
  }
  const importedNames = new Set([...imports.values()].flatMap((s) => [...s]));
  if (!importedNames.has(declared.ms)) problems.push(`runLimit names ${declared.ms}, which the page does not import`);
  if (chosen.stall) {
    if (declared.kind !== 'quiet') problems.push(`${chosen.name} is a stall limit, so kind must be 'quiet'`);
  } else if (declared.kind !== null && declared.kind !== 'total') {
    problems.push(`${chosen.name} is a total limit, so kind must be absent or 'total'`);
  }
  return { problems, expected };
}

function readHelperFromTree(module) {
  const file = join(LIB_DIR, `${module.replace('../lib/', '')}.ts`);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

function scanTree() {
  const rows = [];
  for (const file of readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.ts'))) {
    const source = readFileSync(join(TOOLS_DIR, file), 'utf8');
    const imports = importsOf(source);
    const usesHelper = [...imports.keys()].some((m) => /^\.\.\/lib\/(?:run-|mermaid-frame)/.test(m));
    if (!usesHelper) continue;
    const { problems, expected } = checkPage(source, readHelperFromTree);
    rows.push({ id: file.replace(/\.ts$/, ''), problems, expected, declared: declaredRunLimit(source) });
  }
  return rows;
}

const rows = scanTree();
const declaring = rows.filter((r) => r.declared);

describe('every page with an enforced run limit declares it from its helper', () => {
  it('finds the helper pages the plan counted: 50 import a run helper and 45 of them export a limit', () => {
    expect(rows.length).toBe(50);
    expect(rows.filter((r) => r.expected).length).toBe(45);
  });

  it('has exactly 45 pages that declare a runLimit, and none of the other 5', () => {
    expect(declaring.length).toBe(45);
    const noLimit = rows.filter((r) => !r.expected).map((r) => r.id);
    expect(noLimit.sort()).toEqual(['bcrypt', 'chart-maker', 'hash-file', 'image-splitter', 'sprite-sheet']);
    for (const id of noLimit) expect(rows.find((r) => r.id === id)?.declared).toBeNull();
  });

  it('has no page that misses a limit, names the wrong constant or writes a number', () => {
    const bad = rows.filter((r) => r.problems.length > 0).map((r) => `${r.id}: ${r.problems.join('; ')}`);
    expect(bad).toEqual([]);
  });

  it('marks exactly the eight stall limit pages quiet and no other page', () => {
    const quiet = declaring.filter((r) => r.declared?.kind === 'quiet').map((r) => r.id);
    expect(quiet.sort()).toEqual([
      'archive-toolkit',
      'exif-viewer',
      'favicon-generator',
      'image-converter',
      'image-to-pdf',
      'pdf-merge',
      'pdf-split',
      'pdf-to-image',
    ]);
  });

  it('names the total limit on the pages whose helpers export both, never a start limit', () => {
    const pdfText = rows.find((r) => r.id === 'pdf-text-metadata');
    expect(pdfText?.declared?.ms).toBe('PDF_TEXT_METADATA_TIME_LIMIT_MS');
    expect(pdfText?.declared?.kind).toBeNull();
    const mermaid = rows.find((r) => r.id === 'mermaid-renderer');
    expect(mermaid?.declared?.ms).toBe('MERMAID_REPLY_LIMIT_MS');
    for (const r of declaring) expect(r.declared?.ms).not.toMatch(/START_LIMIT|READY_LIMIT/);
  });
});

describe('the mapping check can fail', () => {
  const helper = (name) =>
    `export const ${name}_TIME_LIMIT_MS = 5000;\nexport const ${name}_START_LIMIT_MS = 10000;\nexport const ${name}_TIME_LIMIT_MESSAGE = 'x';\n`;
  const read = (module) => (module === '../lib/run-demo-in-worker' ? helper('DEMO') : null);
  const page = (limitLine) =>
    `import { DEMO_TIME_LIMIT_MS, DEMO_START_LIMIT_MS, runDemo } from '../lib/run-demo-in-worker';\nexport default defineTool({ id: 'demo', ${limitLine} });`;

  it('accepts a page that names the helper constant it imports', () => {
    expect(checkPage(page('runLimit: { ms: DEMO_TIME_LIMIT_MS },'), read).problems).toEqual([]);
    expect(checkPage(page("runLimit: { ms: DEMO_TIME_LIMIT_MS, kind: 'total' },"), read).problems).toEqual([]);
  });

  it('fails a page that writes a number', () => {
    expect(checkPage(page('runLimit: { ms: 5000 },'), read).problems.join()).toContain('writes a number');
    expect(checkPage(page('runLimit: { ms: 5 * 1000 },'), read).problems.length).toBeGreaterThan(0);
  });

  it('fails a page that names the start limit or a constant that is not a limit', () => {
    expect(checkPage(page('runLimit: { ms: DEMO_START_LIMIT_MS },'), read).problems.length).toBeGreaterThan(0);
    expect(checkPage(page('runLimit: { ms: SOMETHING_ELSE },'), read).problems.length).toBeGreaterThan(0);
  });

  it('fails a page that imports a helper with a limit and declares none', () => {
    expect(checkPage(page(''), read).problems.join()).toContain('declares no runLimit');
  });

  it('fails a runLimit on a page whose helpers export no limit', () => {
    const none = () => 'export const DEMO_START_LIMIT_MS = 10000;\n';
    const source = `import { DEMO_START_LIMIT_MS, runDemo } from '../lib/run-demo-in-worker';\nexport default defineTool({ runLimit: { ms: DEMO_START_LIMIT_MS } });`;
    expect(checkPage(source, none).problems.join()).toContain('no imported helper exports a limit');
  });

  it('fails a stall limit page that is not quiet and a total limit page that is', () => {
    const stall = () => 'export const DEMO_STALL_LIMIT_MS = 20_000;\n';
    const stallPage = (line) =>
      `import { DEMO_STALL_LIMIT_MS, runDemo } from '../lib/run-demo-in-worker';\ndefineTool({ ${line} });`;
    expect(checkPage(stallPage('runLimit: { ms: DEMO_STALL_LIMIT_MS },'), stall).problems.length).toBe(1);
    expect(checkPage(stallPage("runLimit: { ms: DEMO_STALL_LIMIT_MS, kind: 'quiet' },"), stall).problems).toEqual([]);
    expect(checkPage(page("runLimit: { ms: DEMO_TIME_LIMIT_MS, kind: 'quiet' },"), read).problems.length).toBe(1);
  });

  it('prefers the total limit when a page imports a total and a stall limit', () => {
    const both = (module) =>
      module === '../lib/run-demo-in-worker'
        ? 'export const DEMO_TIME_LIMIT_MS = 20000;\n'
        : 'export const DEMO_READER_STALL_LIMIT_MS = 20_000;\n';
    const source = (line) =>
      `import { a } from '../lib/run-demo-reader';\nimport { DEMO_TIME_LIMIT_MS } from '../lib/run-demo-in-worker';\ndefineTool({ ${line} });`;
    expect(checkPage(source('runLimit: { ms: DEMO_TIME_LIMIT_MS },'), both).problems).toEqual([]);
    const stallOnly = source("runLimit: { ms: DEMO_READER_STALL_LIMIT_MS, kind: 'quiet' },");
    expect(checkPage(stallOnly, both).problems.length).toBeGreaterThan(0);
  });
});
