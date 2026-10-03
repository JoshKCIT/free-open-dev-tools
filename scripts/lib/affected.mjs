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
          // The same text with each resolved version hidden, to tell a change
          // to those versions from any other change to the entry.
          masked: '',
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
        importer.masked += `${' '.repeat(indent)}version: (resolved)\n`;
        continue;
      }
      importer.masked += `${raw}\n`;
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

// ---------------------------------------------------------------------------
// Optional peers becoming available
//
// A package can declare a peer as optional (`peerDependenciesMeta`: `optional: true`),
// as vite does for sass and less. When some tool then adds sass, pnpm re-resolves
// every vite snapshot, and everything that depends on vite, with sass in its key:
// `vite@6.4.3(terser@5.51.2)` becomes `vite@6.4.3(sass@1.103.1)(terser@5.51.2)`.
// Nothing about vite changed, and a page that never imports a stylesheet builds
// the same. The functions below recognise exactly that and nothing wider.

const SNAPSHOT_DEP_GROUPS = new Set(['dependencies', 'optionalDependencies']);
const withoutSuffix = (ref) => ref.replace(/\(.*$/, '');
const refName = (ref) => ref.slice(0, ref.indexOf('@', 1));
const pairId = (x, y) => `${x}\n${y}`;
const indentOf = (raw) => raw.length - raw.trimStart().length;

/** The peer names a package entry marks `optional: true`. Empty when it says nothing. */
function optionalPeerNames(entry) {
  const names = new Set();
  let inMeta = false;
  let name = null;
  for (const raw of entry.split('\n').slice(1)) {
    const indent = indentOf(raw);
    const line = raw.trimStart();
    if (indent === 4) {
      inMeta = line === 'peerDependenciesMeta:';
      name = null;
    } else if (inMeta && indent === 6) {
      name = splitKey(line)[0];
    } else if (inMeta && indent === 8 && name !== null && line === 'optional: true') {
      names.add(name);
    }
  }
  return names;
}

/** A snapshot's dependency lines (`group\0name` -> version) apart from the rest of its text. */
function snapshotBody(entry) {
  const deps = new Map();
  const rest = [];
  let group = null;
  for (const raw of entry.split('\n').slice(1)) {
    const indent = indentOf(raw);
    const line = raw.trimStart();
    if (indent === 4) {
      group = splitKey(line)[0];
      if (!SNAPSHOT_DEP_GROUPS.has(group)) rest.push(raw);
    } else if (indent === 6 && SNAPSHOT_DEP_GROUPS.has(group)) {
      const [name, version] = splitKey(line);
      deps.set(`${group}\0${name}`, unquote(version));
    } else {
      rest.push(raw);
    }
  }
  return { deps, rest: rest.join('\n') };
}

/** The peers in a snapshot key's suffix: name -> `name@version(...)`. Null when the key is malformed. */
function suffixPeers(key) {
  const peers = new Map();
  let depth = 0;
  let start = -1;
  for (let i = key.indexOf('('); i !== -1 && i < key.length; i++) {
    if (key[i] === '(') {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (key[i] === ')') {
      depth--;
      if (depth < 0) return null;
      if (depth === 0) {
        const ref = key.slice(start, i);
        if (ref.indexOf('@', 1) === -1) return null;
        peers.set(refName(ref), ref);
      }
    }
  }
  return depth === 0 ? peers : null;
}

/**
 * Which pairs of snapshot keys (a key before, the key it became after) differ
 * only by optional peers becoming available or going away. A pair counts only
 * when all of these hold:
 *  - both keys are the same package at the same version, and the package's own
 *    entry is byte for byte the same before and after;
 *  - every peer added or removed is marked optional by that package, or by a
 *    package below it that passes the same test (vite's optional sass shows up
 *    in the key of vite-node, which depends on vite but has no peers itself);
 *  - no peer, and no other dependency, changed version;
 *  - the rest of the snapshot's text is the same, and each dependency or peer
 *    whose key differs is itself such a pair.
 * Whether the unchanged dependencies below really are unchanged is checked by
 * the caller, which has the full picture of what changed.
 *
 * Returns Map(pair id -> { x, y, names, own, added, removed, edges }).
 */
function optionalPeerPairs(a, b, roots, banned) {
  const memo = new Map();
  const examine = (x, y) => {
    const base = withoutSuffix(x);
    if (base !== withoutSuffix(y)) return null;
    const entry = a.entries.get(`packages:${base}`);
    if (entry === undefined || entry !== b.entries.get(`packages:${base}`)) return null;
    const optional = optionalPeerNames(entry);
    const was = a.entries.get(`snapshots:${x}`);
    const now = b.entries.get(`snapshots:${y}`);
    if (was === undefined || now === undefined) return null;
    const bodyA = snapshotBody(was);
    const bodyB = snapshotBody(now);
    if (bodyA.rest !== bodyB.rest) return null;
    const peersA = suffixPeers(x);
    const peersB = suffixPeers(y);
    if (peersA === null || peersB === null) return null;

    const added = new Map();
    const removed = new Map();
    const own = new Set();
    const edges = [];
    const needCarrying = [];
    const nested = new Map();
    for (const name of new Set([...peersA.keys(), ...peersB.keys()])) {
      const ra = peersA.get(name);
      const rb = peersB.get(name);
      if (ra === undefined || rb === undefined) {
        (ra === undefined ? added : removed).set(name, withoutSuffix(ra ?? rb));
        if (optional.has(name)) own.add(name);
        else needCarrying.push(name);
      } else if (withoutSuffix(ra) !== withoutSuffix(rb)) {
        return null;
      } else if (ra !== rb) {
        nested.set(pairId(ra, rb), [ra, rb]);
      }
    }
    for (const slot of new Set([...bodyA.deps.keys(), ...bodyB.deps.keys()])) {
      const name = slot.slice(slot.indexOf('\0') + 1);
      const va = bodyA.deps.get(slot);
      const vb = bodyB.deps.get(slot);
      if (va === undefined || vb === undefined) {
        if (!optional.has(name)) return null;
        own.add(name);
        (va === undefined ? added : removed).set(name, `${name}@${withoutSuffix(va ?? vb)}`);
        edges.push(va === undefined ? `${y}\0${name}@${vb}` : `${x}\0${name}@${va}`);
      } else if (va !== vb) {
        nested.set(pairId(`${name}@${va}`, `${name}@${vb}`), [`${name}@${va}`, `${name}@${vb}`]);
      }
    }
    const carried = new Set();
    for (const [cx, cy] of nested.values()) {
      const child = check(cx, cy);
      if (child === null) return null;
      for (const name of child.names) carried.add(name);
    }
    if (needCarrying.some((name) => !carried.has(name))) return null;
    return {
      x,
      y,
      names: new Set([...added.keys(), ...removed.keys(), ...carried]),
      own,
      added,
      removed,
      edges,
      nested: [...nested.keys()],
    };
  };
  const check = (x, y) => {
    const id = pairId(x, y);
    if (banned.has(id)) return null;
    if (memo.has(id)) return memo.get(id);
    // While its own dependencies are examined, a pair that leads back to itself is taken as fine.
    memo.set(id, { names: new Set(), pending: true });
    let result = null;
    try {
      result = examine(x, y);
    } catch {
      result = null;
    }
    memo.set(id, result);
    return result;
  };
  for (const [x, y] of roots) check(x, y);

  const found = new Map([...memo].filter(([, result]) => result !== null && !result.pending));
  for (let dropped = true; dropped;) {
    dropped = false;
    for (const [id, result] of found) {
      if (result.nested.some((child) => !found.has(child))) {
        found.delete(id);
        dropped = true;
      }
    }
  }
  return found;
}

/**
 * Which workspace packages a lockfile change reaches, and through which kind of
 * dependency. A package whose own entry changed affects everything that depends
 * on it, however indirectly, so the walk goes up the dependency tree.
 *
 * A dependency whose resolution changed only by optional peers becoming
 * available or going away (see optionalPeerPairs) is not reached; what those
 * were is returned as `optionalPeers`, for the report.
 *
 * Returns { everything: reason } or
 * { importers: Map(path -> { runtime: [names], dev: [names] }), optionalPeers?: { added, removed, declaredBy, reresolved } }.
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

  const pairs = [];
  for (const key of a.children.keys()) {
    if (b.entries.has(`snapshots:${key}`) && a.entries.get(`snapshots:${key}`) !== b.entries.get(`snapshots:${key}`)) {
      pairs.push([key, key]);
    }
  }
  for (const path of new Set([...a.importers.keys(), ...b.importers.keys()])) {
    for (const group of DEP_GROUPS) {
      const was = a.importers.get(path)?.[group] ?? new Map();
      const now = b.importers.get(path)?.[group] ?? new Map();
      for (const [name, version] of was) {
        if (now.has(name) && now.get(name) !== version) pairs.push([`${name}@${version}`, `${name}@${now.get(name)}`]);
      }
    }
  }

  // What changed, given which pairs are taken as only optional peers coming or
  // going: those keys are not changes in themselves, and nothing is passed up
  // from a peer that became available. A pair whose unchanged dependencies did
  // change is no longer such a pair; it is dropped and the walk done again.
  const banned = new Set();
  let excused;
  let changed;
  for (;;) {
    excused = optionalPeerPairs(a, b, pairs, banned);
    const keys = new Set();
    const edges = new Set();
    for (const pair of excused.values()) {
      keys.add(pair.x).add(pair.y);
      for (const edge of pair.edges) edges.add(edge);
    }
    changed = new Set();
    for (const key of new Set([...a.entries.keys(), ...b.entries.keys()])) {
      if (a.entries.get(key) === b.entries.get(key)) continue;
      if (key.startsWith('snapshots:') && keys.has(key.slice('snapshots:'.length))) continue;
      changed.add(key.replace(/^(packages|snapshots):/, ''));
    }
    // A changed package entry (`name@1.0.0`) changes each of its snapshots (`name@1.0.0(peer@2.0.0)`).
    for (const snapshot of new Set([...a.children.keys(), ...b.children.keys()])) {
      if (changed.has(snapshot.replace(/\(.*$/, ''))) changed.add(snapshot);
    }
    const parents = new Map();
    for (const graph of [a.children, b.children]) {
      for (const [parent, kids] of graph) {
        for (const kid of kids) {
          if (edges.has(`${parent}\0${kid}`)) continue;
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
    const broken = [...excused].filter(([, pair]) => changed.has(pair.x) || changed.has(pair.y));
    if (broken.length === 0) break;
    for (const [id] of broken) banned.add(id);
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
          if (was.get(name) !== now.get(name)) {
            const same =
              was.has(name) &&
              now.has(name) &&
              excused.has(pairId(`${name}@${was.get(name)}`, `${name}@${now.get(name)}`));
            if (!same) names.add(name);
          } else if (changed.has(`${name}@${now.get(name)}`)) names.add(name);
        }
      }
      return [...names].sort();
    };
    const runtime = reached(['dependencies', 'optionalDependencies']);
    const dev = reached(['devDependencies']);
    // Something else in the entry changed (a specifier, dependency metadata):
    // not clear what it reaches, so it counts as both. A change to nothing but
    // resolved versions, all of them optional peers coming or going, is explained.
    const onlyVersions = x !== undefined && y !== undefined && x.masked === y.masked;
    const unexplained = runtime.length === 0 && dev.length === 0 && x?.raw !== y?.raw && !onlyVersions;
    if (runtime.length > 0 || dev.length > 0 || unexplained) {
      importers.set(path, {
        runtime: unexplained ? ['(the entry itself)'] : runtime,
        dev: unexplained ? ['(the entry itself)'] : dev,
      });
    }
  }

  const named = { added: new Set(), removed: new Set(), declaredBy: new Set(), reresolved: new Set() };
  for (const pair of excused.values()) {
    for (const peer of pair.added.values()) named.added.add(peer);
    for (const peer of pair.removed.values()) named.removed.add(peer);
    if (pair.own.size > 0) named.declaredBy.add(withoutSuffix(pair.x));
    named.reresolved.add(withoutSuffix(pair.x));
  }
  if (named.added.size === 0 && named.removed.size === 0) return { importers };
  const sorted = (set) => [...set].sort();
  return {
    importers,
    optionalPeers: {
      added: sorted(named.added),
      removed: sorted(named.removed),
      declaredBy: sorted(named.declaredBy),
      reresolved: sorted(named.reresolved),
    },
  };
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
