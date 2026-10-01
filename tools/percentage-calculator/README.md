# Percentage & Discount Calculator

Answer everyday percentage questions: a percent of a number, what percent one number is of another, percent change, a discounted price and stacked discounts.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Answers one percentage question at a time from the numbers you type: what a percent of a number is, what percent one number is of another, the percent change between two values, the price after a percent discount with the saving, and the single discount that several stacked discounts add up to (20 percent off and then 10 percent off is 28 percent off, not 30). The page shows each formula with your own numbers put in, so you can check the result by hand.

## Supported

- X percent of Y: the percent as the number 0.01 times X, multiplied by Y, as NIST Special Publication 811 defines the percent symbol
- What percent X is of Y: X divided by Y times 100
- Percent change from one value to another: the difference divided by the absolute starting value times 100, so -50 to -25 is an increase of 50 percent
- Price after a percent discount, with the saving
- Stacked discounts: 1 to 20 discounts typed one per line, each applied to the price left by the one before, giving the single discount they add up to and, when a price is typed, the final price and the saving
- A percent change from 0 and a what-percent question with a whole of 0 get a plain message, and a discount above 100 percent is refused
- Results shown to 0 to 4 decimal places, 2 by default
- The working shown: the formula, your numbers put into it and the result before and after rounding
- Exact decimal arithmetic with decimal.js: no number ever passes through a JavaScript floating-point number

## Limits

- Results are rounded half away from zero to the decimal places you choose, only when shown; every step before that keeps 40 significant digits.
- Every figure is arithmetic on the values you type, not financial, tax or legal advice; it ignores taxes, shipping, coupons that are not a percent, minimum spends and any rule about which offers may be combined.
- Numbers are plain: no currency is used, so a price is shown with a dot as the decimal point and no digit grouping, whatever unit you type it in.
- Stacked discounts apply one after another, each to the price left by the one before, and accept 1 to 20 lines with each discount from 0 to 100; a single discount is from 0 to 100 too.
- A percent change divides by the absolute value of the starting value, and has no answer when the starting value is 0; a what-percent question has no answer when the whole is 0.
- A number may have at most 15 digits before the point and 12 after; a percent, a value, a part, a whole and a change may be negative, a price and a discount may not.

## Ambiguous cases, and what this does about them

- A percent change from a negative value is read against the size of the starting value, so -50 to -25 is an increase of 50 percent; dividing by the signed value would call the same move minus 50 percent.
- Two discounts do not add: 20 percent off and then 10 percent off leaves 72 percent of the price, a single discount of 28 percent, not 30.
- NIST Special Publication 811 asks for the symbol % with a space before it in scientific writing; this page shows results with the symbol and writes the word percent in its explanations.

## Defined by

- [NIST Special Publication 811, Guide for the Use of the International System of Units, section 7.10.2: the symbol % (percent) stands for the number 0.01](https://www.nist.gov/pml/special-publication-811/nist-guide-si-chapter-7-rules-and-style-conventions-expressing-values)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/percentage-calculator percentage-calculator
cd percentage-calculator
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/percentage-calculator
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { calculatePercentage } from '@fodt/percentage-calculator';

const result = calculatePercentage({ mode: 'stacked', discounts: '20\n10', price: '100' });
result.summary.result; // '28.00'
result.summary.lines.map((line) => line.label); // ['Single discount', 'Price after the discounts', 'Saving']
```

`calculatePercentage` takes the page's text values (`mode` as `of`, `what`, `change`, `discount` or `stacked`, then `percent`, `value`, `part`, `whole`, `from`, `to`, `price`, `discount`, `discounts` (one percent per line), `decimals` from 0 to 4) and returns `{ summary, working }`, or `null` when every number the chosen mode needs is blank, or throws `MoneyInputError` carrying the `field` that was wrong, with `line` and `column` for a bad discount line. `summary.result` is the headline figure as plain decimal text, or `null` when there is none (with the reason in `summary.notes`), and `summary.lines` is every row of the page as `{ label, value, kind }` where `kind` is `number` or `percent`. `percentOf(percent, value)`, `whatPercent(part, whole)` and `percentChange(from, to)` (the last two `null` for a zero divisor), `discountedPrice(price, discountPercent)` (`{ price, saving }`) and `stackedDiscount(discountPercents)` (`{ percent, factor }`) work on exact `Dec` values, a decimal.js value made by this folder's own clone with 40 significant digits and half away from zero. `money.ts` is the shared exact-decimal helper: strict text parsing, rounding, money formatting, whole-number counts, calendar dates, one-row-per-line text with line and column errors, and spreadsheet-safe CSV cells.

## Dependencies

- `decimal.js` 10.6.0

## Tests

```sh
npm test
```

NIST Special Publication 811 section 7.10.2 (fetched and quoted in the test comments) says the symbol % represents simply the number 0.01, which gives X percent of Y as X times 0.01 times Y: 15 percent of 80 is 12. NIST gives no formula for what percent, percent change, discounts or stacked discounts, so those are derived by hand in the tests: 12 over 80 is 15 percent; 80 to 100 is 25 over 80, 100 to 80 is minus 20 over 100 and minus 50 to minus 25 is 25 over the absolute 50, which is 50 percent; 80 less 15 percent is 80 times 0.85, which is 68; 20 percent then 10 percent is 1 minus 0.8 times 0.9, which is 0.28. Exactness is proven by first showing that a change from 0.1 to 0.3 in JavaScript floating point is 199.99999999999997 percent and then that this tool's own path returns exactly 200.

## Licence

MIT. See [LICENSE](./LICENSE).
