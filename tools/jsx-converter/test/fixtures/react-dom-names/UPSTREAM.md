# Upstream source: React's `possibleStandardNames`

- **Repository:** https://github.com/facebook/react
- **File:** `packages/react-dom-bindings/src/shared/possibleStandardNames.js`
- **Commit (main, pinned):** `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51`
- **Fetched:** 2026-09-25
- **Licence:** MIT (repository `LICENSE`, vendored alongside this file, unmodified)
- **Files in this folder:**
  - `possibleStandardNames.js` — the file itself, byte for byte, at the pinned commit
  - `LICENSE` — the repository's own MIT licence text, at the same commit
- **Extracted entry count:** 494 lowercase-key to React-prop-name pairs (`test/index.test.ts` re-reads
  this file by line pattern and asserts this count and every pair equal `src/react-attribute-names.ts`).

This file is never imported or executed by this package's source or tests. It is read as plain text by
a line-pattern parser (matching `key: 'Value',` and `'quoted-key': 'Value',` lines) so the equality test
does not depend on this file being valid, loadable JavaScript in the test runner's module graph.
