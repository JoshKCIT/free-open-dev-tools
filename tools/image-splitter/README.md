# Image Splitter (Grid Tiles to ZIP)

Cut an image into a grid of tiles by rows and columns or by tile size and download them as a ZIP.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Cuts one picture into a grid of tiles inside your browser, either by a number of rows and columns or by a tile width and height, writes each tile as a PNG or JPEG, and packs them into tiles.zip. You also get a table of every tile's name, position and size. Nothing is sent, stored or recorded: your picture, the tiles and the ZIP stay in this page.

## Supported

- PNG, JPEG, GIF, WebP and BMP image files
- Rows and columns mode: the picture is divided into the number of rows and columns you choose, as evenly as whole pixels allow
- Tile size mode: tiles of the width and height you choose, starting at the top left, with smaller tiles at the right and bottom edges when the size does not divide the picture
- PNG tiles, which hold the picture's pixels exactly, or JPEG tiles
- A tiles.zip file that stores the tiles without further compression, with tile names such as tile-r1-c1.png

## Limits

- Files up to 100 MB and 40,000,000 pixels are accepted, and at most 400 tiles are made.
- In rows and columns mode the tiles differ by at most one pixel; in tile size mode the last row and column are smaller when the size does not divide.
- Rows and columns each go from 1 to 100, and a tile size from 1 to 40,000 pixels; a picture cannot be cut into more rows or columns than it has pixels.
- Tiles are written as this browser encodes PNG or JPEG; JPEG tiles lose detail, and transparent areas become white because JPEG has no transparency.
- Splitting can be cancelled at any time; a cancelled run offers no ZIP.
- A browser can refuse to draw a very large tile or to encode it; the page then says so, and smaller tiles work.
- The ZIP holds at most 1 GB of tiles; it does not compress them again, because PNG and JPEG are already compressed.
- Pictures are cut as this browser decodes them, with photo orientation applied; an animated GIF or WebP is cut as the browser draws it, normally its first frame.
- Tile names are made from the row and column numbers only, never from the picked file's name.

## Ambiguous cases, and what this does about them

- In rows and columns mode a column starts at the whole number below its exact share of the width, so an image 10 pixels wide in 4 columns has columns 2, 3, 2 and 3 pixels wide, not 2.5 each
- In tile size mode a size larger than the picture gives one tile the size of the picture rather than a refusal
- Tile names count from 1 and are padded with zeros to the width of the largest row or column count, so a grid of 12 columns has names such as tile-r01-c01.png
- The bytes of a PNG or JPEG tile differ between browsers; only the pixels of a PNG tile are the same everywhere
- The colour profile tags some browsers add to a PNG are removed from the PNG tiles, so each holds plain sRGB values that every browser shows as they were drawn

## Defined by

- [PKWARE ZIP APPNOTE (local file header, central directory, stored entries and CRC-32)](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)
- [Portable Network Graphics (PNG) Specification, Third Edition](https://www.w3.org/TR/png-3/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/image-splitter image-splitter
cd image-splitter
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/image-splitter
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { planTiles, zipTiles } from '@fodt/image-splitter';

// A 10 by 7 picture in 3 rows and 4 columns: columns 0 to 2, 2 to 5, 5 to 7 and 7 to 10; rows 0 to 2, 2 to 4 and 4 to 7.
const tiles = planTiles(10, 7, { kind: 'grid', rows: 3, columns: 4 }, 'png');
console.log(tiles[0]); // { row: 1, column: 1, x: 0, y: 0, width: 2, height: 2, name: 'tile-r1-c1.png' }
// Once each tile is encoded to bytes (three bytes stand in for a PNG here), store them all in one ZIP:
const zip = zipTiles(tiles.map((t) => ({ name: t.name, bytes: new Uint8Array([1, 2, 3]) })));
console.log(zip.length);
```

`planTiles(width, height, mode, format)` returns the tile rectangles in row-major order, where mode is `{ kind: 'grid', rows, columns }` or `{ kind: 'size', tileWidth, tileHeight }` and format is 'png' or 'jpeg'; it refuses a size that is not a whole positive number, rows or columns over 100 or more than the picture has pixels, a tile size over 40,000, and more than 400 tiles, throwing `ImageSplitterError` with a plain sentence. `tileName(row, column, rows, columns, format)` gives the zero-padded name. `zipTiles(entries)` writes a ZIP that stores each entry without compression, with a fixed modification time so the same tiles always give the same bytes; it refuses names that are not plain generated file names. `plainPng(bytes)` removes colour profile tags from a PNG. `checkSplitFile(header, byteLength)` refuses an over-size, unsupported or over-large picture before any decoding.

## Dependencies

- `fflate` 0.8.3

## Tests

```sh
npm test
```

Tile rectangles are worked out by hand from the rules and written into the tests as literals: a picture 10 pixels wide and 7 tall in 4 columns and 3 rows has columns 0 to 2, 2 to 5, 5 to 7 and 7 to 10 and rows 0 to 2, 2 to 4 and 4 to 7; cut into tiles of 4 by 3 pixels it has edge tiles 2 wide and 1 tall. Seeded pictures check that tiles cover every pixel exactly once. The ZIP is read back by a small reader written in the test from PKWARE's APPNOTE (local header signature 0x04034b50, central directory 0x02014b50, end record 0x06054b50, method 0 for stored), and each entry's CRC-32 is computed in the test from the IEEE 802.3 polynomial and checked against the published check value 0xCBF43926 for the nine ASCII digits 123456789. In a browser, a picture made fresh with a different opaque colour in every pixel is split and every PNG tile is decoded and compared pixel for pixel with the matching part of the drawn picture.

## Licence

MIT. See [LICENSE](./LICENSE).
