# Upstream: Unicode.org CP437.TXT

- **Source:** https://www.unicode.org/Public/MAPPINGS/VENDORS/MICSFT/PC/CP437.TXT
- **Fetch date:** 2026-09-27
- **Licence:** Unicode License v3 (https://www.unicode.org/license.txt), quoted in full in
  `../../src/cp437-NOTICE.txt`
- **File in this folder:** `CP437.TXT`, byte for byte as fetched.

The file's own header ("Name: cp437_DOSLatinUS to Unicode table", "Unicode version: 2.0",
"Table version: 2.00", "Table format: Format A") states three tab-separated columns per
line: the code page 437 byte (hex), the mapped Unicode code point (hex), and a comment
naming the character. `../../test/build-cp437.ts` parses every `0xXX<TAB>0xYYYY<TAB>#NAME`
line into `../../src/cp437.ts`'s 256-entry table, asserting all 256 byte values 0x00-0xFF
are covered exactly once.

This file is not a git blob from another repository -- it is fetched directly from
Unicode.org's own web server, not vendored from a git tree. The SHA below is still the git
blob SHA-1 (`git hash-object`'s own algorithm: SHA-1 over `blob <length>\0<bytes>`) of the
exact bytes in this folder, computed locally, so `test/upstream.ts`'s own tamper check
applies unchanged; it is not a SHA recorded anywhere by Unicode.org itself. Content fixity
is additionally proven by `test/build-cp437.ts`'s own generator-equality test: the committed
`src/cp437.ts` must equal a fresh build from this exact file.

## Files

- CP437.TXT: 8f74deffb752456f51be6a1eee61ef9cf41f801e
