# Barcode Generator

Generate Code 128, EAN-13, EAN-8 and UPC-A barcodes as SVG.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Builds a Code 128, EAN-13, EAN-8 or UPC-A barcode as SVG, computing the GS1 check digit or Code 128 check character for you, or confirming one you already have and naming the correct digit if it is wrong. Every symbology is encoded by hand against the GS1 General Specifications, with a decode round trip against an independent reader in tests.

## Supported

- Code 128 (ISO/IEC 15417) for any ASCII text up to 80 characters, with automatic code set A/B/C selection that minimises the symbol's length
- EAN-13, EAN-8 and UPC-A (GS1 General Specifications) with the check digit computed from 12, 7 or 11 data digits, or confirmed from 13, 8 or 12
- A wrong supplied check digit refused, naming the digit it should have been
- Adjustable module width, bar height, custom dark/light colours and an optional human-readable text row
- UPC-A encoded as the equivalent EAN-13 symbol with an implied leading zero, exactly as GS1 defines

## Limits

- No EAN/UPC 2- or 5-digit add-on symbols and no UPC-E.
- No GS1-128 Application Identifiers and no Code 128 FNC codes; Code 128 here is plain ASCII text only.
- Code 128 accepts ASCII characters 0 to 127 only, at most 80 of them.
- A correctly generated barcode still depends on print size and print quality to scan reliably in the real world, which this tool cannot control.

## Ambiguous cases, and what this does about them

- The human-readable digits under an EAN-13 or UPC-A barcode are grouped and centred under each half of the symbol for readability; this tool does not reproduce GS1's own precise typographic guide-bar spacing for the isolated leading and check digits, since that is a print-layout detail, not part of the encoded data.
- GS1's own 'Symbol length in modules' summary table (Table 5-12) did not extract cleanly from the fetched specification's automated text conversion; this tool instead derives each symbology's bar count arithmetically from the specification's own structural description (guard patterns plus symbol characters), cross-checked against Table 5-11's quiet zone figures for EAN-13 (11 + 95 + 7 = 113, matching Table 5-12's own EAN-13 entry).

## Defined by

- [GS1 General Specifications (Release 26.0) — check digit calculation, EAN/UPC and GS1-128 symbology specifications](https://ref.gs1.org/standards/genspecs/)
- [ISO/IEC 15417 — Automatic identification and data capture techniques — Code 128 bar code symbology specification](https://www.iso.org/standard/43896.html)
- [ISO/IEC 15420 — Automatic identification and data capture techniques — EAN/UPC bar code symbology specification](https://www.iso.org/standard/45308.html)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/barcode-generator barcode-generator
cd barcode-generator
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/barcode-generator
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { generateBarcode, gs1CheckDigit } from '@fodt/barcode-generator';

gs1CheckDigit('036000241457'.slice(0, 11)); // '7'
const { svg } = generateBarcode({ symbology: 'ean13', data: '036000241457' });
```

generateBarcode is the one entry point the page uses; gs1CheckDigit, encodeEan13, encodeEan8, encodeUpcA and encodeCode128 are exported too for anyone who only needs the maths, not the SVG. Every encode function accepts data with or without its own check digit/character: with one, it is verified and BarcodeError names the expected value if it is wrong; without one, it is computed.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

GS1's own General Specifications were fetched from ref.gs1.org/standards/genspecs/ (Release 26.0) and converted with pdftotext; the check digit worked example (Table 7-9) and the EAN/UPC number-set widths (Table 5-3) are quoted in source comments and reproduced exactly in tests. The Code 128 symbol pattern table and the EAN/UPC digit-width tables are cross-checked against the installed @zxing/library's own source (Code128Reader.CODE_PATTERNS, AbstractUPCEANReader.L_PATTERNS), which independently agrees with the fetched GS1 text everywhere both were checked. @zxing/library (devDependency-only, pinned to 0.21.3 since 0.22 and later require Node 24) decodes every symbology's own rendered SVG in tests; a symbology found unreliable to decode this way is named in KNOWN_DECODE_GAPS with a reason, and the check-digit and pattern-table tests remain the primary proof either way.

## Licence

MIT. See [LICENSE](./LICENSE).
