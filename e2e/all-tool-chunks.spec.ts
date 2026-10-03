import { test, expect, type APIRequestContext, type Browser, type TestInfo } from '@playwright/test';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * D-141: the release-wide proof that the complete 192-tool catalog's
 * deployed JavaScript is clean. Runs against the production build
 * (E2E_BASE_URL unset, playwright.config.ts:15) or the deployed site
 * (E2E_BASE_URL set) -- the same base-URL convention every other
 * deployed-site spec in this repo already uses.
 *
 * Chromium only: this is a byte scan over static files and a request-log
 * proof, not a cross-engine behavioural check, so running it on four
 * browser projects would only repeat the same HTTP fetches four times for
 * no additional coverage. `test.skip` on the other three projects, per
 * test, with the reason named below.
 *
 * The whole file runs in one worker in declaration order (`mode: 'serial'`)
 * so the one expensive crawl over all 192 pages happens exactly once and is
 * shared by every test in this file, rather than once per test.
 *
 * SITE-02 (the last test) adds the per-page loading check on top of that one
 * crawl: it reads the source map of every JavaScript file each page loads
 * (page chunks, shared chunks and the inline worker maps named inside them),
 * turns each map's `sources` into package names, and fails when a page loads a
 * package that none of its own tool's declared dependencies account for, or
 * when the home, catalog, tools index, about or privacy page loads any
 * declared package at all. Who may load what is read from each
 * tools/<id>/package.json and the installed manifests, never from a hand-kept
 * list, so a package a later tool declares is covered with no edit here.
 */

const CHROMIUM_ONLY_REASON = 'one engine is enough for a byte scan';

const rel = (path: string) => path.replace(/^\//, '');

/** SITE-02: the pages that are not tool pages. None of them may load any declared runtime package. */
const SITE_PAGES = ['/', '/catalog', '/tools', '/about', '/privacy'];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

interface CatalogEntry {
  id: string;
}

const catalogJsonRaw: unknown = JSON.parse(readFileSync(join(root, 'docs', 'catalog.json'), 'utf8'));
const ALL_IDS: string[] = (
  Array.isArray(catalogJsonRaw) ? catalogJsonRaw : (catalogJsonRaw as { tools: CatalogEntry[] }).tools
).map((e) => (e as CatalogEntry).id);

/**
 * Reads the forbidden-reference denylist exactly as `scripts/check-provenance.mjs`
 * does: `PROVENANCE_DENYLIST`, else the local `.provenance-denylist`, split on
 * commas and newlines, trimmed, lower-cased, empty and `#` lines dropped.
 */
function readDenylist(): string[] {
  let text = process.env.PROVENANCE_DENYLIST ?? '';
  if (text.length === 0) {
    try {
      text = readFileSync(join(root, '.provenance-denylist'), 'utf8');
    } catch {
      text = '';
    }
  }
  return text
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !t.startsWith('#'))
    .map((t) => t.toLowerCase());
}

const DENYLIST = readDenylist();

/**
 * Fails closed, as `deploy.yml`'s own provenance step does: an empty
 * denylist means this spec cannot check anything, so it must not report a
 * false pass. Never logs the denylist itself, only that it is missing.
 */
function assertDenylistAvailable(): void {
  if (DENYLIST.length === 0) {
    throw new Error('No denylist available: set PROVENANCE_DENYLIST.');
  }
}

/** True when `lower` (already lower-cased) contains any denylisted token. Never returns which one. */
function hasDenylistHit(lower: string): boolean {
  return DENYLIST.some((token) => lower.includes(token));
}

/** Finds every base64 literal of at least 1,000 characters -- the form a bundled binary blob or an inlined worker can take. */
function findLongBase64Literals(text: string): string[] {
  const matches = text.match(/[A-Za-z0-9+/]{1000,}/g);
  return matches ?? [];
}

/** The exact case-insensitive substring rule `deploy.yml`'s own provenance step uses. */
function scanTextForDenylist(text: string): { plainHit: boolean; decodedHit: boolean; decodedLiteralCount: number } {
  const lower = text.toLowerCase();
  const plainHit = hasDenylistHit(lower);
  const literals = findLongBase64Literals(text);
  let decodedHit = false;
  for (const literal of literals) {
    let decoded: Buffer;
    try {
      decoded = Buffer.from(literal, 'base64');
    } catch {
      continue;
    }
    // Read as Latin-1 too: a byte-for-byte reinterpretation catches an ASCII
    // token embedded in otherwise-binary decoded bytes without requiring the
    // decoded content to itself be valid UTF-8.
    const decodedLatin1 = decoded.toString('latin1').toLowerCase();
    if (hasDenylistHit(decodedLatin1)) {
      decodedHit = true;
      break;
    }
  }
  return { plainHit, decodedHit, decodedLiteralCount: literals.length };
}

// --- Shared crawl, computed once and reused by every test in this file -----

interface PageCrawlResult {
  id: string;
  resetAppeared: boolean;
  crashed: boolean;
  pageErrors: string[];
  offOriginRequests: string[];
  jsPathnames: string[];
}

interface CrawlState {
  entryScriptPathname: string;
  fileTable: string[];
  toolChunkPathnames: Map<string, string[]>;
  pages: Map<string, PageCrawlResult>;
  /** SITE-02: page path (such as '/catalog') to the JavaScript URLs that page loaded. */
  sitePages: Map<string, string[]>;
  loadedJsUrls: Set<string>;
  durationMs: number;
}

let crawlPromise: Promise<CrawlState> | null = null;

/**
 * Derives the absolute URL of a file the entry bundle's own `m.f` table
 * names (a path relative to the build root, e.g. `assets/react-X.js`) by
 * reusing the entry script's own base path -- the deployment prefix
 * (`/` locally, `/free-open-dev-tools/` when deployed), read from where
 * `assets/` first appears in the entry script's own `src` attribute. This
 * works unchanged whether the site is served from the root or a
 * subdirectory, without hardcoding either.
 */
function resolveBuildRootUrl(entryScriptPath: string, relativePath: string, origin: string): string {
  const assetsIndex = entryScriptPath.indexOf('assets/');
  const basePath = assetsIndex >= 0 ? entryScriptPath.slice(0, assetsIndex) : '/';
  return new URL(basePath + relativePath, origin).toString();
}

async function crawlAllPages(browser: Browser, baseURL: string): Promise<CrawlState> {
  const startedAt = Date.now();
  const origin = new URL(baseURL).origin;

  // 1. Fetch the served HTML and locate the entry script -- the first
  //    <script type="module"> tag in <head>, which carries __vite__mapDeps
  //    and the id-to-chunk mapping for every tool page.
  const homeContext = await browser.newContext();
  const homeRequest = homeContext.request;
  const htmlResponse = await homeRequest.get(baseURL);
  const html = await htmlResponse.text();
  const scriptMatch = html.match(/<script\s+type="module"[^>]*\ssrc="([^"]+\.js)"/);
  if (!scriptMatch) {
    await homeContext.close();
    throw new Error('Could not find the entry <script type="module"> tag in the served HTML.');
  }
  const entryScriptPathname = scriptMatch[1];
  if (!entryScriptPathname) {
    await homeContext.close();
    throw new Error('The entry <script> tag matched with no captured src.');
  }
  const entryScriptUrl = new URL(entryScriptPathname, origin).toString();
  const entryScriptResponse = await homeRequest.get(entryScriptUrl);
  const entryScriptText = await entryScriptResponse.text();
  await homeContext.close();

  // 2. Extract the file table (`m.f`, an array of build-root-relative paths).
  const fileTableMatch = entryScriptText.match(/m\.f\s*=\s*(\[[^\]]*\])/);
  if (!fileTableMatch) {
    throw new Error('Could not find the __vite__mapDeps file table (m.f) in the entry script.');
  }
  const fileTableSource = fileTableMatch[1];
  if (!fileTableSource) {
    throw new Error('The __vite__mapDeps file table matched with no captured array.');
  }
  const fileTable: string[] = JSON.parse(fileTableSource);

  // 3. For every catalog id, extract its own dynamic-import call site and
  //    the chunk indices __vite__mapDeps resolves for it.
  const toolChunkPathnames = new Map<string, string[]>();
  const notWired: string[] = [];
  for (const id of ALL_IDS) {
    const callSitePattern = new RegExp(
      String.raw`"\.\./tools/${id}\.ts":\(\)=>[a-zA-Z_$][\w$]*\(\(\)=>import\("([^"]+)"\)(?:,__vite__mapDeps\(\[([0-9,]+)\]\))?\)`,
    );
    const match = callSitePattern.exec(entryScriptText);
    if (!match) {
      notWired.push(id);
      continue;
    }
    const indices = match[2] ? match[2].split(',').map(Number) : [];
    const files = indices.map((i) => fileTable[i]).filter((f): f is string => typeof f === 'string');
    const pathnames = files.map((f) => new URL(resolveBuildRootUrl(entryScriptPathname, f, origin)).pathname);
    toolChunkPathnames.set(id, pathnames);
  }
  if (notWired.length > 0) {
    throw new Error(`Could not find the entry bundle's own dynamic-import call site for: ${notWired.join(', ')}`);
  }

  // 4. Visit every one of the 192 tool pages, once each, in its own fresh
  //    browser context (a shared context would serve a repeated chunk like
  //    the shared react chunk from cache without a network round trip on
  //    the second and later visits, silently hiding it from the request
  //    log this test relies on).
  const pages = new Map<string, PageCrawlResult>();
  const loadedJsUrls = new Set<string>();

  for (const id of ALL_IDS) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const requests: string[] = [];
    const jsUrls = new Set<string>();
    const pageErrors: string[] = [];

    page.on('request', (request) => requests.push(request.url()));
    page.on('response', (response) => {
      const url = response.url();
      if (url.endsWith('.js')) jsUrls.add(url);
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    try {
      await page.goto(rel(`/tools/${id}`));
      await page.waitForLoadState('networkidle');
    } catch (err) {
      pageErrors.push(`navigation failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    let resetAppeared = true;
    try {
      await page.getByRole('button', { name: 'Reset', exact: true }).waitFor({ timeout: 15_000 });
    } catch {
      resetAppeared = false;
    }

    let crashed = false;
    try {
      const bodyText = await page.locator('body').innerText();
      crashed = bodyText.includes('The tool failed on this input:');
    } catch {
      // A page that cannot even report body text is itself a load failure,
      // already captured by resetAppeared/pageErrors above.
    }

    const offOriginRequests = requests.filter((url) => {
      if (url.startsWith('data:') || url.startsWith('blob:')) return false;
      try {
        return new URL(url).origin !== origin;
      } catch {
        return false;
      }
    });

    for (const url of jsUrls) loadedJsUrls.add(url);

    pages.set(id, {
      id,
      resetAppeared,
      crashed,
      pageErrors,
      offOriginRequests,
      jsPathnames: Array.from(jsUrls, (u) => {
        try {
          return new URL(u).pathname;
        } catch {
          return u;
        }
      }),
    });

    await context.close();
  }

  // 5. SITE-02: the five pages that are not tool pages, each in its own fresh
  //    context for the same reason as above.
  const sitePages = new Map<string, string[]>();
  for (const path of SITE_PAGES) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const jsUrls = new Set<string>();
    page.on('response', (response) => {
      const url = response.url();
      if (url.endsWith('.js')) jsUrls.add(url);
    });
    try {
      await page.goto(rel(path));
      await page.waitForLoadState('networkidle');
    } catch {
      // A page that never loaded has no JavaScript in the set, which SITE-02
      // reports as a problem rather than skipping it.
    }
    sitePages.set(path, Array.from(jsUrls));
    await context.close();
  }

  return {
    entryScriptPathname,
    fileTable,
    toolChunkPathnames,
    pages,
    sitePages,
    loadedJsUrls,
    durationMs: Date.now() - startedAt,
  };
}

// --- SITE-02: which page may load which package ------------------------------

/**
 * The package a source-map `sources` entry belongs to: the LAST `node_modules`
 * segment (pnpm nests them), scoped names kept. Null for the project's own
 * files and for virtual module ids. The pnpm store folder `.pnpm` is not a
 * package.
 */
function pkgOf(source: string): string | null {
  const names = [...source.matchAll(/node_modules\/((?:@[^/]+\/)?[^/]+)\//g)]
    .flatMap((m) => (m[1] ? [m[1]] : []))
    .filter((name) => !name.startsWith('.'));
  return names.at(-1) ?? null;
}

/** Each catalog id's own runtime dependencies, read from its tools/<id>/package.json. A missing file is a problem. */
function readDeclaredDependencies(problems: string[]): Map<string, string[]> {
  const declared = new Map<string, string[]>();
  for (const id of ALL_IDS) {
    try {
      const manifest = JSON.parse(readFileSync(join(root, 'tools', id, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
      };
      declared.set(id, Object.keys(manifest.dependencies ?? {}).sort());
    } catch (err) {
      problems.push(`tools/${id}/package.json cannot be read: ${err instanceof Error ? err.message : String(err)}`);
      declared.set(id, []);
    }
  }
  return declared;
}

interface InstalledManifest {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/**
 * Finds the installed copy of `name` the way Node would for a package living in `fromDir` (a real path): in the
 * nearest node_modules above it. A directory named node_modules is searched directly, any other directory through
 * its node_modules child (under pnpm a package's own siblings sit in the store folder beside it).
 */
function findInstalledDir(fromDir: string, name: string): string | null {
  let dir = fromDir;
  for (;;) {
    const candidate = basename(dir) === 'node_modules' ? join(dir, name) : join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/**
 * Every package name a tool's declared dependencies reach: the declared names plus the `dependencies` and
 * `optionalDependencies` of each installed manifest, to a fixed point. `devDependencies` and `peerDependencies` are
 * ignored (a peer a tool needs at run time is declared by the tool itself). A missing optional child is skipped, a
 * missing required one is a problem.
 */
function dependencyClosure(toolId: string, declaredNames: string[], problems: string[]): Set<string> {
  const closure = new Set<string>();
  const seen = new Set<string>();
  const toolDir = realpathSync(join(root, 'tools', toolId));

  const visit = (dir: string): void => {
    if (seen.has(dir)) return;
    seen.add(dir);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as InstalledManifest;
    const children: [string, boolean][] = [
      ...Object.keys(manifest.dependencies ?? {}).map((n): [string, boolean] => [n, false]),
      ...Object.keys(manifest.optionalDependencies ?? {}).map((n): [string, boolean] => [n, true]),
    ];
    for (const [name, optional] of children) {
      const child = findInstalledDir(dir, name);
      if (!child) {
        if (!optional) problems.push(`tools/${toolId}: ${name}, required by ${basename(dir)}, is not installed`);
        continue;
      }
      closure.add(name);
      visit(child);
    }
  };

  for (const name of declaredNames) {
    const dir = findInstalledDir(toolDir, name);
    if (!dir) {
      problems.push(`tools/${toolId}: declared dependency ${name} is not installed`);
      continue;
    }
    closure.add(name);
    visit(dir);
  }
  return closure;
}

/** Package name to the tools whose declared dependency closure contains it. Computed, never hand-kept. */
function ownersOf(declared: Map<string, string[]>, problems: string[]): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  for (const [toolId, names] of declared) {
    for (const name of dependencyClosure(toolId, names, problems)) {
      const set = owners.get(name) ?? new Set<string>();
      set.add(toolId);
      owners.set(name, set);
    }
  }
  return owners;
}

interface ScriptPackages {
  packages: string[];
  /** Why this file's contents cannot be attributed to packages; empty when every map was read. */
  failures: string[];
}

/**
 * Every package the file's source maps name: each `sourceMappingURL=<name>.map` comment in the file (the page chunk's
 * own map and each inline worker's map both appear inside the page chunk), fetched relative to the file. A file with
 * no map comment, or a map that cannot be fetched or parsed, is a failure, never a skip. Cached per URL.
 */
async function packagesOfScript(
  request: APIRequestContext,
  url: string,
  cache: Map<string, ScriptPackages>,
): Promise<ScriptPackages> {
  const cached = cache.get(url);
  if (cached) return cached;

  const packages = new Set<string>();
  const failures: string[] = [];
  const response = await request.get(url);
  if (!response.ok()) {
    failures.push(`the file answered ${response.status()}`);
  } else {
    const text = await response.text();
    const mapNames = [
      ...new Set([...text.matchAll(/sourceMappingURL=([\w.-]+\.map)/g)].flatMap((m) => (m[1] ? [m[1]] : []))),
    ];
    if (mapNames.length === 0) failures.push('no sourceMappingURL comment');
    for (const mapName of mapNames) {
      const mapResponse = await request.get(new URL(mapName, url).toString());
      if (!mapResponse.ok()) {
        failures.push(`${mapName} answered ${mapResponse.status()}`);
        continue;
      }
      try {
        const map = JSON.parse(await mapResponse.text()) as { sources?: unknown };
        if (!Array.isArray(map.sources)) {
          failures.push(`${mapName} has no sources list`);
          continue;
        }
        for (const source of map.sources) {
          const name = typeof source === 'string' ? pkgOf(source) : null;
          if (name) packages.add(name);
        }
      } catch {
        failures.push(`${mapName} is not valid JSON`);
      }
    }
  }

  const result: ScriptPackages = { packages: [...packages].sort(), failures };
  cache.set(url, result);
  return result;
}

interface PageLoad {
  files: number;
  packages: Set<string>;
  unattributed: { file: string; reason: string }[];
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The SITE-02 verdict for every page, pure and sorted by page path and then by package name so two runs over the same
 * build print the same report. `toolIdOfPage` is the tool a page belongs to, or null for a page that is not a tool
 * page (which may load no tracked package at all).
 */
function site02Problems(
  owners: Map<string, Set<string>>,
  loadedByPage: Map<string, PageLoad>,
  toolIdOfPage: Map<string, string | null>,
): string[] {
  const rows: { page: string; rank: number; key: string; text: string }[] = [];
  for (const [page, load] of loadedByPage) {
    const toolId = toolIdOfPage.get(page) ?? null;
    if (load.files === 0) {
      rows.push({
        page,
        rank: 0,
        key: '',
        text: `page ${page}: no JavaScript file was loaded, so it cannot be checked`,
      });
    }
    for (const { file, reason } of load.unattributed) {
      rows.push({ page, rank: 1, key: file, text: `page ${page}: ${file} cannot be attributed: ${reason}` });
    }
    for (const pkg of load.packages) {
      const who = owners.get(pkg);
      if (!who) continue;
      if (toolId !== null && who.has(toolId)) continue;
      const names = [...who].sort(byText);
      const shown =
        names.length > 8 ? `${names.slice(0, 8).join(', ')} and ${names.length - 8} more` : names.join(', ');
      rows.push({ page, rank: 2, key: pkg, text: `page ${page} loads ${pkg}, declared only by ${shown}` });
    }
  }
  return rows.sort((a, b) => byText(a.page, b.page) || a.rank - b.rank || byText(a.key, b.key)).map((r) => r.text);
}

/** The detector run on synthetic data, so a broken detector fails loudly instead of passing everything. */
function site02SelfTest(): string[] {
  const issues: string[] = [];
  const load = (pkgs: string[], files = 1): PageLoad => ({ files, packages: new Set(pkgs), unattributed: [] });
  const tools = new Map<string, string | null>([
    ['/tools/a', 'a'],
    ['/tools/b', 'b'],
    ['/', null],
  ]);

  const leak = site02Problems(
    new Map([['p', new Set(['a'])]]),
    new Map([
      ['/tools/a', load(['p'])],
      ['/tools/b', load(['p'])],
    ]),
    tools,
  );
  if (leak.length !== 1 || leak[0] !== 'page /tools/b loads p, declared only by a') {
    issues.push(`adjacency: expected exactly one problem naming /tools/b and p, got ${JSON.stringify(leak)}`);
  }

  const shared = site02Problems(
    new Map([['p', new Set(['a', 'b'])]]),
    new Map([
      ['/tools/a', load(['p'])],
      ['/tools/b', load(['p'])],
    ]),
    tools,
  );
  if (shared.length !== 0)
    issues.push(`a shared package declared by both pages was reported: ${JSON.stringify(shared)}`);

  const site = site02Problems(new Map([['p', new Set(['a'])]]), new Map([['/', load(['p'])]]), tools);
  if (site.length !== 1 || site[0] !== 'page / loads p, declared only by a') {
    issues.push(`a non-tool page loading a tracked package was not reported once: ${JSON.stringify(site)}`);
  }

  const untracked = site02Problems(new Map([['p', new Set(['a'])]]), new Map([['/', load(['react'])]]), tools);
  if (untracked.length !== 0) issues.push(`an untracked package was reported: ${JSON.stringify(untracked)}`);

  const empty = site02Problems(
    new Map(),
    new Map([
      [
        '/tools/a',
        {
          files: 1,
          packages: new Set<string>(),
          unattributed: [{ file: 'x.js', reason: 'no sourceMappingURL comment' }],
        },
      ],
      ['/tools/b', load([], 0)],
    ]),
    tools,
  );
  if (
    empty.length !== 2 ||
    empty[0] !== 'page /tools/a: x.js cannot be attributed: no sourceMappingURL comment' ||
    empty[1] !== 'page /tools/b: no JavaScript file was loaded, so it cannot be checked'
  ) {
    issues.push(`unmappable or empty pages were not reported: ${JSON.stringify(empty)}`);
  }

  const sorted = site02Problems(
    new Map([
      ['z', new Set(['a'])],
      ['m', new Set(['a'])],
    ]),
    new Map([
      ['/tools/b', load(['z', 'm'])],
      ['/', load(['z'])],
    ]),
    tools,
  );
  if (
    JSON.stringify(sorted) !==
    JSON.stringify([
      'page / loads z, declared only by a',
      'page /tools/b loads m, declared only by a',
      'page /tools/b loads z, declared only by a',
    ])
  ) {
    issues.push(`the report is not sorted by page and then package: ${JSON.stringify(sorted)}`);
  }

  if (
    pkgOf('../../../node_modules/.pnpm/@wasm-fmt+gofmt@0.7.3/node_modules/@wasm-fmt/gofmt/gofmt.wasm?url&inline') !==
    '@wasm-fmt/gofmt'
  ) {
    issues.push('pkgOf did not name the scoped package behind a pnpm store path');
  }
  if (pkgOf('../../../tools/go-formatter/src/index.ts') !== null)
    issues.push('pkgOf named a package for a project file');
  if (pkgOf('../../node_modules/.pnpm/a@1/node_modules/a/node_modules/b/index.js') !== 'b') {
    issues.push('pkgOf did not take the last node_modules level');
  }
  return issues;
}

/** Positive controls: these pairs must be seen, so a detector that sees nothing cannot pass. */
const SITE02_CONTROLS: [string, string][] = [
  ['loan-calculator', 'decimal.js'],
  ['markdown-formatter', 'prettier'],
  ['go-formatter', '@wasm-fmt/gofmt'],
  // The other five code formatters: each engine package must be seen on its own page. Prettier and its PHP plugin are
  // plain JavaScript and the other four are WebAssembly engines inlined into the page chunk, so a blind spot for either
  // kind of package shows here.
  ['python-formatter', '@wasm-fmt/ruff_fmt'],
  ['shell-formatter', '@wasm-fmt/shfmt'],
  ['c-family-formatter', '@wasm-fmt/clang-format'],
  ['dart-formatter', '@wasm-fmt/dart_fmt'],
  ['php-formatter', 'prettier'],
  ['php-formatter', '@prettier/plugin-php'],
];

/**
 * Declared (tool, package) pairs whose package is never loaded as a module on that tool's page. Each has a reason and
 * names its evidence: `marker` is a string that occurs in the installed package's `dataFile` and must also occur in the
 * text of the JavaScript the tool's page loads, so an exemption holds only while the package's data really is bundled.
 */
const SITE02_UNSEEN_EXEMPT: { tool: string; pkg: string; reason: string; marker: string; dataFile: string }[] = [
  {
    tool: 'mime-types',
    pkg: 'mime-db',
    reason:
      'the tool imports only mime-db/db.json and mime-db/package.json, which are JSON data files; the table is bundled into the tool page chunk, but the build writes no source-map entry for a JSON module, so the package never appears in any map',
    // A media type that only mime-db's table lists: neither the tool's own code nor its tests contain it.
    marker: 'x-conference/x-cooltalk',
    dataFile: 'db.json',
  },
];

/** Problems with an exemption: its marker must be in the package's own data file and in the text of a JavaScript file the page loads. */
async function exemptionEvidenceProblems(
  request: APIRequestContext,
  exemption: (typeof SITE02_UNSEEN_EXEMPT)[number],
  pageUrls: string[],
): Promise<string[]> {
  const label = `exemption ${exemption.tool} / ${exemption.pkg}`;
  const dir = findInstalledDir(realpathSync(join(root, 'tools', exemption.tool)), exemption.pkg);
  if (!dir) return [`${label}: the package is not installed`];
  const data = existsSync(join(dir, exemption.dataFile)) ? readFileSync(join(dir, exemption.dataFile), 'utf8') : '';
  if (!data.includes(exemption.marker)) {
    return [
      `${label}: the marker is not in ${exemption.pkg}/${exemption.dataFile}, so it is no evidence of the package`,
    ];
  }
  for (const url of [...new Set(pageUrls)].sort(byText)) {
    const response = await request.get(url);
    if (response.ok() && (await response.text()).includes(exemption.marker)) return [];
  }
  return [`${label}: no JavaScript file the page loads contains the marker, so the package is not shown to be bundled`];
}

function getCrawl(browser: Browser, baseURL: string): Promise<CrawlState> {
  if (!crawlPromise) crawlPromise = crawlAllPages(browser, baseURL);
  return crawlPromise;
}

test.describe.configure({ mode: 'serial' });

test.describe('the complete 192-tool catalog loads clean JavaScript', () => {
  test('every one of the 192 catalog tools has a built page that loads its tool without an error', async ({
    browser,
    baseURL,
  }, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium', CHROMIUM_ONLY_REASON);
    assertDenylistAvailable();
    test.setTimeout(20 * 60_000);

    const crawl = await getCrawl(browser, baseURL!);
    testInfo.annotations.push({ type: 'crawl-duration-ms', description: String(crawl.durationMs) });

    const problems: string[] = [];
    for (const id of ALL_IDS) {
      const result = crawl.pages.get(id);
      if (!result) {
        problems.push(`${id}: never crawled`);
        continue;
      }
      if (!result.resetAppeared) problems.push(`${id}: the Reset button never appeared`);
      if (result.crashed) problems.push(`${id}: the page shows a crash note`);
      if (result.pageErrors.length > 0) problems.push(`${id}: uncaught page error(s): ${result.pageErrors.length}`);
    }

    expect(problems, `every catalog tool page must load its tool without error:\n${problems.join('\n')}`).toEqual([]);
  });

  test('every tool page loads nothing from another origin', async ({ browser, baseURL }, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium', CHROMIUM_ONLY_REASON);
    assertDenylistAvailable();
    test.setTimeout(20 * 60_000);

    const crawl = await getCrawl(browser, baseURL!);

    const problems: string[] = [];
    for (const id of ALL_IDS) {
      const result = crawl.pages.get(id);
      if (!result) continue;
      if (result.offOriginRequests.length > 0) {
        problems.push(`${id}: ${result.offOriginRequests.length} off-origin request(s)`);
      }
    }

    expect(problems, `no tool page may load anything from another origin:\n${problems.join('\n')}`).toEqual([]);
  });

  test('every chunk the entry bundle maps to a tool page is loaded with that page', async ({
    browser,
    baseURL,
  }, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium', CHROMIUM_ONLY_REASON);
    assertDenylistAvailable();
    test.setTimeout(20 * 60_000);

    const crawl = await getCrawl(browser, baseURL!);

    const problems: string[] = [];
    for (const id of ALL_IDS) {
      const result = crawl.pages.get(id);
      const mappedPathnames = crawl.toolChunkPathnames.get(id) ?? [];
      if (!result) {
        problems.push(`${id}: never crawled`);
        continue;
      }
      const loaded = new Set(result.jsPathnames);
      const missing = mappedPathnames.filter((p) => !loaded.has(p));
      if (missing.length > 0) problems.push(`${id}: ${missing.length} mapped chunk(s) not observed loading`);
    }

    expect(
      problems,
      `every chunk the entry bundle maps to a tool page must be loaded with that page:\n${problems.join('\n')}`,
    ).toEqual([]);
  });

  test('every JavaScript file the 192 tool pages load, inline workers included, carries no denylisted reference', async ({
    browser,
    baseURL,
  }, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium', CHROMIUM_ONLY_REASON);
    assertDenylistAvailable();
    test.setTimeout(20 * 60_000);

    const crawl = await getCrawl(browser, baseURL!);

    // The union of every JavaScript file actually observed loading with any
    // page, plus every file the entry bundle maps to any tool page (a
    // defensive superset in case a mapped chunk was not observed loading --
    // that gap is already reported by the previous test, not silently
    // dropped from this scan).
    const origin = new URL(baseURL!).origin;
    const allUrls = new Set(crawl.loadedJsUrls);
    for (const pathnames of crawl.toolChunkPathnames.values()) {
      for (const pathname of pathnames) allUrls.add(new URL(pathname, origin).toString());
    }
    // The entry script itself is part of what every page loads.
    allUrls.add(new URL(crawl.entryScriptPathname, origin).toString());

    const context = await browser.newContext();
    const request = context.request;

    const report: { file: string; bytes: number; decodedLiterals: number }[] = [];
    const problems: string[] = [];

    for (const url of allUrls) {
      const response = await request.get(url);
      const text = await response.text();
      const { plainHit, decodedHit, decodedLiteralCount } = scanTextForDenylist(text);
      report.push({ file: new URL(url).pathname, bytes: text.length, decodedLiterals: decodedLiteralCount });
      if (plainHit) problems.push(`${new URL(url).pathname}: a denylisted reference in plain text`);
      if (decodedHit) problems.push(`${new URL(url).pathname}: a denylisted reference in decoded base64 text`);
    }

    await context.close();

    await testInfo.attach('scanned-files-report', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });

    expect(
      problems,
      `no scanned file may carry a denylisted reference (files and text/decoded kind named only, never the match):\n${problems.join('\n')}`,
    ).toEqual([]);
  });

  test('SITE-02: a declared runtime package loads only on the pages of tools that declare it, and the home, catalog, tools index, about and privacy pages load none', async ({
    browser,
    baseURL,
  }, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium', CHROMIUM_ONLY_REASON);
    test.setTimeout(20 * 60_000);

    const selfTest = site02SelfTest();
    if (selfTest.length > 0) throw new Error(`the SITE-02 detector self-test failed:\n${selfTest.join('\n')}`);

    const crawl = await getCrawl(browser, baseURL!);
    const origin = new URL(baseURL!).origin;

    const setup: string[] = [];
    const declared = readDeclaredDependencies(setup);
    const owners = ownersOf(declared, setup);

    const context = await browser.newContext();
    const request = context.request;
    const cache = new Map<string, ScriptPackages>();

    const loadOf = async (urls: string[]): Promise<PageLoad> => {
      const load: PageLoad = { files: 0, packages: new Set<string>(), unattributed: [] };
      for (const url of [...new Set(urls)].sort(byText)) {
        load.files += 1;
        const result = await packagesOfScript(request, url, cache);
        for (const pkg of result.packages) load.packages.add(pkg);
        for (const reason of result.failures) load.unattributed.push({ file: basename(new URL(url).pathname), reason });
      }
      return load;
    };

    const loadedByPage = new Map<string, PageLoad>();
    const toolIdOfPage = new Map<string, string | null>();
    for (const id of ALL_IDS) {
      const result = crawl.pages.get(id);
      const mapped = crawl.toolChunkPathnames.get(id) ?? [];
      const urls = [...(result?.jsPathnames ?? []), ...mapped].map((p) => new URL(p, origin).toString());
      loadedByPage.set(`/tools/${id}`, await loadOf(urls));
      toolIdOfPage.set(`/tools/${id}`, id);
    }
    for (const path of SITE_PAGES) {
      loadedByPage.set(path, await loadOf(crawl.sitePages.get(path) ?? []));
      toolIdOfPage.set(path, null);
    }
    await context.close();

    const problems: string[] = [...new Set(setup)].sort(byText);
    problems.push(...site02Problems(owners, loadedByPage, toolIdOfPage));

    // The positive controls and every declared pair: a package the detector never sees fails loudly.
    for (const [tool, pkg] of SITE02_CONTROLS) {
      if (!loadedByPage.get(`/tools/${tool}`)?.packages.has(pkg)) {
        problems.push(`control: page /tools/${tool} was not seen loading ${pkg}`);
      }
    }
    const exempt = new Set(SITE02_UNSEEN_EXEMPT.map((e) => `${e.tool}\n${e.pkg}`));
    // An exemption stands only while its evidence holds: the package's own data is in the page's JavaScript.
    const evidenceContext = await browser.newContext();
    for (const exemption of SITE02_UNSEEN_EXEMPT) {
      const result = crawl.pages.get(exemption.tool);
      const mapped = crawl.toolChunkPathnames.get(exemption.tool) ?? [];
      const urls = [...(result?.jsPathnames ?? []), ...mapped].map((p) => new URL(p, origin).toString());
      problems.push(...(await exemptionEvidenceProblems(evidenceContext.request, exemption, urls)));
    }
    await evidenceContext.close();
    for (const id of ALL_IDS) {
      for (const pkg of declared.get(id) ?? []) {
        if (loadedByPage.get(`/tools/${id}`)?.packages.has(pkg)) continue;
        if (exempt.has(`${id}\n${pkg}`)) continue;
        problems.push(`page /tools/${id} declares ${pkg} but was not seen loading it`);
      }
    }

    const report: Record<string, string[]> = {};
    for (const [page, load] of [...loadedByPage].sort((a, b) => byText(a[0], b[0]))) {
      report[page] = [...load.packages].filter((p) => owners.has(p)).sort(byText);
    }
    await testInfo.attach('site02-packages-by-page', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });
    testInfo.annotations.push({ type: 'tracked-packages', description: String(owners.size) });
    testInfo.annotations.push({ type: 'crawl-duration-ms', description: String(crawl.durationMs) });

    expect(
      problems,
      `every page may load only the declared packages of its own tool (page, package and owners named):\n${problems.join('\n')}`,
    ).toEqual([]);
  });
});
