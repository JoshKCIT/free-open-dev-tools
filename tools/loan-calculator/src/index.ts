import meta from './meta.json';
import {
  D,
  type Dec,
  type CalendarDate,
  MoneyInputError,
  isBlank,
  formatMoney,
  parseDecimal,
  parseCurrency,
  parseIsoDate,
  formatIsoDate,
  addMonthsClamped,
  addDays,
  roundTo,
  toPlain,
  minorUnits,
} from './money';

export { meta, D, MoneyInputError, isBlank, formatMoney };
export type { Dec };

/** The longest term accepted, in years. At the most frequent payment this is 2,600 payments. */
export const MAX_TERM_YEARS = 50;

export type Frequency = 'monthly' | 'fortnightly' | 'weekly';
const FREQUENCIES: readonly Frequency[] = ['monthly', 'fortnightly', 'weekly'];

const FIELD_AMOUNT = 'Loan amount';
const FIELD_RATE = 'Annual interest rate (percent)';
const FIELD_YEARS = 'Term (years)';
const FIELD_CURRENCY = 'Currency (ISO 4217 code)';
const FIELD_FREQUENCY = 'Payment frequency';
const FIELD_EXTRA = 'Extra payment each period (optional)';
const FIELD_FIRST = 'First payment date (optional, YYYY-MM-DD)';

/**
 * Payments in a year: 12 for monthly, 26 for fortnightly, 52 for weekly.
 * 12 CFR 1026 Appendix J (b)(5)(ii) and (iv): a month is one twelfth of a year and a week-based
 * unit-period is 52 divided by the number of weeks it spans.
 */
export function periodsPerYear(frequency: Frequency): number {
  if (frequency === 'monthly') return 12;
  if (frequency === 'fortnightly') return 26;
  return 52;
}

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

export interface AmortiseInput {
  principal: Dec;
  /** The yearly rate in percent. */
  annualPercent: Dec;
  frequency: Frequency;
  /** The scheduled number of payments, a whole number from 1 to MAX_TERM_YEARS times the periods a year. */
  payments: Dec;
  /** Decimal places of the currency's smallest unit. */
  decimals: number;
  /** An extra amount paid with every regular payment, 0 or more. */
  extra: Dec;
  firstPayment?: CalendarDate;
}

export interface AmortRow {
  number: number;
  date?: CalendarDate;
  /** Everything paid in this period: the regular payment plus any extra. */
  payment: Dec;
  interest: Dec;
  principal: Dec;
  balance: Dec;
}

export interface Amortisation {
  /** The regular payment before rounding. */
  exact: Dec;
  /** The regular payment, rounded once to the smallest unit. */
  payment: Dec;
  rows: AmortRow[];
  totalPaid: Dec;
  totalInterest: Dec;
}

/**
 * The repayment schedule. The payment is rounded once; each row's interest is the balance at the start of the
 * row times the per-period rate (OpenFormula 6.12.23 IPMT), rounded to the smallest unit; the principal is the
 * payment minus that interest plus any extra (6.12.37 PPMT). The last row (the scheduled last payment, or the
 * row where the balance would reach zero first) pays the balance plus its interest, so the rows add up
 * exactly to the totals.
 */
export function amortise(input: AmortiseInput): Amortisation {
  const { principal, annualPercent, frequency, payments, decimals, extra, firstPayment } = input;
  const perYear = periodsPerYear(frequency);
  const exact = paymentPerPeriod(principal, annualPercent, payments, perYear);
  const payment = roundTo(exact, decimals);
  if (!payment.gt(0)) {
    throw new MoneyInputError(
      FIELD_AMOUNT,
      'the payment works out to less than the smallest unit of the currency, so no schedule can be shown, try a larger amount or a shorter term',
    );
  }
  const r = annualPercent.div(100).div(perYear);
  const step = frequency === 'fortnightly' ? 14 : 7;

  const rows: AmortRow[] = [];
  let balance = principal;
  let totalPaid = new D(0);
  let totalInterest = new D(0);
  for (let k = 1; ; k++) {
    const interest = roundTo(balance.times(r), decimals);
    let paid = payment.plus(extra);
    let part = paid.minus(interest);
    if (new D(k).gte(payments) || part.gte(balance)) {
      // The last row: pay whatever is left, plus this row's interest.
      part = balance;
      paid = balance.plus(interest);
    } else if (!part.gt(0)) {
      throw new MoneyInputError(
        FIELD_AMOUNT,
        `a payment of ${toPlain(payment, decimals)} does not cover the ${toPlain(interest, decimals)} of interest in payment ${k}, so the balance would never fall, try a larger amount or a shorter term`,
      );
    }
    balance = balance.minus(part);
    totalPaid = totalPaid.plus(paid);
    totalInterest = totalInterest.plus(interest);
    const row: AmortRow = { number: k, payment: paid, interest, principal: part, balance };
    if (firstPayment) {
      row.date =
        frequency === 'monthly' ? addMonthsClamped(firstPayment, k - 1) : addDays(firstPayment, step * (k - 1));
    }
    rows.push(row);
    if (balance.isZero()) break;
  }
  return { exact, payment, rows, totalPaid, totalInterest };
}

/** The values the page holds, exactly as typed. */
export interface LoanTexts {
  amount: string;
  rate: string;
  years: string;
  currency?: string;
  frequency?: string;
  extra?: string;
  firstPayment?: string;
}

/** One schedule row as plain decimal strings at the currency's smallest unit. */
export interface LoanRow {
  number: number;
  /** YYYY-MM-DD; only present when a first payment date was typed. */
  date?: string;
  payment: string;
  interest: string;
  principal: string;
  balance: string;
}

export interface LoanSummary {
  currency: string;
  /** Decimal places of the currency's smallest unit. */
  decimals: number;
  frequency: Frequency;
  perYear: number;
  /** The regular payment rounded once to the smallest unit, as plain digits. */
  payment: string;
  /** The regular payment before rounding, at the full working precision. */
  paymentExact: string;
  /** The extra payment added to each regular payment, 0.00 when there is none. */
  extra: string;
  /** Payments actually made: fewer than scheduled when an extra payment clears the loan early. */
  payments: string;
  scheduledPayments: string;
  totalPaid: string;
  totalInterest: string;
  /** The date of the last payment, when a first payment date was typed. */
  payoffDate?: string;
  /** The payoff date, or the number of payments and how long they take when there is no first date. */
  payoffText: string;
}

export interface LoanResult {
  summary: LoanSummary;
  rows: LoanRow[];
  /** The formula, the typed numbers put into it, and the result before and after rounding. */
  working: string;
  /** The schedule as RFC 4180 CSV. */
  csv: string;
  /** Plain-language notes about the result, such as a last payment far above the regular one. Often empty. */
  notes: string[];
}

/** The schedule as RFC 4180 CSV (CRLF line ends), from the same rounded figures the table shows. */
export function scheduleCsv(rows: LoanRow[]): string {
  const dated = rows.some((row) => row.date !== undefined);
  const header = dated
    ? ['Payment', 'Date', 'Payment amount', 'Interest', 'Principal', 'Balance']
    : ['Payment', 'Payment amount', 'Interest', 'Principal', 'Balance'];
  const lines = [header.join(',')];
  for (const row of rows) {
    const cells = dated
      ? [String(row.number), row.date ?? '', row.payment, row.interest, row.principal, row.balance]
      : [String(row.number), row.payment, row.interest, row.principal, row.balance];
    lines.push(cells.join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

/** "1 year 2 months", "30 years", "3 months": how long `count` payments take, to the whole month. */
function termText(count: number, perYear: number): string {
  const months = new D(count).times(12).div(perYear).floor();
  const years = months.div(12).floor();
  const rest = months.minus(years.times(12));
  const parts: string[] = [];
  if (years.gt(0)) parts.push(`${years.toFixed(0)} ${years.eq(1) ? 'year' : 'years'}`);
  if (rest.gt(0)) parts.push(`${rest.toFixed(0)} ${rest.eq(1) ? 'month' : 'months'}`);
  return parts.length > 0 ? parts.join(' ') : 'less than a month';
}

/** The decimal places an amount was typed with, trailing zeros not counted. */
function placesTyped(x: Dec): number {
  return x.decimalPlaces();
}

/** Works out a loan from the page's typed values, or throws a MoneyInputError naming the field that is wrong. */
export function calculateLoan(texts: LoanTexts): LoanResult {
  const amount = parseDecimal(texts.amount, FIELD_AMOUNT);
  if (!amount.gt(0)) throw new MoneyInputError(FIELD_AMOUNT, 'must be more than 0, type the amount borrowed');
  const rate = parseDecimal(texts.rate, FIELD_RATE);
  const years = parseDecimal(texts.years, FIELD_YEARS, { maxFrac: 2 });
  const currency = parseCurrency(texts.currency ?? 'USD', FIELD_CURRENCY);

  const frequencyText = texts.frequency === undefined || isBlank(texts.frequency) ? 'monthly' : texts.frequency.trim();
  const frequency = FREQUENCIES.find((f) => f === frequencyText);
  if (!frequency) throw new MoneyInputError(FIELD_FREQUENCY, 'choose monthly, fortnightly or weekly');
  const perYear = periodsPerYear(frequency);

  const extra = texts.extra === undefined || isBlank(texts.extra) ? new D(0) : parseDecimal(texts.extra, FIELD_EXTRA);
  const firstPayment =
    texts.firstPayment === undefined || isBlank(texts.firstPayment)
      ? undefined
      : parseIsoDate(texts.firstPayment, FIELD_FIRST);

  const decimals = minorUnits(currency);
  for (const [value, field] of [
    [amount, FIELD_AMOUNT],
    [extra, FIELD_EXTRA],
  ] as const) {
    if (placesTyped(value) > decimals) {
      throw new MoneyInputError(
        field,
        `${currency} amounts have at most ${decimals} decimal places, so the schedule can add up to the cent`,
      );
    }
  }

  if (years.gt(MAX_TERM_YEARS)) {
    throw new MoneyInputError(
      FIELD_YEARS,
      `${years.toFixed()} years is too long, the most this tool works out is ${MAX_TERM_YEARS} years`,
    );
  }
  const payments = years.times(perYear);
  if (!payments.isInteger()) {
    throw new MoneyInputError(
      FIELD_YEARS,
      `${years.toFixed()} years is not a whole number of ${frequency} payments, try a term in whole years such as 30`,
    );
  }
  if (!payments.gte(1)) {
    throw new MoneyInputError(FIELD_YEARS, `the term must be at least one ${frequency} payment, try 1 year`);
  }

  const schedule = amortise({
    principal: amount,
    annualPercent: rate,
    frequency,
    payments,
    decimals,
    extra,
    firstPayment,
  });
  const { exact, payment } = schedule;
  const r = rate.div(100).div(perYear);

  const rows: LoanRow[] = schedule.rows.map((row) => {
    const out: LoanRow = {
      number: row.number,
      payment: row.payment.toFixed(decimals),
      interest: row.interest.toFixed(decimals),
      principal: row.principal.toFixed(decimals),
      balance: row.balance.toFixed(decimals),
    };
    if (row.date) out.date = formatIsoDate(row.date);
    return out;
  });
  const last = rows[rows.length - 1];
  const payoffDate = last?.date;
  const made = rows.length;
  const payoffText = payoffDate ?? `after ${made} payments (about ${termText(made, perYear)})`;

  const rShown = toPlain(r, 12);
  const working = [
    `Payment per period, from OpenFormula 6.12.36 PMT with payments at the end of each period (${frequency}, ${perYear} a year):`,
    '  r = yearly rate / 100 / payments per year',
    '  n = years x payments per year',
    '  payment = P x r / (1 - (1 + r)^-n)',
    '  when r is 0 the specification uses its Rate 0 equation instead: payment = P / n',
    '',
    'With your numbers:',
    `  P = ${amount.toFixed()}`,
    `  r = ${rate.toFixed()} / 100 / ${perYear} = ${rShown} (shown to 12 places, 40 significant digits are used)`,
    `  n = ${years.toFixed()} x ${perYear} = ${payments.toFixed()}`,
    rate.isZero()
      ? `  payment = P / n = ${amount.toFixed()} / ${payments.toFixed()}`
      : `  payment = ${amount.toFixed()} x ${rShown} / (1 - (1 + ${rShown})^-${payments.toFixed()})`,
    `  exact payment = ${toPlain(exact, 12)}`,
    `  rounded payment = ${payment.toFixed(decimals)} (rounded once, half away from zero, to ${decimals} decimal places, the smallest unit of ${currency})`,
    '',
    'Each row of the schedule (OpenFormula 6.12.23 IPMT and 6.12.37 PPMT):',
    `  interest = balance at the start of the row x r, rounded half away from zero to ${decimals} decimal places`,
    `  principal = payment - interest${extra.gt(0) ? ' + extra payment' : ''}`,
    '  balance = balance at the start of the row - principal',
    ...(extra.gt(0) ? [`  extra payment each period = ${extra.toFixed(decimals)}`] : []),
    '  The last row pays the balance left plus its interest, so the rows add up exactly to the totals.',
    '',
    `Totals: ${made} payments, total paid ${schedule.totalPaid.toFixed(decimals)}, total interest ${schedule.totalInterest.toFixed(decimals)}.`,
  ].join('\n');

  const summary: LoanSummary = {
    currency,
    decimals,
    frequency,
    perYear,
    payment: payment.toFixed(decimals),
    paymentExact: exact.toFixed(),
    extra: extra.toFixed(decimals),
    payments: String(made),
    scheduledPayments: payments.toFixed(),
    totalPaid: schedule.totalPaid.toFixed(decimals),
    totalInterest: schedule.totalInterest.toFixed(decimals),
    payoffText,
  };
  if (payoffDate) summary.payoffDate = payoffDate;

  const notes: string[] = [];
  const regular = payment.plus(extra);
  const finalPaid = schedule.rows[schedule.rows.length - 1]?.payment ?? regular;
  if (finalPaid.gt(regular.times(1.5).plus(1))) {
    notes.push(
      `The last payment is ${finalPaid.toFixed(decimals)}, much more than the regular ${regular.toFixed(decimals)}. The regular payment is rounded once to ${decimals} decimal places and that rounding adds up over ${payments.toFixed()} payments, so the last one has to make up the gap. This is normal for small loans, long terms and high rates.`,
    );
  }

  return { summary, rows, working, csv: scheduleCsv(rows), notes };
}
