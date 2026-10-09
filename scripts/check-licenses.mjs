#!/usr/bin/env node
/**
 * Release gate: every dependency that reaches a user must be under a licence
 * compatible with shipping it inside an MIT-licensed static site, and its
 * notice must be preserved. Also covers data bundled directly into a tool
 * folder under an attribution licence (never an npm dependency, so it is
 * invisible to the ordinary dependency walk below) via `scripts/lib/bundled-data.mjs`.
 *
 * Also writes docs/THIRD-PARTY.md, so the attribution file cannot drift away
 * from what is actually installed or bundled.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { ROOT as REPO_ROOT } from './lib/catalog.mjs';
import { collectBundledData, renderBundledDataSection } from './lib/bundled-data.mjs';

/**
 * Overridable so `scripts/test/bundled-data.test.mjs` can point this script
 * at a throwaway fixture directory instead of editing the real repository.
 * Defaults to the actual repository root; this env var exists for that test
 * alone.
 */
const ROOT = process.env.FODT_CHECK_LICENSES_ROOT ? resolve(process.env.FODT_CHECK_LICENSES_ROOT) : REPO_ROOT;

/** Permissive licences that may be redistributed inside this project. */
const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  'Python-2.0',
  'BlueOak-1.0.0',
  '(MIT OR CC0-1.0)',
  '(MIT OR Apache-2.0)',
  'MIT AND ISC',
  // Elected 2026-09-25: this project elects the Apache-2.0 disjunct of
  // DOMPurify's dual licence. The BLOCKED list below matches /MPL/i, which
  // would otherwise catch this exact string too, so this entry only helps
  // once an exact ALLOWED match is checked before BLOCKED runs (see below).
  '(MPL-2.0 OR Apache-2.0)',
]);

/**
 * Copyleft licences that would require releasing the whole site under the same
 * terms. Shipping one of these in the bundle is a release blocker, not a warning.
 */
const BLOCKED = [/GPL/i, /AGPL/i, /LGPL/i, /MPL/i, /EPL/i, /CDDL/i, /SSPL/i, /BUSL/i, /Commons-Clause/i, /UNLICENSED/i];

function collectRuntimeDependencies() {
  // One entry per installed copy (its real folder), not per name: two versions of a package that both reach a visitor
  // each need their own notice. A declared package that is not installed has no folder and is keyed by its name.
  const wanted = new Map();

  const add = (name, range, origin, direct, via, dir) => {
    const key = dir ? realpathSync(dir) : `missing:${name}`;
    const entry = wanted.get(key) ?? {
      name,
      dir: dir ?? null,
      ranges: new Set(),
      origins: new Set(),
      direct: false,
      via: new Set(),
      expanded: new Set(),
    };
    entry.ranges.add(range);
    entry.origins.add(origin);
    if (direct) entry.direct = true;
    if (via) entry.via.add(via);
    wanted.set(key, entry);
  };

  const toolsDir = join(ROOT, 'tools');
  for (const id of readdirSync(toolsDir).filter((d) => statSync(join(toolsDir, d)).isDirectory())) {
    const pkg = JSON.parse(readFileSync(join(toolsDir, id, 'package.json'), 'utf8'));
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      add(name, pkg.dependencies[name], `tools/${id}`, true, null, resolveFrom(join(toolsDir, id), name));
    }
  }

  const webDir = join(ROOT, 'apps', 'web');
  const web = JSON.parse(readFileSync(join(webDir, 'package.json'), 'utf8'));
  for (const name of Object.keys(web.dependencies ?? {})) {
    add(name, web.dependencies[name], 'apps/web', true, null, resolveFrom(webDir, name));
  }

  // To a fixed point: follow every package that reaches a visitor into its own installed manifest and collect what
  // IT declares as a runtime dependency or a peer dependency, then do the same for those, until nothing new turns up.
  // A package ships its dependencies to every visitor just as surely as it ships itself, however deep, and the MIT
  // licence (and the others allowed here) require the notice to travel with every copy. Each package is expanded once
  // per origin, so a dependency cycle ends. A peer dependency that is not installed is skipped: it is the host's to
  // supply, and a missing optional one ships nothing. A declared dependency that is not installed is still reported
  // by the check below.
  let changed = true;
  while (changed) {
    changed = false;
    for (const dep of [...wanted.values()]) {
      const dir = dep.dir;
      if (!dir) continue;
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      for (const origin of dep.origins) {
        if (dep.expanded.has(origin)) continue;
        dep.expanded.add(origin);
        changed = true;
        for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
          add(name, range, origin, false, dep.name, resolveFrom(dir, name));
        }
        for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
          const found = resolveFrom(dir, name);
          if (found) add(name, range, origin, false, dep.name, found);
        }
      }
    }
  }

  return [...wanted.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || String(a.dir).localeCompare(String(b.dir)),
  );
}

/**
 * Finds the installed copy of `name` the way Node would for a package living in `parentDir`: in the nearest
 * node_modules above its real path (under pnpm that is the folder next to it in the .pnpm store). Returns null when
 * nothing is found there; callers fall back to `findInstalled`.
 */
function resolveFrom(parentDir, name) {
  let dir = realpathSync(parentDir);
  for (;;) {
    const candidate = basename(dir) === 'node_modules' ? join(dir, name) : join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return findInstalled(name);
}

/** Walks the installed tree to find a package's real manifest and licence text. */
function findInstalled(name) {
  const candidates = [
    join(ROOT, 'node_modules', name),
    ...readdirSync(join(ROOT, 'tools'))
      .map((id) => join(ROOT, 'tools', id, 'node_modules', name))
      .filter((p) => existsSync(p)),
    join(ROOT, 'apps', 'web', 'node_modules', name),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'package.json'))) return dir;
  }
  // pnpm keeps the real files under .pnpm; resolve through the symlink farm.
  const store = join(ROOT, 'node_modules', '.pnpm');
  if (existsSync(store)) {
    const match = readdirSync(store).find((d) => d.startsWith(`${name.replace('/', '+')}@`));
    if (match) {
      const dir = join(store, match, 'node_modules', name);
      if (existsSync(join(dir, 'package.json'))) return dir;
    }
  }
  return null;
}

/**
 * A handful of published packages declare a permissive `license` field but
 * do not include a licence file in their npm tarball at all (the source
 * repository has one; the published `files` allowlist just omits it). For
 * those, and only those, this project vendors a verbatim copy of the
 * upstream repository's own LICENSE file and points at it here, keyed by
 * exact `name@version` so a later version bump re-triggers this check
 * rather than silently reusing a possibly-stale override.
 */
const MANUAL_LICENSE_OVERRIDES = {
  // fetched from https://raw.githubusercontent.com/nodable/val-parsers/main/LICENSE
  // (2026-09-24): the repository root's own MIT LICENSE, which the published
  // @nodable/entities npm tarball's `files` allowlist (["src","README.md"])
  // does not include, even though its package.json declares `"license": "MIT"`.
  '@nodable/entities@3.0.0': 'docs/vendored-licenses/nodable-entities-LICENSE.txt',
  // fetched from https://raw.githubusercontent.com/fb55/boolbase/master/LICENSE (2026-10-01): the repository's own
  // ISC licence, which the published boolbase 1.0.0 tarball (reached through css-select and nth-check) omits even
  // though its package.json declares "ISC".
  'boolbase@1.0.0': 'docs/vendored-licenses/boolbase-LICENSE.txt',
  // The published railroad-diagrams 1.0.0 tarball (reached through nearley) has no licence file; its README.md
  // states CC0. That statement is quoted verbatim in the vendored file (the repository's later LICENSE file is a
  // different, MIT, licence for later versions and is deliberately not used).
  'railroad-diagrams@1.0.0': 'docs/vendored-licenses/railroad-diagrams-LICENSE.txt',
  // fetched from https://raw.githubusercontent.com/less/less.js/master/LICENSE (2026-10-03): the repository's own
  // Apache-2.0 licence, which the published less 4.9.1 tarball omits even though its package.json declares
  // "Apache-2.0".
  'less@4.9.1': 'docs/vendored-licenses/less-LICENSE.txt',
  // fastdom 1.0.12 and strictdom 1.0.1 (reached through mermaid 11.17.2): each package.json declares "MIT" but the
  // published tarball has no licence file. Each README.md ends with a License section ("(The MIT License)" and the
  // full text), quoted verbatim in the vendored file, read from the installed packages on 2026-10-03.
  'fastdom@1.0.12': 'docs/vendored-licenses/fastdom-LICENSE.txt',
  'strictdom@1.0.1': 'docs/vendored-licenses/strictdom-LICENSE.txt',
};

/**
 * A package whose manifest states no licence at all (the `license` field is missing, so the gate would read
 * "UNKNOWN") but whose own licence file states one. Consulted ONLY in that case, keyed by exact `name@version` so a
 * later version bump re-triggers the review, and never overrides a licence a manifest does state. The value is the
 * licence identifier the package's own licence file states.
 */
const MANUAL_LICENCE_ID_OVERRIDES = {
  // khroma 2.1.0 (reached through mermaid 11.17.2): package.json has no `license` field; its own `license` file
  // reads "The MIT License (MIT) Copyright (c) 2019-present Fabio Spampinato, Andrew Maney" followed by the MIT
  // text (read from the installed package on 2026-10-03).
  'khroma@2.1.0': 'MIT',
};

// Some upstream packages (e.g. typescript, @mixmark-io/domino) ship a LICENSE
// file with CRLF line endings. This project's .gitattributes normalizes every
// text file to LF on commit (`* text=auto eol=lf`), so embedding raw CRLF
// bytes here would make a freshly regenerated docs/THIRD-PARTY.md byte-differ
// from the committed one on every single run, on every platform, tripping
// CI's own "notices file is out of date" gate deterministically. Normalizing
// to LF here keeps this generated file's line endings internally consistent
// with the rest of the document and with what git actually stores.
const normaliseLineEndings = (text) => text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

// Compared without regard to letter case: a package may ship `license.md`, and a
// case-insensitive file system (Windows, macOS) would find it under `LICENSE.md`
// while CI's Linux runner would not, so the gate must not depend on the platform.
const LICENCE_FILE_NAMES = [
  'license',
  'license.md',
  'licence',
  'license.txt',
  'license-mit',
  'license-mit.txt',
  'licence.md',
  'licence.txt',
];

function licenceTextFor(dir, name, version) {
  const present = new Map(readdirSync(dir).map((entry) => [entry.toLowerCase(), entry]));
  for (const candidate of LICENCE_FILE_NAMES) {
    const entry = present.get(candidate);
    if (entry && statSync(join(dir, entry)).isFile()) {
      return normaliseLineEndings(readFileSync(join(dir, entry), 'utf8').trim());
    }
  }
  const overridePath = MANUAL_LICENSE_OVERRIDES[`${name}@${version}`];
  if (overridePath) {
    const path = join(ROOT, overridePath);
    if (existsSync(path)) return normaliseLineEndings(readFileSync(path, 'utf8').trim());
  }
  return null;
}

const dependencies = collectRuntimeDependencies();
const problems = [];
const rows = [];

for (const dep of dependencies) {
  const dir = dep.dir;
  if (!dir) {
    problems.push(`${dep.name} is declared but not installed, so its licence cannot be checked. Run install first.`);
    continue;
  }
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  let licence =
    typeof manifest.license === 'string'
      ? manifest.license
      : (manifest.license?.type ??
        (Array.isArray(manifest.licenses) ? manifest.licenses.map((l) => l.type).join(' OR ') : 'UNKNOWN'));
  if (licence === 'UNKNOWN') licence = MANUAL_LICENCE_ID_OVERRIDES[`${dep.name}@${manifest.version}`] ?? licence;

  // An exact match on the reviewed ALLOWED list is accepted before BLOCKED
  // ever runs: a licence string this project has specifically reviewed and
  // elected (e.g. DOMPurify's dual `(MPL-2.0 OR Apache-2.0)`) must
  // never be caught by a pattern like /MPL/i that exists to catch licences
  // nobody has reviewed. Anything not on the list is still tested against
  // BLOCKED exactly as before.
  if (ALLOWED.has(licence)) {
    // Reviewed and accepted; no further check.
  } else if (BLOCKED.some((re) => re.test(licence))) {
    problems.push(
      `${dep.name}@${manifest.version} is ${licence}. Shipping it would impose those terms on this project.`,
    );
  } else {
    problems.push(
      `${dep.name}@${manifest.version} is "${licence}", which is not on the reviewed allow list. Review it and add it if it is acceptable.`,
    );
  }

  const text = licenceTextFor(dir, dep.name, manifest.version);
  if (!text) {
    problems.push(`${dep.name}@${manifest.version} ships no licence file, so its notice cannot be preserved.`);
  }

  rows.push({
    name: dep.name,
    version: manifest.version,
    licence,
    homepage: manifest.homepage ?? manifest.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, '') ?? '',
    usedBy: [...dep.origins].sort(),
    text,
    origin: dep.direct ? 'direct' : `transitive (via ${[...dep.via].sort().join(', ')})`,
  });
}

const { entries: bundledEntries, problems: bundledProblems } = collectBundledData(join(ROOT, 'tools'));
problems.push(...bundledProblems);

/**
 * The gate above reads package.json, so a compiled engine hides inside a permissively licensed wrapper: the wrapper says
 * MIT while the WebAssembly inside it carries a standard library, a runtime or a parser under terms nobody read. A
 * package that ships a .wasm file must therefore be named by one of the `bundledData` notices of the tool that reaches
 * it, whether the tool declares the package itself or only a wrapper that depends on it. The decision is per package,
 * not per tool: a notice about a word list, or about another engine, does not cover a package it does not name. A notice
 * names a package when the package name appears in the entry's `name`, `source` or `attribution` text, compared without
 * regard to case or punctuation (so `@wasm-fmt/gofmt 0.7.3` and `fake-engine` / `Fake engine` both match). Read-only,
 * and independent of how the notices file is rendered. Nested node_modules are not searched (they are their own packages,
 * covered by the transitive walk above). A package tree deeper than the search limit is a reported problem, never a
 * silent "no wasm file here".
 */
const WASM_SEARCH_DEPTH = 10;

/** `{ files, tooDeep }`: the .wasm files under `dir` (relative paths) and whether a folder lay below the depth limit. */
function findWasmFiles(dir, depth = 0) {
  const files = [];
  let tooDeep = false;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      if (depth >= WASM_SEARCH_DEPTH) {
        tooDeep = true;
        continue;
      }
      const inner = findWasmFiles(join(dir, entry.name), depth + 1);
      for (const file of inner.files) files.push(`${entry.name}/${file}`);
      if (inner.tooDeep) tooDeep = true;
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.wasm')) {
      files.push(entry.name);
    }
  }
  return { files: files.sort(), tooDeep };
}

/** Lower case, with every run of punctuation and spaces folded to one space and the ends padded, for whole-word search. */
const foldForNameSearch = (text) =>
  ` ${String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;

/** True when one of the tool's bundledData entries names the package in its name, source or attribution text. */
function noticeNamesPackage(bundledData, packageName) {
  const wanted = foldForNameSearch(packageName);
  return bundledData.some((entry) =>
    [entry?.name, entry?.source, entry?.attribution].some((text) => foldForNameSearch(text ?? '').includes(wanted)),
  );
}

function wasmNoticeProblems(runtimeDependencies) {
  const found = [];
  for (const dep of runtimeDependencies) {
    if (!dep.dir) continue; // not installed: reported by the walk above
    const toolIds = [...dep.origins].filter((o) => o.startsWith('tools/')).map((o) => o.slice('tools/'.length));
    if (toolIds.length === 0) continue;
    const { files, tooDeep } = findWasmFiles(dep.dir);
    if (files.length === 0 && !tooDeep) continue;
    const reached = dep.direct ? '' : ` (reached through ${[...dep.via].sort().join(', ')})`;
    for (const id of toolIds.sort()) {
      let bundledData = [];
      try {
        const meta = JSON.parse(readFileSync(join(ROOT, 'tools', id, 'src', 'meta.json'), 'utf8'));
        if (Array.isArray(meta.bundledData)) bundledData = meta.bundledData;
      } catch {
        // No meta.json (or one that does not parse, which the catalog gate reports) declares no notice.
      }
      if (tooDeep) {
        found.push(
          `${id} reaches ${dep.name}${reached}, which has folders more than ${WASM_SEARCH_DEPTH} levels deep, below the search limit for WebAssembly files. Raise WASM_SEARCH_DEPTH in scripts/check-licenses.mjs and check it.`,
        );
      }
      if (files.length > 0 && !noticeNamesPackage(bundledData, dep.name)) {
        found.push(
          `${id} reaches ${dep.name}${reached}, which ships compiled WebAssembly (${files[0]}), but no bundledData notice of ${id} names ${dep.name} (put the package name in the entry's name, source or attribution).`,
        );
      }
    }
  }
  return found;
}

problems.push(...wasmNoticeProblems(dependencies));

const lines = [];
lines.push('# Third-party notices');
lines.push('');
lines.push(
  'Every dependency whose code reaches a visitor, with its licence and the full notice text, and every data file bundled directly into a tool folder under an attribution licence. Generated by `pnpm check:licenses` from what is actually installed and declared, so it cannot drift from reality.',
);
lines.push('');
lines.push('Original code in this repository is MIT licensed. See [LICENSE](../LICENSE).');
lines.push('');
lines.push('## Summary');
lines.push('');
lines.push('| Package | Version | Licence | Origin | Used by |');
lines.push('| --- | --- | --- | --- | --- |');
for (const r of rows) {
  lines.push(`| [${r.name}](${r.homepage}) | ${r.version} | ${r.licence} | ${r.origin} | ${r.usedBy.join(', ')} |`);
}
lines.push('');
lines.push('## Full notices');
lines.push('');
for (const r of rows) {
  lines.push(`### ${r.name} ${r.version}`);
  lines.push('');
  lines.push(`Licence: ${r.licence}`);
  lines.push('');
  lines.push('```text');
  lines.push(r.text ?? '(no licence file shipped with this package)');
  lines.push('```');
  lines.push('');
}

const bundledSection = renderBundledDataSection(bundledEntries);
if (bundledSection) {
  lines.push(bundledSection);
}

writeFileSync(join(ROOT, 'docs', 'THIRD-PARTY.md'), lines.join('\n'));

if (problems.length > 0) {
  console.error('Licence check failed:\n');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(
  `Licence check passed. ${rows.length} runtime dependenc${rows.length === 1 ? 'y' : 'ies'}, ${bundledEntries.length} bundled data file${bundledEntries.length === 1 ? '' : 's'}, all permissive, notices written to docs/THIRD-PARTY.md.`,
);
