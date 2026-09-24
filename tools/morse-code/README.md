# Morse Code Translator

Translate text to and from International Morse Code.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Converts text to and from International Morse Code as ITU-R M.1677-1 defines it: the 26 letters, the 10 digits, the at sign added in the 2009 revision, and a set of punctuation marks. Procedural signals (prosigns) such as the wait signal are typed as their letters run together inside angle brackets and encode to one unbroken code group, the way they are actually sent.

## Supported

- Text to Morse and Morse to text, for all 26 letters, all 10 digits, the at sign and the punctuation marks the recommendation lists
- A configurable letter separator (default a single space) and word separator (default a slash, because that is what people paste)
- Decoding tolerant of any run of whitespace between letters and either the configured word separator or a run of three or more spaces between words
- Prosigns typed as run-together letters inside angle brackets, such as <AS> for wait, encoded as one unbroken code group
- A three-rule decoding precedence for a run-together code group: a single character's code first, then an enumerated prosign, otherwise rejected
- A choice of what happens to a character with no code: reject with its position (the default), drop it, or replace it with a configured stand-in
- The published collision between the letter X and the multiplication sign, resolved by treating the multiplication sign as an alias that encodes to X's code and decodes back to X

## Limits

- Morse code has no case. Encoding upper-cases the input first, and decoding always returns upper case.
- This is a text tool. The timing, tone and spacing conventions used when Morse is actually sent over the air cannot be expressed here.
- The published table gives dash-dot-dot-dash to both the letter X and the multiplication sign. Decoding that code always returns the canonical character, X.
- Prosigns are typed as their letters run together inside angle brackets, for example <AS> for wait, and encode to one unbroken code group. When decoding, a code group that is also a single character's code becomes that character, so the invitation to transmit signal comes back as the letter K and loses its brackets. A prosign whose code matches no single character, such as wait, comes back in its bracketed form. A run-together group that is neither a character nor a listed prosign is rejected, never split into guessed letters.
- A character with no entry in the table is rejected with its position by default, rather than silently dropped, so nothing disappears without you noticing.

## Ambiguous cases, and what this does about them

- The code itself does not distinguish the letter X from the multiplication sign; decoding has to choose, and this tool chooses the letter because that is what a reader almost always means. A round trip is lossless for every canonical character and lossy for an alias, by definition of the published code rather than by a shortcut taken here.
- A separated pair of letters and a run-together prosign are different inputs in this tool's text format, because the format keeps a letter separator between ordinary codes ("... --- ..." is two letters; "...---..." run together is neither a valid letter sequence nor, in this example, a listed prosign). No information is lost by supporting both.

## Defined by

- [ITU-R M.1677-1 — International Morse code](https://www.itu.int/rec/R-REC-M.1677-1-200910-I)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/morse-code morse-code
cd morse-code
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/morse-code
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { toMorse, fromMorse } from '@fodt/morse-code';

toMorse('SOS');                 // '... --- ...'
fromMorse('... --- ...');       // 'SOS'
toMorse('<AS> WAIT');            // '.-.../.-- .- .. -'
fromMorse('-.-');                // 'K' (invitation to transmit collides with the letter K)
```

`toMorse` and `fromMorse` throw `MorseError`, which carries a `position` field pointing at the offending character or code group in the input. `MORSE` maps every supported character (canonical and alias) to its code; `MORSE_ALIASES` maps an alias character to the canonical character it shares a code with; `PROSIGNS` maps a prosign name to its concatenated code.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

ITU-R M.1677-1 defines the table and is cited above, but it publishes no machine-readable conformance file to assert against. The tests iterate the transcribed `MORSE` table in both directions for coverage, asserting the canonical round trip rather than a universal one, AND separately assert a set of entries transcribed a second time, independently, by hand from the recommendation, spread across letters, digits and punctuation with the document section named in a comment beside each group — that second pass is what would catch a mistranscription that a table-iterating test cannot. The round trip is asserted for canonical characters; the published X/multiplication-sign collision is recorded as an alias and tested explicitly, as is the three-rule prosign decoding precedence, one test per rule. Treat the table as a transcription checked twice against the document, not as a file supplied by the ITU.

## Licence

MIT. See [LICENSE](./LICENSE).
