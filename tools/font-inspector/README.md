# Font Inspector & Web Font Converter

Read a font's names, licence text, metrics, glyphs, coverage and features, and convert it between TTF/OTF, WOFF and WOFF2 on your device.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Open a TrueType, OpenType, WOFF or WOFF2 font and read what is inside it: the names and the licence text the font carries, its embedding flags and metrics, the glyph count, a grid of its glyphs, the characters it covers by Unicode block, its OpenType feature tags and its variable axes. A WOFF2 file is unpacked in a background worker that can be cancelled and is stopped after 60 seconds. The font is read on this device and nothing is uploaded.

## Supported

- TrueType and OpenType files (an sfnt with TrueType or CFF outlines), TrueType and OpenType collections one font at a time, WOFF 1.0 files and WOFF2 files, including WOFF2 collections
- Name records of every platform the format defines, decoded as the platform and encoding say: UTF-16BE, Mac Roman and the 936, 950 and 949 code pages, with the licence description and licence address shown in full
- The head, hhea, maxp, OS/2 and post tables: units per em, revision and dates, vertical metrics (with a note when the three places that state them disagree), the embedding flags and what they say
- Character maps of formats 0, 4, 6, 10, 12, 13 and 14, counted by the 346 Unicode blocks of Unicode 17.0.0, and a sample text checked by code point
- GSUB and GPOS feature tags with the scripts and languages that use them, each described in plain words when it is a registered tag, and the axes and named instances of a variable font
- TrueType glyph outlines (simple and composite) and PostScript outlines (CFF with Type 2 charstrings, including subroutines and flex), drawn as one sheet of up to 512 glyphs with their names and code points

## Limits

- The font is read on this device. Nothing is uploaded and no address inside the font (a licence or vendor address) is ever requested; such an address is shown as text only.
- The page shows what the licence fields and embedding flags say. It cannot tell you whether you may use, convert or embed the font; read the licence first.
- Files over 20 MiB are refused before they are read. A WOFF2 file whose tables add up to more than 30 MiB once unpacked, or that would expand more than 100 times (which font readers refuse), is refused before the engine runs. A WOFF 1.0 table is stopped at its stated size while it is being unpacked.
- The WOFF2 engine builds part of its own code when it starts, so this page, and only a few others, allows run-time code generation. That code is the engine's own and is never used on anything you open here.
- Glyph drawings are the default outlines drawn by this page, not the way a browser would show them: no hinting, no variation and no colour layers, and the outlines of variable CFF2 fonts are not drawn. A glyph with more than 5,000 points, 64 components or 8 levels of nested components is drawn only in part, and says so.
- Coverage by Unicode block uses the block list of Unicode 17.0.0. The sample text may hold up to 10,000 characters and a character outside the Basic Multilingual Plane counts once. The grid draws 256 glyphs by default and at most 512.
- A name table with more than 5,000 records, a character map with more than 200,000 groups and a layout table with more than 5,000 features are read only as far as those numbers; the page says what was left out. Collections list at most 100 fonts, and only one is read at a time.

## Ambiguous cases, and what this does about them

- A font with no name table or no character map still shows every other part, with a note that the table is missing.
- Vertical metrics are stated in three places (hhea, the OS/2 typographic values and the OS/2 Windows values) and different systems read different ones; the page shows all three and says when they differ.
- A TrueType outline is drawn shifted by the glyph's left side bearing minus its xMin, as a rasteriser places it; real fonts have equal values, so nothing moves.

## Defined by

- [WOFF File Format 1.0 (W3C Recommendation)](https://www.w3.org/TR/WOFF/)
- [WOFF File Format 2.0 (W3C Recommendation)](https://www.w3.org/TR/WOFF2/)
- [OpenType specification: name table](https://learn.microsoft.com/en-us/typography/opentype/spec/name)
- [OpenType specification: OS/2 table](https://learn.microsoft.com/en-us/typography/opentype/spec/os2)
- [OpenType specification: cmap table](https://learn.microsoft.com/en-us/typography/opentype/spec/cmap)
- [OpenType specification: registered features](https://learn.microsoft.com/en-us/typography/opentype/spec/featurelist)
- [OpenType specification: fvar table](https://learn.microsoft.com/en-us/typography/opentype/spec/fvar)
- [OpenType specification: glyf table](https://learn.microsoft.com/en-us/typography/opentype/spec/glyf)
- [OpenType specification: CFF table](https://learn.microsoft.com/en-us/typography/opentype/spec/cff)
- [Adobe Technical Note 5177: the Type 2 charstring format](https://adobe-type-tools.github.io/font-tech-notes/pdfs/5177.Type2.pdf)
- [Unicode 17.0.0 block list](https://www.unicode.org/Public/17.0.0/ucd/Blocks.txt)

## Bundled data

This folder ships a data file that is not an npm dependency, so it travels with the folder when it is
copied out on its own:

- **WOFF2 reference library (google/woff2) compiled into woff2-encoder 2.0.0** (MIT) — [source](https://github.com/google/woff2/tree/4721483ad780ee2b63cb787bfee4aa64b61a0446). Copyright (c) 2013-2017 by the WOFF2 Authors. The code is compiled into the WebAssembly module that woff2-encoder 2.0.0 carries inside dist/index.js as a base64 data address, built from this commit by Emscripten 3.1.46, which is why the licence gate cannot find it among the package's files.
- **Brotli (google/brotli) compiled into woff2-encoder 2.0.0** (MIT) — [source](https://github.com/google/brotli/tree/533843e3546cd24c8344eaa899c6b0b681c8d222). Copyright (c) 2009, 2010, 2013-2016 by the Brotli Authors. Brotli is the library the WOFF2 reference code uses (its submodule at this commit) and is compiled into the same WebAssembly module inside woff2-encoder 2.0.0's dist/index.js, as a base64 data address that the licence gate cannot find.
- **Emscripten runtime 3.1.46 compiled into woff2-encoder 2.0.0** (MIT) — [source](https://github.com/emscripten-core/emscripten/tree/3.1.46). Copyright (c) 2010-2014 Emscripten authors. The Dockerfile and Makefile of woff2-encoder 2.0.0 say its WebAssembly was built with Emscripten 3.1.46, and the Emscripten runtime and C library are part of that module. Emscripten is offered under the MIT licence and the University of Illinois/NCSA licence; the MIT licence is the one relied on here, and the notice file holds both texts.
- **Unicode 17.0.0 block list (Blocks-17.0.0.txt) compiled into src/blocks.ts** (Unicode-3.0) — [source](https://www.unicode.org/Public/17.0.0/ucd/Blocks.txt). "Blocks-17.0.0.txt", (c) 2025 Unicode, Inc., from the Unicode Character Database, licensed under the Unicode License V3 (https://www.unicode.org/license.txt), turned into this package's block table by a generator script.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/font-inspector font-inspector
cd font-inspector
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/font-inspector
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { inspectFont, readContainer } from '@fodt/font-inspector';

const container = readContainer(bytes); // bytes: a Uint8Array holding a .ttf or .otf file
container.kind; // 'sfnt', or 'collection', 'woff' or 'woff2'

const report = inspectFont(bytes, { glyphStart: 0, glyphCount: 64, sample: 'Hello' });

report.font.family; // 'Det Sans'
report.font.unitsPerEm; // 1000
report.licence; // the licence description and address records, decoded
report.features; // [{ tag: 'liga', tables: ['GSUB'], uses: ['latn/dflt'], description: '...' }]
report.coverage.blocks; // [{ name: 'Basic Latin', covered: 6, size: 128, ... }]
report.grid.dataAddress; // one SVG sheet of the glyphs as a data address
```

`readContainer(bytes)` checks the size first, then reads the start of a TrueType, OpenType or collection file; a WOFF or WOFF2 file is recognised and must be unpacked with `unwrapWoff1(bytes)` or, for WOFF2, `unpackWoff2(bytes, engine)` before it is inspected. `unwrapWoff1` inflates each table through a streaming reader that stops at the table's stated size. `planWoff2(bytes)` pre-checks a WOFF2 header and table directory (30 MiB out, 100 times expansion, 512 tables, a lying total size refused) before the engine is called; the engine itself is in `src/engine.ts`, is given to `unpackWoff2` by the caller and is never imported by the package index. `inspectFont(sfnt, options)` reads one font of an sfnt (a collection member is picked with `member`, counting from 1) into plain data: names and licence text, metrics, embedding flags, tables with their checksums, features, axes, coverage, the sample check and the glyph grid. `openGlyphs(sfnt, member)` draws single glyphs. A table that is damaged or missing does not stop the report: a note says what could not be read. Every refusal is a `FontInspectorError` whose message names the field or byte offset and never repeats the font's bytes, and the package prints nothing.

## Dependencies

- `woff2-encoder` 2.0.0
- `fflate` 0.8.3

## Tests

```sh
npm test
```

Fonts are built by fontTools 4.64.0 in test/fixtures/build-fonts.py with fixed dates, and fontTools' own reading of them is recorded in test/fixtures/recorded.json: 45 checks of names on three platforms, character maps, layout features with scripts and languages, metrics, embedding flags, variable axes and every outline segment, all of which the reader must equal. Mac Roman equals Python's and fontTools' decoding for all 128 high bytes, and the 936, 950 and 949 code pages equal Python's codecs. The WOFF2 engine is compared with wawoff2 2.0.1, a second build of the same Google code. WOFF 1.0 files and a WOFF2 fault list built by editing a good file are refused with one plain sentence, the block table equals the generator's output from the original Unicode data file, every reader is held to a doubling ratio of 6 and a four times ratio of 12 on hostile input, and depth and step caps are tested with hand-made glyphs.

## Licence

MIT. See [LICENSE](./LICENSE).
