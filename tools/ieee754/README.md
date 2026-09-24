# IEEE 754 Float Inspector

Show the exact sign, exponent and mantissa bits behind a binary32 or binary64 value.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Decomposes a binary32 (single precision) or binary64 (double precision) floating-point value into its exact sign, exponent and mantissa bits. Every special case — signed zero, both infinities, quiet and signalling NaN with its payload, and subnormals — is named explicitly rather than run through the ordinary decomposition, which gets every one of them wrong. Accepts either a decimal value or a raw hexadecimal bit pattern, so a bit pattern copied from a debugger round trips exactly, including a signalling NaN that an ordinary float round trip would quiet.

## Supported

- Binary32 (single precision) and binary64 (double precision) bit-level decomposition
- Sign, exponent and mantissa fields shown separately, plus the full bit string grouped by field
- Signed zero, both infinities, quiet and signalling NaN with its payload, and subnormals, each explicitly labelled
- Inspecting a decimal value, or a raw hexadecimal bit pattern of the exact width the chosen format requires
- Exact round trip of a hexadecimal bit pattern, including a signalling NaN, with no quieting by the engine
- Biased and unbiased exponent reported for both normal and subnormal values, with no implicit leading one claimed for a subnormal

## Limits

- Only the two binary interchange formats are covered: no half precision (binary16), no decimal floating point, and no extended precision.
- The decoded value shown is the shortest decimal string that round trips back to the same bits, which is often not the exact decimal the visitor originally typed.
- JavaScript treats every NaN identically at runtime; the quiet-or-signalling distinction is reported here but has no effect on how the engine behaves.
- A hexadecimal bit pattern must be exactly the digit count the chosen format requires (8 digits for binary32, 16 for binary64); partial or padded input is rejected rather than guessed at.

## Ambiguous cases, and what this does about them

- Negative zero is displayed as "-0" through an explicit sign check rather than through ordinary string conversion, because `String(-0)` prints `0` and would otherwise hide the one bit this tool exists to show.

## Defined by

- [IEEE 754-2019: IEEE Standard for Floating-Point Arithmetic](https://ieeexplore.ieee.org/document/8766229)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/ieee754 ieee754
cd ieee754
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/ieee754
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { inspectFloat, fromBits, bitsFromHex, reportFromBits } from '@fodt/ieee754';

inspectFloat('3.14', 'binary32', 'value').bits;        // full bit string
inspectFloat('7f800001', 'binary32', 'bits').label;     // 'signalling NaN'
reportFromBits(bitsFromHex('80000000', 'binary32'), 'binary32').label; // 'negative zero'
```

The mantissa, the payload and the returned bit pattern from `bitsFromHex` are all `bigint`, so no bit-derived field of the report ever passes through a JavaScript number. Converting to a number happens exactly once, to produce the displayed decoded value, and feeds nothing else.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

IEEE 754-2019 is not freely published; it sits behind the IEEE's paywall and this project does not purchase standards. Two layers of tests compensate. First, a differential oracle: for ordinary values the JavaScript engine's own binary32/binary64 representation is used as a second implementation, since it implements the same format, and the package's decomposition is checked against bits computed independently in the test with a raw DataView. That oracle cannot catch a mistake the platform itself shares, so second, a set of source-attributed bit patterns is asserted literally: the signalling and quiet NaN patterns, the largest subnormal, the smallest normal and negative zero for both widths were computed with a BigInt-only reference classifier and cross-checked with a V8 round-trip probe (Node 22.14.0), recorded in this plan's review ledger, rather than taken from the paywalled standard.

## Licence

MIT. See [LICENSE](./LICENSE).
