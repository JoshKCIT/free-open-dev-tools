/**
 * The page policy library.
 *
 * GitHub Pages cannot send response headers, so each page carries its own content security policy as a `<meta>` tag
 * that the prerender step writes as the first element of the page head. This module holds everything that decides
 * what that policy says. It is pure (no file is read except by `mermaidFrameHashes`) so the prerender step, the build
 * gate and the unit tests all read the same rules.
 *
 * The baseline refuses every outside request. A page widens it only by what its tool declares in
 * `tools/<id>/src/meta.json` under `needs`, taken from the closed list in `NEEDS`:
 *
 * - `eval`            adds `'unsafe-eval'` to `script-src` (it also lets WebAssembly compile).
 * - `mermaid-frame`   adds the two hashes of the diagram frame's inline scripts, and inline styles.
 * - `sandboxed-html`  adds inline styles, because the preview frame's own policy asks for them.
 * - `wasm`            adds `'wasm-unsafe-eval'` to `script-src`.
 * - `workers`         sets `worker-src` to `blob:`. It is never `'self'` and never an address: a worker loaded from an
 *                     address could be pointed anywhere the page can reach.
 *
 * Rules that hold for every policy this module writes:
 * - the directives come in the fixed order of `DIRECTIVE_ORDER`, none twice, so two builds write identical text;
 * - `frame-ancestors`, `report-uri` and `sandbox` are never written (a browser ignores them in a meta policy);
 * - `script-src` never holds `'unsafe-inline'`, a wildcard, `http:`, `https:` or `data:`; inline scripts are trusted
 *   only by the sha256 of their text, computed from the final HTML.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The closed vocabulary of `needs`, sorted. */
export const NEEDS = Object.freeze(['eval', 'mermaid-frame', 'sandboxed-html', 'wasm', 'workers']);

/** The order every policy is written in. */
export const DIRECTIVE_ORDER = Object.freeze([
  'default-src',
  'script-src',
  'style-src',
  'img-src',
  'font-src',
  'connect-src',
  'worker-src',
  'frame-src',
  'media-src',
  'object-src',
  'base-uri',
  'form-action',
  'manifest-src',
]);

const HASH_FORM = /^sha256-[A-Za-z0-9+/]+={0,2}$/;

/** Text as the HTML parser reads it: a carriage return, alone or before a line feed, is a line feed. */
const normaliseLineEndings = (text) => text.replace(/\r\n?/g, '\n');

const sha256 = (text) => `sha256-${createHash('sha256').update(normaliseLineEndings(text), 'utf8').digest('base64')}`;

function checkHashes(hashes, what) {
  for (const hash of hashes) {
    if (typeof hash !== 'string' || !HASH_FORM.test(hash)) {
      throw new Error(`${what} holds a value that is not a sha256 hash: ${JSON.stringify(hash)}`);
    }
  }
}

/**
 * The policy text for one page.
 *
 * @param {{ needs: readonly string[], scriptHashes: readonly string[], frameHashes?: readonly string[] }} input
 *   `needs` is the page's declaration, `scriptHashes` the hashes of the page's own inline scripts, `frameHashes` the
 *   two hashes of the Mermaid frame (used only when `mermaid-frame` is declared).
 * @returns {string} the directives joined with `; `
 */
export function policyFor({ needs, scriptHashes, frameHashes = [] }) {
  if (!Array.isArray(needs)) throw new Error('policyFor needs an array of needs.');
  for (const term of needs) {
    if (!NEEDS.includes(term)) {
      throw new Error(`"${term}" is not a need this site knows. The closed list is: ${NEEDS.join(', ')}.`);
    }
  }
  checkHashes(scriptHashes, 'scriptHashes');
  checkHashes(frameHashes, 'frameHashes');

  const n = new Set(needs);
  const script = ["'self'", ...scriptHashes.map((h) => `'${h}'`)];
  if (n.has('mermaid-frame')) script.push(...frameHashes.map((h) => `'${h}'`));
  if (n.has('wasm')) script.push("'wasm-unsafe-eval'");
  if (n.has('eval')) script.push("'unsafe-eval'");
  const inlineStyle = n.has('sandboxed-html') || n.has('mermaid-frame');

  const directives = {
    'default-src': "'none'",
    'script-src': script.join(' '),
    'style-src': `'self'${inlineStyle ? " 'unsafe-inline'" : ''}`,
    'img-src': 'data: blob:',
    'font-src': "'none'",
    'connect-src': "'none'",
    'worker-src': n.has('workers') ? 'blob:' : "'none'",
    'frame-src': "'none'",
    'media-src': "'none'",
    'object-src': "'none'",
    'base-uri': "'none'",
    'form-action': "'none'",
    'manifest-src': "'none'",
  };
  return DIRECTIVE_ORDER.map((name) => `${name} ${directives[name]}`).join('; ');
}

/**
 * The hash of every inline script in a page, in document order, each once. A script with a `src` attribute is not
 * inline and is left out. Line endings are normalised to LF first, as the HTML parser does before the browser hashes.
 *
 * @param {string} html
 * @returns {string[]} `sha256-<base64>` strings
 */
export function inlineScriptHashes(html) {
  const found = [];
  for (const match of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script\s*>/gi)) {
    const attributes = match[1] ?? '';
    if (/(^|\s)src\s*=/i.test(attributes)) continue;
    const hash = sha256(match[2]);
    if (!found.includes(hash)) found.push(hash);
  }
  return found;
}

/**
 * The two hashes of the Mermaid frame's inline scripts, computed from the folder's own frame builder and its bundled
 * diagram engine, so the policy follows whatever the page really puts in the frame. The two TypeScript files are
 * compiled in memory with the repository's own `typescript` and written to a temporary folder only so they can be
 * loaded; the folder is removed afterwards.
 *
 * @param {string} root the repository root
 * @returns {string[]} exactly two `sha256-<base64>` strings
 */
export function mermaidFrameHashes(root) {
  const require = createRequire(join(root, 'package.json'));
  const ts = require('typescript');
  const sourceDir = join(root, 'tools', 'mermaid-renderer', 'src');
  const scratch = mkdtempSync(join(tmpdir(), 'fodt-frame-'));
  try {
    for (const name of ['limits', 'frame-doc']) {
      const source = readFileSync(join(sourceDir, `${name}.ts`), 'utf8');
      const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      // `require` finds only .js, .json and .node by itself, so the written copy of the limits file is named in full.
      writeFileSync(
        join(scratch, `${name}.cjs`),
        compiled.replace(/require\((['"])\.\/limits\1\)/, "require('./limits.cjs')"),
      );
    }
    const { buildFrameDocument } = createRequire(join(scratch, 'loader.cjs'))('./frame-doc.cjs');
    const bundle = readFileSync(
      join(root, 'tools', 'mermaid-renderer', 'node_modules', 'mermaid', 'dist', 'mermaid.min.js'),
      'utf8',
    );
    const hashes = inlineScriptHashes(buildFrameDocument(bundle));
    if (hashes.length !== 2) {
      throw new Error(`The Mermaid frame document should hold exactly two inline scripts; found ${hashes.length}.`);
    }
    return hashes;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * The policy meta tag. The policy holds only single quotes, so the attribute needs no escaping; a double quote in a
 * policy is a mistake and throws.
 *
 * @param {string} policy
 */
export function metaTag(policy) {
  if (policy.includes('"')) throw new Error('A policy must not hold a double quote; it goes inside an attribute.');
  return `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
}

/**
 * A policy read back into directive name to source tokens.
 *
 * @param {string} text
 * @returns {Map<string, string[]>}
 */
export function parsePolicy(text) {
  const map = new Map();
  for (const part of text.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const [name, ...sources] = tokens;
    if (!map.has(name)) map.set(name, sources);
  }
  return map;
}
