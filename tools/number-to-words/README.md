# Number to Words

Spell numbers out in English, in short scale, with ordinal and currency modes.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Spells an integer out in English on the short scale, as a cardinal number, an ordinal, or a currency amount with a major and minor unit. The value is carried as an exact sign, digit string and decimal scale end to end -- never as a JavaScript number -- so a value with more digits than a double can hold, or a currency amount with an exact fractional part, spells correctly rather than losing precision on the way in.

## Supported

- Cardinal spelling of any integer from 0 up to the largest scale this tool supports (see limits), including values far beyond what a JavaScript number can represent exactly
- Ordinal spelling (first, second, twenty-third, one hundred and first), applying the irregular forms correctly and converting only the final word
- Currency spelling with a major and minor unit, each supplied as an option and pluralised correctly for a quantity of exactly one
- A configurable minor-unit scale (number of digits after the point), defaulting to two, with amounts padded on the right rather than rounded
- Separators people actually type -- spaces, commas, underscores and apostrophes -- accepted and reported as stripped
- A negative number spelled with the word for negative in front of the whole phrase, not in front of an individual part

## Limits

- Cardinal and ordinal styles expect a whole number. The largest supported scale is decillion (10^33); a value at or beyond the next multiple of a thousand above that is rejected, naming decillion as the largest scale known.
- Only English on the short scale is offered. The long scale, where a billion means 10^12, is not supported.
- The connective word before the final small group ("one hundred and one" versus "one hundred one") is controlled by an option. Neither form is wrong; this tool defaults to including the word, and says so here rather than leaving the choice invisible.
- Currency mode spells whatever unit names the visitor supplies and knows nothing about real currencies, exchange rates or ISO 4217 codes -- the unit names are free text, pluralised with a plain added 's'.

## Ambiguous cases, and what this does about them

- English usage genuinely differs on whether to say "and" before the final small group below one hundred, for example "one hundred and one" (common in British usage) versus "one hundred one" (common in American usage). Neither is wrong. This tool defaults to including the connective word and exposes it as an option so a visitor can match either convention.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/number-to-words number-to-words
cd number-to-words
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/number-to-words
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { toWords } from '@fodt/number-to-words';

toWords('1994');                                   // 'one thousand, nine hundred and ninety-four'
toWords('21', { style: 'ordinal' });               // 'twenty-first'
toWords('12.34', { style: 'currency' });           // 'twelve dollars and thirty-four cents'
toWords('9007199254740993');                       // exact, one more than Number.MAX_SAFE_INTEGER
```

toWords throws NumberToWordsError, which carries a position field pointing at the offending character when a position is meaningful. The value is parsed straight from its decimal digit string into a sign, an unscaled BigInt and a scale (digits after the point) -- there is no intermediate JavaScript number anywhere on the path from input to spelled words, which is what lets a value beyond Number.MAX_SAFE_INTEGER spell exactly.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

No standards body defines English number naming -- it is a linguistic convention, not a specification, and this is stated here rather than a citation being invented. The tests sweep zero to one hundred exhaustively (every irregular word in the language lives in that range), assert a hand-written expectation at every short-scale boundary this tool supports, and assert an exact spelling for a value one greater than the largest safe integer to prove the digit-string path never touches a lossy numeric conversion.

## Licence

MIT. See [LICENSE](./LICENSE).
