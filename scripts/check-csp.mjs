#!/usr/bin/env node
/**
 * Build gate: every page's content security policy must match what the page's built code actually does.
 *
 * This is what stops a later tool from shipping a page whose declared needs (workers, WebAssembly, run-time code
 * generation, inline preview styles, the Mermaid frame) disagree with its code. It runs as the last step of the
 * production build, so no build finishes unless:
 *
 * - every `src/tools/<id>.ts` entry in Vite's manifest has a closure of built chunks (its own code and everything it
 *   loads, never expanding the shared shell chunks) whose scanned tokens agree with that tool's `needs` declaration in
 *   `tools/<id>/src/meta.json`, apart from the proven false positives in `scripts/csp-acks.json`;
 * - run-time code generation appears only on the fixed list `EVAL_PAGES`, and the WebAssembly inspector
 *   never declares WebAssembly or code generation;
 * - no network call (the fetch class) appears in any page closure without a reviewed acknowledgement, and none of
 *   the four code-behaviour token classes appears in the shell chunks;
 * - every script chunk in the manifest is in the shell or in some tool page's closure, so none goes unscanned;
 * - every written HTML file opens its head with exactly one policy, equal to the one the page's needs produce.
 *
 * Every check calls note() and keeps going; one report-and-exit block runs at the end. The gate never prints text it
 * matched in a built chunk, only the file, the page and the token class.
 *
 * Flags: `--keep-manifest` leaves `dist/.vite` in place after a pass (debugging only); `--suggest` prints the needs
 * each page's code implies, as JSON, and judges nothing; `--live <url>` repeats the page structure check on a running
 * site; `--dist <folder>` names the build folder (default `apps/web/dist`).
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Buffer } from 'node:buffer';
import { setTimeout as sleep } from 'node:timers/promises';
import { ROOT } from './lib/catalog.mjs';
import { NEEDS, inlineScriptHashes, mermaidFrameHashes, parsePolicy, policyFor } from './lib/csp.mjs';

/**
 * Pages that may use run-time code generation (`'unsafe-eval'`). Fixed here on purpose: a change needs an edit to this
 * list and to its unit test.
 */
export const EVAL_PAGES = Object.freeze([
  'docker-compose-validator',
  'docker-run-to-compose',
  'font-inspector',
  'github-actions-validator',
  'json-schema-validator',
  'k8s-validator',
  'openapi-validator',
  'sass-less-compiler',
]);

/** The only page that may (and must) declare the Mermaid frame. */
export const MERMAID_FRAME_PAGES = Object.freeze(['mermaid-renderer']);

/** Pages that may never declare WebAssembly or run-time code generation, so the browser proves they never need it. */
export const NO_COMPILE_PAGES = Object.freeze(['wasm-inspector']);

/**
 * Ids the fixed lists may name before their page exists. Such an id is reported and does not fail. Both ids on this
 * list have pages now, so a real build reports none.
 */
export const RESERVED_IDS = Object.freeze(['font-inspector', 'wasm-inspector']);

/**
 * The token classes scanned for in built chunks, raw text included (documentation strings count).
 *
 * Each class names the forms minified code really uses, while a method of another object (`a.fetch(`, `this.eval(`)
 * or a longer name (`xWorker(`, `isFunction(`) stays clean:
 * - workers: a dedicated or a shared worker;
 * - wasm: the compiling calls, a computed member of `WebAssembly`, and `WebAssembly` copied into a variable or
 *   destructured as minified code writes it, with no space (`W=WebAssembly;`, `{instantiate:i}=WebAssembly`), so the
 *   word in a sentence such as "a worker, WebAssembly, or" on a site page is not taken for code;
 * - eval: `new Function(`, a bare `Function(` call, the bare `Function` constructor used as a value (the first argument
 *   of a call or the right side of an assignment, written directly after `(` or an assignment `=` and directly before
 *   `,`, `)`, `;`, `}` or `]`, which is how compiled engines reach it; the name inside an array, as a later argument or
 *   as an object value is not matched, because libraries list it for type checks), the constructor reached through its
 *   own member (`Function.apply(`, `Function.call(`, `Function.bind(`, never `Function.prototype...`), read from the
 *   global object (`globalThis.Function(`, `self.Function(`, `window.Function(`), called through a comma
 *   (`(0,Function)(`) or returned (`return Function` or `=>Function` directly before `,`, `)`, `;`, `}` or `]`), direct
 *   and indirect eval (`eval(`, `(0,eval)(`, `globalThis.eval(`), a timer given a string, and `.constructor("...")`;
 * - fetch, the network class: `fetch(`, any mention of `XMLHttpRequest` (minified code often reaches it as a member
 *   such as `new g.XMLHttpRequest`), `new WebSocket(`, `new EventSource(` and `sendBeacon(`.
 */
export const TOKENS = Object.freeze([
  ['workers', /\b(?:Shared)?Worker\(/],
  [
    'wasm',
    /WebAssembly\.(?:instantiate|compile|Module|instantiateStreaming|compileStreaming)\b|WebAssembly\s*\[|[=:]WebAssembly(?:[;,)}]|$)/,
  ],
  [
    'eval',
    /new Function\(|(?:^|[^A-Za-z0-9_.$])Function\(|(?:\(|(?<![=!<>])=)Function(?=[,);}\]])|(?<![A-Za-z0-9_$.])Function\.(?:apply|call|bind)\(|(?<![A-Za-z0-9_$.])(?:globalThis|window|self)\.Function\(|\(\s*0\s*,\s*Function\s*\)\s*\(|(?:(?<![A-Za-z0-9_$.])return\s+|=>\s*)Function(?=[,);}\]])|(?:^|[^A-Za-z0-9_$])eval\s*\)\s*\(|(?:^|[^A-Za-z0-9_.$])eval\(|(?:globalThis|window|self)\.eval\(|set(?:Timeout|Interval)\(\s*["'`]|\.constructor\(\s*["'`]/,
  ],
  ['fetch', /(?:^|[^A-Za-z0-9_.$])fetch\(|XMLHttpRequest|new WebSocket\(|new EventSource\(|sendBeacon\(/],
  ['sandboxed-html', /kind\s*:\s*["'`]sandboxed-html["'`]/],
]);

/** The token classes a reviewed acknowledgement may name. */
const ACK_CLASSES = Object.freeze(['eval', 'fetch', 'wasm']);
const ACK_REASON_MAX = 200;

/** The tool page entries in Vite's manifest: `src/tools/<id>.ts`. */
const PAGE_ENTRY = /^src\/tools\/([^/]+)\.ts$/;

/**
 * Splits a manifest into the shell and one closure per tool page.
 *
 * The shell is every chunk reachable from the `index.html` entry through static imports only. A tool page's closure is
 * its entry plus everything it imports or loads on demand, followed transitively but never expanding a shell chunk:
 * the entry chunk lists every tool as a dynamic import, so expanding it would make every closure the whole site.
 *
 * @param {Record<string, { file: string, imports?: string[], dynamicImports?: string[] }>} manifest
 * @returns {{ shell: Set<string>, pages: Map<string, Set<string>> }} manifest keys, not file names
 */
export function closures(manifest) {
  const shell = new Set();
  if (manifest['index.html']) {
    const queue = ['index.html'];
    shell.add('index.html');
    while (queue.length > 0) {
      const key = queue.pop();
      for (const next of manifest[key]?.imports ?? []) {
        if (!shell.has(next)) {
          shell.add(next);
          queue.push(next);
        }
      }
    }
  }

  const pages = new Map();
  for (const key of Object.keys(manifest)) {
    const match = PAGE_ENTRY.exec(key);
    if (!match) continue;
    const seen = new Set([key]);
    const queue = [key];
    while (queue.length > 0) {
      const current = queue.pop();
      const entry = manifest[current];
      for (const next of [...(entry?.imports ?? []), ...(entry?.dynamicImports ?? [])]) {
        if (shell.has(next) || seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    pages.set(match[1], seen);
  }
  return { shell, pages };
}

/**
 * The script chunks no closure reaches: in neither the shell nor any tool page's closure, so nobody reads their tokens.
 * A lazily loaded site page or shared component that is not a tool entry would land here.
 *
 * @param {Record<string, { file: string }>} manifest
 * @param {{ shell: Set<string>, pages: Map<string, Set<string>> }} split what `closures` returned for that manifest
 * @returns {string[]} the built file names, sorted
 */
export function unreachedChunks(manifest, { shell, pages }) {
  const reached = new Set(shell);
  for (const keys of pages.values()) for (const key of keys) reached.add(key);
  const reachedFiles = new Set([...reached].map((key) => manifest[key]?.file).filter(Boolean));
  const files = new Set();
  for (const [key, entry] of Object.entries(manifest)) {
    const file = entry?.file ?? '';
    if (!reached.has(key) && /\.m?js$/.test(file) && !reachedFiles.has(file)) files.add(file);
  }
  return [...files].sort();
}

/**
 * The token classes present in a chunk's text.
 *
 * @param {string} text
 * @returns {Set<string>}
 */
export function scanTokens(text) {
  const found = new Set();
  for (const [name, pattern] of TOKENS) if (pattern.test(text)) found.add(name);
  return found;
}

/**
 * The rule table for one page.
 *
 * @param {{ id: string, needs: readonly string[], tokens: Iterable<string>, acks: Iterable<string> }} input
 *   `needs` is the page's declaration, `tokens` what its closure holds, `acks` the token classes acknowledged for it.
 * @returns {string[]} one message per broken rule; empty when the page passes
 */
export function judgePage({ id, needs, tokens, acks }) {
  const problems = [];
  const fail = (message) => problems.push(`${id}: ${message}`);
  const declared = new Set(needs ?? []);
  const seen = new Set(tokens ?? []);
  const acked = new Set(acks ?? []);

  for (const term of declared) {
    if (!NEEDS.includes(term)) {
      fail(`needs holds "${term}", which is not on the closed list: ${NEEDS.join(', ')}.`);
    }
  }

  // The three grants a token can justify.
  const meaning = {
    workers: 'a background worker (Worker or SharedWorker)',
    wasm: 'WebAssembly compilation',
    eval: 'run-time code generation (new Function or eval)',
  };
  for (const term of ['workers', 'wasm', 'eval']) {
    const has = seen.has(term);
    const dec = declared.has(term);
    const ack = acked.has(term);
    if (ack && dec) {
      fail(
        `"${term}" is both declared in needs and acknowledged in scripts/csp-acks.json. Keep one: remove the acknowledgement.`,
      );
    } else if (ack && !has) {
      fail(
        `the "${term}" acknowledgement in scripts/csp-acks.json is stale: the built code no longer holds that token. Remove the entry.`,
      );
    } else if (dec && !has) {
      fail(
        `needs declares "${term}" but the built code never uses ${meaning[term]}, so the grant is unnecessary. Remove it from meta.json.`,
      );
    } else if (has && !dec && !ack) {
      // A page that declares eval already allows WebAssembly to compile, so it need not declare wasm as well.
      if (term === 'wasm' && declared.has('eval')) continue;
      fail(
        `the built code uses ${meaning[term]} but needs does not declare "${term}". Declare it in meta.json, or acknowledge a proven false positive in scripts/csp-acks.json.`,
      );
    }
  }

  // A network call in a page closure always needs a reviewed reason.
  if (acked.has('fetch') && !seen.has('fetch')) {
    fail(
      'the "fetch" acknowledgement in scripts/csp-acks.json is stale: the built code no longer holds that token. Remove the entry.',
    );
  } else if (seen.has('fetch') && !acked.has('fetch')) {
    fail(
      'the built code holds a network call (the fetch class: fetch, XMLHttpRequest, WebSocket, EventSource or sendBeacon) and scripts/csp-acks.json has no reviewed reason for this page.',
    );
  }

  // Inline preview styles follow the preview block exactly.
  if (declared.has('sandboxed-html') && !seen.has('sandboxed-html')) {
    fail(
      'needs declares "sandboxed-html" but the built code never shows a sandboxed preview, so the grant is unnecessary.',
    );
  } else if (seen.has('sandboxed-html') && !declared.has('sandboxed-html')) {
    fail('the built code shows a sandboxed preview but needs does not declare "sandboxed-html".');
  }

  // The Mermaid frame is decided by id.
  const frameAllowed = MERMAID_FRAME_PAGES.includes(id);
  if (declared.has('mermaid-frame') && !frameAllowed) {
    fail(`only ${MERMAID_FRAME_PAGES.join(', ')} may declare "mermaid-frame".`);
  } else if (frameAllowed && !declared.has('mermaid-frame')) {
    fail('this page must declare "mermaid-frame": its diagram frame needs the two script hashes.');
  }

  // Run-time code generation is allowed only on the fixed list.
  const evalAllowed = EVAL_PAGES.includes(id);
  if (declared.has('eval') && !evalAllowed) {
    fail(
      'needs declares "eval", but run-time code generation is allowed only on the fixed list in scripts/check-csp.mjs.',
    );
  } else if (evalAllowed && !declared.has('eval')) {
    fail('this page is on the fixed run-time code generation list and must declare "eval".');
  }

  // The WebAssembly inspector proves it never compiles anything.
  if (NO_COMPILE_PAGES.includes(id)) {
    for (const term of ['wasm', 'eval']) {
      if (declared.has(term)) fail(`this page may never declare "${term}": the browser must prove it never compiles.`);
    }
  }
  return problems;
}

/**
 * The rule for the shared shell chunks: none of the four code-behaviour tokens may appear in them.
 *
 * @param {Iterable<string>} tokens
 * @returns {string[]} the token classes found
 */
export function shellFindings(tokens) {
  const seen = new Set(tokens);
  return ['workers', 'wasm', 'eval', 'fetch'].filter((name) => seen.has(name));
}

const POLICY_META = /<meta\s[^>]*http-equiv\s*=\s*["']?Content-Security-Policy["']?[^>]*>/gi;
const CHARSET_META = /^<meta\s+charset\s*=/i;
const FORBIDDEN_IN_META = ['frame-ancestors', 'report-uri', 'report-to', 'sandbox'];

/** One attribute of a start tag: its name, then a double-quoted, single-quoted or unquoted value, or no value. */
const ATTRIBUTE = /\s([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/**
 * The policy text of a page's policy meta: null when there is no policy meta, and an empty string when the meta has
 * no `content` attribute the browser would read. The tag is read attribute by attribute the way a browser reads it,
 * so a single-quoted or unquoted value is found, a lookalike such as `data-content` is never taken for it, and the
 * first `content` attribute wins when there are two.
 */
export function policyOfHtml(html) {
  const tag = new RegExp(POLICY_META.source, 'i').exec(html);
  if (!tag) return null;
  const attributes = tag[0].replace(/^<meta/i, '').replace(/\/?>$/, '');
  for (const [, name, double, single, bare] of attributes.matchAll(ATTRIBUTE)) {
    if (name.toLowerCase() === 'content') return double ?? single ?? bare ?? '';
  }
  return '';
}

/** A policy cut into `[name, tokens]` pairs in written order, duplicates kept. */
function directivesOf(policy) {
  return policy
    .split(';')
    .map((part) => part.trim().split(/\s+/).filter(Boolean))
    .filter((tokens) => tokens.length > 0)
    .map(([name, ...sources]) => [name, sources]);
}

/**
 * The page structure rules for one written HTML file.
 *
 * @param {{ file: string, html: string, needs: readonly string[], frameHashes?: readonly string[] }} input
 *   `file` is only a label for messages; `needs` is the page's declaration from its meta.json
 * @returns {string[]} one message per broken rule; empty when the file passes
 */
export function checkHtml({ file, html, needs, frameHashes = [] }) {
  const problems = [];
  const fail = (message) => problems.push(`${file}: ${message}`);

  const metas = html.match(POLICY_META) ?? [];
  if (metas.length !== 1) {
    fail(
      metas.length === 0
        ? 'the page has no policy meta, so nothing restricts what it loads.'
        : `the page has ${metas.length} policy metas; exactly one is allowed.`,
    );
  }

  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (!head) {
    fail('the page has no head element.');
  } else {
    const start = head.index + head[0].length;
    const rest = html.slice(start);
    const lead = /^\s*/.exec(rest)[0].length;
    const first = new RegExp(`^${POLICY_META.source}`, 'i').exec(rest.slice(lead));
    if (!first) {
      fail('the policy meta is not the first element of the head (only white space may come before it).');
    } else {
      const afterFirst = lead + first[0].length;
      const gap = /^\s*/.exec(rest.slice(afterFirst))[0].length;
      const second = /^<meta\b[^>]*>/i.exec(rest.slice(afterFirst + gap));
      if (!second || !CHARSET_META.test(second[0])) {
        fail('the charset meta is not the second element of the head, straight after the policy meta.');
      } else {
        const end = start + afterFirst + gap + second[0].length;
        if (Buffer.byteLength(html.slice(0, end), 'utf8') > 1024) {
          fail('the charset meta ends after byte 1,024, where the browser stops looking for it.');
        }
      }
    }
  }

  const policy = policyOfHtml(html);
  if (policy !== null && policy.trim() === '') {
    // A policy meta whose policy cannot be read would skip every rule below, so it fails here instead.
    fail('the policy meta has no content attribute the gate can read, so its policy cannot be checked.');
  } else if (policy !== null) {
    const directives = directivesOf(policy);
    const names = directives.map(([name]) => name);
    for (const name of new Set(names)) {
      if (names.filter((n) => n === name).length > 1)
        fail(`the policy repeats the directive ${name}; a browser ignores the second.`);
    }
    for (const name of FORBIDDEN_IN_META) {
      if (names.includes(name)) fail(`the policy holds ${name}, which a browser ignores in a meta policy.`);
    }
    const parsed = parsePolicy(policy);

    const worker = (parsed.get('worker-src') ?? []).join(' ');
    if (worker !== "'none'" && worker !== 'blob:') {
      fail(`worker-src must be exactly 'none' or blob:, found "${worker}".`);
    }
    for (const [name, sources] of directives) {
      if (name !== 'style-src' && sources.includes("'unsafe-inline'")) {
        fail(`${name} allows 'unsafe-inline'; it is allowed only in style-src.`);
      }
      for (const source of sources) {
        if (!source.startsWith("'") && source !== 'data:' && source !== 'blob:') {
          fail(`${name} allows the outside source ${source}.`);
        }
      }
    }
    for (const name of ['script-src', 'worker-src']) {
      for (const source of parsed.get(name) ?? []) {
        if (source === 'data:') fail(`${name} allows data:.`);
      }
    }
    if ((parsed.get('script-src') ?? []).includes('blob:')) fail('script-src allows blob:.');
    if ((parsed.get('script-src') ?? []).includes("'unsafe-eval'") && !needs.includes('eval')) {
      fail("script-src allows 'unsafe-eval' on a page that does not declare eval.");
    }

    const hashes = inlineScriptHashes(html);
    const scriptSources = parsed.get('script-src') ?? [];
    for (const hash of hashes) {
      if (!scriptSources.includes(`'${hash}'`)) {
        fail('an inline script is not covered by a hash in script-src, so the browser will refuse it.');
      }
    }

    let expected;
    try {
      expected = policyFor({ needs, scriptHashes: hashes, frameHashes });
    } catch (error) {
      fail(`the policy for this page's needs cannot be built: ${error.message}`);
    }
    if (expected !== undefined && expected !== policy) {
      fail(
        "the policy is not the one this page's declared needs produce (compare it with policyFor in scripts/lib/csp.mjs).",
      );
    }
  }
  return problems;
}

/** Checks a reviewed acknowledgement file's shape; returns the entries and the problems found. */
function readAcks(path, note) {
  const empty = { wasm: {}, eval: {}, fetch: {} };
  if (!existsSync(path)) {
    note('scripts/csp-acks.json is missing.');
    return empty;
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    note(`scripts/csp-acks.json is not valid JSON: ${error.message}`);
    return empty;
  }
  const acks = { ...empty };
  for (const [klass, entries] of Object.entries(raw)) {
    if (!ACK_CLASSES.includes(klass)) {
      note(`scripts/csp-acks.json names the class "${klass}"; the classes are ${ACK_CLASSES.join(', ')}.`);
      continue;
    }
    acks[klass] = {};
    for (const [id, reason] of Object.entries(entries ?? {})) {
      if (typeof reason !== 'string' || reason.trim() === '') {
        note(
          `scripts/csp-acks.json: ${klass} / ${id} has no reason. Say in one sentence what the matched code is and why the page never runs it.`,
        );
      } else if (/[\r\n]/.test(reason)) {
        note(`scripts/csp-acks.json: ${klass} / ${id} has a line break in its reason; keep it to one line.`);
      } else if (reason.length > ACK_REASON_MAX) {
        note(
          `scripts/csp-acks.json: ${klass} / ${id} has a reason of ${reason.length} characters; the limit is ${ACK_REASON_MAX}.`,
        );
      }
      acks[klass][id] = reason;
    }
  }
  return acks;
}

/** Every `.html` file under a folder, as forward-slash paths relative to it, sorted. `.vite` is skipped. */
function htmlFiles(dist) {
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === '.vite') continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.html')) found.push(relative(dist, full).split('\\').join('/'));
    }
  };
  walk(dist);
  return found.sort();
}

/** The route a written file serves: `a/b.html` and `a/b/index.html` are both `a/b`; `index.html` is the home route. */
function routeOf(path) {
  if (path === 'index.html') return '';
  return path.replace(/\/index\.html$/, '').replace(/\.html$/, '');
}

const TOOL_ROUTE = /^tools\/([^/]+)$/;
const readNeeds = (id, note) => {
  const metaPath = join(ROOT, 'tools', id, 'src', 'meta.json');
  if (!existsSync(metaPath)) {
    note(`tools/${id}/src/meta.json is missing for the built page ${id}, so its needs cannot be read.`);
    return [];
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  return Array.isArray(meta.needs) ? meta.needs : [];
};

const sortedDistinct = (policies) => {
  const counts = new Map();
  for (const policy of policies) counts.set(policy, (counts.get(policy) ?? 0) + 1);
  return [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
};

/** Cached frame hashes: only computed when some page declares the Mermaid frame. */
function frameHashesFor(needsList, note) {
  if (!needsList.some((needs) => needs.includes('mermaid-frame'))) return [];
  try {
    return mermaidFrameHashes(ROOT);
  } catch (error) {
    note(`The Mermaid frame hashes could not be computed: ${error.message}`);
    return [];
  }
}

function parseArgs(argv) {
  const options = { keepManifest: false, suggest: false, live: null, dist: join(ROOT, 'apps', 'web', 'dist') };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--keep-manifest') options.keepManifest = true;
    else if (arg === '--suggest') options.suggest = true;
    else if (arg === '--live') options.live = argv[++i];
    else if (arg === '--dist') options.dist = resolve(process.cwd(), argv[++i] ?? '');
    else throw new Error(`Unknown flag ${arg}. Flags: --keep-manifest, --suggest, --live <url>, --dist <folder>.`);
  }
  if (argv.includes('--live') && !options.live) throw new Error('--live needs a site address.');
  return options;
}

/** The pause before the one retry of an address in live mode. */
const LIVE_RETRY_MS = 1000;

/**
 * Reads one address of the live site, with one retry after a short pause when the request fails outright or the host
 * answers 5xx, so a single passing hiccup does not fail a deployment. A second failure is returned as it is.
 *
 * @returns {Promise<{ status: number, text: string } | { error: string }>}
 */
async function liveGet(url) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(LIVE_RETRY_MS);
    try {
      const response = await globalThis.fetch(url);
      const text = await response.text();
      last = { status: response.status, text };
      if (response.status < 500) return last;
    } catch (error) {
      last = { error: error.message };
    }
  }
  return last;
}

/** The tool ids in the catalog of the checked-out commit, or null (noted) when it cannot be read. */
function catalogIds(note) {
  const path = join(ROOT, 'docs', 'catalog.json');
  try {
    return new Set(JSON.parse(readFileSync(path, 'utf8')).map((entry) => entry.id));
  } catch (error) {
    note(`docs/catalog.json cannot be read, so the sitemap's tool pages cannot be counted: ${error.message}`);
    return null;
  }
}

/**
 * The deployed-site mode: the page structure rules over both written forms of every route the sitemap names (the
 * `<path>.html` twin answers `<path>` and the folder index answers `<path>/`), and one unknown address. The sitemap's
 * tool pages must be exactly the tools in `docs/catalog.json`, so a truncated sitemap cannot pass by naming fewer.
 */
async function runLive(base, problems, note) {
  const root = base.endsWith('/') ? base : `${base}/`;
  const sitemap = await liveGet(`${root}sitemap.xml`);
  if (sitemap.error || sitemap.status !== 200) {
    note(`${root}sitemap.xml ${sitemap.error ? `could not be read: ${sitemap.error}` : `answered ${sitemap.status}`}.`);
    return { pages: 0, addresses: 0 };
  }
  const locs = [...sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (locs.length === 0) {
    note('the sitemap names no pages.');
    return { pages: 0, addresses: 0 };
  }
  // The sitemap carries the public address; the shortest entry is the home page, and the rest are routes below it.
  const home = [...locs].sort((a, b) => a.length - b.length)[0];
  const prefix = home.endsWith('/') ? home : `${home}/`;
  const routes = locs.map((loc) => (loc.startsWith(prefix) ? loc.slice(prefix.length) : null));
  if (routes.includes(null)) note('the sitemap names a page that is not below its home address.');
  const pageRoutes = [...new Set(routes.filter((r) => r !== null))];

  const listed = new Set(pageRoutes.map((route) => TOOL_ROUTE.exec(route)?.[1]).filter(Boolean));
  const catalog = catalogIds(note);
  if (catalog) {
    const missing = [...catalog].filter((id) => !listed.has(id)).sort();
    const extra = [...listed].filter((id) => !catalog.has(id)).sort();
    if (missing.length > 0 || extra.length > 0) {
      const show = (ids) => `${ids.slice(0, 5).join(', ')}${ids.length > 5 ? ` and ${ids.length - 5} more` : ''}`;
      note(
        `the sitemap names ${listed.size} tool pages but docs/catalog.json has ${catalog.size} tools` +
          (missing.length > 0 ? `; not in the sitemap: ${show(missing)}` : '') +
          (extra.length > 0 ? `; not in the catalog: ${show(extra)}` : '') +
          '.',
      );
    }
  }

  const targets = [];
  for (const route of pageRoutes) {
    targets.push({ route, address: route, expected: 200 });
    if (route !== '') targets.push({ route, address: `${route}/`, expected: 200 });
  }
  targets.push({ route: '__no-such-page__', address: '__no-such-page__', expected: 404 });

  const needsById = new Map();
  for (const { route } of targets) {
    const match = TOOL_ROUTE.exec(route);
    if (match && !needsById.has(match[1])) needsById.set(match[1], readNeeds(match[1], note));
  }
  const frameHashes = frameHashesFor([...needsById.values()], note);

  for (const { route, address, expected } of targets) {
    const url = `${root}${address}`;
    const response = await liveGet(url);
    if (response.error) {
      note(`${url} could not be read, twice: ${response.error}`);
      continue;
    }
    if (response.status !== expected) {
      note(`${url} answered ${response.status}, expected ${expected}.`);
    }
    const match = TOOL_ROUTE.exec(route);
    const needs = match ? needsById.get(match[1]) : [];
    for (const problem of checkHtml({ file: url, html: response.text, needs, frameHashes })) problems.push(problem);
  }
  return { pages: pageRoutes.length + 1, addresses: targets.length };
}

async function main() {
  const problems = [];
  const note = (message) => problems.push(message);
  const options = parseArgs(process.argv.slice(2));

  if (options.live) {
    const { pages, addresses } = await runLive(options.live, problems, note);
    if (problems.length > 0) {
      console.error(`CSP live check failed with ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n`);
      for (const p of problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log(`CSP-LIVE-OK pages=${pages} addresses=${addresses}`);
    return;
  }

  const dist = options.dist;
  const manifestPath = join(dist, '.vite', 'manifest.json');
  const acks = readAcks(join(ROOT, 'scripts', 'csp-acks.json'), note);
  const ackCount = ACK_CLASSES.reduce((sum, klass) => sum + Object.keys(acks[klass]).length, 0);

  // --- the closures -----------------------------------------------------------------------------------------
  let manifest = null;
  if (!existsSync(manifestPath)) {
    note(
      `${relative(ROOT, manifestPath).split('\\').join('/')} is missing, so the built code cannot be checked against the declared needs. Run the whole build (vite build, prerender, then this gate), or this gate with --keep-manifest on a build that kept it.`,
    );
  } else {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  }

  const chunkTokens = new Map();
  const tokensOfFile = (file) => {
    if (!chunkTokens.has(file)) {
      const full = join(dist, file);
      chunkTokens.set(
        file,
        /\.(m?js)$/.test(file) && existsSync(full) ? scanTokens(readFileSync(full, 'utf8')) : new Set(),
      );
    }
    return chunkTokens.get(file);
  };

  const pageTokens = new Map();
  const pageFiles = new Map();
  if (manifest) {
    const { shell, pages } = closures(manifest);
    if (shell.size === 0) note('the manifest has no index.html entry, so the shared shell cannot be told apart.');
    for (const file of unreachedChunks(manifest, { shell, pages })) {
      note(
        `the chunk ${file} is in neither the shared shell nor any tool page's closure, so its code is never scanned. Load it from a tool page or statically from the shell, or teach the gate where it belongs.`,
      );
    }

    const shellTokens = new Set();
    for (const key of shell) {
      const file = manifest[key]?.file;
      if (!file) continue;
      for (const token of shellFindings(tokensOfFile(file))) {
        shellTokens.add(token);
        note(`the shared shell chunk ${file} holds a ${token} token. The shell loads on every page and may hold none.`);
      }
    }

    for (const [id, keys] of pages) {
      const union = new Set();
      const files = new Map();
      for (const key of keys) {
        const file = manifest[key]?.file;
        if (!file) continue;
        for (const token of tokensOfFile(file)) {
          union.add(token);
          if (!files.has(token)) files.set(token, []);
          files.get(token).push(file);
        }
      }
      pageTokens.set(id, union);
      pageFiles.set(id, files);
    }
  }

  // --- the written pages --------------------------------------------------------------------------------------
  if (!existsSync(dist)) {
    note(`${dist} does not exist. Run the build first.`);
  }
  const files = existsSync(dist) ? htmlFiles(dist) : [];
  if (existsSync(dist) && files.length === 0) note('the build folder holds no HTML files.');

  const routes = new Map(); // route -> { policy }
  const toolIds = new Set();
  for (const path of files) {
    const route = routeOf(path);
    const match = TOOL_ROUTE.exec(route);
    if (match && !routes.has(route)) toolIds.add(match[1]);
    if (!routes.has(route)) routes.set(route, null);
  }
  const needsById = new Map();
  for (const id of [...toolIds].sort()) needsById.set(id, readNeeds(id, note));
  const frameHashes = frameHashesFor([...needsById.values()], note);

  const policies = [];
  for (const path of files) {
    const route = routeOf(path);
    const match = TOOL_ROUTE.exec(route);
    const needs = match ? needsById.get(match[1]) : [];
    const html = readFileSync(join(dist, path), 'utf8');
    for (const problem of checkHtml({ file: path, html, needs, frameHashes })) note(problem);
    const policy = policyOfHtml(html);
    // One entry per route (the `.html` twin and the folder index carry the same text), counted once.
    if (policy && routes.get(route) === null) {
      routes.set(route, policy);
      policies.push(policy);
    }
  }

  // --- the rule table ---------------------------------------------------------------------------------------
  const ackedClasses = (id) => new Set(ACK_CLASSES.filter((klass) => Object.hasOwn(acks[klass], id)));
  const reserved = [];
  if (manifest) {
    const manifestIds = new Set(pageTokens.keys());
    for (const id of toolIds) {
      if (!manifestIds.has(id))
        note(
          `${id}: the page is written but the manifest has no src/tools/${id}.ts entry, so its code cannot be checked.`,
        );
    }
    for (const id of [...manifestIds].sort()) {
      if (!toolIds.has(id)) note(`${id}: the manifest has a page entry but no HTML file was written for it.`);
      const needs = needsById.get(id) ?? readNeeds(id, note);
      for (const problem of judgePage({ id, needs, tokens: pageTokens.get(id), acks: ackedClasses(id) })) {
        const detail = [...pageFiles.get(id).entries()]
          .filter(([token]) => problem.includes(`"${token}"`) || (token === 'fetch' && problem.includes('fetch')))
          .map(([token, list]) => `${token} in ${list.slice(0, 3).join(', ')}`)
          .join('; ');
        note(detail ? `${problem} (${detail})` : problem);
      }
    }
    for (const klass of ACK_CLASSES) {
      for (const id of Object.keys(acks[klass])) {
        if (!manifestIds.has(id))
          note(`scripts/csp-acks.json: ${klass} / ${id} names no built page. Remove the entry.`);
      }
    }
    for (const id of RESERVED_IDS) {
      if (!manifestIds.has(id) && !toolIds.has(id)) reserved.push(id);
    }
  }

  if (options.suggest) {
    if (!manifest) {
      for (const p of problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    const suggestion = {};
    for (const id of [...pageTokens.keys()].sort()) {
      const tokens = pageTokens.get(id);
      const acked = ackedClasses(id);
      const needs = [];
      if (MERMAID_FRAME_PAGES.includes(id)) needs.push('mermaid-frame');
      if (tokens.has('eval') && !acked.has('eval')) needs.push('eval');
      if (tokens.has('sandboxed-html')) needs.push('sandboxed-html');
      if (tokens.has('wasm') && !acked.has('wasm') && !needs.includes('eval')) needs.push('wasm');
      if (tokens.has('workers')) needs.push('workers');
      suggestion[id] = needs.sort();
    }
    console.log(JSON.stringify(suggestion, null, 1));
    return;
  }

  // --- report ------------------------------------------------------------------------------------------------
  if (problems.length > 0) {
    console.error(`CSP gate failed with ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  for (const id of reserved) console.log(`reserved ${id}: no page yet`);
  const distinct = sortedDistinct(policies);
  for (const [policy, count] of distinct) console.log(`policy ${count} pages: ${policy}`);
  console.log(`CSP-GATE-OK pages=${routes.size} files=${files.length} policies=${distinct.length} ack=${ackCount}`);

  // The manifest names local paths and is not part of the site, so it goes once the gate has passed.
  if (!options.keepManifest) rmSync(join(dist, '.vite'), { recursive: true, force: true });
}

// Run only as the process entry, so the tests can import the exports above.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`CSP gate stopped: ${error.message}`);
    process.exit(1);
  });
}
