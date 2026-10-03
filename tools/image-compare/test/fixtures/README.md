# Test fixtures

`pixelmatch-vectors.ts` holds two published test images as base64 PNG literals, so the unit tests never fetch or run
anything.

- Source: `test/fixtures/1a.png` and `test/fixtures/1b.png` of pixelmatch's own repository at the tag `v7.2.0`
  (`https://github.com/mapbox/pixelmatch/tree/v7.2.0/test/fixtures`), fetched on 2026-10-03 by
  `make-fixtures.mjs` (run it from the repository root with Node 22: `node tools/image-compare/test/fixtures/make-fixtures.mjs`).
  pixelmatch is ISC licensed, Copyright (c) 2025, Mapbox.
- Both images are 512 by 256 pixels, 8-bit RGBA, not interlaced (checked from the PNG header on the same date).
- Published expected counts, from `test/test.js` at the same tag: `1a` against `1b` at threshold 0.05 differs in 143
  pixels (`diffTest('1a', '1b', '1diff', { threshold: 0.05 }, 143)`) and at the default threshold of 0.1 in 106
  (`diffTest('1a', '1b', '1diffdefaultthreshold', { threshold: undefined }, 106)`), anti-aliased pixels skipped.
- The other published vectors of that test file use images of 27 KB to 240 KB each and are not copied; the two above
  carry the semantics the tests need (a real picture pair, two thresholds).
