# Upstream: Unicode IdnaTestV2.txt (UTS #46 conformance data)

- Source: https://www.unicode.org/Public/17.0.0/idna/IdnaTestV2.txt
- Unicode version: 17.0.0 (the file's own header: `# Version: 17.0.0`, `# Date: 2025-05-01, 19:36:55 GMT`)
- Fetch date: 2026-10-04
- Size: 775,973 bytes, LF line endings, 6,391 test rows
- SHA-256: beb5d0be20e896189b03209a82fdc34f06351502bbd4b8e2523583fc2954d9cf
- Licence: Unicode License V3 (the file's header points to https://www.unicode.org/terms_of_use.html; the licence text copied
  here is https://www.unicode.org/license.txt, fetched the same day)

`IdnaTestV2.txt` is the file at the address above, copied byte for byte with `curl -fsSL`. It is test data only: it is
never shipped with the page and never edited, and it holds raw non-ASCII and direction-changing characters on purpose
(the repository's formatter and linter skip `test/fixtures/`). The tests check it against the SHA-256 above and the git blob
SHA below.

The newest published file (Unicode 18.0.0, dated 2026-02-04) is not used: it differs from this one on 9 rows (newly assigned
code points), and the `tr46` package this tool uses carries the Unicode 17.0.0 mapping data (`unicodeVersion` in its
package.json), so the matching 17.0.0 file is the one to check against.

`LICENSE.txt` is `https://www.unicode.org/license.txt` (Unicode License V3, SHA-256
e7a93b009565cfce55919a381437ac4db883e9da2126fa28b91d12732bc53d96).

## Files

- IdnaTestV2.txt: fdee7e65891191df1bd24ba632d328d28a43c347
- LICENSE.txt: 56da58912807030b451a4700687d5bd02c72d6ed
