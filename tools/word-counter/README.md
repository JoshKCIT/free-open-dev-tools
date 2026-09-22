# Word & Character Counter

Count characters, words, sentences, paragraphs and word frequency, with reading time.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Counts what is in a block of text, and is careful about the part most counters get wrong: there are four different answers to how many characters a string has, and which one you want depends on what is enforcing the limit. It shows all four, along with word frequency, reading time and an estimated reading level.

## Supported

- Characters counted four ways: UTF-16 code units, Unicode code points, user-perceived characters, and UTF-8 bytes
- Words, unique words, sentences, paragraphs, lines and non-empty lines
- Sentence splitting that does not break on a decimal point, and merges back breaks after a short list of common abbreviations such as Dr. and etc.
- Word and character frequency, with optional stop-word removal and a minimum length
- Reading and speaking time at adjustable speeds
- Flesch Reading Ease and Flesch-Kincaid grade level, with the inputs to the formula shown
- Headroom against the length limits people actually write to, such as a page title or a commit subject

## Limits

- Readability scores are estimates. They depend on counting syllables, which cannot be done exactly without a pronunciation dictionary; the heuristic used here is right about 85% of the time on ordinary prose and wrong on names and loanwords.
- Flesch scores were designed for English. Applying them to another language produces a number with no meaning.
- Sentence splitting uses the browser Intl.Segmenter where it exists, which handles decimals correctly but has no abbreviation list of its own. A short list of common abbreviations is applied on top; it is not exhaustive, so an unusual abbreviation will still end a sentence early.
- A word here is a run of letters and digits, so scripts written without spaces, such as Chinese and Japanese, are counted as very few very long words. The character count is the useful number for those.
- Stop-word removal uses a short English list. It is a convenience, not linguistics.

## Ambiguous cases, and what this does about them

- There is no single character count. A skin-toned waving hand is one character to a reader, two code points to Unicode, four code units to JavaScript's length property and eight bytes in UTF-8. All four are shown, because which one matters depends entirely on what is imposing the limit.
- Whether a hyphenated or contracted form is one word or two is a genuine choice. Both are kept as single words here, which matches what a person counting by hand would do.

## Defined by

- [Unicode Standard Annex 29, text segmentation](https://unicode.org/reports/tr29/)
- [Flesch, A new readability yardstick (1948)](https://psycnet.apa.org/record/1949-01274-001)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/word-counter word-counter
cd word-counter
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/word-counter
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { count, wordFrequency, readingTime, readability } from '@fodt/word-counter';

count('👋🏽');            // graphemes 1, codePoints 2, codeUnits 4, utf8Bytes 8
wordFrequency(text, { excludeStopWords: true });
readingTime(count(text).words);
readability(text);       // null when the text is too short to score
```

`readability` returns null rather than a number when there are fewer than three words or no complete sentence, because a score computed from that little text is noise.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Character counting is asserted against a skin-toned emoji, a flag emoji and a combining sequence, where the four counts genuinely differ. Sentence splitting is checked against decimal points, abbreviations and initials. Syllable counting is pinned against the cases the usual vowel-pair heuristic gets wrong, such as beautiful. Readability is checked for the direction of the score between simple and dense prose rather than for an exact value, since the syllable heuristic makes an exact assertion meaningless. A 900,000 word document is counted within a time bound.

## Licence

MIT. See [LICENSE](./LICENSE).
