# Source Map Stack Trace Decoder

Paste a minified stack trace and its source maps to see each frame's original file, line, column and name, with no address ever fetched.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Paste a stack trace from minified JavaScript and the source map it was built with, and see for every frame the original file, line, column and name, a decoded trace in the shape of the one you pasted, and the original source around each frame. Maps are read by the rules of ECMA-426, first edition, including index maps. Everything is read on this page in a background task that stops after 20 seconds: no address in a map or a trace is ever requested.

## Supported

- Stack traces in the V8 shape (at name (file:line:column), at file:line:column, at async name, at new Name, at Type.name [as method], eval at frames), the SpiderMonkey shape (name@file:line:column) and the JavaScriptCore shape (global code@file:line:column); the position is read from the last two numbers of the address
- Source maps of version 3 as ECMA-426 first edition defines them: the base64 VLQ mappings with 1, 4 or 5 fields per segment, sources joined with sourceRoot, names, sourcesContent, ignoreList (and x_google_ignoreList), and index maps made of sections
- One or more maps pasted one after another, a data: address that holds a map (decoded here, never requested), a first line of )]}' that a server puts in front of a map, and map files opened from disk
- Columns and lines in the trace are one based, as the engines print them; original positions are shown one based as well

## Limits

- The page never downloads a map or a source file and never follows a sourceMappingURL comment or a sources address; they are shown as text. Paste or open the map yourself.
- The map must be the one built together with the file that threw: a map from another build gives confident but wrong answers, so check the file names and the build you took it from.
- A function name in a decoded frame is a best reading from the next frame's call site (a map names the token at a position, not the function around it); both readings are shown, and the last frame has none.
- Engines print different columns for the same throw (JavaScriptCore points at the call parenthesis), so a column a few characters off is expected; the lookup takes the closest mapping at or before the position on the same line.
- Positions are counted in UTF-16 code units as the format defines them. Maps that use the scopes or range mappings proposals are read for positions only; reading several maps one after another (a map of a map) is not done.
- Up to 20 maps of 50 MiB each (80 MiB in all), traces of 5,000 lines and 1 MiB, and index maps with 20,000 sections; larger input is refused with the number named. The one generated line a frame names may hold at most 4,000,000 mappings. The decoded trace keeps a source path whole up to 4,096 characters; the Frames table shows the first 200 characters of a path or a name. A run that takes longer than 20 seconds is stopped.

## Ambiguous cases, and what this does about them

- When a trace has one map and no file name matches, the map is used for every frame and the page says so; with several maps and no match a frame is left as it is.
- When two segments of a map start at the same generated column, the one written last answers, as Node's own source map reader answers.
- A frame whose generated position is before the first mapping of its line, or on a line with no mappings, is shown as a result with that reason, never as an error.

## Defined by

- [ECMA-426 Source map format, first edition (2024)](https://tc39.es/ecma426/2024/)
- [V8 stack trace API (frame shapes)](https://v8.dev/docs/stack-trace-api)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/source-map-decoder source-map-decoder
cd source-map-decoder
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/source-map-decoder
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { decodeStackTrace } from '@fodt/source-map-decoder';

const report = decodeStackTrace({
  trace: 'Error: boom\n    at e (https://example.test/min.js:1:35)\n    at f (https://example.test/min.js:1:128)',
  maps: mapJsonText, // one or more maps, one after another, or a data: address that holds a map
  files: [{ name: 'min.js.map', text: mapFileText }], // opened map files, already read as text
  context: 2, // lines of original source either side of a frame, 0 to 5
});

report.rows[0].original; // 'src/math.ts:3:11'
report.rows[0].functionName; // the function read from the next frame's call site, or null
report.decoded; // the trace again, each mapped frame written with its original place
report.excerpts[0].lines; // the original source around frame 1
```

`decodeStackTrace(input)` checks the sizes first (`checkInput`), reads the trace line by line (`parseTrace`), splits the pasted text into maps (`splitMaps`), reads each map (`parseMap`, with `parseSections` for an index map), gives each frame a map (`matchMaps`), reads each map once keeping only the generated lines the trace names (`decodeNeededLines`) and looks every frame up (`lookup`). A fault in a map is a finding, not an error; sizes and text that is not a map are refused with a `SourceMapError` that names the part, the map number or the character position and never repeats the input. The function holds no state between calls.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The tc39 source-map-tests suite at commit 9ea66b466fd37e8a4050033d23b3e1480973c3dc (99 cases) is vendored byte for byte with its licence and the blob sha of every file: the 32 valid maps read with no finding, the 67 invalid maps each get at least one finding, the 77 mapping checks and the ignore list check give their expected answers, and the 16 actions that need a map of a map are listed by name as not done. The stacks that Chromium 153, Firefox 155, WebKit 26.6 and Node 22.14 printed for one esbuild 0.25.12 bundle are recorded with their scripts and decode to the positions Node's own module.SourceMap gives (WebKit differs in one frame, listed in the test with its reason). Node's module.SourceMap and @jridgewell/trace-mapping 0.3.31 are lookup oracles only, on 2,000 seeded positions over maps made by esbuild, terser and TypeScript and two index maps joining them; no library gives a validity verdict, because they accept maps the suite calls invalid. Node gives a segment with no name field the last name it read, which the specification does not, so names are compared with trace-mapping, and with Node only where the segment has one. Index map offsets, VLQ limits, sourceRoot, the served-map prefix, data addresses, size limits, source excerpts and hostile input are tested from the text of ECMA-426, first edition.

## Licence

MIT. See [LICENSE](./LICENSE).
