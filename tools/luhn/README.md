# Luhn & Card Number Validator

Check a number against the Luhn algorithm and identify the issuer pattern.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Checks a number against the Luhn algorithm, the checksum formula ISO/IEC 7812-1 Annex B specifies for these numbers, computes the check digit a number without one should carry, and reports which published issuer numbering pattern the digits match. It never claims that a number which passes is real, active or issued -- only that its digits are internally consistent.

## Supported

- Checking whether a number, with or without spaces or hyphens, satisfies the Luhn checksum
- Computing the check digit a number without one should carry
- Identifying every issuer numbering pattern (Visa, Mastercard including its 2-series BINs, American Express, Discover, and China UnionPay) whose prefix and length the number matches
- Stripping spaces and hyphens as separators and reporting how many were stripped
- Reporting the raw Luhn sum alongside the pass or fail verdict
- Returning every matching issuer pattern rather than only the first, including where two issuers' ranges genuinely overlap

## Limits

- Passing the Luhn check proves only that the digits are internally consistent. It catches typing mistakes, not fabrications -- a fabricated number can pass, and this never means the number is real, active or usable.
- Issuer ranges are published by the issuers and change over time. The table here is a snapshot compiled from public sources on 2026-09-24, not a live lookup.
- The Luhn algorithm cannot detect every error: it is known not to catch the transposition of an adjacent 0 and 9 (or 9 and 0), which is documented and tested here rather than treated as a bug.
- The number is processed entirely on this page and is never sent anywhere.
- A string shorter than two digits is rejected outright; there is nothing to check with fewer.

## Ambiguous cases, and what this does about them

- Some issuer ranges genuinely overlap -- Discover's 622126-622925 range is co-branded with China UnionPay's own 62 range, per publicly published issuer tables. This tool reports both matches rather than silently preferring one.

## Defined by

- [ISO/IEC 7812-1 — Identification cards — Identification of issuers — Part 1: Numbering system (Annex B specifies the check digit formula)](https://www.iso.org/standard/70484.html)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/luhn luhn
cd luhn
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/luhn
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { isValid, checkDigit, identify } from '@fodt/luhn';

isValid('79927398713');        // true
checkDigit('7892739979');      // wrong example digits omitted -- see tests
identify('4242424242424242'); // [{ id: 'visa', label: 'Visa' }]
```

isValid, checkDigit and identify all throw LuhnError, which carries a position field pointing at the offending character when a position is meaningful. checkDigit and isValid share one implementation of the digit-doubling walk rather than duplicating it.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

ISO/IEC 7812-1 is sold rather than freely published, and it was not opened for this tool -- Annex B is cited as the formula's normative home based on aggregated public confirmation, not a read of the paywalled text itself. The worked example the tests assert is widely reproduced across many independent descriptions of the algorithm, but is not established as an ISO-published vector; its correctness here rests on the hand computation written out in a comment beside the assertion, not on the citation. The issuer table is this project's own compilation from publicly published issuer identification number references.

## Licence

MIT. See [LICENSE](./LICENSE).
