# Credit Card Payoff Calculator

See how long several card balances take to clear at a chosen monthly payment, or the payment that clears them by a chosen month, highest rate first or smallest balance first.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Takes your cards, one per line with a name, a balance, a yearly interest rate and a minimum payment, and a total amount you can pay each month. It plays the months forward one at a time and tells you how many months it takes to clear everything and how much interest that costs, with the extra money going to the highest-rate card first or to the smallest-balance card first, side by side. Or type a number of months and it finds the smallest monthly payment, to the cent, that clears every card in time. Each month's interest is worked out and rounded to the cent the way the US repayment-disclosure rules do it, and the page shows the formula with your own numbers put in.

## Supported

- Up to 20 cards, one per line as name | balance | APR in percent | minimum payment, with a clear message naming the line and column of any cell that cannot be read
- Months to pay off and total interest at a chosen total monthly payment, for highest rate first and for smallest balance first, side by side
- The smallest whole-cent monthly payment that clears every card by a chosen month (1 to 1,200), for each order
- The month each card is cleared, and a month-by-month table of interest, amount paid and balance left for each order
- Monthly interest of the yearly rate divided by 12, rounded to the cent each month, and a final payment that clears the balance plus its interest
- A minimum payment that rolls over: once a card is cleared its minimum stays inside the fixed monthly payment and goes to the next card
- A plain not-paid-off message when the payment never beats the interest, found by stopping at 1,200 months
- The working shown: the monthly rate, the first month's interest for each card with your numbers, how the money is shared out and the rounding rule
- Any currency code your browser knows, with the right number of decimal places for that currency
- Exact decimal arithmetic with decimal.js: no amount or rate ever passes through a JavaScript floating-point number

## Limits

- Interest each month is the balance times the yearly rate divided by 12, rounded half away from zero to the currency's smallest unit, and payments are whole smallest units; every step before that rounding keeps 40 significant digits.
- The final payment on a card is exactly its balance plus that month's interest, so no interest is left over after the last month.
- Every figure is arithmetic on the values you type, not financial, tax or legal advice; it ignores annual and late fees, promotional and penalty rates, new purchases, grace periods, daily compounding and minimum payments that change with the balance.
- Each minimum is the fixed amount you type and the total monthly payment never changes, so the money freed when a card is cleared moves on to the next card.
- Both orders pay every minimum first, never more than the card owes, and give the rest to one card at a time. This is the page's own convention, because no regulation defines either order.
- At most 20 cards, and a plan that is still not paid off after 1,200 months (100 years) stops there and says so.
- A balance and a minimum payment can have no more decimal places than the currency's smallest unit, so every month adds up to the last cent.
- Amounts are shown with English (United States) digit grouping and decimal point whatever currency you choose.

## Ambiguous cases, and what this does about them

- Appendix M1 (b)(4)(ix) assumes payments go to lower-rate balances before higher-rate ones when a card issuer prints its minimum-payment disclosures. That is a convention for those disclosures, not an order offered here, which is why this page compares highest rate first with smallest balance first instead.
- Appendix M1 (b)(4)(vii) lets a monthly or a daily periodic rate be assumed. This page uses the monthly rate; Appendix M2 sets its periodic rate as the yearly rate over 365 times 365 over 12 days, which is exactly the yearly rate divided by 12.
- When two cards tie for the extra money, the one with the smaller balance goes first for highest rate first, and the one with the higher rate goes first for smallest balance first; a tie that is still a tie is settled by the order the cards were typed.
- A real card issuer may charge interest on the average daily balance and apply the payment on a different day; this page charges a month's interest on the balance at the start of the month and then applies the payments.

## Defined by

- [12 CFR 1026 Appendix M1, repayment disclosures (monthly periodic rate, rounding to the cent, final payment pays the account in full)](https://www.consumerfinance.gov/rules-policy/regulations/1026/m1/)
- [12 CFR 1026 Appendix M2, sample calculations of repayment disclosures](https://www.consumerfinance.gov/rules-policy/regulations/1026/m2/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/credit-card-payoff credit-card-payoff
cd credit-card-payoff
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/credit-card-payoff
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { calculatePayoff } from '@fodt/credit-card-payoff';

const plan = calculatePayoff({
  cards: 'Card A | 1000 | 24 | 25\nCard B | 500 | 12 | 25',
  budget: '200',
  currency: 'USD',
});
plan.orders[0].months; // 9 (highest rate first)
plan.orders[0].totalInterest; // '105.49'
plan.orders[1].months; // 9 (smallest balance first)
plan.orders[1].totalInterest; // '130.28'
```

`calculatePayoff` takes the page's text values (`cards` with one card per line, `mode` as `time` or `target`, `budget` for the total monthly payment, `months` for the target, and `currency`) and returns `{ summary, orders, working, notes, warnings }`, or `null` when nothing was typed, or throws `MoneyInputError` carrying the `field` that was wrong and, for a card line, its `line` and `column`. `orders` holds highest rate first and then smallest balance first, each with its months, total interest, total paid, the month every card is cleared and a row for every month, all as plain decimal strings at the currency's smallest unit. `parseCards` reads the card lines, `simulatePayoff` plays the months for one order with a decimal.js clone (40 significant digits, half away from zero), and `paymentToFinishBy` finds the smallest whole-unit monthly payment that finishes within a number of months. `money.ts` is the shared exact-decimal helper: strict text parsing, rounding, money formatting, whole-number counts, calendar dates, one-row-per-line text with line and column errors, and spreadsheet-safe CSV cells.

## Dependencies

- `decimal.js` 10.6.0

## Tests

```sh
npm test
```

No published text gives numbers for a payoff plan, so the figures are worked out by hand from the rules in 12 CFR 1026 Appendix M1 and M2 (monthly rate of the yearly rate over 12, interest and payments rounded to the cent, final payment clears the balance plus its interest) and written out month by month in the test comments. The single-card case is also run through a second, separate implementation of the Appendix M2 loop written in whole cents with big integers and no decimal library, and both must agree month by month. Exactness is proven by first showing that 0.1 + 0.2 in JavaScript floating point is 0.30000000000000004 and then that this tool's own path returns exactly 0.3. Section numbers cited here were read from the regulation text.

## Licence

MIT. See [LICENSE](./LICENSE).
