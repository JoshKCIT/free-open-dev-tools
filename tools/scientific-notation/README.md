# Scientific Notation Converter

Convert between decimal, scientific, engineering and E notation.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Converts a number between plain decimal, scientific notation (one non-zero digit before the point), engineering notation (the exponent is always a multiple of three) and E notation (the letter form of the exponent). The value is represented internally as a sign, an exact digit string and an integer exponent, so a value with more digits than a JavaScript double can hold survives every conversion unchanged — nothing here is ever parsed into a floating-point number.

## Supported

- Conversion between decimal, scientific, engineering and E notation, in every direction
- Arbitrary digit strings: a value with more significant digits than a double can hold round trips exactly
- Engineering notation with the exponent always landing on a multiple of three, including for values below one
- A signed zero, preserved through every notation
- Rounding to a requested number of significant figures, half away from zero
- Thousands separators and underscores accepted in the input and reported as stripped
- A bound on decimal output length, checked before any expansion is built, so an enormous exponent cannot lock up the page

## Limits

- This converts notation only; it does not do arithmetic. An expression such as 0.1 + 0.2 is rejected rather than evaluated.
- Significant figures are whatever the input states: a trailing zero the visitor did not write is never invented, and a trailing zero they did write is preserved.
- Rounding uses the half-away-from-zero rule, named in the ambiguities below.
- A decimal expansion longer than 100000 characters is rejected rather than built, naming the length that would have been produced and the maximum.
- Engineering notation is defined here as the exponent being a multiple of three, which is the common convention rather than a requirement any standards body publishes.

## Ambiguous cases, and what this does about them

- Rounding to a requested number of significant figures rounds half away from zero (5 rounds up in magnitude), the rule most people expect from school arithmetic. The alternative, round-half-to-even, would surprise a visitor reading a result they were about to quote.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/scientific-notation scientific-notation
cd scientific-notation
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/scientific-notation
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { parseNumber, formatNumber } from '@fodt/scientific-notation';

const value = parseNumber('0.000123');
formatNumber(value, 'scientific');   // '1.23 × 10^-4'
formatNumber(value, 'engineering');  // '123 × 10^-6'
formatNumber(value, 'e');            // '1.23e-4'
formatNumber(value, 'decimal');      // '0.000123'
```

`DecimalValue` is the exact representation: a sign, a digit string with no point in it, and an integer exponent saying where the point sits. Nothing in the conversion path uses `Number`, `parseFloat`, `parseInt` or `.valueOf` on the value being converted, so no digit is ever lost on the way.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

No standards body publishes a vector table for these conversions; ISO 80000-1 touches numeric notation without defining a citable string format for this purpose. The tests instead assert the definitions of each notation directly (exactly one non-zero digit before the point for scientific, an exponent that is a multiple of three for engineering, the letter form for E notation) plus their round trips, and hand-computed examples. The exactness claim is checked with a value that has more significant digits than a double can hold, which a float-based implementation could not pass.

## Licence

MIT. See [LICENSE](./LICENSE).
