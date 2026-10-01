# Compound Interest & Savings Calculator

Grow a starting amount and regular deposits at a stated rate and compounding frequency, with the final balance and a year-by-year table.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Grows a starting amount and a regular deposit at a yearly interest rate you type, compounded yearly, twice a year, quarterly, monthly, weekly or daily, for any number of years from 1 to 100. It shows the final balance, the total of your deposits, the total interest and a year-by-year table whose rows add up exactly to those totals. The page shows the formula with your own numbers put in, so you can check the result by hand, and the effective annual yield that the rate and compounding give.

## Supported

- A starting amount and a regular deposit, either one left blank counting as 0
- One deposit in every compounding period, made at the end of the period or at the start of it, where a deposit at the start earns that period's interest
- Compounding 1, 2, 4, 12, 52 or 365 times a year, the daily year being 365 days as the US deposit-account rule counts it
- A yearly rate from 0 to 100 percent, with a zero rate handled by its own equation instead of a division by zero
- Terms from 1 to 100 years
- The final balance, the total deposits, the total interest and the effective annual yield to 4 places of a percent
- A year-by-year table of deposits, interest and year-end balance whose columns add up exactly to the totals
- The working shown: the formula, your numbers put into it, the exact balance and the rounded balance
- The annual percentage yield formula of the US deposit-account rule, for interest earned on a principal over a number of days
- Any currency code your browser knows, with the right number of decimal places for that currency
- Exact decimal arithmetic with decimal.js: no amount or rate ever passes through a JavaScript floating-point number

## Limits

- Balances are worked out at full precision (40 significant digits) and rounded half away from zero to the currency's smallest unit only when shown; each year's interest is the rounded year-end balance minus the rounded balance a year earlier minus that year's deposits, so the interest column adds up exactly to the totals.
- Every figure is arithmetic on the values you type, not financial, tax or legal advice; it ignores tax on interest, account fees, rate changes over time, inflation and day counts other than equal compounding periods.
- One deposit is made in every compounding period, so with weekly or daily compounding the deposit is a weekly or daily one; type the deposit that way.
- The rate is a nominal yearly rate that stays the same for the whole term, and interest is added in equal periods; a daily year is 365 days.
- A term is limited to 1 to 100 years, and a final balance of 1,000,000,000,000,000,000 or more is refused because it is too large to show exactly.
- A starting amount and a deposit can have no more decimal places than the currency's smallest unit, so the deposits add up to the last cent.
- Amounts are shown with English (United States) digit grouping and decimal point whatever currency you choose.

## Ambiguous cases, and what this does about them

- A deposit at the start of a period earns that period's interest and a deposit at the end does not, which is the difference between PayType 1 and PayType 0 in the OpenFormula future value equation; the final balance with start-of-period deposits is the end-of-period balance times one period of growth.
- The OpenFormula equation is written with the sign convention of money paid out. This page uses positive numbers throughout: money you put in and the balance you get out.
- The deposit-account rule allows an institution to use a 366-day year in a leap year; this page always counts a year as 365 days when it works out an annual percentage yield.
- Real accounts may round interest to the cent every period; this page keeps full precision between years and rounds only for display, so a bank statement can differ by a few cents.

## Defined by

- [ISO/IEC 26300-2:2015 (OpenFormula, OASIS ODF 1.2 part 2) sections 6.12.20 FV and 6.12.41 PV](https://docs.oasis-open.org/office/v1.2/os/OpenDocument-v1.2-os-part2.html)
- [12 CFR 1030 Appendix A, annual percentage yield calculation (Regulation DD)](https://www.consumerfinance.gov/rules-policy/regulations/1030/a/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/compound-interest compound-interest
cd compound-interest
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/compound-interest
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { calculateSavings } from '@fodt/compound-interest';

const plan = calculateSavings({
  start: '0',
  deposit: '100',
  timing: 'end',
  rate: '12',
  compounding: '12',
  years: '1',
  currency: 'USD',
});
plan.summary.finalBalance; // '1268.25'
plan.summary.totalDeposits; // '1200.00'
plan.summary.totalInterest; // '68.25'
plan.summary.effectiveYield; // '12.6825'
plan.rows[0]; // { year: 1, deposits: '1200.00', interest: '68.25', balance: '1268.25' }
```

`calculateSavings` takes the page's text values (`start`, `deposit`, `timing` as `end` or `start`, `rate`, `compounding` as 1, 2, 4, 12, 52 or 365, `years` and `currency`) and returns `{ summary, rows, working }`, or `null` when every number field is blank, or throws `MoneyInputError` carrying the `field` that was wrong. Every figure in `summary` and `rows` is a plain decimal string at the currency's smallest unit, apart from the effective yield, a percent to 4 places. `futureValue(pv, pmt, annualPercent, perYear, periods, payType)` solves the OpenFormula 6.12.41 equation that 6.12.20 FV refers to, with positive amounts, and returns an exact `Dec` (a decimal.js value made by this folder's own clone, 40 significant digits, half away from zero). `yearlyTable` builds the rows, `effectiveAnnualYield(annualPercent, perYear)` returns a percent and `annualPercentageYield(interest, principal, days)` returns the Regulation DD figure as a percent. `money.ts` is the shared exact-decimal helper: strict text parsing, rounding, money formatting, whole-number counts, calendar dates, one-row-per-line text with line and column errors, and spreadsheet-safe CSV cells.

## Dependencies

- `decimal.js` 10.6.0

## Tests

```sh
npm test
```

The balances for 100 a month at 12 percent for 12 months (1268.25 with deposits at the end, 1280.93 at the start) and for 1000 at 5 percent compounded monthly for 10 years (1647.01) are worked out by hand from the OpenFormula 6.12.41 equation in the test comments. The annual percentage yield is checked against the two worked examples printed in 12 CFR 1030 Appendix A (61.68 of interest on 1000 for a 365-day year gives 6.17 percent, 30.37 over 182 days gives 6.18 percent). The regulation's stepped-rate totals are not used as exact figures because it allows interest rates to be carried to five places. Exactness is proven by first showing that 0.1 + 0.2 in JavaScript floating point is 0.30000000000000004 and then that this tool's own path returns exactly 0.3. Section numbers cited here were read from the specification text.

## Licence

MIT. See [LICENSE](./LICENSE).
