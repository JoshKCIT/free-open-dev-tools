# Loan & Mortgage Calculator

Work out the payment per period, total interest, payoff date and full repayment schedule of a loan, with optional extra payments.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Works out the regular payment on a fixed-rate loan or mortgage from the amount, the yearly interest rate and the term, then lists every payment with its interest, principal and balance so the rows add up exactly to the totals. The page shows the payment formula with your own numbers put in, so you can check the result by hand. Every amount and rate is read as typed text and added up with exact decimal arithmetic, so 0.1 plus 0.2 is exactly 0.3 and nothing drifts by a cent.

## Supported

- Payment per period from a loan amount, a yearly interest rate in percent and a term in years, by the standard annuity formula
- Monthly (12 a year), every two weeks (26 a year) and weekly (52 a year) payments
- An optional extra payment each period, which shortens the schedule and shows the end date sooner
- A full repayment schedule: payment, interest, principal and balance for every payment, with a download as a CSV file
- An optional first payment date (YYYY-MM-DD), which gives every payment date and the payoff date; a payment due on the 31st falls on the last day of shorter months
- A zero interest rate, which pays the amount divided by the number of payments
- Terms up to 50 years that are a whole number of payments, in steps of a quarter year for monthly payments
- The working shown: the formula, your numbers put into it, the exact payment and the rounded payment
- Any currency code your browser knows, with the right number of decimal places for that currency
- Exact decimal arithmetic with decimal.js: no amount or rate ever passes through a JavaScript floating-point number

## Limits

- The payment is rounded once to the currency's smallest unit, half away from zero, and each row's interest is rounded the same way; every step before that keeps 40 significant digits.
- The last row pays whatever balance is left plus its interest, so the payments, interest and principal columns add up exactly to the totals; that last payment can differ from the others by a few units of the smallest coin.
- Every figure is arithmetic on the values you type, not financial, tax or legal advice; it ignores lender fees, mortgage insurance, taxes and escrow, rate changes over time and day counts other than equal periods.
- Interest is charged in equal periods: the yearly rate is divided by the number of payments a year, not accrued day by day.
- A term is limited to 50 years, so a schedule never holds more than 2,600 payments.
- The loan amount and any extra payment can have no more decimal places than the currency's smallest unit, so the schedule can add up to the last cent.
- A payment that rounds to less than the smallest unit of the currency, or does not cover its row's interest, is refused instead of showing a schedule that never pays the loan off.
- Amounts are shown with English (United States) digit grouping and decimal point whatever currency you choose.

## Ambiguous cases, and what this does about them

- Interest is charged once per equal period: the nominal yearly rate divided by the number of periods a year, which is how the US consumer-credit rule 12 CFR 1026 Appendix J (b)(5) counts unit-periods. A lender that accrues interest daily will quote slightly different figures.
- Real loan documents round the payment to the cent and let the final payment absorb the difference; this tool shows the unrounded payment next to the rounded one so the gap is visible.
- An extra payment is added to every payment, including the first, and goes entirely to principal; lenders that apply extra money differently, or only after a fee, will differ.

## Defined by

- [ISO/IEC 26300-2:2015 (OpenFormula, OASIS ODF 1.2 part 2) sections 6.12.36 PMT, 6.12.23 IPMT and 6.12.37 PPMT](https://docs.oasis-open.org/office/v1.2/os/OpenDocument-v1.2-os-part2.html)
- [12 CFR 1026 Appendix J, annual percentage rate computations for closed-end credit](https://www.consumerfinance.gov/rules-policy/regulations/1026/j/)
- [CFPB sample Loan Estimate H-24(B), fixed rate loan](https://files.consumerfinance.gov/f/201403_cfpb_loan-estimate_fixed-rate-loan-sample-H24B.pdf)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/loan-calculator loan-calculator
cd loan-calculator
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/loan-calculator
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { calculateLoan, scheduleCsv } from '@fodt/loan-calculator';

const loan = calculateLoan({ amount: '162000', rate: '3.875', years: '30', currency: 'USD', firstPayment: '2026-01-31' });
loan.summary.payment; // '761.78'
loan.summary.totalInterest; // '112243.70'
loan.summary.payoffDate; // '2055-12-31'
loan.rows[0]; // { number: 1, date: '2026-01-31', payment: '761.78', interest: '523.13', principal: '238.65', balance: '161761.35' }
scheduleCsv(loan.rows); // RFC 4180 text with a header row
```

`calculateLoan` takes the page's text values (`amount`, `rate`, `years`, `currency`, and optionally `frequency` as `monthly`, `fortnightly` or `weekly`, `extra` and `firstPayment`) and returns `{ summary, rows, working, csv }`, or throws `MoneyInputError` carrying the `field` that was wrong. Every figure in `summary` and `rows` is a plain decimal string at the currency's smallest unit. `paymentPerPeriod(principal, annualPercent, payments, perYear)` returns the exact, unrounded payment as a `Dec` (a decimal.js value made by this folder's own clone, 40 significant digits, half away from zero) and `amortise` builds the schedule from already-parsed values. `money.ts` is the shared exact-decimal helper: strict text parsing, rounding, money formatting, whole-number counts, calendar dates, one-row-per-line text with line and column errors, and spreadsheet-safe CSV cells.

## Dependencies

- `decimal.js` 10.6.0

## Tests

```sh
npm test
```

The payment is checked against the figure printed on the CFPB sample Loan Estimate H-24(B) (162000 at 3.875 percent for 30 years pays 761.78 a month, 15,773 of principal paid in five years) and against the OpenFormula PMT Rate 0 equation. Row interest and principal follow OpenFormula IPMT and PPMT, worked by hand for a small loan and recomputed independently in whole cents for the large one. Exactness is proven by first showing that 0.1 + 0.2 in JavaScript floating point is 0.30000000000000004 and then that this tool's own path returns exactly 0.3. Section numbers cited here were read from the specification text.

## Licence

MIT. See [LICENSE](./LICENSE).
