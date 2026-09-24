# Password Generator

Generate passwords and passphrases from the cryptographic random source, with entropy shown.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Generates a random password from chosen character classes, or a random passphrase from a bundled 7,776-word list, drawing every character and every word through the browser's cryptographic random source. Reports the entropy in bits and names the randomness source on every run, so the strength claim is checkable rather than asserted.

## Supported

- Character passwords built from any combination of lower-case, upper-case, digit and symbol classes
- Passphrases of any word count, built from the EFF long wordlist (7,776 words, about 12.9 bits per word)
- Excluding visually similar look-alike characters (0/O/o and 1/l/I) from a character password
- Requiring at least one character from every selected class in a character password
- A chosen separator and a chosen capitalisation style for a passphrase
- Generating more than one value in a single run
- An entropy figure in bits for every value, marked as an upper bound when a class requirement constrains the output

## Limits

- When 'require one of each class' is on, the entropy figure shown is an upper bound, not the exact figure: constraining the output to contain every selected class removes a small amount of the unconstrained entropy. The trade buys compatibility with password rules that demand every class.
- Entropy measures how the generator behaves, not how hard any one particular password is to guess by someone who already suspects it or knows something about you.
- The passphrase word list is English only.
- Requesting more than one value draws each one independently; independent draws may legitimately repeat, especially for a short password or a low word count. The result reports how many of the returned values were actually distinct.
- The generated value is shown on screen and copied by you; this tool never writes it to a file.

## Ambiguous cases, and what this does about them

- The EFF long wordlist has no unique-three-letter-prefix property. That property belongs to EFF's separate SHORT wordlist. The long list bundled here contains pairs such as 'abdomen' and 'abdominal' that share the same first three letters, so no test here asserts a unique prefix.
- Four entries in the bundled list are compound words carrying an internal hyphen, exactly as EFF publishes them: drop-down, felt-tip, t-shirt and yo-yo. They are kept as published rather than stripped to plain letters, because altering published attribution data on an assumption about its shape would make the bundled file no longer match its source.

## Bundled data

This folder ships a data file that is not an npm dependency, so it travels with the folder when it is
copied out on its own:

- **EFF Long Wordlist** (CC BY 3.0 US) — [source](https://www.eff.org/deeplinks/2016/07/new-wordlists-random-passphrases). "EFF Long Wordlist" by the Electronic Frontier Foundation, licensed under CC BY 3.0 US (https://creativecommons.org/licenses/by/3.0/us/).

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/password-generator password-generator
cd password-generator
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/password-generator
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { generate } from '@fodt/password-generator';

generate({ mode: 'characters', length: 16, classes: ['lower', 'upper', 'digits', 'symbols'] });
generate({ mode: 'passphrase', words: 6, separator: '-' });
```

`generate` always returns a `PasswordGeneratorResult` object -- `values`, `distinctCount`, `source` and an `entropy` report -- never a bare array of strings, because the entropy figure and the randomness source name have to travel with the values. The 'require one of each class' option is enforced by generate-test-retry over independently and uniformly drawn characters, checked and redrawn as a whole if a class is missing, never by fixing a class to a particular position, which would leak positional structure and cost real entropy.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

No standards body publishes password-generation test vectors; the entropy formula (length times log2 of the effective alphabet size, or word count times log2 of the wordlist length) is what the tests check directly, recomputed from the bundled wordlist rather than hardcoded. Rejection sampling is tested deterministically with a controlled byte source at alphabet sizes 3, 256, 257 and 7776, rather than trusted from character-coverage sampling alone, which cannot distinguish an unbiased picker from a slightly biased one.

## Licence

MIT. See [LICENSE](./LICENSE).
