# Test fixtures

Two files hold the pictures the reading tests use. Both are committed as text, so the unit tests never run any of the
tools below (CI has other versions of them).

## independent-codes.ts

Barcode and QR images written by someone else: BWIPP (Barcode Writer in Pure PostScript) driven through treepoem,
with Ghostscript turning the PostScript into pixels. Fifteen images, one per symbology asked for (QR Code, Code 128,
Code 39, EAN-13, EAN-8, UPC-A, ITF, Codabar, Data Matrix, PDF417, Aztec, Code 93 with check characters, Code 93
without them, Micro QR, UPC-E), as base64 PNG literals, and three degraded copies in the style of a photograph of a
screen (perspective tilt, blur, low contrast, vignette, moire, noise, JPEG at quality 45), made with a fixed seed.

- Written by `make-fixtures.py` on 2026-10-03.
- Versions: treepoem 3.29.0, Pillow 12.3.0, numpy 2.5.3, Ghostscript 10.07.1, Python 3.14.3.
- Run it from a scratch virtual environment (never the machine's own Python) with Ghostscript on the PATH:
  `python make-fixtures.py` writes `independent-codes.ts` next to the script.
- The expected symbology and text of each image come from the data given to the writer and the symbology asked for,
  and from the GS1 General Specifications for two cases: UPC-A is an EAN-13 symbol with an implied leading zero, and a
  UPC-E symbol expands to 13 digits.
- Second opinion: the same reading engine built for Python (zxing-cpp 3.1.1, run on 2026-10-03 from the same virtual
  environment) read 13 of the 15 as written, read nothing from the Code 93 symbol made without check characters, and
  read the UPC-E symbol as `0012345000065`.

## repository-barcodes.ts

Fourteen symbols written by this repository's Code 128 and EAN/UPC SVG writer at commit 97d3556 (the last commit that
changed the writer's source, checked on 2026-10-03): Code 128 three ways, EAN-13 two ways, EAN-8 and UPC-A, each at
module widths 2 and 3, written with no human readable text and 80 pixel bars. They are kept as the SVG text the writer
returned, because a tool folder may not import another folder. The capture called the writer's own generate function
once per symbol and module width and wrote the results as the literals in the file; the expected text of each symbol
comes from the GS1 General Specifications (the mod 10 check digit, and UPC-A as an EAN-13 symbol with a leading zero),
not from the writer, and the ZXing library 0.21.3 is run on the same pictures as a second opinion in the tests.
