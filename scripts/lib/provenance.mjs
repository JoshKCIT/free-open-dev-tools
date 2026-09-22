/**
 * Pure, side-effect-free helpers shared between the provenance gate
 * (`scripts/check-provenance.mjs`) and its test suite. Kept in a separate
 * module so the redaction and catalog-shape logic can be unit tested
 * directly, without running the whole gate -- which walks the real tracked
 * file tree, reads an out-of-band denylist, and calls `process.exit`.
 */

/**
 * Replaces every case-insensitive occurrence of any token in
 * `denylistTokens` inside `text` with a fixed `[redacted]` placeholder.
 *
 * This is the single choke point every gate problem message passes through
 * (see `note()` in check-provenance.mjs). Redacting here, rather than at
 * each call site that builds a message, means a future call site that
 * prints a tracked path after a name-layer match cannot reintroduce a
 * token leak into gate output, CI logs, or hook output (CR-01, 01-REVIEW.md).
 */
export function redactDenylistTokens(text, denylistTokens) {
  let out = text;
  for (const token of denylistTokens) {
    if (!token) continue;
    const pattern = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(pattern, 'gi'), '[redacted]');
  }
  return out;
}

/**
 * Locates the per-tool entry array inside a parsed
 * `generated-catalog.json` document.
 *
 * Returns `{ entries, found }` rather than silently defaulting to an empty
 * array. `found: false` means none of the known shapes matched -- that is
 * itself a problem worth reporting (the structural per-entry check has
 * nothing to inspect), not a silent pass. The array-shape and `.canonical`
 * fallbacks exist only for robustness against a *future* rename; `.tools`
 * is the shape `scripts/build-catalog.mjs` actually writes today
 * (CR-02, 01-REVIEW.md).
 */
export function extractCatalogEntries(data) {
  if (Array.isArray(data)) return { entries: data, found: true };
  if (Array.isArray(data?.tools)) return { entries: data.tools, found: true };
  if (Array.isArray(data?.canonical)) return { entries: data.canonical, found: true };
  return { entries: [], found: false };
}
