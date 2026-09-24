# Text to Binary, Hex & Octal

Convert text to and from binary, hexadecimal, octal and decimal in any supported encoding.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Converts text to groups of digits, one group per byte, in binary, octal, decimal or hexadecimal. This always reads the input as characters, never as a numeric value: typing 255 produces the bytes of the three characters '2', '5' and '5', not the number two hundred and fifty-five. Choose which character encoding produces those bytes -- UTF-8, either byte order of UTF-16, or windows-1252 -- because the same text is a different set of bytes under each one.

## Supported

- Binary, octal, decimal and hexadecimal, in both directions, one group of digits per byte
- UTF-8, UTF-16 in both byte orders, and windows-1252, per the WHATWG Encoding Standard
- A configurable group separator, and parsing that also accepts any run of whitespace regardless of it
- Fixed-width groups (padded to the radix's conventional per-byte width) or unpadded groups, as an option
- Upper-case or lower-case hexadecimal digits
- The empty string, which produces no groups and parses back to the empty string

## Limits

- This tool always reads its input as text characters, never as a numeric value. There is no mode, option or heuristic anywhere in it that reads a number out of the input instead -- the live Number Base Converter does that job.
- The label iso-8859-1 maps to windows-1252 under the WHATWG Encoding Standard this tool follows, and the two differ in the 0x80 to 0x9F range: byte 0x80 is the euro sign under this standard, not U+0080.
- windows-1252 cannot represent most of Unicode. A character it has no byte for is refused, naming the character and the encoding, rather than silently substituted with a replacement character.
- The unit of grouping is always one byte, whatever the encoding, so a single UTF-16 or multi-byte UTF-8 character spans more than one group.
- UTF-16LE and UTF-16BE differ only in which byte of each two-byte code unit comes first. Neither one is more correct; a file or protocol that expects one and receives the other will misread every character.

## Ambiguous cases, and what this does about them

- Grouping by byte rather than by UTF-16 code unit was a deliberate choice: grouping by code unit would hide the byte order entirely, which is the only reason this tool offers two UTF-16 options at all.
- Group padding, separator and hexadecimal letter case are purely cosmetic. None of the three changes which bytes are produced or parsed back.

## Defined by

- [WHATWG Encoding Standard](https://encoding.spec.whatwg.org/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/text-radix text-radix
cd text-radix
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/text-radix
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { textToRadix, radixToText } from '@fodt/text-radix';

textToRadix('Hi');                                          // '48 69'
textToRadix('Hi', { radix: 'binary' });                     // '01001000 01101001'
radixToText('48 69');                                       // 'Hi'
textToRadix('€', { encoding: 'windows-1252' });             // '80'
radixToText('80', { encoding: 'windows-1252' });            // '€'
```

`textToRadix` and `radixToText` throw `TextRadixError`, which carries a `position` field pointing at the offending character or group in the input, when a position is meaningful. `ENCODINGS` exposes a label and a short note for each of the four supported encodings, for building a select control from.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every radix round trips in every encoding. The windows-1252 codec is checked against a vendored, verbatim copy of the WHATWG index-windows-1252.txt file for all 256 byte values, including the euro sign at 0x80 and the five C1 control code points at 0x81, 0x8D, 0x8F, 0x90 and 0x9D -- never against Node's own TextDecoder, which decodes windows-1252 as literal Latin-1 on the Node version this project runs and would pass an incorrect implementation.

## Licence

MIT. See [LICENSE](./LICENSE).
