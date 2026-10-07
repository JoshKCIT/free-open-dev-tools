# Font Inspector & Web Font Converter

Read a font's names, licence text, metrics, glyphs, coverage and features, and convert it between TTF/OTF, WOFF and WOFF2 on your device.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Open a TrueType, OpenType, WOFF or WOFF2 font and read what is inside it: the names and the licence text the font carries, its embedding flags and metrics, the glyph count, the tables, the OpenType feature tags and variable axes, and which characters it covers by Unicode block. A WOFF2 file is unpacked in a background worker that can be cancelled. The font is read on this device and nothing is uploaded.

## Supported

- TrueType and OpenType files (sfnt with TrueType or CFF outlines), TrueType and OpenType collections one font at a time, WOFF 1.0 files and WOFF2 files
- Name records of every platform the format defines, decoded as the platform and encoding say: UTF-16BE, Mac Roman and the 936, 950 and 949 code pages

## Limits

- The font is read on this device. Nothing is uploaded and no address inside the font (a licence or vendor address) is ever requested; such an address is shown as text only.
- The page shows what the licence fields and embedding flags say. It cannot tell you whether you may use, convert or embed the font; read the licence first.
- Files over 20 MiB are refused before they are read. A WOFF2 file whose tables add up to more than 30 MiB, or that would expand more than 100 times, is refused before the engine runs.
- The WOFF2 engine builds part of its own code when it starts, so this page, and only a few others, allows run-time code generation. That code is the engine's own and is never used on anything you open here.

## Ambiguous cases, and what this does about them

- A font with no name table or no character map still shows every other part, with a note that the table is missing.

## Defined by

- [WOFF File Format 1.0 (W3C Recommendation)](https://www.w3.org/TR/WOFF/)
- [WOFF File Format 2.0 (W3C Recommendation)](https://www.w3.org/TR/WOFF2/)
- [OpenType specification: name table](https://learn.microsoft.com/en-us/typography/opentype/spec/name)

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
import { readContainer, inspectFont } from '@fodt/font-inspector';

const container = readContainer(bytes); // bytes: a Uint8Array holding a .ttf or .otf file
const report = inspectFont(bytes, {});

report.font.family; // 'Det Sans'
report.names; // every name record, decoded
report.metrics.unitsPerEm; // 1000
```

`readContainer(bytes)` checks the size first, then reads the table directory of a TrueType, OpenType or collection file with every table range compared against the file. `unwrapWoff1(bytes)` inflates the tables of a WOFF 1.0 file through a streaming reader that stops at each table's stated size. `planWoff2(bytes)` pre-checks a WOFF2 header and table directory before the engine is called; the engine itself is in `src/engine.ts` and is never imported by the package index. `inspectFont(sfnt, options)` reads one font of an sfnt into plain data. Every failure is a `FontInspectorError` whose message names the field or offset and never repeats the font's bytes.

## Dependencies

- `woff2-encoder` 2.0.0
- `fflate` 0.8.3

## Tests

```sh
npm test
```

Fonts are built by fontTools 4.64.0 in test/fixtures/build-fonts.py, and fontTools' own reading of them is recorded in test/fixtures/recorded.json. The WOFF2 engine is compared with wawoff2 2.0.1, a second build of the same Google code.

## Licence

MIT. See [LICENSE](./LICENSE).
