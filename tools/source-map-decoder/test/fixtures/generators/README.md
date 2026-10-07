# Maps made by three programs, and two index maps joining them

`maps.json` holds source maps produced by the repository's own copies of esbuild, terser and TypeScript from small
sample sources that `make-maps.mjs` writes itself (nothing is downloaded), together with the generated code each map
belongs to. The versions of the three programs and the time are inside the JSON (`tools`, `recordedAt`).

| Case | Made by | What it is |
| ---- | ------- | ---------- |
| `esbuild-minified-typescript` | esbuild | 24 classes of TypeScript, minified, with a string holding a character outside the Basic Multilingual Plane |
| `tsc-es2019-typescript` | TypeScript | the same source transpiled to ES2019 (not minified), sources inline |
| `terser-mangled-javascript` | terser | 30 functions of plain JavaScript, compressed and mangled |
| `index-map-by-lines` | by hand | an index map whose second section starts on the line after the first |
| `index-map-by-column` | by hand | an index map whose second section starts on the last line of the first, after its last character, so a section's column offset applies on its first line |

## What they are for

The decoder tests use these maps as extra input for the two lookup oracles (Node's `module.SourceMap` and
`@jridgewell/trace-mapping`): for each map 2,000 seeded positions inside the generated code are looked up by the decoder
and by both oracles, and the answers are compared. A map here is never used to decide whether a map is valid; validity
verdicts come only from the vendored tc39 suite and the decoder's own strict reader.

## How to make them again

From the repository root:

```
node tools/source-map-decoder/test/fixtures/generators/make-maps.mjs
```

The script finds the three programs inside the repository's `node_modules/.pnpm` folder, so it needs `pnpm install` to
have run. The output is deterministic except for `recordedAt`.
