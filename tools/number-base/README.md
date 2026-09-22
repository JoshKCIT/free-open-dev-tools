# Number Base Converter

Convert integers between any bases from 2 to 36, with arbitrary precision.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Converts whole numbers between any pair of bases from 2 to 36. Everything is computed with arbitrary-precision integers, so a 256-bit hash converts to decimal exactly rather than becoming 1.157920892373162e+77, which is what happens in most browser-based converters. It also shows how the value sits in fixed-width integers, including the two complement form of a negative number.

## Supported

- Any base from 2 to 36, in both directions, with no size limit
- The 0x, 0o and 0b prefixes, and separators written as underscores, spaces, commas or apostrophes
- Negative numbers, with the sign kept outside any prefix
- Two complement at 8, 16, 32, 64, 128 and 256 bits, with the smallest width that fits each value
- Digit grouping: bytes in binary, nibbles in hexadecimal
- Arbitrary-precision arithmetic and bitwise operations between two numbers

## Limits

- Whole numbers only. There is no fractional part, so 0.5 in binary is not something this converts. The IEEE 754 inspector handles fractional binary values.
- Bases above 36 would need digits beyond the 26 letters, and there is no agreed alphabet for them. Base58 and Base64 have their own tools here because they encode bytes rather than numbers.
- Bitwise operations on a negative number use the arbitrary-precision two complement of an infinite-width integer, which is what JavaScript BigInt does. That differs from a fixed-width language where the result wraps.
- The exponent for a power is capped, and a shift is capped at 4096 places, because the result would otherwise be too large to render.

## Ambiguous cases, and what this does about them

- Integer division truncates towards zero, so -7 divided by 2 is -3. C, Java, Go and Rust all agree; Python rounds towards negative infinity and gives -4. The choice made here is the more common one and is stated on the page.
- The remainder takes the sign of the dividend, so -7 modulo 3 is -1 rather than 2. This follows from the division rule above.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/number-base number-base
cd number-base
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/number-base
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { parseInBase, toBase, convertAll, widthReport } from '@fodt/number-base';

parseInBase('0xdead_beef', 16).value;   // 3735928559n
toBase(255n, 2);                        // '11111111'
convertAll(255n);                       // every common base at once
widthReport(-1n).twosComplement;        // ff, ffff, ffffffff, …
```

Values are `bigint` throughout. `parseInBase` returns the magnitude with a separate `negative` flag, so a leading zero or a prefix can still be reported accurately.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Round trips every base from 2 to 36 over a set of values including zero, negatives and 2 to the 64th. Agreement with the platform is checked against `Number.prototype.toString` and `parseInt` for values a double can hold, and precision is checked by converting a 64-digit hexadecimal hash to its exact 78-digit decimal form. Two complement is asserted at every width, and division and modulo sign behaviour is pinned down explicitly.

## Licence

MIT. See [LICENSE](./LICENSE).
