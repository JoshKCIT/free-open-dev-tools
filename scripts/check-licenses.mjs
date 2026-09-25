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
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
]);

/**
 * Copyleft licences that would require releasing the whole site under the same
 * terms. Shipping one of these in the bundle is a release blocker, not a warning.
 */
const BLOCKED = [/GPL/i, /AGPL/i, /LGPL/i, /MPL/i, /EPL/i, /CDDL/i, /SSPL/i, /BUSL/i, /Commons-Clause/i, /UNLICENSED/i];

function collectRuntimeDependencies() {
  const wanted = new Map();

  const add = (name, range, origin, direct, via) => {
    const entry = wanted.get(name) ?? { name, ranges: new Set(), origins: new Set(), direct: false, via: new Set() };
    entry.ranges.add(range);
    entry.origins.add(origin);
    if (direct) entry.direct = true;
    if (via) entry.via.add(via);
    wanted.set(name, entry);
  };

  const toolsDir = join(ROOT, 'tools');
  for (const id of readdirSync(toolsDir).filter((d) => statSync(join(toolsDir, d)).isDirectory())) {
    const pkg = JSON.parse(readFileSync(join(toolsDir, id, 'package.json'), 'utf8'));
    for (const [name, range] of Object.entries(pkg.dependencies ?? {})) add(name, range, `tools/${id}`, true);
  }

  const web = JSON.parse(readFileSync(join(ROOT, 'apps', 'web', 'package.json'), 'utf8'));
  for (const [name, range] of Object.entries(web.dependencies ?? {})) add(name, range, 'apps/web', true);

  // One level, deliberately, and only one: follow each direct dependency into
  // its own installed manifest and collect what IT declares as a runtime
  // dependency. A direct dependency ships its own dependencies to every
  // visitor just as surely as it ships itself, and a notices file that only
  // ever looked at this project's own package.json files would miss that.
  // A full transitive walk is a bigger change than this notices file
  // currently needs; revisit if a shipping dependency introduces a deeper
  // runtime dependency of its own.
  for (const dep of [...wanted.values()].filter((d) => d.direct)) {
    const dir = findInstalled(dep.name);
    if (!dir) continue;
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      for (const origin of dep.origins) add(name, range, origin, false, dep.name);
    }
  }

  return [...wanted.values()].sort((a, b) => a.name.localeCompare(b.name));
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
};

function licenceTextFor(dir, name, version) {
  for (const candidate of ['LICENSE', 'LICENSE.md', 'LICENCE', 'LICENSE.txt', 'license', 'LICENSE-MIT']) {
    const path = join(dir, candidate);
    if (existsSync(path)) return readFileSync(path, 'utf8').trim();
  }
  const overridePath = MANUAL_LICENSE_OVERRIDES[`${name}@${version}`];
  if (overridePath) {
    const path = join(ROOT, overridePath);
    if (existsSync(path)) return readFileSync(path, 'utf8').trim();
  }
  return null;
}

const dependencies = collectRuntimeDependencies();
const problems = [];
const rows = [];

for (const dep of dependencies) {
  const dir = findInstalled(dep.name);
  if (!dir) {
    problems.push(`${dep.name} is declared but not installed, so its licence cannot be checked. Run install first.`);
    continue;
  }
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const licence =
    typeof manifest.license === 'string'
      ? manifest.license
      : (manifest.license?.type ??
        (Array.isArray(manifest.licenses) ? manifest.licenses.map((l) => l.type).join(' OR ') : 'UNKNOWN'));

  if (BLOCKED.some((re) => re.test(licence))) {
    problems.push(
      `${dep.name}@${manifest.version} is ${licence}. Shipping it would impose those terms on this project.`,
    );
  } else if (!ALLOWED.has(licence)) {
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
