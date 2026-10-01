import meta from './meta.json';
import {
  D,
  type Dec,
  MoneyInputError,
  isBlank,
  formatMoney,
  parseDecimal,
  parseCurrency,
  roundTo,
  toPlain,
  minorUnits,
} from './money';

export { meta, D, MoneyInputError, isBlank, formatMoney };
export type { Dec };

/** The longest term accepted, in years. At the most frequent payment this is 2,600 payments. */
export const MAX_TERM_YEARS = 50;

const FIELD_AMOUNT = 'Loan amount';
const FIELD_RATE = 'Annual interest rate (percent)';
const FIELD_YEARS = 'Term (years)';
const FIELD_CURRENCY = 'Currency (ISO 4217 code)';

const PAYMENTS_PER_YEAR = 12;

/**
 * The payment made at the end of each period that clears `principal` in `payments` equal payments, exactly
 * (not rounded). OpenFormula 6.12.36 PMT with no future value and payments at the end of the period:
 * P * r / (1 - (1 + r)^-n) where r is the yearly rate divided by the periods a year, or P / n when r is 0.
 */
export function paymentPerPeriod(principal: Dec, annualPercent: Dec, payments: Dec | number, perYear: number): Dec {
  const n = new D(payments);
  if (!n.gt(0)) throw new MoneyInputError(FIELD_YEARS, 'the term must be at least one payment');
  const r = annualPercent.div(100).div(perYear);
  if (r.isZero()) return principal.div(n);
  return principal.times(r).div(new D(1).minus(new D(1).plus(r).pow(n.neg())));
}

/** The values the page holds, exactly as typed. */
export interface LoanTexts {
  amount: string;
  rate: string;
  years: string;
  currency?: string;
}

export interface LoanSummary {
  currency: string;
  /** Decimal places of the currency's smallest unit. */
  decimals: number;
  /** The payment rounded once to the smallest unit, as plain digits. */
  payment: string;
  /** The payment before rounding, at the full working precision. */
  paymentExact: string;
  payments: string;
}

export interface LoanResult {
  summary: LoanSummary;
  /** The formula, the typed numbers put into it, and the result before and after rounding. */
  working: string;
}

/** Works out a loan from the page's typed values, or throws a MoneyInputError naming the field that is wrong. */
export function calculateLoan(texts: LoanTexts): LoanResult {
  const amount = parseDecimal(texts.amount, FIELD_AMOUNT);
  if (!amount.gt(0)) throw new MoneyInputError(FIELD_AMOUNT, 'must be more than 0, type the amount borrowed');
  const rate = parseDecimal(texts.rate, FIELD_RATE);
  const years = parseDecimal(texts.years, FIELD_YEARS, { maxFrac: 2 });
  const currency = parseCurrency(texts.currency ?? 'USD', FIELD_CURRENCY);

  if (years.gt(MAX_TERM_YEARS)) {
    throw new MoneyInputError(
      FIELD_YEARS,
      `${years.toFixed()} years is too long, the most this tool works out is ${MAX_TERM_YEARS} years`,
    );
  }
  const payments = years.times(PAYMENTS_PER_YEAR);
  if (!payments.isInteger()) {
    throw new MoneyInputError(
      FIELD_YEARS,
      `${years.toFixed()} years is not a whole number of monthly payments, try a term such as 0.25, 0.5 or 30`,
    );
  }
  if (!payments.gte(1))
    throw new MoneyInputError(FIELD_YEARS, 'the term must be at least one monthly payment, try 0.25 years');

  const exact = paymentPerPeriod(amount, rate, payments, PAYMENTS_PER_YEAR);
  const decimals = minorUnits(currency);
  const rounded = roundTo(exact, decimals);
  const r = rate.div(100).div(PAYMENTS_PER_YEAR);

  const working = [
    'Payment per period, from OpenFormula 6.12.36 PMT with payments at the end of each period:',
    '  r = yearly rate / 100 / payments per year',
    '  n = years x payments per year',
    '  payment = P x r / (1 - (1 + r)^-n)',
    '  when r is 0 the specification uses its Rate 0 equation instead: payment = P / n',
    '',
    'With your numbers:',
    `  P = ${amount.toFixed()}`,
    `  r = ${rate.toFixed()} / 100 / ${PAYMENTS_PER_YEAR} = ${toPlain(r, 12)} (shown to 12 places, 40 significant digits are used)`,
    `  n = ${years.toFixed()} x ${PAYMENTS_PER_YEAR} = ${payments.toFixed()}`,
    rate.isZero()
      ? `  payment = P / n = ${amount.toFixed()} / ${payments.toFixed()}`
      : `  payment = ${amount.toFixed()} x ${toPlain(r, 12)} / (1 - (1 + ${toPlain(r, 12)})^-${payments.toFixed()})`,
    `  exact payment = ${toPlain(exact, 12)}`,
    `  rounded payment = ${rounded.toFixed(decimals)} (rounded once, half away from zero, to ${decimals} decimal places, the smallest unit of ${currency})`,
  ].join('\n');

  return {
    summary: {
      currency,
      decimals,
      payment: rounded.toFixed(decimals),
      paymentExact: exact.toFixed(),
      payments: payments.toFixed(),
    },
    working,
  };
}
