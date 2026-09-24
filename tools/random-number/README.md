# Random Number Generator

Generate random integers or decimals in a range, optionally from the cryptographic source.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Generates one or more random integers or decimals inside a range you choose, both bounds included. Numbers come from the browser's cryptographically secure random source by default, using unbiased rejection sampling rather than a modulo of a random word, which is the shortcut that quietly skews the low end of a range.

## Supported

- Integer generation, inclusive of both the lower and upper bound
- Decimal generation with any number of decimal places, rounded to exactly that many digits
- Any count of values in a single request
- A cryptographically secure source (the browser's Web Crypto `getRandomValues`) by default
- An optional non-cryptographic source for reproducible-looking test data
- Optional uniqueness for integer output, so no value repeats within one request
- Unbiased sampling across the requested range via rejection sampling, never a modulo of a random word

## Limits

- This is a generator of values, not a source of cryptographic keys, tokens or secrets.
- The non-cryptographic source is offered only for reproducible-looking test data and must never be used for anything that matters.
- Decimal output is rounded to the requested number of places, so the printed value is not the full-precision draw that produced it.
- A unique-integer request whose range holds fewer distinct values than the count asked for is rejected rather than attempted.

## Ambiguous cases, and what this does about them

- The range is inclusive at both ends: asking for 1 to 6 can return either 1 or 6, not just the values strictly between them.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/random-number random-number
cd random-number
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/random-number
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { generate } from '@fodt/random-number';

generate({ mode: 'integer', min: 1, max: 6, count: 10 });
// { values: ['4','1','6','3','2','5','5','1','4','6'], source: 'crypto', min: 1, max: 6, mode: 'integer' }

generate({ mode: 'decimal', min: 0, max: 1, places: 3, count: 1 });
// { values: ['0.512'], source: 'crypto', min: 0, max: 1, mode: 'decimal' }
```

Throws `RandomNumberError` for an inverted range, a non-finite bound, a count below one, a unique-integer request whose range cannot hold the count requested, or a decimal range with no value representable at the requested precision. `RandomNumberOptions` also accepts an undocumented `byteSource`, an array of raw bytes consumed instead of drawing from the configured source; it exists only so the rejection-sampling path can be tested deterministically and is never exposed on the page.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

No standards body publishes random-number test vectors, so correctness here is grounded in the definition of an inclusive range and proven deterministically: a supplied byte sequence forces a draw into the rejection-sampling path's discarded final block, and the test asserts the next byte's value is returned rather than a biased modulo of the first. A large-sample check that every value in a small range eventually appears is kept as a smoke test alongside it, not as the proof, because it cannot itself distinguish rejection sampling from a small modulo bias.

## Licence

MIT. See [LICENSE](./LICENSE).
