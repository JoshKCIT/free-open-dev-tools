# ASCII Art Text

Render text as an ASCII banner from bundled figlet-style fonts.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Renders text as a large ASCII banner using one of 15 bundled FIGlet fonts, each shipped in the browser bundle rather than fetched. Supports full-width layout, where every character keeps its designed width, and fitted layout, where characters are moved together until they would touch.

## Supported

- 15 bundled FIGlet Version 2 fonts: standard, small, slant, big, block, bubble, digital, lean, mini, script, shadow, smscript, smshadow, smslant and term
- Full width layout, where every character occupies its full designed width
- Fitted layout, where characters are moved together until any visible sub-character (including a font's own hardblank) would overlap
- The 95 printable ASCII characters plus the font's own hardblank-to-space substitution
- A warning naming any input character a chosen font has no glyph for, skipped rather than silently dropped

## Limits

- Only full-width and fitted layouts are implemented; this tool has no smushing (character-merging) layouts, so its output is wider than the reference FIGlet program's default for a font designed to smush
- Right-to-left fonts and vertical layout are not supported
- A character outside a font's own character set (anything past the 95 printable ASCII characters, the required Deutsch characters and that font's own code-tagged extras) is skipped, not substituted
- Only the 15 fonts whose own FIGlet 2.2.5 header explicitly grants a modification permission are bundled; ivrit, mnemonic and banner, published in the same repository, are excluded because their headers grant no such permission (D-41)

## Ambiguous cases, and what this does about them

- Output rows keep every character's own designed width, trailing spaces included: this was checked directly against the figlet reference package's own textSync output for the same font and text, which also keeps them
- A hardblank sub-character renders as an ordinary space in the output text, matching the FIGfont specification's own definition of a hardblank as a sub-character 'displayed as a blank'
- Multi-line input (a line break in the text field) is rendered as separate, independently laid-out banner blocks stacked one after another, with no vertical smushing between them; this differs from the figlet reference package's own default multi-line behaviour, which is out of this tool's scope (see limits: no vertical layout)

## Defined by

- [FIGfont Version 2 specification](https://raw.githubusercontent.com/cmatsuoka/figlet/master/figfont.txt)

## Bundled data

This folder ships a data file that is not an npm dependency, so it travels with the folder when it is
copied out on its own:

- **FIGlet 2.2.5 fonts (15)** (BSD-3-Clause) — [source](https://github.com/cmatsuoka/figlet/tree/master/fonts). FIGlet fonts by Glenn Chappell, Ian Chai, John Cowan, Bruce Jakeway and Paul Burton, part of the FIGlet project (Copyright (C) 1991-2011 Glenn Chappell, Ian Chai, John Cowan, Christiaan Keet and Claudio Matsuoka), licensed under the BSD-3-Clause licence.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/ascii-art ascii-art
cd ascii-art
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/ascii-art
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { renderBanner, parseFont, FONT_NAMES } from '@fodt/ascii-art';

FONT_NAMES; // the 15 bundled font names
renderBanner('standard', 'Hi', { layout: 'fitted' }).lines.join('\n');

// parseFont is exposed separately, for reading a font's own structure directly:
import { FONTS } from '@fodt/ascii-art/dist/fonts/index.js'; // internal build output, not a stable subpath export
parseFont(FONTS.standard);
```

`renderBanner(fontName, text, { layout })` takes a bundled font's name (one of `FONT_NAMES`), not a parsed font, so the caller never has to parse a font itself just to render with it; it throws `FigletFontError` for an unknown font name. `parseFont(text)` reads a raw FIGfont Version 2 file's text into a `FigFont` object directly, for callers that want the parsed structure itself (this package's own tests use it this way); it throws `FigletFontError` for anything that does not match the format's header, signature or required character set. `FONT_NAMES` and `FONTS` (defined in `src/fonts/index.ts`, re-exported from this package's own `index.ts` as `FONT_NAMES`) are the only place the 15 bundled font names and their text live; this package's own `index.ts` never imports the `figlet` npm package, which is a devDependency used only by this package's own tests as a differential oracle.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every bundled font's full-width AND fitted output is compared directly against the `figlet` npm package's own `textSync` output for the same font text and the same input, for a sample of printable ASCII characters (FIGfont Version 2 specification, figfont.txt, cited by name for the header format, the hardblank substitution rule and the endmark-stripping rule). The fitted overlap search is a faithful, hand-verified port of the figlet reference implementation's own fitting-only algorithm (growing a candidate overlap window one column at a time and stopping at the first two-sided collision), not a simplified leading/trailing-blank-run count, which was checked empirically against the reference package and found to diverge on most fonts before this port. `figlet` is never imported outside the test file.

## Licence

MIT. See [LICENSE](./LICENSE).
