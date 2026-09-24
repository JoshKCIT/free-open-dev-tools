# Random String & Nano ID

Generate random identifiers from a chosen alphabet, with entropy shown.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Generates a random identifier of a chosen length, drawn character by character from a named alphabet preset or a custom one you supply, using the browser's cryptographic random source. Reports the entropy in bits and names the randomness source on every run.

## Supported

- A URL-safe preset (upper- and lower-case letters, digits, hyphen and underscore)
- An unambiguous preset with visually similar look-alike characters removed
- A hexadecimal preset (lower-case 0-9 and a-f)
- A letters-and-digits preset and a lower-case-letters-only preset
- A digits-only preset
- A custom alphabet you supply, used exactly as given after duplicate characters are removed
- Generating more than one value in a single run

## Limits

- Entropy measures how the generator behaves, not how hard any one particular value is to guess by someone who already suspects it or knows something about you.
- A shorter value drawn from a larger alphabet is not automatically stronger than a longer value from a smaller one; the bits figure is the number to compare, not the length or the alphabet size alone.
- Values are drawn independently and may repeat, especially for a short length over a small alphabet; the result reports how many of the returned values were actually distinct.
- A custom alphabet is used exactly as given (after removing duplicate characters), so a visitor who supplies a weak or predictable alphabet gets a weak result.
- The generated value is shown on screen and copied by you; this tool never writes it to a file.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/random-string random-string
cd random-string
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/random-string
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { generate, ALPHABETS } from '@fodt/random-string';

generate({ alphabet: 'urlSafe', length: 21 });
generate({ alphabet: 'custom', customAlphabet: 'abcxyz', length: 10 });
```

`generate` always returns a `RandomStringResult` object -- `values`, `distinctCount`, the effective `alphabet` used, `duplicatesRemoved`, `bitsPerValue`, `totalBits` and `source` -- never a bare array of strings, because the entropy figure and the randomness source name have to travel with the values. `pickIndex` is the same rejection-sampling index picker `tools/password-generator` uses, copied rather than imported since a tool package may not depend on another tool package.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

No standards body publishes vectors for random-identifier generation; the entropy formula (length times log2 of the effective alphabet size) is what the tests check directly. Rejection sampling is tested deterministically with a controlled byte source at alphabet sizes 3, 256, 257 and 7776, and character-coverage sampling is used only as a loose smoke test, since coverage alone cannot distinguish an unbiased picker from a slightly biased one.

## Licence

MIT. See [LICENSE](./LICENSE).
