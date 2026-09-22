#!/usr/bin/env node
/**
 * Turns docs/catalog.json into apps/web/src/generated-catalog.json.
 *
 * Catalog consistency (no duplicate id, every category known, tier in
 * range, name and summary non-empty) is enforced inside `loadCatalog()`
 * itself now, so every caller gets it for free (WR-01, 01-REVIEW.md). This
 * script just reports it in a CI-friendly form instead of leaving a thrown
 * Error's raw stack trace as the only output.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, CATEGORY_LABELS, loadCatalog } from './lib/catalog.mjs';

let catalog;
try {
  catalog = loadCatalog();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const tools = catalog.map((entry) => ({
  id: entry.id,
  name: entry.name,
  category: entry.category,
  categoryLabel: CATEGORY_LABELS[entry.category] ?? entry.category,
  tier: entry.tier,
  summary: entry.summary,
  implemented: entry.implemented,
}));

writeFileSync(join(ROOT, 'apps', 'web', 'src', 'generated-catalog.json'), JSON.stringify({ tools }, null, 2) + '\n');

console.log(`Catalog written: ${tools.length} tools, ${tools.filter((t) => t.implemented).length} implemented.`);
