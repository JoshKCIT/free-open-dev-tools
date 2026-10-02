# Text Encoding Fixer

Decode bytes in a legacy text encoding, repair UTF-8 read as Windows-1252, and convert line endings and byte order marks.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Decodes bytes (a file or pasted hex) in a legacy text encoding, repairs text where UTF-8 was read as Windows-1252 or Latin-1 (cafÃ© becomes café), converts line endings to LF, CRLF or CR, and adds or removes a byte order mark, all in your browser. Windows-1252 is decoded with its own copy of the table from the WHATWG Encoding Standard, so the result is the same in every browser and in Node. Nothing is uploaded.

## Supported

- Decoding bytes with every encoding label the WHATWG Encoding Standard defines that your browser can decode, such as windows-1252, windows-1251, koi8-r, iso-8859-2, shift_jis, gbk, big5, utf-16le and utf-8
- The labels latin1, iso-8859-1, ascii and us-ascii as the WHATWG standard defines them (all mean windows-1252), and true ISO-8859-1, where bytes 80 to 9F stay control characters, as a separate choice
- Repairing text where UTF-8 bytes were read as Windows-1252 or as true ISO-8859-1, for the whole text or line by line
- Converting line endings to LF, CRLF or CR in one pass, counting each kind found
- Adding or removing a byte order mark: EF BB BF for UTF-8, FF FE for UTF-16LE and FE FF for UTF-16BE, with the first 8 bytes shown as hex before and after
- Bytes from a file or from pasted hex, up to 20 MiB, and the result as text or as a download of the exact bytes

## Limits

- Files and pasted bytes up to 20 MiB.
- The labels latin1 and iso-8859-1 mean windows-1252, as the WHATWG Encoding Standard defines them; choose true ISO-8859-1 to keep bytes 80 to 9F as control characters.
- Repair works when the garbled text came from one pass of UTF-8 read as Windows-1252 or ISO-8859-1; a character outside that table, or bytes that are not UTF-8, are reported instead of guessed.
- Text is not written into multi-byte legacy encodings such as Shift_JIS, GBK or Big5.

## Ambiguous cases, and what this does about them

- The WHATWG label latin1 is Windows-1252, not ISO-8859-1: byte 80 is the euro sign, not a control character. True ISO-8859-1 is a separate choice here
- Windows-1252 has five bytes (81, 8D, 8F, 90 and 9D) that Microsoft leaves undefined; the WHATWG table maps them to the control characters U+0081, U+008D, U+008F, U+0090 and U+009D, so every byte decodes and every one of those characters repairs back
- Text that is already correct UTF-8 can look repairable or not: plain ASCII is left alone, and accented text such as café does not decode as UTF-8 after being read as Windows-1252, so it is left as it is
- A lone carriage return counts as a line ending, as it did on older Mac systems, and a carriage return followed by a line feed counts once
- Positions in messages count characters (code points); byte views and sizes count bytes
- Unknown encoding labels are refused rather than guessed, and a decoder that cannot be built in your browser is refused with the label named

## Defined by

- [WHATWG Encoding Standard](https://encoding.spec.whatwg.org/)
- [RFC 3629 UTF-8, a transformation format of ISO 10646](https://www.rfc-editor.org/rfc/rfc3629)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/text-encoding-fixer text-encoding-fixer
cd text-encoding-fixer
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/text-encoding-fixer
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { repairMojibake } from '@fodt/text-encoding-fixer';

const result = repairMojibake('cafÃ© â€™quotedâ€™', 'windows-1252', { perLine: false });
console.log(result.text);
// café ’quoted’
console.log(result.changed);
// true
```

`repairMojibake(text, from, { perLine })` maps each character back to the byte the chosen table gives it and reads the bytes as UTF-8, returning `{ text, changed, unrepairedLines, problem }`; text that cannot be repaired comes back unchanged with `problem` saying why and where (a character position counting code points), and `perLine` repairs only the lines that decode. `decodeBytes(bytes, label, { strictLatin1 })` decodes with a WHATWG label, using the folder's own windows-1252 table, and counts replacement characters. `convertLineEndings(text, eol)` and `changeBom(bytes, action)` work in one pass. Every expected failure is a `TextEncodingFixerError` with a plain message and, where one applies, a `position`. Input over `MAX_INPUT_BYTES` (20 MiB) is refused before any decoding.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The windows-1252 table is checked against the WHATWG index file copied into test/fixtures, not against the decoder of the platform running the tests (Node and the browsers differ for this encoding). The garbled and repaired pairs come from Python 3.14.3: encoding the correct text as UTF-8 and decoding it as cp1252 gave the garbled text, quoted as literals in the test comment. Nothing is checked against this folder's own output.

## Licence

MIT. See [LICENSE](./LICENSE).
