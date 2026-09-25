# Upstream source

**Repository:** https://github.com/OWASP/CheatSheetSeries
**Commit:** `c04039adbe6f727a2198b3a3ea634fec98ac068a` (`master`)
**Fetch date:** 2026-09-25
**Licence:** CC BY-SA 4.0 (see `LICENSE.md` in this folder, the repository's own root licence file)

## Files

- `XSS_Filter_Evasion_Cheat_Sheet.md` — fetched from
  `https://raw.githubusercontent.com/OWASP/CheatSheetSeries/c04039adbe6f727a2198b3a3ea634fec98ac068a/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.md`
- `LICENSE.md` — fetched from
  `https://raw.githubusercontent.com/OWASP/CheatSheetSeries/c04039adbe6f727a2198b3a3ea634fec98ac068a/LICENSE.md`

## Extracted payload count

**107** fenced code blocks tagged ```` ```html ```` or ```` ```js ```` in `XSS_Filter_Evasion_Cheat_Sheet.md`,
counted with a regular expression matching a fence-open line of exactly ` ```html` or ` ```js` (optional
trailing whitespace) through the next fence-close line. `tools/svg-optimizer/test/xss-vectors.ts`'s
`loadXssVectors()` extracts the same set the same way; `EXPECTED_VECTOR_COUNT` is this number, so a
broken extractor fails a test rather than silently passing on zero payloads.

Neither file was modified after fetching.
