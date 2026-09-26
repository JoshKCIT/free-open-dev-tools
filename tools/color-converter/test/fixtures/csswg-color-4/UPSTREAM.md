# Upstream: CSS Color 4 sample conversion code

- Repository: w3c/csswg-drafts
- Commit: bbb1d87033095f792421c668c4211bc4f00cfe93
- Commit date: 2026-09-26T18:43:50Z
- Fetched: 2026-09-26

Vendored, test-only, never imported from `src/`: the sample code is compared digit for
digit against this tool's own `MATRICES` (a small parser in
`test/index.test.ts` extracts the numeric literals from `conversions.js` below), and the
matrices' `deltaE`/gamut-mapping behaviour is checked against it in prose only, never by
running the file itself. `LICENSE.md` is the repository's own licence, kept so the vendored
file's terms travel with it.

Two documented issues against this exact file, checked directly against the fetched text:

- `csswg-drafts#9477` (the OKLab step is undefined for negative XYZ values, i.e. `Math.pow`
  with a fractional exponent on a negative number returns `NaN`): **already fixed** at this
  pinned commit. `XYZ_to_OKLab` (line ~397) computes `LMS.map(c => Math.cbrt(c))`, and
  `Math.cbrt` is defined for negative arguments (unlike `Math.pow(x, 1/3)`), with the file's
  own comment noting exactly this: "JavaScript Math.cbrt returns a sign-matched cube root...
  beware if porting to other languages". This tool's own `color-space.ts` uses `Math.cbrt`
  for the same reason, matching the pinned file rather than working around a bug that no
  longer exists in it.
- `csswg-drafts#5922`/`#7675` (the linear-sRGB-to-XYZ matrix was wrong starting at the fourth
  decimal place until a later erratum): **already fixed** at this pinned commit.
  `lin_sRGB_to_XYZ`/`XYZ_to_lin_sRGB` (line ~54) are written as exact rational fractions
  (e.g. `506752 / 1228815`), which evaluate to the corrected, full-precision matrix values
  (matching Björn Ottosson's own independently-published Oklab-adjacent matrices used
  elsewhere in this tool). The ProPhoto matrix's own comment even cites `#7675` directly:
  "matrix cannot be expressed in rational form, but is calculated to 64 bit accuracy, see
  https://github.com/w3c/csswg-drafts/issues/7675".

## Files

- test/fixtures/csswg-color-4/conversions.js: 459bd6003399260f601c7c66b7641541eccaa7a1
- test/fixtures/csswg-color-4/LICENSE.md: 0f7c218c64691e29b618b5c1fed5cd9db7651727
