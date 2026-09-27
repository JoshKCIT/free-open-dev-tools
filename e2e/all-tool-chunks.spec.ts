import { test, expect, type Browser, type TestInfo } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * D-141: the release-wide proof that the complete 144-tool catalog's
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
 * so the one expensive crawl over all 144 pages happens exactly once and is
 * shared by every test in this file, rather than once per test.
 */

const CHROMIUM_ONLY_REASON = 'one engine is enough for a byte scan';

const rel = (path: string) => path.replace(/^\//, '');

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

  // 4. Visit every one of the 144 tool pages, once each, in its own fresh
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

  return {
    entryScriptPathname,
    fileTable,
    toolChunkPathnames,
    pages,
    loadedJsUrls,
    durationMs: Date.now() - startedAt,
  };
}

function getCrawl(browser: Browser, baseURL: string): Promise<CrawlState> {
  if (!crawlPromise) crawlPromise = crawlAllPages(browser, baseURL);
  return crawlPromise;
}

test.describe.configure({ mode: 'serial' });

test.describe('the complete 144-tool catalog loads clean JavaScript', () => {
  test('every one of the 144 catalog tools has a built page that loads its tool without an error', async ({
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

  test('every JavaScript file the 144 tool pages load, inline workers included, carries no denylisted reference', async ({
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
});
