# Investment Return Calculator

Work out profit or loss, return on investment and annualised return from buy and sell prices or start and end values, quantities, fees and dates.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Takes either a buy price, a sell price and a quantity, or a start value and an end value, with optional fees paid when buying and when selling, and works out the total cost, the total proceeds, the profit or loss and the return on investment. When you also type a start date and an end date it works out the annualised return that the SEC Form N-1A definition gives, P(1+T)^n = ERV, where n is the days held over 365. The page shows each formula with your own numbers put in, so you can check the result by hand.

## Supported

- Buy and sell prices with a quantity (whole or fractional), or a start value and an end value
- Optional fees paid when buying, added to the cost, and when selling, taken off the proceeds
- Profit or loss, and return on investment as profit divided by total cost, in percent
- Annualised return from a start date and an end date, the solution of P(1+T)^n = ERV from SEC Form N-1A Item 26(b)(1), with n the days held over 365 and a fractional power done in exact decimal arithmetic
- A holding period of any length from 1 day up, and a total loss reported as -100 percent
- Percentages shown to 0 to 4 decimal places, 2 by default (SEC Form N-1A Item 26 Instruction 5: the nearest hundredth of one percent)
- The working shown: both formulas, your numbers put into them and the result before and after rounding
- Any currency code your browser knows, with the right number of decimal places for that currency
- Exact decimal arithmetic with decimal.js: no amount ever passes through a JavaScript floating-point number

## Limits

- Amounts are rounded half away from zero to the currency's smallest unit, and percentages to the decimal places you choose, only when shown; every step before that keeps 40 significant digits.
- Every figure is arithmetic on the values you type, not financial, tax or legal advice; it ignores taxes, inflation, dividends and interest unless they are already in the values you type, and when money moved between the two dates.
- The holding period is counted in whole days between the two dates, leap days included, and the years held are those days divided by 365; a count of 365.25 days or a 30/360 month basis would give slightly different annualised figures.
- A holding period under a year is annualised by the same formula, so a short period with a large gain gives a very large annualised figure; an annualised figure of 1,000,000,000,000,000,000 percent or more is not shown.
- Cost must be more than 0, and proceeds must not be below 0, so fees larger than the sale are refused naming the fees; a sale for nothing gives a return of -100 percent.
- A price and a quantity can each have up to 12 digits before the point and 6 after, and other amounts up to 15 before and 12 after; none can be negative.
- Dates are year-month-day text between 1900 and 2200, the end cannot be before the start, and a holding period of 0 days has no annualised return.
- Amounts are shown with English (United States) digit grouping and decimal point whatever currency you choose.

## Ambiguous cases, and what this does about them

- SEC Form N-1A fixes the formula P(1+T)^n = ERV with n the number of years but not how a number of days becomes years; this page uses days over 365.
- Return on investment is profit divided by total cost including the fees paid when buying; some definitions leave the fees out of the cost.
- SEC Form N-1A assumes distributions are reinvested; this page has no distributions, so any income must already be in the end value or the proceeds.

## Defined by

- [SEC Form N-1A Item 26(b)(1), average annual total return P(1+T)^n = ERV, and Instruction 5, the nearest hundredth of one percent](https://www.sec.gov/files/form-n-1a.pdf)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/investment-return investment-return
cd investment-return
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/investment-return
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { calculateInvestment } from '@fodt/investment-return';

const result = calculateInvestment({
  mode: 'values',
  startValue: '1000',
  endValue: '1500',
  startDate: '2021-01-01',
  endDate: '2025-12-31',
  currency: 'USD',
});
result.summary.profit; // '500.00'
result.summary.roi; // '50.00'
result.summary.days; // 1825
result.summary.annualised; // '8.45'
```

`calculateInvestment` takes the page's text values (`mode` as `prices` or `values`, `buyPrice`, `sellPrice`, `quantity`, `startValue`, `endValue`, `buyFees`, `sellFees`, `startDate`, `endDate`, `decimals` from 0 to 4 and `currency`) and returns `{ summary, working }`, or `null` when every number the chosen mode needs is blank, or throws `MoneyInputError` carrying the `field` that was wrong. `summary.annualised` is `null` when no dates were typed or the holding period is 0 days, with the reason in `summary.annualisedNote`. `annualisedReturn(start, end, years)` returns the annual rate as a fraction (`T` in P(1+T)^n = ERV) from exact decimal values, or `null` when the years are zero, and `investmentReturn({ cost, proceeds, days })` returns the profit, the return on investment in percent and, when `days` is given, the annualised return in percent. `money.ts` is the shared exact-decimal helper: strict text parsing, rounding, money formatting, whole-number counts, calendar dates, one-row-per-line text with line and column errors, and spreadsheet-safe CSV cells.

## Dependencies

- `decimal.js` 10.6.0

## Tests

```sh
npm test
```

SEC Form N-1A Item 26(b)(1) gives the formula P(1+T)^n = ERV and Instruction 5 the quotation to the nearest hundredth of one percent; the form has no worked example, so each figure is derived by hand in the test comments: 1,000 growing to 1,500 over 5 years is 1.5^(1/5) - 1 = 0.0844717712, which is 8.45 percent, and 1,000 growing to 2,000 over 2.5 years is 2^(1/2.5) - 1 = 0.3195079108, which is 31.95 percent. The day count and the fee handling are conventions stated on the page and derived by hand. Exactness is proven by first showing that 0.3 - 0.1 in JavaScript floating point is 0.19999999999999998 and then that this tool's own path returns exactly 0.2.

## Licence

MIT. See [LICENSE](./LICENSE).
