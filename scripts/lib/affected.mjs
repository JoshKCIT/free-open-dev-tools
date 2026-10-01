/**
 * The rules behind scripts/affected-tools.mjs, kept free of git and file access
 * so each rule can be tested on its own (scripts/test/affected.test.mjs).
 *
 * Every changed file is sorted into one of these:
 *
 *   tool        One tool's own files: its folder, its page, a helper only tool
 *               pages import, its browser fixtures, its catalog entry, or its
 *               dependencies in the lockfile. That tool's browser tests run in
 *               every engine, and its folder gets the standalone check.
 *   whole spec  A browser test file (or a helper it imports) that changed. The
 *               check itself changed, so that file runs whole, for every tool.
 *   site        Something only the site-wide browser tests read.
 *   everything  Anything every page shares: the page frame, shared components,
 *               the build, the browser test setup, root dependencies.
 *   nothing     Documentation, planning notes, the setup of checks the static
 *               job always runs in full, and edits that only touch comments.
 *
 * A file no rule covers counts as everything, so a gap in these rules costs
 * time, never coverage.
 */
import { posix } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

/** Browser fixture folders, each holding one `<tool id>.json` per tool. */
export const FIXTURE_DIRS = [
  'e2e/live-fixtures/',
  'e2e/privacy-fixtures/',
  'e2e/css-preview-fixtures/',
  'e2e/file-tool-fixtures/',
];

/** Catalog files, compared one tool entry at a time rather than as a whole. */
export const CATALOG_FILES = [
  'docs/catalog.json',
  'apps/web/src/generated-catalog.json',
  'apps/web/src/generated-tools.json',
];

/** The page every visitor loads first. Anything it reaches is shared by every page. */
export const SHELL_ENTRY = 'apps/web/src/main.tsx';

/** The build step that writes every page's HTML. */
export const PRERENDER = 'scripts/prerender.mjs';

/** The script behind the standalone job. */
export const STANDALONE_CHECK = 'scripts/check-standalone.mjs';

const NOTHING = [
  [/^\.planning\//, 'planning notes'],
  [/^\.claude\//, 'assistant notes'],
  [/^[^/]+\.md$/, 'documentation'],
  [/^docs\/[^/]+\.md$/, 'documentation'],
  [/^docs\/(RELEASE-MANIFEST\.json|release-manifest\.schema\.json)$/, 'the release record, written after the checks'],
  [/^docs\/vendored-licenses\//, 'licence texts read only by the licence gate, which runs on every push'],
  [/^LICENSE$/, 'the licence text'],
  [/^\.github\/workflows\/deploy\.yml$/, 'the deploy workflow, which runs after these checks'],
  [/^\.github\/workflows\/ci\.yml$/, "these checks' own workflow; a mistake in it shows in its own run"],
  [/^\.github\/(?!workflows\/)/, 'GitHub settings files'],
  [/^\.gitleaksignore$/, 'read only by the secret scan, which runs on every push'],
  [/^\.(gitignore|gitattributes|editorconfig)$/, 'git and editor settings'],
  [
    /^(\.prettierrc(\.\w+)?|\.prettierignore|eslint\.config\.js|vitest\.config\.ts|tsconfig\.tools\.json)$/,
    'set-up for a check the static job runs in full on every push',
  ],
];

const EVERYTHING = [
  [/^playwright\.config\.ts$/, 'the browser test set-up'],
  [/^(package\.json|pnpm-workspace\.yaml|\.npmrc|\.nvmrc)$/, 'the workspace set-up'],
  [/^tsconfig(\.base)?\.json$/, 'the TypeScript settings every package builds with'],
];

const everything = (why) => ({ kind: 'everything', why });

/**
 * The first-pass rule for one path. Some kinds ('trace', 'catalog', 'lockfile')
 * need more than the path, and the caller resolves those.
 */
export function pathRule(path) {
  const inTool = /^tools\/([^/]+)\/(.+)$/.exec(path);
  if (inTool) {
    const [, id, rest] = inTool;
    if (rest.startsWith('test/')) return { kind: 'tool', id, browser: false, why: 'a unit test of this tool' };
    if (/^(README|CHANGELOG)\.md$|^LICENSE$/.test(rest)) {
      return { kind: 'tool', id, browser: false, why: "this tool's own documentation" };
    }
    return { kind: 'tool', id, browser: true, trace: rest.startsWith('src/') };
  }
  if (path.startsWith('tools/')) return everything('a file shared by every tool folder');
  if (CATALOG_FILES.includes(path)) return { kind: 'catalog' };
  if (path.startsWith('apps/web/src/')) return { kind: 'trace' };
  if (path.startsWith('apps/web/')) return everything('the web app build set-up');
  for (const dir of FIXTURE_DIRS) {
    if (!path.startsWith(dir)) continue;
    const fixture = /^([^/]+)\.json$/.exec(path.slice(dir.length));
    return fixture ? { kind: 'fixture', id: fixture[1] } : everything('a browser fixture that belongs to no one tool');
  }
  if (/^e2e\/[^/]+\.spec\.ts$/.test(path)) return { kind: 'spec' };
  if (path.startsWith('e2e/')) return { kind: 'trace' };
  if (path === 'pnpm-lock.yaml') return { kind: 'lockfile' };
  if (path.startsWith('scripts/')) return { kind: 'trace' };
  if (path === '.provenance-denylist') return { kind: 'site', why: 'read by the whole-catalog JavaScript check' };
  for (const [pattern, why] of NOTHING) if (pattern.test(path)) return { kind: 'nothing', why };
  for (const [pattern, why] of EVERYTHING) if (pattern.test(path)) return everything(why);
  return everything('no rule covers this file');
}

// ---------------------------------------------------------------------------
// Comment-only edits

const CODE_FILE = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/;

/**
 * Comments a bundler or minifier reads. They change the built output, so an
 * edit to one is never treated as comment-only.
 */
const MEANINGFUL_COMMENT =
  /\/\*[!#@][\s\S]*?\*\/|\/\/[#@].*|@vite-ignore|__PURE__|__NO_SIDE_EFFECTS__|@license|@preserve|sourceMappingURL|@jsx/g;

/**
 * True when two versions of a file differ only in comments or formatting, so
 * nothing any check exercises changed. `ts` is the TypeScript module; without
 * it only JSON files can be compared and every code edit counts as real.
 */
export function sameIgnoringComments(path, before, after, ts) {
  if (before === null || after === null || before === undefined || after === undefined) return false;
  if (before === after) return true;
  if (path.endsWith('.json')) {
    try {
      return isDeepStrictEqual(JSON.parse(before), JSON.parse(after));
    } catch {
      return false;
    }
  }
  if (!ts || !CODE_FILE.test(path)) return false;
  const printed = (text) => {
    const kind = path.endsWith('.tsx')
      ? ts.ScriptKind.TSX
      : path.endsWith('.jsx')
        ? ts.ScriptKind.JSX
        : /\.(m|c)?js$/.test(path)
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS;
    const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, kind);
    // A file that does not parse cleanly cannot be compared reliably.
    if (file.parseDiagnostics?.length) return null;
    return ts.createPrinter({ removeComments: true }).printFile(file);
  };
  const a = printed(before);
  if (a === null || a !== printed(after)) return false;
  return isDeepStrictEqual(before.match(MEANINGFUL_COMMENT) ?? [], after.match(MEANINGFUL_COMMENT) ?? []);
}

// ---------------------------------------------------------------------------
// Imports

const IMPORT_PATTERNS = [
  /\b(?:import|export)\s+(?:type\s+)?(?:[\w$*{}\s,]+?\s+from\s+)?['"]([^'"\n]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  /\bnew\s+URL\(\s*['"]([^'"\n]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
];

/**
 * Every module specifier a file names. Deliberately generous: a match inside a
 * comment or a string only adds an edge, which can make a run bigger but never
 * smaller.
 */
export function importsOf(text) {
  const found = new Set();
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of text.matchAll(pattern)) found.add(match[1]);
  }
  return [...found];
}

const EXTENSIONS = ['', '.ts', '.tsx', '.mts', '.js', '.mjs', '.jsx', '.json', '/index.ts', '/index.tsx', '/index.js'];

/**
 * The repository path a specifier points at, or null for a package from
 * node_modules. `@fodt/<id>` is the web app's alias for a tool's own source.
 */
export function resolveImport(from, specifier, files) {
  const bare = specifier.split('?')[0];
  const tool = /^@fodt\/([^/]+)$/.exec(bare);
  if (tool) return `tools/${tool[1]}/src/index.ts`;
  if (!bare.startsWith('.')) return null;
  const target = posix.normalize(posix.join(posix.dirname(from), bare));
  const stems = [target];
  // TypeScript's ESM style names the compiled file: `./x.js` for `./x.ts`.
  if (/\.(m?js|jsx)$/.test(target)) stems.push(target.replace(/\.(m?)js(x?)$/, '.$1ts$2'));
  for (const stem of stems) {
    for (const ext of EXTENSIONS) if (files.has(stem + ext)) return stem + ext;
  }
  // Unresolved, but kept: a change to exactly that path is still traced.
  return target;
}

/** Forward and reverse import edges over the given source texts. */
export function buildGraph(sources, files) {
  const forward = new Map();
  const reverse = new Map();
  const add = (map, key, value) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(value);
  };
  for (const [path, text] of sources) {
    for (const specifier of importsOf(text)) {
      const target = resolveImport(path, specifier, files);
      if (target === null || target === path) continue;
      add(forward, path, target);
      add(reverse, target, path);
    }
  }
  return { forward, reverse };
}

/** Everything reachable from `start` along `edges`, including `start`. */
export function reach(start, edges) {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    for (const next of edges.get(queue.pop()) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

// ---------------------------------------------------------------------------
// Catalog files

function catalogEntries(path, text) {
  const data = JSON.parse(text);
  if (path === 'docs/catalog.json') return { entries: data, rest: null };
  if (path === 'apps/web/src/generated-catalog.json') {
    const { tools, ...rest } = data;
    return { entries: tools, rest };
  }
  return { entries: Object.values(data), rest: null };
}

/**
 * Which tools' catalog entries differ between two versions of a catalog file,
 * and whether anything outside the entries (their order, a top-level key)
 * changed too, which only the site-wide tests read.
 */
export function catalogImpact(path, before, after) {
  let a;
  let b;
  try {
    a = before === null ? { entries: [], rest: null } : catalogEntries(path, before);
    b = after === null ? { entries: [], rest: null } : catalogEntries(path, after);
  } catch (err) {
    return { everything: `${path} could not be read as a catalog (${err.message})` };
  }
  const byId = (entries) => new Map(entries.map((entry) => [entry.id, entry]));
  const beforeById = byId(a.entries);
  const afterById = byId(b.entries);
  const ids = new Set();
  for (const id of new Set([...beforeById.keys(), ...afterById.keys()])) {
    if (!isDeepStrictEqual(beforeById.get(id), afterById.get(id))) ids.add(id);
  }
  const order = (entries) => entries.map((entry) => entry.id).filter((id) => beforeById.has(id) && afterById.has(id));
  const site = !isDeepStrictEqual(a.rest, b.rest) || !isDeepStrictEqual(order(a.entries), order(b.entries));
  return { ids, site };
}

// ---------------------------------------------------------------------------
// Lockfile

const LOCK_SECTIONS = new Set(['importers', 'packages', 'snapshots']);
const DEP_GROUPS = ['dependencies', 'devDependencies', 'optionalDependencies'];

function unquote(value) {
  if (value === undefined) return undefined;
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  return value;
}

/** Splits `key: value` or `'quoted key': value`, as pnpm writes them. */
function splitKey(line) {
  if (line.startsWith("'")) {
    let i = 1;
    let key = '';
    while (i < line.length) {
      if (line[i] === "'") {
        if (line[i + 1] === "'") {
          key += "'";
          i += 2;
          continue;
        }
        break;
      }
      key += line[i++];
    }
    const value = line.slice(i + 1).replace(/^:\s*/, '');
    return [key, value === '' ? undefined : value];
  }
  const colon = line.search(/:(\s|$)/);
  if (colon === -1) throw new Error(`no key on the line "${line}"`);
  const value = line.slice(colon + 1).trim();
  return [line.slice(0, colon), value === '' ? undefined : value];
}

/**
 * Reads the parts of a pnpm v9 lockfile that decide who is affected by a
 * change: each workspace package's resolved dependencies, each package entry's
 * text, and which package depends on which. Throws on anything unexpected, and
 * the caller then treats the change as affecting everything.
 */
export function parseLockfile(text) {
  const importers = new Map();
  const entries = new Map();
  const children = new Map();
  const other = [];
  let section = null;
  let key = null;
  let group = null;
  let dep = null;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '') continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trimStart();
    if (indent === 0) {
      section = splitKey(line)[0];
      key = null;
      if (!LOCK_SECTIONS.has(section)) other.push(raw);
      continue;
    }
    if (!LOCK_SECTIONS.has(section)) {
      other.push(raw);
      continue;
    }
    if (indent === 2) {
      key = splitKey(line)[0];
      group = null;
      dep = null;
      if (section === 'importers') {
        importers.set(key, {
          raw: '',
          dependencies: new Map(),
          devDependencies: new Map(),
          optionalDependencies: new Map(),
        });
      } else {
        entries.set(`${section}:${key}`, line);
        if (section === 'snapshots') children.set(key, new Set());
      }
      continue;
    }
    if (key === null) throw new Error(`a line outside any entry: "${raw}"`);
    if (section === 'importers') {
      const importer = importers.get(key);
      importer.raw += `${raw}\n`;
      if (indent === 4) group = splitKey(line)[0];
      else if (indent === 6) dep = splitKey(line)[0];
      else if (indent === 8 && DEP_GROUPS.includes(group) && line.startsWith('version:')) {
        importer[group].set(dep, unquote(line.slice('version:'.length).trim()));
      }
      continue;
    }
    entries.set(`${section}:${key}`, `${entries.get(`${section}:${key}`)}\n${raw}`);
    if (section === 'snapshots') {
      if (indent === 4) group = splitKey(line)[0];
      else if (indent === 6 && (group === 'dependencies' || group === 'optionalDependencies')) {
        const [name, version] = splitKey(line);
        children.get(key).add(`${name}@${unquote(version)}`);
      }
    }
  }
  if (importers.size === 0) throw new Error('no importers section');
  return { importers, entries, children, other: other.join('\n') };
}

/**
 * Which workspace packages a lockfile change reaches, and through which kind of
 * dependency. A package whose own entry changed affects everything that depends
 * on it, however indirectly, so the walk goes up the dependency tree.
 *
 * Returns { everything: reason } or { importers: Map(path -> { runtime: [names], dev: [names] }) }.
 */
export function lockfileImpact(before, after) {
  let a;
  let b;
  try {
    a = parseLockfile(before ?? '');
    b = parseLockfile(after ?? '');
  } catch (err) {
    return { everything: `the lockfile could not be read (${err.message})` };
  }
  if (a.other !== b.other) return { everything: 'a lockfile setting outside the dependency lists changed' };

  const changed = new Set();
  for (const key of new Set([...a.entries.keys(), ...b.entries.keys()])) {
    if (a.entries.get(key) !== b.entries.get(key)) changed.add(key.replace(/^(packages|snapshots):/, ''));
  }
  // A changed package entry (`name@1.0.0`) changes each of its snapshots (`name@1.0.0(peer@2.0.0)`).
  for (const snapshot of new Set([...a.children.keys(), ...b.children.keys()])) {
    if (changed.has(snapshot.replace(/\(.*$/, ''))) changed.add(snapshot);
  }
  const parents = new Map();
  for (const graph of [a.children, b.children]) {
    for (const [parent, kids] of graph) {
      for (const kid of kids) {
        if (!parents.has(kid)) parents.set(kid, new Set());
        parents.get(kid).add(parent);
      }
    }
  }
  const queue = [...changed];
  while (queue.length > 0) {
    for (const parent of parents.get(queue.pop()) ?? []) {
      if (changed.has(parent)) continue;
      changed.add(parent);
      queue.push(parent);
    }
  }

  const importers = new Map();
  for (const path of new Set([...a.importers.keys(), ...b.importers.keys()])) {
    const x = a.importers.get(path);
    const y = b.importers.get(path);
    const reached = (groups) => {
      const names = new Set();
      for (const group of groups) {
        const was = x?.[group] ?? new Map();
        const now = y?.[group] ?? new Map();
        for (const name of new Set([...was.keys(), ...now.keys()])) {
          if (was.get(name) !== now.get(name)) names.add(name);
          else if (changed.has(`${name}@${now.get(name)}`)) names.add(name);
        }
      }
      return [...names].sort();
    };
    const runtime = reached(['dependencies', 'optionalDependencies']);
    const dev = reached(['devDependencies']);
    // Something else in the entry changed (a specifier, dependency metadata):
    // not clear what it reaches, so it counts as both.
    const unexplained = runtime.length === 0 && dev.length === 0 && x?.raw !== y?.raw;
    if (runtime.length > 0 || dev.length > 0 || unexplained) {
      importers.set(path, {
        runtime: unexplained ? ['(the entry itself)'] : runtime,
        dev: unexplained ? ['(the entry itself)'] : dev,
      });
    }
  }
  return { importers };
}

// ---------------------------------------------------------------------------
// Picking browser tests

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * A Playwright --grep-invert pattern that leaves out every test naming a tool
 * outside `selected`. Playwright matches it against one line made of the
 * project, the test file's name, any describe titles and the test title, so a
 * test is left out when its file is `<id>.spec.ts` or its title names `<id>`.
 * A test that names no tool at all is site-wide and always kept, and so is
 * every test in a file listed in `wholeFiles`.
 *
 * Returns '' when no test needs leaving out. The pattern is wrapped in slashes
 * so Playwright applies it exactly as written: case-sensitive, not global.
 */
export function grepInvertPattern({ allIds, selected, wholeFiles }) {
  const leaveOut = [...allIds]
    .filter((id) => !selected.has(id))
    .sort((x, y) => y.length - x.length || (x < y ? -1 : 1));
  if (leaveOut.length === 0) return '';
  const names = `(?<![A-Za-z0-9-])(?:${leaveOut.map(escapeRegExp).join('|')})(?![A-Za-z0-9-])`;
  if (wholeFiles.size === 0) return `/${names}/`;
  const keep = [...wholeFiles].sort().map(escapeRegExp).join('|');
  return `/^(?!.*(?<![\\w.-])(?:${keep})(?![\\w.-])).*${names}/`;
}
