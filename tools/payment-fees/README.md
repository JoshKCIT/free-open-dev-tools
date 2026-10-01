# Payment Fee Calculator

Work out the fee on a payment and the amount received from a percentage and fixed fee you type in, or the amount to charge to receive a chosen sum.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Works out what a payment fee costs from a percentage fee and a fixed fee that you type in. Give a payment and it shows the fee and the amount you receive. Give the amount you want to receive and it shows the smallest amount to charge that still leaves you at least that much after the fee is rounded to the currency's smallest unit. Nothing is filled in for you: the page holds no fee table of any company, so every rate is the one on your own agreement.

## Supported

- Fee on a payment: the payment times the percentage fee, plus the fixed fee, rounded half away from zero to the currency's smallest unit; the amount received is the payment minus that fee
- Amount to charge to receive a chosen sum: the exact gross-up, (amount wanted + fixed fee) over (1 - percentage), rounded up to the smallest unit and then moved by single units until it is the smallest charge that leaves at least the amount wanted after the rounded fee
- Whole-unit currencies such as JPY round the fee to whole units; currencies with three decimals such as BHD round to three
- A percentage fee of 100 percent or more is refused naming the field; a fee larger than the payment is reported with the shortfall
- The working shown: the formulas, your numbers put in, and each charge checked while settling on the smallest one
- Exact decimal arithmetic with decimal.js: no amount ever passes through a JavaScript floating-point number

## Limits

- Amounts are rounded half away from zero to the currency's smallest unit; the fee is rounded once, after the percentage part and the fixed fee are added, and every step before that keeps 40 significant digits. A provider's own rounding may differ from this rule.
- Every figure is arithmetic on the values you type, not financial, tax or legal advice; it ignores tiered, capped or volume fees, currency conversion fees, refund and dispute fees, taxes on fees and any charge that is not typed as the percentage or the fixed fee.
- One percentage fee and one fixed fee apply to each payment; nothing is filled in for you, so a fee that does not apply is typed as 0.
- The payment, the amount you want to receive and the fixed fee may have no more decimal places than the currency's smallest unit; the percentage fee is at least 0 and below 100 with at most 12 decimal places.
- The search for the smallest charge starts at the exact gross-up and takes at most a few single-unit steps; if it did not settle within 20 steps this page says so instead of guessing.
- Amounts are shown with English (United States) digit grouping and decimal point whatever currency you choose.

## Ambiguous cases, and what this does about them

- Providers differ in how they round a fee: some round the percentage part and the fixed fee separately, some round down, some round once at the end. This page rounds once at the end, half away from zero, and says so; check a provider's own statement for the last unit.
- Wanting to receive a sum has no single exact answer when rounding is involved: several neighbouring charges can leave the same amount, so this page shows the smallest charge that leaves at least the sum you want, which can leave one unit more than you asked for.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/payment-fees payment-fees
cd payment-fees
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/payment-fees
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { calculateFees } from '@fodt/payment-fees';

const result = calculateFees({ mode: 'charge', amount: '100', percentFee: '2.9', fixedFee: '0.30', currency: 'USD' });
result.summary.fee; // '3.20'
result.summary.received; // '96.80'
```

`calculateFees` takes the page's text values (`mode` as `charge` or `receive`, `amount`, `target`, `percentFee`, `fixedFee` and `currency`) and returns `{ summary, working }`, or `null` when every number the chosen mode needs is blank, or throws `MoneyInputError` carrying the `field` that was wrong. `summary` holds the fee, the amount received, the amount to charge (in `receive` mode, otherwise `null`) and the shortfall (when the fee is larger than the payment, otherwise `null`) as plain decimal text rounded to the currency's smallest unit, and `lines` is every row of the page. `feeOn(amount, percent, fixed, currency)`, `amountToCharge(target, percent, fixed, currency)` and `searchCharge(...)` (the same search with every charge it checked) work on exact `Dec` values, a decimal.js value made by this folder's own clone with 40 significant digits and half away from zero. `money.ts` is the shared exact-decimal helper: strict text parsing, rounding, money formatting, whole-number counts, calendar dates, one-row-per-line text with line and column errors, and spreadsheet-safe CSV cells.

## Dependencies

- `decimal.js` 10.6.0

## Tests

```sh
npm test
```

No standards body defines payment-fee arithmetic, and this tool holds no fee tables because every rate is typed by the visitor, so the tests derive every figure by hand and the page shows the formulas: 100 at 2.9 percent plus 0.30 is 2.90 + 0.30 = 3.20 and leaves 96.80; to receive 100 the exact gross-up is 100.30 over 0.971 = 103.2955..., rounded up to 103.30, which has a fee of 3.2957 rounded to 3.30 and leaves exactly 100.00, while 103.29 has the same fee and leaves 99.99; a sweep over every target from 0.01 to 20.00 checks that the charge leaves at least the target and one cent less does not; JPY 1000 at 3.6 percent is a fee of 36. Exactness is proven by first showing that 0.1 plus 0.2 in JavaScript floating point is 0.30000000000000004 and then that this tool's own path returns a fee of exactly 0.3.

## Licence

MIT. See [LICENSE](./LICENSE).
