# Upstream source

**Repository:** https://github.com/commonmark/commonmark-spec
**Tag:** `0.31.2`
**Commit:** `9103e341a973013013bb1a80e13567007c5cef6f` (resolved from the `0.31.2` tag ref)
**Fetch date:** 2026-09-25
**Licence:** CC BY-SA 4.0 for `spec.txt` (John MacFarlane); BSD-2-Clause for the test tooling. See `LICENSE`
in this folder, the repository's own root licence file, which documents both.

## Files

- `spec.txt` — fetched from
  `https://raw.githubusercontent.com/commonmark/commonmark-spec/9103e341a973013013bb1a80e13567007c5cef6f/spec.txt`
- `LICENSE` — fetched from
  `https://raw.githubusercontent.com/commonmark/commonmark-spec/9103e341a973013013bb1a80e13567007c5cef6f/LICENSE`

## Extracted example count

**652** numbered example blocks (the `````````````````````````````````` example` fence through the matching
close fence, separated by a `.` line into a Markdown part and an HTML part), extracted the way upstream's
own `test/spec_tests.py` (`get_tests`) does: `tools/markdown-html/test/spec-examples.ts`'s `readSpecExamples`
is a port of that function. Counted with `grep -c "^\`{32} example" spec.txt`.

Neither file was modified after fetching.
