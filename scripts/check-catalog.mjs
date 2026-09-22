#!/usr/bin/env node
/**
 * Release gate: the catalog, the packages and the website must agree.
 *
 * This is what stops a tool appearing on the site without tests, or a folder
 * existing with no page, or documentation drifting away from the code. Every
 * failure here blocks the build.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadCatalog } from './lib/catalog.mjs';

const problems = [];
const note = (msg) => problems.push(msg);

const catalog = loadCatalog();
const catalogIds = new Set(catalog.map((c) => c.id));

const toolsDir = join(ROOT, 'tools');
const packageIds = existsSync(toolsDir)
  ? readdirSync(toolsDir).filter((d) => statSync(join(toolsDir, d)).isDirectory())
  : [];

const webSrcRoot = join(ROOT, 'apps', 'web', 'src');
const pagesDir = join(webSrcRoot, 'tools');
const pageIds = existsSync(pagesDir)
  ? readdirSync(pagesDir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => f.replace(/\.ts$/, ''))
  : [];

// --- every package corresponds to a catalog entry -------------------------
for (const id of packageIds) {
  if (!catalogIds.has(id)) {
    note(`tools/${id} has no entry in docs/catalog.json. Add it there or remove the folder.`);
  }
}

// --- every page corresponds to a package ----------------------------------
for (const id of pageIds) {
  if (!packageIds.includes(id)) {
    note(
      `apps/web/src/tools/${id}.ts has no matching tools/${id} package. The site must never ship logic that has no tests.`,
    );
  }
}

// --- every package has a page, tests and complete documentation -----------
for (const id of packageIds) {
  const dir = join(toolsDir, id);

  if (!pageIds.includes(id)) {
    note(`tools/${id} exists but has no page at apps/web/src/tools/${id}.ts, so it is built but unreachable.`);
  }

  const testDir = join(dir, 'test');
  const tests = existsSync(testDir) ? readdirSync(testDir).filter((f) => f.endsWith('.test.ts')) : [];
  if (tests.length === 0) note(`tools/${id} has no test file.`);

  for (const required of ['README.md', 'LICENSE', 'package.json', 'tsconfig.json', 'src/index.ts', 'src/meta.json']) {
    if (!existsSync(join(dir, required))) note(`tools/${id} is missing ${required}.`);
  }

  const metaPath = join(dir, 'src', 'meta.json');
  if (existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    if (meta.id !== id) note(`tools/${id}/src/meta.json declares id "${meta.id}".`);

    const entry = catalog.find((c) => c.id === id);
    if (entry && meta.name !== entry.name) {
      note(`tools/${id}: meta.json name "${meta.name}" does not match the catalog name "${entry.name}".`);
    }
    if (entry && meta.summary !== entry.summary) {
      note(`tools/${id}: meta.json summary does not match the catalog summary.`);
    }

    // The documentation contract every tool page relies on.
    if (!meta.about || meta.about.length < 60) note(`tools/${id}: "about" is missing or too short to be useful.`);
    if (!Array.isArray(meta.supports) || meta.supports.length === 0) note(`tools/${id}: "supports" is empty.`);
    if (!Array.isArray(meta.limits) || meta.limits.length === 0) {
      note(`tools/${id}: "limits" is empty. Every tool has limits, and hiding them is how people get surprised.`);
    }
    for (const field of ['about', 'supports', 'limits']) {
      const text = JSON.stringify(meta[field] ?? '');
      // Word boundaries matter: "\uXXXX" is legitimate documentation, "TODO" is not.
      if (/\b(TODO|FIXME|TBD)\b/i.test(text)) note(`tools/${id}: "${field}" still contains a placeholder.`);
    }
    if (Array.isArray(meta.standards)) {
      for (const s of meta.standards) {
        if (!s.url || !/^https?:\/\//.test(s.url)) note(`tools/${id}: standard "${s.label}" has no usable URL.`);
      }
    }
  }

  // Self-containment: a tool folder must not reach outside itself.
  const srcDir = join(dir, 'src');
  for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.ts'))) {
    const source = readFileSync(join(srcDir, file), 'utf8');
    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const spec = match[1];
      if (spec.startsWith('../../') || spec.includes('/tools/')) {
        note(
          `tools/${id}/src/${file} imports "${spec}", which reaches outside its own folder. That breaks standalone use.`,
        );
      }
      if (spec.startsWith('@fodt/')) {
        note(`tools/${id}/src/${file} imports "${spec}". Tool packages must not depend on each other.`);
      }
    }
  }
}

/**
 * Removes comments and string literals before scanning for network calls.
 *
 * Without this the check fires on documentation and on test data: the case
 * converter legitimately uses "XMLHttpRequest" as an example identifier. What
 * matters is whether the code can actually call these, not whether it names them.
 */
function stripStringsAndComments(source) {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < n) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i++;
          break;
        }
        // A template literal can contain real code inside ${ }.
        if (quote === '`' && source[i] === '$' && source[i + 1] === '{') {
          let depth = 1;
          i += 2;
          const start = i;
          while (i < n && depth > 0) {
            if (source[i] === '{') depth++;
            else if (source[i] === '}') depth--;
            if (depth > 0) i++;
          }
          out += ' ' + source.slice(start, i) + ' ';
          i++;
          continue;
        }
        i++;
      }
      out += ' ';
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// --- no tool claims to send data anywhere ---------------------------------
const FORBIDDEN = [
  [/\bfetch\s*\(/, 'fetch('],
  [/XMLHttpRequest/, 'XMLHttpRequest'],
  [/navigator\.sendBeacon/, 'navigator.sendBeacon'],
  [/new\s+WebSocket/, 'new WebSocket'],
  [/new\s+EventSource/, 'new EventSource'],
  [/import\s*\(\s*['"]https?:/, 'a remote dynamic import'],
];

for (const id of packageIds) {
  const srcDir = join(toolsDir, id, 'src');
  for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.ts'))) {
    const code = stripStringsAndComments(readFileSync(join(srcDir, file), 'utf8'));
    for (const [pattern, label] of FORBIDDEN) {
      if (pattern.test(code)) {
        note(`tools/${id}/src/${file} calls ${label}. A local tool must never transmit anything.`);
      }
    }
  }
}

for (const id of pageIds) {
  const code = stripStringsAndComments(readFileSync(join(pagesDir, `${id}.ts`), 'utf8'));
  for (const [pattern, label] of FORBIDDEN) {
    if (pattern.test(code)) {
      note(`apps/web/src/tools/${id}.ts calls ${label}. A tool page must never transmit anything.`);
    }
  }
}

// The shared site code is held to the same rule, minus the theme storage.
for (const file of ['components/ToolRunner.tsx', 'components/OutputView.tsx', 'lib/tool-ui.ts', 'lib/registry.ts']) {
  const full = join(webSrcRoot, file);
  if (!existsSync(full)) continue;
  const code = stripStringsAndComments(readFileSync(full, 'utf8'));
  for (const [pattern, label] of FORBIDDEN) {
    if (pattern.test(code)) note(`apps/web/src/${file} calls ${label}.`);
  }
}

// --- the site shell must not reach a third party --------------------------
const webSrc = webSrcRoot;
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(ts|tsx|css)$/.test(entry)) {
      const source = readFileSync(full, 'utf8');
      // Allow links in href attributes; forbid anything that loads a resource.
      for (const match of source.matchAll(/url\(\s*['"]?(https?:\/\/[^)'"]+)/g)) {
        note(
          `${full} loads a remote resource: ${match[1]}. Everything must be bundled and served from our own origin.`,
        );
      }
      if (/<script[^>]+src=["']https?:/.test(source)) {
        note(`${full} loads a remote script.`);
      }
    }
  }
};
walk(webSrc);

const indexHtml = readFileSync(join(ROOT, 'apps', 'web', 'index.html'), 'utf8');
for (const match of indexHtml.matchAll(/(?:src|href)=["'](https?:\/\/[^"']+)/g)) {
  note(`apps/web/index.html references ${match[1]}. No third-party asset may be loaded.`);
}

if (problems.length > 0) {
  console.error(`Catalog check failed with ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(
  `Catalog check passed. ${packageIds.length} tool packages, ${pageIds.length} pages, all present in the catalog, all documented, none capable of transmitting input.`,
);
