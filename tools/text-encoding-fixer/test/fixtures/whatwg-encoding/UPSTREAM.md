# Upstream of the WHATWG index files

`index-windows-1252.txt` is the index of the windows-1252 single-byte encoding, copied byte for byte from the WHATWG
Encoding Standard.

- **Document:** WHATWG Encoding Standard, Living Standard (Last Updated 21 May 2026 on the fetch date).
- **Address:** https://encoding.spec.whatwg.org/index-windows-1252.txt
- **Index identifier:** `e56d49d9176e9a412283cf29ac9bd613f5620462f2a080a84eceaf974cfa18b7`, dated 2024-09-18 (the file's
  own header).
- **Fetched:** 2026-10-02.
- **Copyright and licence:** Copyright (c) WHATWG (Apple, Google, Mozilla, Microsoft). The standard's page says: "This
  work is licensed under a Creative Commons Attribution 4.0 International License. To the extent portions of it are
  incorporated into source code, such portions in the source code are licensed under the BSD 3-Clause License instead."
  The file is test data (a table of 128 pointers and code points) and is attributed here to the WHATWG Encoding
  Standard.
- **How it was made:** `curl -fsSL` of the address above into a scratch directory, then copied here unchanged. Nothing
  in it was typed by hand or produced by this package.
- **Rows:** 128 (pointer 0 is `0x20AC`, pointer 31 is `0x0178`, pointers 32 to 127 are the identity from `0x00A0`).
  Pointer `n` is the byte `0x80 + n`.

Other index files used as literals (the first rows of `index-koi8-r.txt` and `index-windows-1251.txt`, and the rows for
`shift_jis` single-byte katakana) are quoted in the test file's comments with their addresses, not copied here.
