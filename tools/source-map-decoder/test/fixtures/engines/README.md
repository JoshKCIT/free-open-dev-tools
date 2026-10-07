# Recorded stack traces of real engines

`stacks.json` holds the stack a thrown error printed in four engines, for one minified bundle, so the decoder is tested
against what engines really print and not against hand-written traces.

## What is recorded

- `min.js` (275 bytes) and `min.js.map` (1,155 bytes): two small TypeScript files (`src/math.ts`, `src/main.ts`) bundled and
  minified by esbuild 0.25.12 (`esbuild src/main.ts --bundle --minify --sourcemap --outfile=out/min.js`). The map
  carries both sources in `sourcesContent`; writing them out under `src/` and running that command with esbuild 0.25.12
  (the version in this repository's lockfile) gives the same two files byte for byte. The script throws a `RangeError`
  from inside `Accumulator.add`.
- `stacks.json`, key `browsers`: the stack of the uncaught error in Chromium, Firefox and WebKit, with each browser's
  version, the Playwright version that drove them (1.63.0), the loopback port the bundle was served on (the system picks
  one, never 4173) and the time. Recorded by `record-browsers.mjs`.
- `stacks.json`, key `node`: the frames Node printed for the same bundle run as a script, once as it is (`plain`) and once with
  `--enable-source-maps` (`mapped`). The second list is Node's own decoding of the same stack and is the reference for
  the positions and function names the decoder must give. The temporary folder the script ran in is written as `<dir>`.
  Recorded by `record-node.mjs` with Node 22.14.0.
- `recordedAt` at the top and inside each key says when.

## How to record again

From the repository root, with the browsers of the repository's Playwright installed:

```
node tools/source-map-decoder/test/fixtures/engines/record-node.mjs
node tools/source-map-decoder/test/fixtures/engines/record-browsers.mjs
```

Each script keeps the other's key when it writes. The tests never run the scripts: they read `stacks.json`.

## What the recording shows

Chromium and Node print V8 frames (`at name (address:line:column)`), Firefox prints SpiderMonkey frames
(`name@address:line:column`), and WebKit prints JavaScriptCore frames (`name@address:line:column`, with `global code`
for the top level). Lines and columns are one based in all four. The columns agree between Chromium, Firefox and Node
(35, 128, 178, 220, 234, 240). WebKit reports 49, 129, 181, 221, 235 and 240 for the same throws, because
JavaScriptCore points at the call parenthesis (or the end of the called name) and not at the callee. With the lookup
that takes the closest mapping at or before a position, five of the six WebKit frames land on exactly the same original
position as the other engines; the first one decodes to `src/math.ts` 3:15 (the name `RangeError`) where the others give
3:11 (the `new` before it). That one frame is the only difference, and the decoder's test lists it by number.
