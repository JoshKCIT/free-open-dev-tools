# Upstream source

**Repository:** https://github.com/github/cmark-gfm
**Commit:** `499789b49373bfa045d0e7547e5ee63444c77bca` (`master` at fetch time)
**Fetch date:** 2026-09-25
**Licence:** `test/spec.txt`'s own front matter declares itself `license: '[CC-BY-SA
4.0](http://creativecommons.org/licenses/by-sa/4.0/)'`, version `0.29`. `COPYING` in this folder is the
repository's own root licence file (BSD-2-Clause), which covers the C source, not the spec text; the spec
text's licence is the CC-BY-SA 4.0 declaration quoted above, from the file itself.

## Files

- `spec.txt` — fetched from
  `https://raw.githubusercontent.com/github/cmark-gfm/499789b49373bfa045d0e7547e5ee63444c77bca/test/spec.txt`
- `COPYING` — fetched from
  `https://raw.githubusercontent.com/github/cmark-gfm/499789b49373bfa045d0e7547e5ee63444c77bca/COPYING`

## Extracted example count

**672** numbered example blocks total (the same fence format as `commonmark-spec/spec.txt`, extended with an
optional extension tag after the word `example` on the open-fence line, e.g. `` ```` example table ``).
Counted with `grep -c "^\`{32} example" spec.txt`. Breakdown by tag, counted with
`grep -oE "example [a-z]+$" spec.txt | sort | uniq -c`:

| Tag | Count | Section |
|---|---|---|
| (none — base CommonMark examples reused verbatim) | 650 | throughout |
| `table` | 8 | Tables (extension) |
| `strikethrough` | 2 | Strikethrough (extension) |
| `autolink` | 11 | Autolinks (extension) |
| `tagfilter` | 1 | Disallowed Raw HTML (extension) |
| `disabled` | 2 | Task list items (extension) — both examples in this section carry this
tag rather than a `tasklist` extension tag; upstream's own `test/spec_tests.py` excludes `disabled`-tagged
examples from a normal run. This project's `readSpecExamples` extracts them (so they are counted), and the
required test skips only the `disabled`-tagged pair while still counting them, matching upstream's own rule.

`tools/markdown-html/test/spec-examples.ts`'s `readSpecExamples` is a port of upstream's own
`test/spec_tests.py` (`get_tests`), extended to also capture the optional extension tag after `example` on
the open-fence line, which `spec_tests.py` itself ignores (it treats the whole rest of that line as
insignificant) but this project's tests key on. Example 198 is the first `table`-tagged example, confirmed
directly: `sed -n '1,3325p' spec.txt | grep -c "^\`{32} example"` returns 197, so the fence opening at line
3325 is example 198 — matching the plan's own reference to "GFM spec example 198".

Neither file was modified after fetching.
