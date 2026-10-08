# SMS Segment Calculator

Count the SMS segments a message needs, see whether it fits the GSM 7-bit alphabet and which characters force Unicode.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Type or paste a text message and see how many SMS segments it needs. The count follows 3GPP TS 23.038 and TS 23.040: a message made only of characters in the GSM 7-bit default alphabet is counted in septets, 160 in one message and 153 a part once it is longer; any other character turns the whole message into UCS-2, counted in 16-bit units, 70 in one message and 67 a part. The page names every character that forced Unicode, with its code point and a replacement written in the GSM 7-bit alphabet, and warns about text that Unicode normalisation would shorten. Nothing you type is sent anywhere.

## Supported

- The GSM 7-bit default alphabet of 3GPP TS 23.038 clause 6.2.1: 127 characters, with capital C cedilla at code 9, and the extension table of clause 6.2.1.1 (form feed, ^, {, }, backslash, [, ~, ], the vertical bar and the euro sign), where each extension character takes two septets, an escape and a code
- UCS-2 counting in UTF-16 code units for a message with any character outside the alphabet: a character above U+FFFF counts two units and is never split between parts
- Segment sizes from 3GPP TS 23.040 clause 9.2.3.24.1: 160 septets or 70 units in one message, and 153 septets or 67 units a part once the message is longer, with at most 255 parts
- A table of the segments with how much of each is used and the text it carries; a character that does not fit in what is left of a part moves whole to the next part
- A table of every character that forced Unicode, with its code point, what it is, a replacement written in the GSM 7-bit alphabet and how many times it occurs, for about 40 common characters such as curly quotes, dashes, the ellipsis, no-break and zero-width spaces, accented letters the alphabet lacks, look-alike letters and emoji
- A copy of the message with those replacements made, shown for you to copy; what you typed is never changed
- Warnings for a part left one short because the next character takes two, for text that the composed form of Unicode normalisation (NFC) would shorten, such as letters followed by combining marks or the Angstrom, Ohm and Kelvin signs, and for more than 255 parts

## Limits

- Counts follow 3GPP TS 23.038 and TS 23.040 for one text message sent with a standard concatenation header (6 octets: 153 septets or 67 UCS-2 units a part). A sending service can change the text, choose another encoding, join or split messages differently, or bill differently from what this page shows.
- The page counts the characters exactly as typed. It does not normalise accents or replace look-alike characters; the suggestions show a copy and change nothing.
- Lower case c cedilla is not in the default alphabet (the table has only the capital C cedilla), so it forces UCS-2; some services map it to the capital before counting.
- Emoji and other characters above U+FFFF count as two UCS-2 units and are never split between parts. TS 23.040 speaks of UCS2 characters and does not define surrogate pairs; this page counts UTF-16 units.
- A browser text box gives one character for a line break; a service that sends carriage return and line feed counts two septets.
- A concatenated message has at most 255 parts (39,015 septets or 17,085 UCS-2 units). National language shift tables, the 16-bit reference header (152 septets or 66 units a part), 8-bit data, WAP push, flash messages and RCS are not covered. Nothing is sent.
- Text over 100,000 UTF-16 units is refused. The tables show at most 50 segments and 100 forced characters, and the copy at most 5,000 characters, each with a line saying what was left out.
- The list of replacements covers common characters only; a character that is not on it is shown by its code point and stays in the copy.

## Ambiguous cases, and what this does about them

- Code 9 of the default alphabet: TS 23.038 draws capital C cedilla and so does this page; the Unicode mapping file maps the small one. Lower case c cedilla therefore forces UCS-2, and some services fold it to the capital before counting.
- Line breaks: a line feed and a carriage return are one septet each, so a carriage return followed by a line feed is two. A browser text box gives a line feed alone.
- Empty text needs no segment, because the specification has nothing to send; a counting library may report one part for it.
- An unpaired surrogate is not a character of any alphabet; it is counted as one forced character of one unit.

## Defined by

- [3GPP TS 23.038: Alphabets and language-specific information](https://portal.3gpp.org/desktopmodules/Specifications/SpecificationDetails.aspx?specificationId=745)
- [3GPP TS 23.040: Technical realization of the Short Message Service (SMS)](https://portal.3gpp.org/desktopmodules/Specifications/SpecificationDetails.aspx?specificationId=747)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/sms-segments sms-segments
cd sms-segments
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/sms-segments
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { analyseMessage, gsmSafeCopy } from '@fodt/sms-segments';

const plain = analyseMessage('a'.repeat(161));
plain.encoding; // 'gsm7'
plain.segments.map((s) => s.used); // [153, 8]

const curly = 'It' + String.fromCodePoint(0x2019) + 's late';
const result = analyseMessage(curly);
result.encoding; // 'ucs2'
result.forced[0]; // { character: curly's apostrophe, codePoint: 0x2019, count: 1, firstAt: 3 }
gsmSafeCopy(curly).text; // "It's late"
```

`analyseMessage(text)` refuses a message over 100,000 UTF-16 units first (`SmsSegmentsError`, naming the limit and the 255 parts), then walks the text once by code point, so a surrogate pair is one character of two units and an unpaired surrogate is one forced character of one unit. A character costs 1 septet in the default alphabet, 2 in the extension table, and otherwise 1 or 2 UTF-16 units; if any character is outside both tables the whole message is UCS-2. A message that fits one message (160 septets or 70 units) is one segment; otherwise a character that does not fit in what is left of a part starts the next part, so an escape pair or a surrogate pair is never split. The result holds the encoding, the counts, `segments` of `{ index, text, used, capacity }`, `forced` of `{ character, codePoint, count, firstAt }` and plain-words `warnings` that never repeat the message. `gsmSafeCopy(text)` joins letters and combining marks (NFC), replaces each character of `OFFENDERS` by its replacement and returns `{ text, replaced, normalised, remaining }`; the input is never changed. `septetsOf(character)` gives 1, 2 or undefined. `visible(text, max)` writes control, invisible and direction-changing characters as \u{XX} and cuts at `max` characters, for showing pasted text. Everything is pure and runs in Node or a browser.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The 3GPP texts are never copied. The default alphabet and the extension table are checked cell by cell against the Unicode mapping file GSM0338.TXT (table version 2.0, Unicode License v3) and against the Android table (GsmAlphabet.java, blob 5c53f7e5, Apache-2.0) recorded as data. Code 0x09 is the one cell where the Unicode file differs (it maps the small c cedilla; TS 23.038 and Android have the capital) and it is listed by name in the test. A recorded comparison of the TS 23.038 V20.0.0 table text with the Android table holds 117 equal cells and names the 11 cells the Word file draws as symbols (ten Greek capitals and the escape), with the hash of the table it compared, which the test ties to this tool's table. The boundary rows are worked by hand from TS 23.040 clause 9.2.3.24.1. The encoding and the segment count of the 660 non-empty messages of a seeded corpus (23 lengths around the 70, 134, 153, 160 and 306 boundaries, 5 mixes, 6 each) equal the counts recorded from split-sms 0.1.7; the 30 empty messages differ by design (the library says one part, this page says 0 segments). The official names of the listed characters were recorded with Python unicodedata and are compared with the list. Hostile input is checked for linear time, and a message of 100,000 units is read while 100,001 are refused before any work.

## Licence

MIT. See [LICENSE](./LICENSE).
