# Salary & Hourly Pay Converter

Convert pay between yearly, monthly, fortnightly, weekly, daily and hourly amounts for chosen hours per week and weeks per year.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Converts one pay figure into every other pay period. Type an amount and say whether it is yearly, monthly, every two weeks, weekly, daily or hourly, then type the hours you work in a week, the days you work in a week and the weeks you work in a year. The page turns your pay into an exact yearly amount first and divides that by each period, so no figure is built from an already rounded one, and it shows the working with your own numbers put in.

## Supported

- Yearly, monthly, fortnightly (every two weeks), weekly, daily and hourly pay, all shown for the one amount you type
- Every figure comes from the exact yearly amount and is rounded only when shown: the fortnightly figure is the yearly amount over half the weeks in a year, not a rounded hourly rate times the hours in two weeks
- Your own working time: hours a week above 0 and at most 168, days a week from 1 to 7 and weeks a year above 0 and at most 53, such as 40 hours and 52.175 weeks, which is 2,087 hours a year
- Amounts rounded half away from zero to the currency's smallest unit: a rate of exactly half a cent over rounds up, so 18.845 shows as 18.85
- The working shown: the periods in a year for each choice, the yearly amount and each division with the result before and after rounding
- Exact decimal arithmetic with decimal.js: no amount ever passes through a JavaScript floating-point number

## Limits

- Amounts are rounded half away from zero to the currency's smallest unit only when shown; every step before that keeps 40 significant digits, so a figure never comes from an already rounded one.
- Every figure is arithmetic on the values you type, not financial, tax or legal advice; it ignores tax, social contributions, overtime, unpaid leave, bonuses, pay rises during the year and any pay rule of an employer or a country.
- A month is one twelfth of the year and a fortnight is half of a week's share of the year, so the weeks a year you type set the weekly, fortnightly and hourly figures while the monthly figure does not depend on them.
- Some payroll rules round the hourly rate to the smallest unit first and then multiply it, which gives a slightly different fortnightly or weekly figure; this page never rounds between steps.
- The pay may have at most 15 digits before the point and 12 after; hours a week, days a week and weeks a year are decimals typed as digits with an optional dot, and nothing is looked up for you.
- Amounts are shown with English (United States) digit grouping and decimal point whatever currency you choose.

## Ambiguous cases, and what this does about them

- A working year is not always 52 weeks: 52.175 weeks of 40 hours is 2,087 hours, an average over the calendar, while 52 weeks of 40 hours is 2,080 hours. This page uses the weeks you type and starts from 40 hours and 52 weeks only as a suggestion.
- Monthly pay is a twelfth of the year here; a payroll that pays every four weeks or twice a month needs its own count of pay periods and is not the same as monthly.

## Defined by

- [US Office of Personnel Management, Computing Hourly Rates of Pay Using the 2,087-Hour Divisor (the example of 89,033 a year giving 42.66 an hour, and the rule that half a cent and over rounds up, 18.845 to 18.85)](https://www.opm.gov/policy-data-oversight/pay-leave/pay-administration/fact-sheets/computing-hourly-rates-of-pay-using-the-2087-hour-divisor/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/salary-converter salary-converter
cd salary-converter
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/salary-converter
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { calculatePay } from '@fodt/salary-converter';

const result = calculatePay({ amount: '52000', period: 'yearly', hoursPerWeek: '40', daysPerWeek: '5', weeksPerYear: '52', currency: 'USD' });
result.summary.rows.map((row) => `${row.period} ${row.amount}`);
// ['yearly 52000.00', 'monthly 4333.33', 'fortnightly 2000.00', 'weekly 1000.00', 'daily 200.00', 'hourly 25.00']
```

`calculatePay` takes the page's text values (`amount`, `period` as `yearly`, `monthly`, `fortnightly`, `weekly`, `daily` or `hourly`, `hoursPerWeek`, `daysPerWeek`, `weeksPerYear` and `currency`) and returns `{ summary, working }`, or `null` when the amount is blank, or throws `MoneyInputError` carrying the `field` that was wrong. `summary.rows` holds one row per period as `{ period, label, factor, amount }`, with `factor` the number of those periods in a year and `amount` the figure rounded to the currency's smallest unit as plain decimal text, and `summary.yearly` is the exact yearly pay rounded the same way. `PAY_PERIODS` lists the six periods with their labels, `yearlyFactor(period, hoursPerWeek, daysPerWeek, weeksPerYear)` gives the periods in a year and `convertPay(amount, period, hoursPerWeek, daysPerWeek, weeksPerYear)` returns the exact yearly amount and an exact figure for every period, all as `Dec` values from this folder's own decimal.js clone with 40 significant digits and half away from zero. `money.ts` is the shared exact-decimal helper: strict text parsing, rounding, money formatting, whole-number counts, calendar dates, one-row-per-line text with line and column errors, and spreadsheet-safe CSV cells.

## Dependencies

- `decimal.js` 10.6.0

## Tests

```sh
npm test
```

The tests quote the published hourly-rate fact sheet of the US Office of Personnel Management as literals: 89,033 a year divided by 2,087 hours is 42.66 an hour, which is 40 hours a week at 52.175 weeks a year, and a rate of half a cent and over rounds up, 18.845 to 18.85. That sheet then multiplies the rounded hourly rate by 80 hours to get 3,412.80 every two weeks; this tool never rounds between steps, so the exact fortnightly figure is 89,033 over 26.0875 = 3,412.86, and the tests assert both numbers and the reason they differ. The rest is derived by hand: 52,000 a year at 40 hours, 5 days and 52 weeks is 25.00 an hour, 200.00 a day, 1,000.00 a week, 2,000.00 every two weeks and 4,333.33 a month. Exactness is proven by first showing that 0.1 times 3 in JavaScript floating point is 0.30000000000000004 and then that this tool's own path turns a weekly 0.1 over 3 weeks a year into a yearly 0.3.

## Licence

MIT. See [LICENSE](./LICENSE).
