# Upstream: Prettier PHP plugin snapshot tests

- **Repository:** https://github.com/prettier/plugin-php
- **Tag:** v0.25.0
- **Fetch date:** 2026-10-01
- **Licence:** MIT (repository `LICENSE` at the same tag, vendored alongside as `LICENSE`, unmodified)

The package under test runs Prettier 3.9.9 with `@prettier/plugin-php` 0.25.0. The plugin's own jest tests keep, for
each fixture file, a snapshot of the options block, the input and the output. They are plain JavaScript modules
(`exports[name] = template literal`), fetched with `curl -fsSL` from
`https://raw.githubusercontent.com/prettier/plugin-php/v0.25.0/tests/<directory>/__snapshots__/jsfmt.spec.mjs.snap`.

Each case was written into `golden.ts` by a throwaway script that evaluates the snapshot file the way jest does, splits
every case into its options block, input and output, checks that the three pieces rebuild the snapshot text exactly,
and writes each string with `JSON.stringify`, so tabs and trailing spaces are exactly as published.

## Files quoted

- `tests/array/__snapshots__/jsfmt.spec.mjs.snap`, first case `arrays.php 1` (line 3): printed at print width 80 with
  no PHP version in the spec run. The plugin's default PHP version is `auto`, which reads `composer.json` from the
  working directory and falls back to the newest version it lists, 8.5; the test passes `8.5` explicitly, because
  `auto` cannot run in a browser.
