# Stock Ratios & Margin Calculator

Work out earnings per share, price to earnings ratio, dividend yield and payout ratio, and the price that triggers a margin call.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Works out one stock figure at a time from the numbers you type: earnings per share (earnings over shares), the price to earnings ratio (price over earnings per share), the dividend yield (the yearly dividend per share over the price), the payout ratio (dividends over earnings), or the price below which a share bought on margin gets a margin call for an initial and a maintenance margin you choose. The page shows each formula with your own numbers put in, so you can check the result by hand.

## Supported

- Earnings per share: earnings divided by the shares outstanding, negative earnings allowed
- Price to earnings ratio: the share price divided by earnings per share, with a plain statement when earnings per share is 0 or below and the ratio is not meaningful
- Dividend yield in percent: the annual dividend per share divided by the share price
- Payout ratio in percent: dividends divided by earnings, both on the same basis
- Margin call price for a share bought on margin: the buy price times (1 minus the initial margin) over (1 minus the maintenance margin), with the loan and the equity per share and how far the price can fall before the call
- Initial and maintenance margins typed as percentages, with an initial margin of 100 percent reported as no loan and so no call, and an initial margin below the maintenance margin reported as already below it
- Ratios and percentages shown to 0 to 4 decimal places, 2 by default, and amounts to the currency's smallest unit
- The working shown: the formula, your numbers put into it and the result before and after rounding
- Exact decimal arithmetic with decimal.js: no amount ever passes through a JavaScript floating-point number

## Limits

- Amounts are rounded half away from zero to the currency's smallest unit, and ratios and percentages to the decimal places you choose, only when shown; every step before that keeps 40 significant digits.
- Every figure is arithmetic on the values you type, not financial, tax or legal advice; it ignores margin interest, trading fees, short positions, dilution, share counts that change during the year, taxes and the rules of any one broker.
- The margin call price is for one share bought on margin and held long: the loan is the buy price times (1 minus the initial margin), a call comes when equity falls below the maintenance share of the market value, and interest on the loan is not added to it.
- Margin percentages are typed by you, with nothing filled in: the initial margin must be more than 0 and at most 100, and the maintenance margin at least 0 and below 100.
- A price to earnings ratio needs earnings per share above 0, and a payout ratio needs earnings above 0; a share price, a buy price and a number of shares must be more than 0.
- Each ratio reflects only the numbers typed: earnings and dividends must be on the same basis, total or per share, and a yield needs a dividend for the year.
- Amounts are shown with English (United States) digit grouping and decimal point whatever currency you choose.

## Ambiguous cases, and what this does about them

- A payout ratio divides dividends by earnings; both can be totals or both can be per share, and this page uses whichever you type for both.
- A dividend yield uses the annual dividend per share; a yield from the last quarter's dividend needs that figure multiplied by 4 first.
- Margin calls depend on the broker's own house rules, which can be stricter than the 25 percent maintenance requirement of FINRA Rule 4210; this page uses the percentages you type.
- Only the earnings per share definition is published in the Investor.gov glossary; the other three ratios have no standard text, so each is stated on the page with its formula.

## Defined by

- [12 CFR 220.12(a) (Regulation T): 50 percent of the current market value as the required margin for a margin equity security](https://www.ecfr.gov/current/title-12/chapter-II/subchapter-A/part-220)
- [FINRA Rule 4210(c)(1): maintenance margin of 25 percent of the current market value of margin securities held long](https://www.finra.org/rules-guidance/rulebooks/finra-rules/4210)
- [SEC Investor.gov glossary, Earnings Per Share: a public company's net profit divided by the number of its common shares](https://www.investor.gov/introduction-investing/investing-basics/glossary/earnings-share)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/stock-metrics stock-metrics
cd stock-metrics
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/stock-metrics
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { calculateStock } from '@fodt/stock-metrics';

const result = calculateStock({
  mode: 'margin',
  buyPrice: '100',
  initialMargin: '50',
  maintenanceMargin: '25',
  currency: 'USD',
});
result.summary.result; // '66.67'
result.summary.lines.map((line) => line.label); // ['Buy price', 'Initial margin', 'Maintenance margin', 'Loan per share', 'Equity per share at purchase', 'Margin call price', 'Fall from the buy price to the call']
```

`calculateStock` takes the page's text values (`mode` as `eps`, `pe`, `yield`, `payout` or `margin`, then `earnings`, `shares`, `price`, `eps`, `dividend`, `dividends`, `buyPrice`, `initialMargin`, `maintenanceMargin`, `decimals` from 0 to 4 and `currency`) and returns `{ summary, working }`, or `null` when every number the chosen mode needs is blank, or throws `MoneyInputError` carrying the `field` that was wrong. `summary.result` is the headline figure as plain decimal text, or `null` when there is none (with the reason in `summary.notes`), and `summary.lines` is every row of the page as `{ label, value, kind }` where `kind` is `money`, `ratio` or `percent`. `earningsPerShare(earnings, shares)`, `priceToEarnings(price, eps)` (null for earnings per share of 0 or below), `dividendYield(dividend, price)` and `payoutRatio(dividends, earnings)` (both in percent) and `marginCallPrice(price, initialPercent, maintenancePercent)` (null for an initial margin of 100) work on exact `Dec` values, a decimal.js value made by this folder's own clone with 40 significant digits and half away from zero. `money.ts` is the shared exact-decimal helper: strict text parsing, rounding, money formatting, whole-number counts, calendar dates, one-row-per-line text with line and column errors, and spreadsheet-safe CSV cells.

## Dependencies

- `decimal.js` 10.6.0

## Tests

```sh
npm test
```

12 CFR 220.12(a) (Regulation T) gives the 50 percent initial requirement and FINRA Rule 4210(c)(1) the 25 percent maintenance requirement, both fetched and quoted in the test comments; neither publishes a margin call price formula, so the formula is derived by hand: equity P - L must stay at least m x P with the loan L = P0 x (1 - i), so the call comes below P0 x (1 - i) / (1 - m), which is 66.666667 for 100, 50 and 25. The Investor.gov glossary defines earnings per share only; no standards body publishes the price to earnings, dividend yield or payout ratio definitions, so those are derived by hand in the tests. Exactness is proven by first showing that 0.3 / 3 in JavaScript floating point is 0.09999999999999999 and then that this tool's own path returns exactly 0.1.

## Licence

MIT. See [LICENSE](./LICENSE).
