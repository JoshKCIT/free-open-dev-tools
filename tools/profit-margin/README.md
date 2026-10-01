# Profit Margin, Markup & Break-even

Turn cost and price into profit, margin and markup, find the price for a target margin or markup, and count break-even units.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Works out one pricing question at a time from the numbers you type: the profit, margin and markup that a cost and a price give; the price that gives a target margin or a target markup on a cost; or the number of units you must sell to cover fixed costs when each unit has a price and a variable cost. The page shows each formula with your own numbers put in, so you can check the result by hand.

## Supported

- Profit, margin and markup from a cost and a price: profit is price minus cost, margin is profit over price, markup is profit over cost, and a loss gives a negative margin and markup
- Price for a target margin: cost divided by one minus the margin, with the implied markup and profit
- Price for a target markup: cost times one plus the markup, with the implied margin and profit
- Break-even units: fixed costs divided by the contribution per unit (unit price minus unit variable cost), rounded up to whole units and said as rounding up
- A price of 0 gives no margin and a cost of 0 gives no markup, each with the reason; a target margin of 100 percent or more is refused; a unit price at or below the unit variable cost says break-even is never reached
- Margins and markups shown to 0 to 4 decimal places, 2 by default, and amounts to the currency's smallest unit
- The working shown: the formula, your numbers put into it and the result before and after rounding
- Exact decimal arithmetic with decimal.js: no amount ever passes through a JavaScript floating-point number

## Limits

- Amounts are rounded half away from zero to the currency's smallest unit, and margins and markups to the decimal places you choose, only when shown; every step before that keeps 40 significant digits.
- Every figure is arithmetic on the values you type, not financial, tax or legal advice; it ignores taxes, discounts, volume effects, shipping, overheads that change with sales and any cost that is not typed.
- This page handles one product at a time: a margin or markup for a mix of products needs each product worked out separately.
- Break-even units are the exact quotient of the fixed costs over the contribution per unit rounded up to the next whole unit, which is a count and not money rounding; a unit price at or below the unit variable cost never reaches break-even.
- A target margin must be below 100 percent and a target markup at least minus 100 percent; both are typed by you, with nothing filled in. A cost and a price are at least 0 and have at most 15 digits before the point and 12 after.
- Amounts are shown with English (United States) digit grouping and decimal point whatever currency you choose.

## Ambiguous cases, and what this does about them

- Margin and markup are different ratios of the same profit: margin divides by the price and markup divides by the cost, so a 50 percent markup is a margin of one third, not 50 percent.
- Some people say margin when they mean markup; this page uses the two definitions above and says which one each figure is.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/profit-margin profit-margin
cd profit-margin
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/profit-margin
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { calculateProfit } from '@fodt/profit-margin';

const result = calculateProfit({ mode: 'margin', cost: '60', price: '100', currency: 'USD' });
result.summary.result; // '40.00'
result.summary.lines.map((line) => line.label); // ['Cost', 'Price', 'Profit', 'Margin', 'Markup']
```

`calculateProfit` takes the page's text values (`mode` as `margin`, `target-margin`, `target-markup` or `break-even`, then `cost`, `price`, `targetMargin`, `targetMarkup`, `fixedCosts`, `unitPrice`, `unitCost`, `decimals` from 0 to 4 and `currency`) and returns `{ summary, working }`, or `null` when every number the chosen mode needs is blank, or throws `MoneyInputError` carrying the `field` that was wrong. `summary.result` is the headline figure as plain decimal text (the margin, the price or the whole units), or `null` when there is none (with the reason in `summary.notes`), and `summary.lines` is every row of the page as `{ label, value, kind }` where `kind` is `money`, `percent`, `ratio` or `count`. `profitMarginMarkup(cost, price)` (margin and markup are `null` for a price or cost of 0), `priceForMargin(cost, marginPercent)`, `priceForMarkup(cost, markupPercent)` and `breakEvenUnits(fixed, unitPrice, unitCost)` (`null` when the price is at or below the cost) work on exact `Dec` values, a decimal.js value made by this folder's own clone with 40 significant digits and half away from zero. `money.ts` is the shared exact-decimal helper: strict text parsing, rounding, money formatting, whole-number counts, calendar dates, one-row-per-line text with line and column errors, and spreadsheet-safe CSV cells.

## Dependencies

- `decimal.js` 10.6.0

## Tests

```sh
npm test
```

No standards body publishes the profit margin, markup or break-even definitions, so the tests derive every figure by hand and the page shows the formula: cost 60 and price 100 give a profit of 40, a margin of 40 over 100 and a markup of 40 over 60, which are 40.00 and 66.67 percent; a target margin of 40 percent on a cost of 60 needs a price of 60 over 0.6, which is 100; a target markup of 50 percent needs 60 times 1.5, which is 90; fixed costs of 1000 over a contribution of 25 minus 15 is exactly 100 units, and 1001 needs 101. Exactness is proven by first showing that 0.3 minus 0.1 in JavaScript floating point is 0.19999999999999998 and then that this tool's own path returns a profit of exactly 0.2.

## Licence

MIT. See [LICENSE](./LICENSE).
