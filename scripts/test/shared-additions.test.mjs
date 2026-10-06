import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, CATEGORY_LABELS } from '../lib/catalog.mjs';
import { NEEDS } from '../lib/csp.mjs';
import { EVAL_PAGES, NO_COMPILE_PAGES, RESERVED_IDS } from '../check-csp.mjs';

/**
 * HARD-09 (D-211, D-214): everything the thirteen new tools and three upgrades of phases 18 to 20 need from the shared
 * code is written down in `v1.2-shared-additions.json` and proved to exist after phase 17. A later phase that finds it
 * needs something else changes this non-shared file in the same commit as its page; a shared edit after the phase 17
 * push is what this table exists to prevent.
 *
 * Checked here: every need is in the closed vocabulary and sorted; code generation is planned only for the font tool and
 * WebAssembly compilation never for the WebAssembly inspector; every output kind is a member of the page contract; every
 * named shared addition exists in the tree now; categories exist; and a tool already in the catalog declares exactly the
 * needs the table plans for it.
 */

const TABLE = JSON.parse(readFileSync(join(ROOT, 'scripts', 'test', 'v1.2-shared-additions.json'), 'utf8'));
const CATALOG = new Map(JSON.parse(readFileSync(join(ROOT, 'docs', 'catalog.json'), 'utf8')).map((e) => [e.id, e]));

const TOOL_UI = readFileSync(join(ROOT, 'apps', 'web', 'src', 'lib', 'tool-ui.ts'), 'utf8');

/** The `kind` members of the `OutputBlock` union, read from the text of the page contract (the union has no blank line). */
export function outputBlockKinds(source) {
  const start = source.indexOf('export type OutputBlock =');
  if (start < 0) throw new Error('apps/web/src/lib/tool-ui.ts has no OutputBlock type');
  const end = source.indexOf('\n\n', start);
  const region = source.slice(start, end < 0 ? source.length : end);
  return new Set([...region.matchAll(/kind:\s*'([a-z-]+)'/g)].map((m) => m[1]));
}

const KINDS = outputBlockKinds(TOOL_UI);

/** The closed list of shared additions a row may name. */
const KNOWN_ADDITIONS = [
  'tree',
  'countdown',
  'runLimit',
  'refreshAfterMs',
  'working cue',
  'inline fixture files',
  'probe controls',
];

const text = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const present = (...parts) => existsSync(join(ROOT, ...parts));

/** For each addition: the problems with it (empty when it exists). `probe controls` may be absent until plan 17-09. */
const ADDITION_CHECKS = {
  tree: () => [
    ...(KINDS.has('tree') ? [] : ['the OutputBlock union has no tree kind']),
    ...(present('apps', 'web', 'src', 'lib', 'tree.ts') ? [] : ['apps/web/src/lib/tree.ts is missing']),
    ...(present('apps', 'web', 'src', 'components', 'TreeView.tsx') ? [] : ['TreeView.tsx is missing']),
  ],
  countdown: () => [
    ...(KINDS.has('countdown') ? [] : ['the OutputBlock union has no countdown kind']),
    ...(present('apps', 'web', 'src', 'components', 'Countdown.tsx') ? [] : ['Countdown.tsx is missing']),
  ],
  runLimit: () => (/\brunLimit\?:\s*RunLimit/.test(TOOL_UI) ? [] : ['ToolPage has no runLimit field']),
  refreshAfterMs: () =>
    /\brefreshAfterMs\?:\s*number/.test(TOOL_UI) ? [] : ['ToolResult has no refreshAfterMs field'],
  'working cue': () => {
    if (!present('apps', 'web', 'src', 'components', 'WorkingCue.tsx')) return ['WorkingCue.tsx is missing'];
    return /export default function WorkingCue\b/.test(text('apps', 'web', 'src', 'components', 'WorkingCue.tsx'))
      ? []
      : ['WorkingCue.tsx has no default WorkingCue component'];
  },
  'inline fixture files': () => {
    if (!present('e2e', 'fixture-inline.ts')) return ['e2e/fixture-inline.ts is missing'];
    const source = text('e2e', 'fixture-inline.ts');
    return ['export function inlineFileProblems', 'export function buildInlineFiles', '{{MARKER}}']
      .filter((needle) => !source.includes(needle))
      .map((needle) => `e2e/fixture-inline.ts lacks ${needle}`);
  },
  'probe controls': () => (present('e2e', 'csp-probe.ts') ? [] : ['e2e/csp-probe.ts is missing']),
};

const sorted = (list) => [...list].sort();
const sameList = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

/** The needs a tool's own `meta.json` declares now (absent reads as none). */
function declaredNeeds(id) {
  const metaPath = join(ROOT, 'tools', id, 'src', 'meta.json');
  if (!existsSync(metaPath)) return null;
  return JSON.parse(readFileSync(metaPath, 'utf8')).needs ?? [];
}

/**
 * Every problem with one table row. `kind` is 'tool' (a new tool, which may not exist yet) or 'upgrade' (a tool already
 * in the catalog). Pure given the table and the repository.
 */
export function rowProblems(row, kind) {
  const problems = [];
  const at = `${kind} ${row.id}`;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(row.id ?? '')) problems.push(`${at}: the id is not a plain folder name`);
  if (typeof row.name !== 'string' || row.name.length === 0) problems.push(`${at}: the name is empty`);
  if (String(row.name).includes(String.fromCodePoint(0x2014))) problems.push(`${at}: the name holds an em dash`);
  if (!Object.hasOwn(CATEGORY_LABELS, row.category))
    problems.push(`${at}: category "${row.category}" is not a catalog category`);
  if (![18, 19, 20].includes(row.phase)) problems.push(`${at}: phase ${row.phase} is not 18, 19 or 20`);

  const needs = row.needs;
  if (!Array.isArray(needs)) problems.push(`${at}: needs is not an array`);
  else {
    for (const need of needs)
      if (!NEEDS.includes(need)) problems.push(`${at}: need "${need}" is not in the closed vocabulary`);
    if (JSON.stringify(needs) !== JSON.stringify(sorted(needs))) problems.push(`${at}: needs are not sorted`);
    if (new Set(needs).size !== needs.length) problems.push(`${at}: needs repeat a term`);
    if (needs.includes('eval') && row.id !== 'font-inspector') problems.push(`${at}: only font-inspector plans eval`);
    if (row.id === 'wasm-inspector' && (needs.includes('wasm') || needs.includes('eval'))) {
      problems.push(`${at}: the WebAssembly inspector never compiles a module, so it plans neither wasm nor eval`);
    }
    if (needs.includes('eval') && !EVAL_PAGES.includes(row.id))
      problems.push(`${at}: plans eval but the gate list EVAL_PAGES lacks it`);
  }

  if (!Array.isArray(row.outputKinds) || row.outputKinds.length === 0) problems.push(`${at}: outputKinds is empty`);
  else {
    for (const outputKind of row.outputKinds) {
      if (!KINDS.has(outputKind)) problems.push(`${at}: output kind "${outputKind}" is not in the page contract`);
    }
    if (new Set(row.outputKinds).size !== row.outputKinds.length) problems.push(`${at}: outputKinds repeat a kind`);
  }

  if (!Array.isArray(row.sharedAdditions)) problems.push(`${at}: sharedAdditions is not an array`);
  else {
    for (const addition of row.sharedAdditions) {
      if (!KNOWN_ADDITIONS.includes(addition))
        problems.push(`${at}: shared addition "${addition}" is not a known name`);
    }
  }

  const catalogEntry = CATALOG.get(row.id);
  if (kind === 'upgrade' && !catalogEntry) problems.push(`${at}: an upgrade must name a tool already in the catalog`);
  if (catalogEntry) {
    if (catalogEntry.category !== row.category) {
      problems.push(`${at}: the catalog category is "${catalogEntry.category}", the row says "${row.category}"`);
    }
    const actual = declaredNeeds(row.id);
    if (actual === null) problems.push(`${at}: it is in the catalog but has no tools/${row.id}/src/meta.json`);
    else if (Array.isArray(needs) && !sameList(actual, needs)) {
      problems.push(
        `${at}: its meta.json declares ${JSON.stringify(actual)} but the table plans ${JSON.stringify(needs)}`,
      );
    }
  }
  return problems;
}

describe('the v1.2 shared additions table', () => {
  it('holds 13 new tools and 3 upgrades with unique ids', () => {
    expect(TABLE.tools).toHaveLength(13);
    expect(TABLE.upgrades).toHaveLength(3);
    const ids = [...TABLE.tools, ...TABLE.upgrades].map((row) => row.id);
    expect(new Set(ids).size, 'a row id repeats').toBe(ids.length);
    expect(TABLE.upgrades.map((row) => row.id).sort()).toEqual(['glob-tester', 'hex-viewer', 'number-base']);
  });

  describe.each(TABLE.tools.map((row) => [row.id, row]))('new tool %s', (_id, row) => {
    it('has valid needs, output kinds, additions and category', () => {
      expect(rowProblems(row, 'tool')).toEqual([]);
    });
  });

  describe.each(TABLE.upgrades.map((row) => [row.id, row]))('upgrade %s', (_id, row) => {
    it('matches the tool already in the catalog and has valid needs, kinds and additions', () => {
      expect(rowProblems(row, 'upgrade')).toEqual([]);
    });
  });

  it('plans code generation only for the font tool and never compilation for the WebAssembly inspector', () => {
    const rows = [...TABLE.tools, ...TABLE.upgrades];
    expect(rows.filter((row) => row.needs.includes('eval')).map((row) => row.id)).toEqual(['font-inspector']);
    const wasmPage = rows.find((row) => row.id === 'wasm-inspector');
    expect(wasmPage.needs).toEqual(['workers']);
  });

  it('is consistent with the policy gate lists for the two reserved ids', () => {
    expect(EVAL_PAGES).toContain('font-inspector');
    expect(NO_COMPILE_PAGES).toContain('wasm-inspector');
    expect(RESERVED_IDS).toContain('font-inspector');
    expect(RESERVED_IDS).toContain('wasm-inspector');
  });

  it('names no shared addition outside the closed list', () => {
    const used = new Set([...TABLE.tools, ...TABLE.upgrades].flatMap((row) => row.sharedAdditions));
    for (const name of used) expect(KNOWN_ADDITIONS, `unknown addition ${name}`).toContain(name);
    expect(used.size, 'the table names at least one addition').toBeGreaterThan(0);
  });

  describe('every shared addition exists now', () => {
    for (const name of KNOWN_ADDITIONS) {
      it(`the ${name} exists`, (context) => {
        if (name === 'probe controls' && !present('e2e', 'csp-probe.ts')) {
          context.skip('e2e/csp-probe.ts arrives with plan 17-09; this check runs from then on');
        }
        expect(ADDITION_CHECKS[name]()).toEqual([]);
      });
    }
  });

  it('reads the output kinds from the real page contract, tree and countdown included', () => {
    for (const kind of [
      'code',
      'keyvalue',
      'table',
      'list',
      'note',
      'image',
      'files',
      'sandboxed-html',
      'tree',
      'countdown',
    ]) {
      expect(KINDS, `the page contract lacks ${kind}`).toContain(kind);
    }
  });

  it('fails a row that plans eval for another id, a wasm need for the inspector, an unknown need and an unknown kind', () => {
    const base = TABLE.tools.find((row) => row.id === 'sms-segments');
    expect(rowProblems({ ...base, needs: ['eval'] }, 'tool').join(' ')).toContain('only font-inspector plans eval');
    const inspector = TABLE.tools.find((row) => row.id === 'wasm-inspector');
    expect(rowProblems({ ...inspector, needs: ['wasm', 'workers'] }, 'tool').join(' ')).toContain(
      'plans neither wasm nor eval',
    );
    expect(rowProblems({ ...base, needs: ['network'] }, 'tool').join(' ')).toContain('closed vocabulary');
    expect(rowProblems({ ...base, needs: ['workers', 'eval'] }, 'tool').join(' ')).toContain('not sorted');
    expect(rowProblems({ ...base, outputKinds: ['table', 'gauge'] }, 'tool').join(' ')).toContain(
      'not in the page contract',
    );
    expect(rowProblems({ ...base, sharedAdditions: ['teleporter'] }, 'tool').join(' ')).toContain('not a known name');
    expect(rowProblems({ ...base, category: 'nowhere' }, 'tool').join(' ')).toContain('not a catalog category');
  });

  it('fails an upgrade whose needs differ from its meta.json, and a tool in the catalog that declares other needs', () => {
    const glob = TABLE.upgrades.find((row) => row.id === 'glob-tester');
    expect(rowProblems({ ...glob, needs: [] }, 'upgrade').join(' ')).toContain('meta.json declares');
    const notThere = { ...glob, id: 'no-such-tool-anywhere' };
    expect(rowProblems(notThere, 'upgrade').join(' ')).toContain('already in the catalog');
  });
});
