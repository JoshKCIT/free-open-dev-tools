# Data Size & Transfer Time

Convert between bits, bytes and their SI and IEC multiples, convert speeds, and work out transfer times.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Converts a data size or a network speed across all 24 SI and IEC bit and byte units at once, works out how long a transfer takes, or the speed a transfer needs to finish in a given time. Every conversion is exact rational arithmetic, not floating point, so values that a float would get slightly wrong (such as 1.005 kB) come out exact.

## Supported

- 24 units: bit and its SI multiples (kbit, Mbit, Gbit, Tbit, Pbit) and IEC multiples (Kibit, Mibit, Gibit, Tibit, Pibit), and byte and its SI multiples (kB, MB, GB, TB, PB, EB) and IEC multiples (KiB, MiB, GiB, TiB, PiB, EiB)
- Speeds as the same 24 units per second
- Four modes: convert a size, convert a speed, work out a transfer time, work out the speed a transfer needs
- Transfer time shown as days, hours, minutes and seconds plus the total in seconds
- Exact BigInt rational arithmetic throughout: a value is never passed through a JavaScript floating-point division
- A choice of 3, 4, 6 (default), 8, 10, 12, 15 or 20 significant digits, with every rounded value marked as rounded

## Limits

- Transfer time ignores protocol overhead, latency, congestion and retransmission; it is the size divided by the speed, nothing more.
- Amounts longer than 100 characters, or with a magnitude above 10^30, are refused rather than computed.
- There are no Ebit or Eibit units on the bit side; the largest bit unit is Pbit/Pibit (the byte side goes one step further, to EB/EiB).
- Displayed values round half up (away from zero), never to even, and only when the exact value needs more digits than the chosen significant-digit count; a whole number of at most 21 digits always prints in full.

## Ambiguous cases, and what this does about them

- "KB" and "MB" mean 1024-based amounts in Windows Explorer and in JEDEC memory sizing, even though the SI prefixes k and M are decimal (1000-based). This tool follows the IEC 80000-13 convention throughout: 1024-based units are named only with the IEC i-prefixes (KiB, MiB, ...), and kB/MB/... are always exactly 1000-based.
- The SI prefix for 1000 is written lower-case k (kbit, kB), matching the SI Brochure; only the binary i-prefixes are capitalised (Ki, Mi, ...).

## Defined by

- [IEC 80000-13, binary prefixes, via NIST's "Prefixes for binary multiples"](https://physics.nist.gov/cuu/Units/binary.html)
- [The International System of Units (SI Brochure), 9th edition, section 3, decimal prefixes](https://www.bipm.org/en/publications/si-brochure)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/data-size data-size
cd data-size
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/data-size
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { convertSize, transferTime, parseAmount } from '@fodt/data-size';

convertSize(parseAmount('1', 'size'), 'GiB').find(r => r.unit === 'B'); // { text: '1073741824', rounded: false, ... }
transferTime(parseAmount('1', 'size'), 'GB', parseAmount('100', 'speed'), 'Mbit').text; // '1 m 20 s'
```

`Rational` is `{ num: bigint; den: bigint }`, always kept reduced with a positive denominator. `formatRational(r, significantDigits)` returns `{ text, rounded }`; `rounded` is true whenever the printed text differs from the exact value. `parseAmount(text, field)` throws `DataSizeError` naming which field (`size`/`speed`/`time`/`value`) was invalid. Every conversion function takes an already-parsed `Rational` amount, never a raw string or a `number`.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

IEC 80000-13 and SI Brochure prefix definitions are asserted directly (1 KiB = 1024 B, 1 kB = 1000 B, 1 B = 8 bit). Exactness is proven specifically on values where a plain JavaScript float computation is provably wrong (1.005 * 1000 and 4.1 * 1e9 both fail in IEEE 754 double precision; this tool's own rational arithmetic does not), each test first confirming the float really does fail before asserting this tool's own exact result.

## Licence

MIT. See [LICENSE](./LICENSE).
