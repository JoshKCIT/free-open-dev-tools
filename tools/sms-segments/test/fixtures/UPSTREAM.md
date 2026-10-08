# Upstream material for the SMS Segment Calculator tests

What the tests are grounded on, where each piece comes from, under which licence, and how it was made. Nothing here is
fetched or run while the tests run: the tests only read these files.

## Unicode: GSM0338.TXT (vendored, byte for byte)

| What          | Value                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------- |
| Address       | https://unicode.org/Public/MAPPINGS/ETSI/GSM0338.TXT                                          |
| Vendored as   | `unicode/GSM0338.TXT`, git blob `57e402505342be186567d1cb51a879f650514de9`, 230 lines          |
| Table         | "GSM 03.38 to Unicode", table version 2.0, header dated 2015-12-02 23:55:00 GMT, served with Last-Modified 2015-12-03 |
| Licence       | Unicode License v3 (the file's header points to the Unicode terms of use, which apply that licence to data files); the text fetched from https://unicode.org/license.txt is `unicode/LICENSE-UNICODE.txt`, git blob `56da58912807030b451a4700687d5bd02c72d6ed` |
| Fetched on    | 2026-10-07 (the bytes equal the copy read during research on 2026-10-06)                        |
| Used how      | `test/alphabet.test.ts` parses it and compares the default alphabet and the extension table cell by cell with `src/alphabet.ts` |

### The one cell where this tool follows the specification and not this file: code 0x09

The file's header says: "This mapping is based on ETSI TS 100 900 V7.2.0 (1999-07), with a correction of 0x09 to *small*
c-cedilla, instead of *capital* C-cedilla." and "The ETSI GSM 03.38 specification shows an uppercase C-cedilla glyph at
0x09. This may be the result of limited display capabilities for handling characters with descenders. However, the language
coverage intent is clearly for the lowercase c-cedilla, as shown in the mapping below." The file keeps the capital letter as
a commented line, `#0x09 0x00C7 # LATIN CAPITAL LETTER C WITH CEDILLA (see note above)`.

3GPP TS 23.038 draws the capital letter, and so does the Android table below, so this tool puts capital C cedilla (U+00C7) at
code 0x09: it is in the alphabet, and lower case c cedilla (U+00E7) forces UCS-2. The test lists this cell by name in an
explicit array and fails on any other difference.

## Android: GsmAlphabet.java (recorded as data)

| What          | Value                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------- |
| Repository    | `aosp-mirror/platform_frameworks_base` (a mirror of the Android Open Source Project)            |
| Path          | `telephony/common/com/android/internal/telephony/GsmAlphabet.java`                             |
| Git blob      | `5c53f7e5a4d0403d510b8ed5a148558175f212b2`; last changed by commit `d238b8a75933bca6cec39f5c34c2e6735b25a7d8` on 2020-03-12 |
| Licence       | Apache License 2.0, "Copyright (C) 2006 The Android Open Source Project"; the full text is `android/LICENSE-APACHE-2.0.txt` (from https://www.apache.org/licenses/LICENSE-2.0.txt, git blob `d645695673349e3947e8e5ae42332d0ac3164cd7`) |
| Recorded as   | `android/android-alphabet.json`: the 128-cell default table and the 10-entry extension table, with the blob and the licence notice. No source code is copied. |
| Made by       | `android/extract-android.py`, run by hand on a copy of the file; it refuses a file whose blob is not the one above |
| Reads         | its own comments name "3GPP TS 23.038 V9.1.1 section 6.2.1" (default) and "6.2.1.1" (extension) |

Android writes the escape code (0x1B) as the placeholder U+FFFF in its table; this tool's table holds nothing there.

## 3GPP TS 23.038 and TS 23.040 (cited, not copied)

| What          | Value                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------- |
| TS 23.038     | V20.0.0 (2026-06), clause 6.2.1 (GSM 7 bit default alphabet), 6.2.1.1 (extension table) and 6.2.3 (UCS2); `23038-k00.zip` of https://www.3gpp.org/ftp/Specs/archive/23_series/23.038/ |
| TS 23.040     | V20.0.0 (2026-09), clause 9.2.3.24.1 (concatenated short messages): 153 (160-7) septets and 67 ((140-6)/2) UCS2 characters a part, an escape sequence and a UCS2 character are never split, at most 255 parts (39015 septets or 17085 UCS2 characters) |
| Copyright     | 3GPP / ETSI. The tables and the text are NOT copied into this repository                       |
| Read on       | 2026-10-06                                                                                    |
| Recorded as   | `spec/spec-comparison.json`: only the result of comparing the specification's table text with the Android table (117 equal cells; the 11 cells the Word file draws as symbols named; the cell where the Unicode file differs; the SHA-256 of the Android default table that was compared; 9 of 9 extension cells equal) |
| Made by       | `spec/compare-spec.py`, run by hand on a text extraction of the specification's two tables kept in a scratch folder and never committed |

The chain of proof is: the specification text equals the Android table on 117 text cells (recorded, with the hash of that
table); the tests prove this tool's table equals the Android table, and so equals the very table that was compared, on every
cell and by the same hash; the ten Greek capitals and the escape cell, which the Word file draws as symbols, are proven by the
Unicode file and the Android table. Short sentences quoted in tests and in the tool's limits text are cited by clause.

## split-sms 0.1.7: recorded counts (a second opinion)

| What          | Value                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------- |
| Package       | `split-sms` 0.1.7 on npm (MIT); not a dependency of this repository                             |
| Used how      | `counts/record-counts.cjs` asks it about the 690 messages of `counts/make-corpus.mjs` and writes `counts/counts.json` (encoding and number of parts of each) |
| Corpus        | seed 12345; 23 lengths around the 70, 134, 153, 160 and 306 boundaries, 5 mixes of plain, extension and non-GSM characters, 6 messages each; 30 are empty |
| Run with      | Node 22.14.0, from a scratch folder that already held the package                              |
| Recorded      | 2026-10-08 (UTC)                                                                              |

The test compares the encoding and the number of parts of the 660 non-empty messages with this tool's. The 30 empty
messages are a difference by design and are named in the test: for empty text the library reports one part, and the
specification has nothing to send, so this tool says 0 segments.

## Python unicodedata: official Unicode names (recorded)

`names/record-names.py` reads the code points of the characters listed in `src/offenders.ts` and records Python's
`unicodedata.name()` of each (Python 3.14.3, Unicode 16.0.0) in `names/unicode-names.json`. Tab has no name in Python; its
formal alias CHARACTER TABULATION is recorded after `unicodedata.lookup()` confirms it is that character. The test compares
every entry of the list with this recording.

No source code of any of these projects is copied: the Unicode file and the licences are vendored as data, and the Android
table, the specification comparison, the counts and the names are recorded as data. The tables in `src/alphabet.ts` are
written by hand from TS 23.038.
