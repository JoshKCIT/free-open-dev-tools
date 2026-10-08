# Test fixtures of the Font Inspector

Nothing here is a third-party font. Every font is built by `build-fonts.py` with fontTools 4.64.0 (MIT) and carries a
statement in name ID 13 that it is released as CC0-1.0. The recorded readings in `recorded.json` are what fontTools itself
reads from those fonts, so the package's own reader is held to a second opinion.

## The fonts

`build-fonts.py <folder>` writes the files below. Every date is fixed, so a rebuild is byte for byte the same file: the script
was run twice and the two lists of sha256 values were identical.

| File | Bytes | sha256 | What it is |
| ---- | ----- | ------ | ---------- |
| `det-sans.ttf` | 1,672 | `3431095620caa514fe33801cacc7913420e5d22b9ef03427009615560320c227` | Seven glyphs, 1000 units per em, features `liga` and `kern`; the font of the live fixture |
| `det-sans-canary.ttf` | 1,780 | `ba1cbc78bc4a387bf3522fabc79fc8c681f25a85ded3655af619d8646564df31` | The same font with the page's canary appended to name ID 13 (privacy fixture) |
| `plain.ttf` | 2,212 | `8f73d4c0128f9e575b4fcba481b266375e3b243c10a25327c45b9d075f54764f` | TrueType with a composite glyph, features, cmap formats 4, 12 and 14, name records of platforms 0 and 3 (encodings 1 and 10), font revision 1 + 1/256 |
| `mac-names.ttf` | 2,504 | `f0372d0db1b8e32afc64fe0de32460244e05e09e5d57ff300645d03694630053` | The same shape with name records of platforms 0, 1 (Mac Roman) and 3, `fsType` 2 |
| `preview.ttf` | 1,796 | `62c5411d0a95cb90ca7a15f578707b5adeadab6ee9788d95adafcd77e0169009` | `fsType` 4 (preview and print), no layout features |
| `variable.ttf` | 1,868 | `1e77474fc10c885018ba9e43964083ebade286bd5a1de3f374be96b5dd3b9029` | One `wght` axis and one named instance; left side bearings 50 below each glyph's xMin, so the outline shift is tested |
| `cff.otf` | 1,640 | `c7d85c92e531b89c3d635df60e18ef1bc507f16eee43f348448f24d43a6f4f77` | OpenType with CFF outlines (a curve among them) |
| `collection.ttc` | 3,440 | `6b4bb9e46b9a8345f88213de1120ffab0640af0e2ecb07a9eca3e29c727ab77f` | Two fonts: `plain.ttf` and `preview.ttf` |
| `plain.woff` | 1,524 | `4244417c4f326f73653be0004fce8f89d9e2068a29b9f66b6de98d855b869eef` | fontTools' own WOFF 1.0 of `plain.ttf` |
| `plain.woff2` | 940 | `72158d840c426908331f5743591c70c78b8e033267490a980abda18f25646327` | fontTools' own WOFF2 of `plain.ttf` |
| `with-blocks.woff2` | 997 | `d61fffabbdc3cb25b809f2654f188351279b5c5c3da85b9a308c7d3ed6389811` | The same WOFF2 with a metadata block and a private data block |

`fonts.ts` holds the files as Base64 with their sizes and sha256 values; a test recomputes each value. fontTools' WOFF and
WOFF2 files are read for their tables only and are never compared byte for byte (fontTools stamps `head.modified` and its
Brotli encoder differs from the engine's).

## The recording

`record.py <folder of the built fonts> recorded.json` reads each font with fontTools and writes `fontTools` (the version),
`recordedAt`, the 128 high Mac Roman bytes as Python and fontTools decode them (`macRoman128`), three legacy code page
samples (`codePages`: gbk, big5 and euc-kr bytes with their text) and 45 `checks`:

- for each of `plain.ttf`, `mac-names.ttf`, `preview.ttf`, `variable.ttf` and `cff.otf`: `names`, `cmap`, `gsub`, `gpos`,
  `metrics`, `embedding` and `outlines` (every segment of every glyph, composites decomposed) - 35 checks;
- `fvarAxes` and `fvarInstances` of `variable.ttf`; `variationSelectors`, `gsubScriptsLanguages` and
  `gposScriptsLanguages` of `plain.ttf` - 5 checks;
- the member count of `collection.ttc` and `names` and `metrics` of both members - 5 checks.

Run order: `python build-fonts.py <folder>`, then `python record.py <folder> recorded.json`, then regenerate `fonts.ts` from the
folder. Python is authoring-time only and is never a repository dependency.

## Unicode block data

`unicode/Blocks-17.0.0.txt` is the original file from https://www.unicode.org/Public/17.0.0/ucd/Blocks.txt (11,663 bytes, md5
`bbb54bbda639796d4d0e9344e537d892`, 346 blocks), kept with the Unicode License V3 text in `unicode/LICENSE.txt`.
`unicode/make-blocks.mjs` writes `src/blocks.ts` from it, and a test requires the table to equal the generator's output.
