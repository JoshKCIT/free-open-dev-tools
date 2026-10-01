# Currency Conversion Markup

Compare an offered exchange rate with a reference mid-market rate you type in, and see the markup as a percentage and the hidden cost in each currency.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Compares the exchange rate a bank or card offers you with a reference mid-market rate, and shows what the difference costs. You type the amount, the two currency codes, the rate you were offered and the reference rate you want to compare it with. The page shows the amount converted at each rate, the markup as a percentage over the reference rate, and the hidden cost in the target currency and in the source currency, with the working. Both rates are typed by you: no exchange rate is built in, looked up or fetched.

## Supported

- The amount converted at the offered rate and at the reference rate, each shown in the target currency
- The markup as a percentage over the reference rate: the reference rate minus the offered rate, divided by the reference rate, times 100, so 1,000 euros at 1.0780 against a reference of 1.1000 is a 2.00 percent markup
- The hidden cost in the target currency (the amount times the difference between the two rates) and in the source currency (that cost divided by the reference rate): 22.00 and 20.00 for the same example
- A negative markup, with a plain note, when the offered rate is better than the reference rate, and a markup of exactly 0.00 with no hidden cost when the two rates are equal
- Each figure shown in the smallest unit of its own currency, as your browser reports it: no decimals for yen and three for Bahraini dinars
- The percentage shown with 0 to 4 decimal places, chosen by you
- The working shown: the formulas, your numbers put into them and the results before and after rounding
- Exact decimal arithmetic with decimal.js: no amount or rate ever passes through a JavaScript floating-point number

## Limits

- Amounts are rounded half away from zero to the currency's smallest unit, and the percentage to the places you choose, only when shown; every step before that keeps 40 significant digits.
- Every figure is arithmetic on the values you type, not financial, tax or legal advice; it ignores separate fixed fees, card network rules, the time between a quote and the settlement, and any rate that changes while you decide.
- No exchange rate is built in, looked up or fetched: both the rate you were offered and the reference rate are typed by you, and a rate of zero or a blank rate is refused by name.
- Rates are read as units of the target currency per one unit of the source currency, as the labels say; a rate typed the other way round (source per target) gives a wrong answer, so check the direction before you type.
- One conversion at a time: the amount is converted once from the source currency to the target currency, with no fees added and nothing carried over from earlier conversions.
- An amount or a rate may have at most 15 digits before the point and 12 after, the amount must be above zero and each rate must be above zero.
- Amounts are shown with English (United States) digit grouping and decimal point whatever currency you choose.

## Ambiguous cases, and what this does about them

- The regulation cited below says charges must be shown as a percentage mark-up over a reference rate but gives no formula and no direction; this page states its own: the reference rate minus the offered rate, divided by the reference rate. Dividing by the offered rate instead would give a slightly different percentage (2.04 rather than 2.00 for 1.0780 against 1.1000).
- An offered rate better than the reference rate gives a negative markup and a negative hidden cost, which means a saving against the reference, not a charge.
- Which reference rate is the right one to compare with (a central bank rate, a market mid rate at a given time) is your choice; this page uses whatever you type and does not say which is correct.

## Defined by

- [Regulation (EU) 2019/518, Article 3a(1): total currency conversion charges are expressed as a percentage mark-up over the latest available euro foreign exchange reference rates issued by the European Central Bank](https://www.legislation.gov.uk/eur/2019/518/data.html)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/currency-markup currency-markup
cd currency-markup
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/currency-markup
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { calculateMarkup } from '@fodt/currency-markup';

const result = calculateMarkup({ amount: '1000', source: 'EUR', target: 'USD', offered: '1.0780', mid: '1.1000' });
result?.summary.markupPercent; // '2.00'
result?.summary.hiddenTarget; // '22.00'
result?.summary.hiddenSource; // '20.00'
```

`calculateMarkup` takes the page's text values (`amount`, `source` and `target` currency codes, `offered` and `mid` rates as units of the target currency per one unit of the source currency, and `decimals` for the percentage, 0 to 4) and returns `{ summary, working }`, or `null` when no amount is typed, or throws `MoneyInputError` carrying the `field` that was wrong. `summary` holds each figure as plain decimal text at the decimal places of its own currency, the percentage text, a `direction` of `worse`, `equal` or `better` and plain `notes`. `markup(amount, offered, mid)` works on exact `Dec` values and returns the converted amounts, the markup percent and the hidden cost in the target and the source currency, unrounded. It uses this folder's own decimal.js clone with 40 significant digits and half away from zero. `money.ts` is the shared exact-decimal helper: strict text parsing, rounding, money formatting, whole-number counts, calendar dates, one-row-per-line text with line and column errors, and spreadsheet-safe CSV cells.

## Dependencies

- `decimal.js` 10.6.0

## Tests

```sh
npm test
```

Regulation (EU) 2019/518 (fetched and quoted in the test comments) requires charges to be expressed as a percentage mark-up over a reference rate but gives no formula, so the figures are derived by hand from the formula this page states: 1,000 at 1.0780 against 1.1000 converts to 1,078.00 and 1,100.00, the markup is 0.022 over 1.1, which is 2 percent, the hidden cost is 1,000 times 0.022 which is 22.00 and 22.00 divided by 1.1 which is 20.00. An offered rate of 1.12 against 1.10 gives minus 1.82 percent, equal rates give 0, yen show no decimals and dinars three. Exactness is proven by first showing that 0.1 times 3 in JavaScript floating point is 0.30000000000000004 and then that an amount of 0.1 at an offered rate of 1 against a reference of 3 converts to exactly 0.3.

## Licence

MIT. See [LICENSE](./LICENSE).
