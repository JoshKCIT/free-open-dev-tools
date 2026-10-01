# Upstream: Prettier PHP plugin snapshot tests

- **Repository:** https://github.com/prettier/plugin-php
- **Tag:** v0.25.0
- **Fetch date:** 2026-10-01
- **Licence:** MIT (repository `LICENSE` at the same tag, vendored alongside as `LICENSE`, unmodified)

The package under test runs Prettier 3.9.9 with `@prettier/plugin-php` 0.25.0. The plugin's own jest tests keep, for
each fixture file, a snapshot of the options block, the input and the output. They are plain JavaScript modules
(`exports[name] = template literal`), fetched with `curl -fsSL` from
`https://raw.githubusercontent.com/prettier/plugin-php/v0.25.0/tests/<directory>/__snapshots__/jsfmt.spec.mjs.snap`.
The directory's `jsfmt.spec.mjs` was fetched too, to read which options each run passes.

Each case was written into `golden.ts` by a throwaway script that evaluates the snapshot file the way jest does, splits
every case into its options block, input and output, checks that the three pieces rebuild the snapshot text exactly,
and writes each string with `JSON.stringify`, so tabs and trailing spaces are exactly as published. The options block
of every case is kept as the snapshot lists it (`printWidth`, and `phpVersion`, `singleQuote`, `trailingCommaPHP`,
`braceStyle` and `trailingComma` where the run passes them).

## The PHP version

Most runs pass no `phpVersion`. The plugin's default is `auto`, which reads `composer.json` from the working directory
and falls back to the newest version it lists, 8.5; it cannot run in a browser (it calls `process.cwd()` and
`fs.existsSync`). The tests therefore pass `8.5` explicitly for those cases, and the version a run names (5.0, 5.3, 7.0,
7.2, 7.3, 8.0) is passed as named.

## Files quoted

The first seven are the directories the research named (18 cases); the rest exercise the options the page offers.

| Directory (`tests/<directory>/`) | Runs | Options passed | Cases |
| --- | --- | --- | --- |
| `array` | 2 | none; `phpVersion: "5.3"` | `arrays.php` 1 and 2, `single.php` 1 and 2, `single-short.php` 1 and 2 |
| `arrowfunc` | 1 | none | `arrowfunc.php` |
| `assign` | 1 | none | `assign.php` |
| `class` | 1 | none | `anonymous.php`, `class.php` |
| `if` | 1 | none | `if.php` |
| `string` | 1 | none | `multiline.php`, `quoting.php`, `single.php`, `string.php` |
| `switch` | 1 | none | `empty_lines.php`, `empty_switch.php`, `switch.php` |
| `brace-style` | 4 | none; `braceStyle: "psr-2"`; `"per-cs"`; `"1tbs"` | `classes.php`, `functions.php`, `methods.php`, each four times |
| `string-single-quote` | 1 | `singleQuote: true` | `quoting.php` |
| `string-double-quote` | 1 | `singleQuote: false` | `quoting.php` |
| `trailing_commas` | 5 | `phpVersion` 7.0; `trailingCommaPHP: true` with 5.0, 7.2, 7.3; `trailingCommaPHP: false` with 7.0 and `trailingComma: "all"` | `array.php`, `call.php`, `isset.php`, `list.php`, `unset.php`, `use.php`, each five times |
| `trailing_comma_func` | 2 | `trailingComma: "all"`, `trailingCommaPHP: false`, 8.0; `trailingComma: "none"`, `trailingCommaPHP: true`, 8.0 | `function.php`, twice |
| `attributes-trail-comma` | 1 | `trailingCommaPHP: true`, 8.0 | `attributes-trail-comma.php` |
| `single-quote-api` (`jsfmt.spec.mjs`, not a snapshot) | 1 | `singleQuote: true` | the inline test with its input and expected text as literals |

That is 66 cases in all. 62 reproduce byte for byte with the page's options. Prettier's own `trailingComma` default is
`"all"`, so the runs that name it with that value need no extra option on the page.

## Left out, by name

Four cases use an option the page does not offer. They are listed in the test file with the reason, and a test fails if
the list and the computed list differ:

- `brace-style` `classes.php 2`, `functions.php 2`, `methods.php 2`: `braceStyle: "psr-2"`, deprecated in the plugin in
  favour of `per-cs`, not offered.
- `trailing_comma_func` `function.php 2`: `trailingComma: "none"`, a Prettier option the page does not offer.

The snapshot directories that exercise options the plugin has but the page does not (`openingBraceNewLine`,
`requirePragma`, `insertPragma`, `endOfLine`) and the markdown embedding test were not vendored.
