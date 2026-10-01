# Upstream: dart_style tall-style test data

- **Repository:** https://github.com/dart-lang/dart_style
- **Tag:** v3.1.4
- **Fetch date:** 2026-10-01
- **Licence:** BSD-3-Clause (repository `LICENSE` at the same tag, vendored alongside as `LICENSE`, unmodified)

The package under test runs dart_style compiled to WebAssembly. The wrapper (`@wasm-fmt/dart_fmt` 0.4.0) does not
record the dart_style version it was built with, but the engine's own source map (`dart_fmt.wasm.map`) lists
`dart_style-3.1.4`, and dart_style 3.1.4 (published 2026-01-14) was the newest release when the wrapper was published
(2026-01-18). The fixtures below are therefore read at `v3.1.4`.

The files were fetched with `curl -fsSL` from `https://raw.githubusercontent.com/dart-lang/dart_style/v3.1.4/...` and
each case was written into `golden.ts` by a throwaway script using `JSON.stringify`, so tabs and trailing spaces are
exactly as published. The script reads a `.unit` file the way `lib/src/testing/test_file.dart` at the same tag does:

- a first line ending in `|` gives the page width, the position of the bar (`40 columns` then spaces then the bar is 40);
  a file with no such line is run at dart_style's default page width, 80;
- lines starting with `###` after a header are comments and are skipped;
- each `>>>` line starts a case (the rest of the line is its description and may carry options such as `(indent 2)`),
  the lines up to the next `<<<` line are the input, and the lines after it up to the next `>>>` or `<<<` are the
  expected output; every text keeps the final line break;
- a `<<< 3.8` line starts an output for a language version (the newest version's output is the one the engine
  produces); a case with options `(indent N)`, `(experiment ...)` or `(trailing_commas preserve)`, or with the
  fixture's selection and unicode escape markers, needs something the page does not offer.

## Files quoted

- `test/tall/top_level/import.unit` (header `40 columns |`): all 15 cases, at a page width of 40. Wrapping before `as`
  and `deferred`, import configurations and their splitting.
- `test/tall/regression/0000/0084.unit` (no width header, so 80): all 4 cases, at the default page width of 80. Long
  parameter lists and method chains that wrap at 80 columns.

Each case reproduces byte for byte; none is left out of these two files.

## Checked while choosing, not vendored

All 284 `.unit` files of `test/tall` were read with the same script and run through the installed engine at their own
width: every case that needs no option the page lacks (836 of the 924 cases) reproduced byte for byte, using the newest
language version's output for cases with version sections. The other 88 cases use `(indent N)`, `(experiment ...)`,
`(trailing_commas preserve)` or the selection and unicode escape markers. No `.unit` file declares `80 columns`
explicitly; the files with no width header (the regression files) are the ones run at 80.
