# Upstream of the WHATWG index files

Three index files are copied byte for byte from the WHATWG Encoding Standard. Each lists the code point for every
pointer of a single-byte encoding; pointer `n` is the byte `0x80 + n`, and pointers 0 to 127 cover the bytes 80 to FF.

| File                      | Address                                                    | Identifier (the file's own header)                                 |
| ------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `index-windows-1252.txt`  | https://encoding.spec.whatwg.org/index-windows-1252.txt    | `e56d49d9176e9a412283cf29ac9bd613f5620462f2a080a84eceaf974cfa18b7` |
| `index-koi8-r.txt`        | https://encoding.spec.whatwg.org/index-koi8-r.txt          | `c5497cd9071cb352c0e56b219154e539badf63de40b71578f09e2e11fe7d50ae` |
| `index-windows-1251.txt`  | https://encoding.spec.whatwg.org/index-windows-1251.txt    | `7592ef921679ba168b00a9e9afa3b4eebd67bf13dc7e84c4b6e120de856826e0` |

- **Document:** WHATWG Encoding Standard, Living Standard (Last Updated 21 May 2026 on the fetch date). The three files
  are all dated 2024-09-18 in their own headers.
- **Fetched:** 2026-10-02.
- **Copyright and licence:** Copyright (c) WHATWG (Apple, Google, Mozilla, Microsoft). The standard's page says: "This
  work is licensed under a Creative Commons Attribution 4.0 International License. To the extent portions of it are
  incorporated into source code, such portions in the source code are licensed under the BSD 3-Clause License instead."
  The files are test data (tables of 128 pointers and code points) and are attributed here to the WHATWG Encoding
  Standard.
- **How they were made:** `curl -fsSL` of each address into a scratch directory, then copied here unchanged. Nothing in
  them was typed by hand or produced by this package.
- **Rows:** 128 in each. For `index-windows-1252.txt`, pointer 0 is `0x20AC`, pointer 31 is `0x0178`, and pointers 32 to
  127 are the identity from `0x00A0`.

## Rows quoted as literals, not copied

The Shift_JIS test quotes rows of `index-jis0208.txt` (https://encoding.spec.whatwg.org/index-jis0208.txt, identifier
`cbaa91f3deb7d0841faf5c33041fc15a285da0e87e64ab802c4bf04b7c4da861`, dated 2024-09-18, 7,724 rows, too large to copy for
four rows): pointer 0 is `0x3000`, pointer 1 is `0x3001`, pointer 3 is `0xFF0C` and pointer 376 is `0x30A1`. Pointers
become byte pairs by the Shift_JIS decoder of the same standard (section 12.3.1): the leading byte is `0x81` plus the
pointer divided by 188, the trailing byte is the pointer modulo 188 plus `0x40`, so those four rows are the byte pairs
`81 40`, `81 41`, `81 43` and `83 40`. The same section turns the single byte `0xB1` into `0xFF61 - 0xA1 + 0xB1`, which
is `U+FF71`.
