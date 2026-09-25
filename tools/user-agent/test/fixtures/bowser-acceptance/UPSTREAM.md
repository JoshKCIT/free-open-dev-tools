# bowser's own acceptance fixture (vendored)

- **Repository:** https://github.com/bowser-js/bowser
- **Tag:** `v2.14.1` (matches the pinned runtime dependency)
- **Commit:** `eb3f153defca3f785a25ec7d65dce72a4a6ffb28`
- **Fetched:** 2026-09-25
- **Files:**
  - `useragentstrings.yml`, copied verbatim from `test/acceptance/useragentstrings.yml` at the pinned commit (264 entries across 71 categories)
  - `LICENSE`, copied verbatim from the repository root at the pinned commit

## Upstream's own licence

bowser is MIT-licensed. `LICENSE` in this folder is the exact file from the pinned commit.

## What this is used for

`tools/user-agent/test/index.test.ts` asserts that every entry's own `ua` string, run through this tool's `parseUserAgent`, maps to the same `browser`, `engine`, `os` and `platform` (this tool's `device`) fields the fixture's own `spec` records -- bowser's own test data used as this tool's correctness oracle, not re-derived from memory. Never edited.
