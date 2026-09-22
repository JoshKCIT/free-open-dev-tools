/**
 * Shared helper for the tool catalog. `docs/catalog.json` is the source of
 * truth for the 144-tool list; every build script reads it through here.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const CATEGORY_LABELS = {
  encoding: 'Encoding, escaping and numbers',
  hashing: 'Hashing, secrets and tokens',
  generators: 'Identifiers and randomness',
  'json-data': 'JSON and structured data',
  text: 'Text',
  code: 'Code and markup',
  css: 'CSS and layout',
  color: 'Colour',
  datetime: 'Date and time',
  network: 'Network and web',
  devops: 'Build, config and CI',
  reference: 'Reference tables',
  media: 'Images, documents and archives',
};

/**
 * Checks a raw (pre-`implemented`-synthesis) catalog row array for internal
 * consistency: no duplicate id, every category known, tier in range 1-3,
 * name and summary non-empty. Returns a list of problem strings; an empty
 * list means the catalog is valid. Pure and side-effect-free so it can be
 * unit tested and shared by every caller of `loadCatalog()`.
 */
export function validateCatalog(rows) {
  const problems = [];
  const seenIds = new Set();
  for (const row of rows) {
    if (!row.id || seenIds.has(row.id)) {
      problems.push(`Catalog entry has an invalid or duplicate id "${row.id}".`);
    }
    seenIds.add(row.id);

    if (!Object.hasOwn(CATEGORY_LABELS, row.category)) {
      problems.push(`Catalog entry "${row.id}" has an unknown category "${row.category}".`);
    }
    if (!Number.isInteger(row.tier) || row.tier < 1 || row.tier > 3) {
      problems.push(`Catalog entry "${row.id}" has an out-of-range tier "${row.tier}".`);
    }
    if (!row.name) problems.push(`Catalog entry "${row.id}" has an empty name.`);
    if (!row.summary) problems.push(`Catalog entry "${row.id}" has an empty summary.`);
  }
  return problems;
}

/**
 * Loads and validates docs/catalog.json. Throws loudly on any inconsistency
 * (duplicate id, unknown category, out-of-range tier, empty name/summary)
 * instead of silently returning a malformed row through to a caller -- every
 * one of the six callers of this function inherits the check, not just
 * `build-catalog.mjs`'s own separate validation (WR-01, 01-REVIEW.md).
 */
export function loadCatalog() {
  const rows = JSON.parse(readFileSync(join(ROOT, 'docs', 'catalog.json'), 'utf8'));
  const problems = validateCatalog(rows);
  if (problems.length > 0) {
    throw new Error(`docs/catalog.json is not internally consistent:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
  return rows.map((row) => ({
    ...row,
    implemented: existsSync(join(ROOT, 'tools', row.id, 'package.json')),
  }));
}
