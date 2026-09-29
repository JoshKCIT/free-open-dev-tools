# Unicode Inspector

Inspect code points, convert to and from escape sequences, normalise, and find invisible characters.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Decomposes text into one row per Unicode code point, each carrying its value, its name where one is worth giving, its general category, and its UTF-8 bytes. Converts to and from three escape-sequence styles, normalises to any of the four Unicode forms, strips accents, and makes invisible or easily-confused characters visible with a stand-in so a table row never disappears. Built for finding the zero-width character, the lookalike space or the wrong normalisation form that is breaking something downstream.

## Supported

- One table row per code point, so a character outside the Basic Multilingual Plane still gets one row carrying its full value and its UTF-8 bytes
- All four Unicode normalisation forms: NFC, NFD, NFKC and NFKD, via the JavaScript engine's own implementation
- Conversion to and from three escape-sequence styles: classic JavaScript \uXXXX, HTML numeric character references, and the modern \u{...} code-point form
- A hand-maintained table of control, format, space and confusable characters, each shown as a bracketed short name or a Control Pictures glyph rather than as nothing
- A general-category catch-all for control, format and surrogate code points not individually named in that table
- An unpaired (lone) surrogate reported as exactly what it is, with an explanatory note and no fabricated UTF-8 bytes
- A summary count of invisible or non-printing characters, computed independently of normalisation
- Remove accents: decomposes to NFD, strips combining marks, recomposes to NFC, with an option to restrict removal to marks on Latin, Greek or Cyrillic letters (on by default) or to strip every combining mark regardless of script

## Limits

- No Unicode character name database is bundled. A character in the hand-maintained invisible-character table gets a real short name; everything else is labelled by its general category instead, such as 'Lowercase Letter'.
- Normalisation is performed by the JavaScript engine's own String.prototype.normalize, so the exact Unicode version it implements follows the runtime rather than this package.
- The inspection table renders up to 5,000 rows. A longer input is still fully counted in the stats, but only the first 5,000 code points get a row, with a note saying so.
- Escaping and unescaping only understand the one style selected at a time; mixing styles in a single unescape call is read as literal text wherever it does not match that style.
- Removing accents strips combining marks; it does not transliterate a distinct letter to its plain-ASCII look-alike, so ø, ł, đ, ß and æ are left exactly as they are

## Ambiguous cases, and what this does about them

- Invisible-character detection reads only the hand-maintained table and the general category -- never normalisation. Most invisible characters (a zero-width space, for instance) pass through all four normalisation forms completely unchanged, so treating a normalisation-affected character as a proxy for an invisible one would miss nearly all of them.
- An unpaired surrogate's UTF-8 byte column is left empty rather than showing the three bytes a naive TextEncoder call would produce (the UTF-8 replacement character's bytes), because those bytes do not belong to the surrogate -- it has no UTF-8 encoding at all.
- A combining mark belongs to the nearest preceding non-mark code point in the decomposed text; with the Latin/Greek/Cyrillic option on, a mark that has no preceding base at all, or one that sits on a digit, symbol, space or any other script, is kept rather than guessed at.
- With the Latin/Greek/Cyrillic option on, й and ё become и and е, which are different letters in Russian and several other languages, not accented forms of the same letter; with the option off, marks that are essential in other scripts (Devanagari vowel signs, Thai and Arabic vowel marks, Hebrew points, Japanese voiced sound marks) are removed too, which can change the word's meaning or make it unreadable.

## Defined by

- [Unicode Standard Annex 15 (UAX #15) — Unicode Normalization Forms](https://www.unicode.org/reports/tr15/)
- [Unicode NormalizationTest.txt — the conformance file this tool's tests quote lines from](https://www.unicode.org/Public/UNIDATA/NormalizationTest.txt)
- [Unicode Character Database UnicodeData.txt — decomposition mappings this tool's remove-accents tests quote](https://www.unicode.org/Public/UNIDATA/UnicodeData.txt)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/unicode-inspector unicode-inspector
cd unicode-inspector
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/unicode-inspector
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { inspect, normalise, removeAccents, toEscapes, fromEscapes } from '@fodt/unicode-inspector';

inspect('a\u200b')[1].invisible;           // true -- zero-width space
normalise('e\u0301', 'NFC');                // 'é', composed
removeAccents('café');                      // { output: 'cafe', removed: 1 }
toEscapes('hi', { style: 'html-numeric' }); // '&#104;&#105;'
fromEscapes('&#104;&#105;', { style: 'html-numeric' }); // 'hi'
```

`inspect` returns an array of `CodePointRow`, one per Unicode code point (never per UTF-16 code unit). `INVISIBLE` is the hand-maintained table keyed on code point; anything not in it that is still invisible (an uncommon control or format character, an unpaired surrogate) is caught by a general-category check instead. `removeAccents` decomposes to NFD, walks by code point tracking the nearest preceding base letter's script, and recomposes the kept text to NFC. `toEscapes`/`fromEscapes` and `UnicodeInspectorError` all take or throw a `position`-bearing error the same way the rest of this project's tools do.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Normalisation correctness is checked against a handful of lines taken directly from Unicode's own published NormalizationTest.txt conformance file, including a Hangul composition case and a singleton decomposition, each cited by the line it was taken from. The invisible-character table is this project's own hand-maintained list, not a published set, and is tested against itself plus the general-category catch-all. Remove-accents is checked against decomposition mappings published in UnicodeData.txt, including a doubly-decomposed Latin letter, stacked Vietnamese marks, Zalgo text, and Devanagari, Greek, Cyrillic, Hebrew and Japanese cases with the Latin/Greek/Cyrillic option both on and off.

## Licence

MIT. See [LICENSE](./LICENSE).
