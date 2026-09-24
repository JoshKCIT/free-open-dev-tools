# NATO Phonetic Alphabet

Spell text out using the ICAO/NATO phonetic alphabet.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Converts text to and from the ICAO spelling alphabet (Alfa, Bravo, Charlie... and the aviation pronunciation of the ten digits), the standard way to spell letters and numbers aloud so they cannot be confused with a similar-sounding one. It writes ICAO's own spellings, Alfa and Juliett, and also reads back the common spellings Alpha and Juliet.

## Supported

- Each of the 26 letters to and from its spelling word, case-insensitively in both directions
- Each of the 10 digits to and from its ICAO pronunciation word, including the four digits whose aviation pronunciation differs from the ordinary English word
- A configurable separator between the words of a spelled-out group
- Reading a spelled message back into text, tolerant of any run of whitespace between words and case-insensitive
- A choice of what happens to a character with no word: reject with its position (the default), drop it, or replace it with a configured stand-in

## Limits

- This spells characters; it does not transcribe pronunciation or produce audio.
- The digit words used here are the ICAO aviation pronunciations, which differ from the ordinary English words for several digits (for example 9 is spoken "niner").
- ICAO defines this alphabet in documents that are sold rather than freely published (ICAO Annex 10 Volume II and ICAO Doc 9432, the Manual of Radiotelephony). The table here was cross-checked against publicly available civil aviation authority publications that reproduce it, not against the primary ICAO document itself.
- Other spelling alphabets exist, including military and historical ones with different words, and are not offered here.

## Ambiguous cases, and what this does about them

- A word that is not in the table is rejected with its position rather than guessed at, because a near-miss spelling word is exactly the kind of mistake this tool exists to catch.

## Defined by

- [ICAO Annex 10, Volume II, Chapter 5 — Aeronautical Telecommunications (spelling alphabet placement)](https://www.icao.int/sites/default/files/postalhistory/annex_10_aeronautical_telecommunications.htm)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/nato-phonetic nato-phonetic
cd nato-phonetic
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/nato-phonetic
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { toPhonetic, fromPhonetic } from '@fodt/nato-phonetic';

toPhonetic('SOS 9');            // 'Sierra Oscar Sierra Niner'
fromPhonetic('Sierra Oscar Sierra Niner');   // 'SOS9'
```

`toPhonetic` and `fromPhonetic` throw `NatoPhoneticError`, which carries a `position` field pointing at the offending character or word in the input. `PHONETIC` maps every letter and digit to its spelling word; the reverse lookup is derived from it rather than written out a second time.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

ICAO's own Annex 10 material was consulted for the alphabet's placement in Volume II, Chapter 5, and is cited above; ICAO Doc 9432, the Manual of Radiotelephony, which carries the digit pronunciations, could not itself be retrieved during this work. In its place, the 26 letter words and 10 digit words in the production table were cross-checked against publicly available civil aviation authority publications that reproduce them, named in the test file. No machine-readable conformance file exists for either half. The tests iterate the transcribed table in both directions for coverage, AND separately assert all 36 letter-and-digit pairs transcribed a second time, independently, by hand from the same cross-checked sources, which is what would catch a mistranscription that a table-iterating test alone cannot.

## Licence

MIT. See [LICENSE](./LICENSE).
