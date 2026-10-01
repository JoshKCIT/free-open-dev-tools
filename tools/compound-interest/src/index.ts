import meta from './meta.json';
import {
  D,
  type Dec,
  MoneyInputError,
  isBlank,
  formatMoney,
  parseDecimal,
  parseCount,
  parseCurrency,
  roundTo,
  toPlain,
  minorUnits,
} from './money';

export { meta, D, MoneyInputError, isBlank, formatMoney };
export type { Dec };

/** The longest term accepted, in years. */
export const MAX_YEARS = 100;
/** Compounding periods a year that can be chosen. 365 is the daily year of 12 CFR 1030 Appendix A. */
export const COMPOUNDING = [1, 2, 4, 12, 52, 365] as const;
/** A final balance at or above this is refused: it is too large to show exactly with 40 significant digits. */
const TOO_LARGE = new D('1e18');

const FIELD_START = 'Starting amount';
const FIELD_DEPOSIT = 'Regular deposit each period';
const FIELD_TIMING = 'Deposit timing';
const FIELD_RATE = 'Annual interest rate (percent)';
const FIELD_COMPOUNDING = 'Compounding';
const FIELD_YEARS = 'Years (1 to 100)';
const FIELD_CURRENCY = 'Currency (ISO 4217 code)';

/** 0 when each deposit is made at the end of a period, 1 when it is made at the start (OpenFormula PayType). */
export type PayType = 0 | 1;

/**
 * The balance after `periods` compounding periods of a starting amount `pv` and one deposit `pmt` in each period.
 * OpenFormula 6.12.20 FV points to the equation of 6.12.41 PV,
 *   0 = Pv x (1 + Rate)^Nper + Payment x (1 + Rate x PayType) x ((1 + Rate)^Nper - 1) / Rate + Fv,
 * which is written for money paid out; with positive amounts (money you put in and the balance you get out) the
 * balance is Pv x (1 + r)^n + Pmt x (1 + r x PayType) x ((1 + r)^n - 1) / r, where r is the yearly rate in percent
 * divided by 100 and by `perYear`. When r is 0 the specification's Rate 0 equation gives Pv + Pmt x n. Exact, not rounded.
 */
export function futureValue(
  pv: Dec,
  pmt: Dec,
  annualPercent: Dec,
  perYear: number,
  periods: number,
  payType: PayType,
): Dec {
  const r = annualPercent.div(100).div(perYear);
  if (r.isZero()) return pv.plus(pmt.times(periods));
  const growth = r.plus(1).pow(periods);
  const deposits = pmt.times(r.times(payType).plus(1)).times(growth.minus(1)).div(r);
  return pv.times(growth).plus(deposits);
}

/** One year of the table, rounded to the currency's smallest unit. */
export interface YearRow {
  year: number;
  /** The deposits made during the year: the deposit times the compounding periods a year. */
  deposits: Dec;
  /** The rounded year-end balance minus the rounded balance a year earlier minus the year's deposits. */
  interest: Dec;
  /** The balance at the end of the year, worked out at full precision and rounded once. */
  balance: Dec;
}

/**
 * The year-by-year table, years 1 to `years` in order. Each year-end balance is worked out at full precision from
 * the start and rounded half away from zero to `decimals` places; a year's interest is the rounded end balance
 * minus the rounded balance a year earlier minus that year's deposits, so the deposits and interest columns add
 * up exactly to the final balance minus the start. `pv` and `pmt` must have no more than `decimals` places.
 */
export function yearlyTable(
  pv: Dec,
  pmt: Dec,
  annualPercent: Dec,
  perYear: number,
  years: number,
  payType: PayType,
  decimals: number,
): YearRow[] {
  if (!Number.isInteger(years) || years < 1 || years > MAX_YEARS) {
    throw new MoneyInputError(FIELD_YEARS, `type a whole number from 1 to ${MAX_YEARS}`);
  }
  const deposits = pmt.times(perYear);
  const rows: YearRow[] = [];
  let previous = roundTo(pv, decimals);
  for (let year = 1; year <= years; year++) {
    const balance = roundTo(futureValue(pv, pmt, annualPercent, perYear, year * perYear, payType), decimals);
    rows.push({ year, deposits, interest: balance.minus(previous).minus(deposits), balance });
    previous = balance;
  }
  return rows;
}

/** The effective annual yield in percent: ((1 + r)^m - 1) x 100 for r = rate / 100 / m and m periods a year. */
export function effectiveAnnualYield(annualPercent: Dec, perYear: number): Dec {
  const r = annualPercent.div(100).div(perYear);
  return r.plus(1).pow(perYear).minus(1).times(100);
}

/**
 * The annual percentage yield in percent, by the general formula of 12 CFR 1030 Appendix A (Regulation DD):
 * 100 x ((1 + Interest / Principal)^(365 / Days in term) - 1). The fractional power goes through decimal.js `pow`.
 */
export function annualPercentageYield(interest: Dec, principal: Dec, days: number): Dec {
  if (!principal.gt(0)) throw new MoneyInputError('Principal', 'must be more than 0');
  if (!Number.isInteger(days) || days < 1) throw new MoneyInputError('Days in term', 'type a whole number of days');
  const growth = interest.div(principal).plus(1);
  if (!growth.gt(0)) {
    throw new MoneyInputError(
      'Interest',
      'must be more than minus the principal, a loss of the whole principal or more has no yield',
    );
  }
  return growth.pow(new D(365).div(days)).minus(1).times(100);
}

/** The values the page holds, exactly as typed. Any of them may be left out. */
export interface SavingsTexts {
  start?: string;
  deposit?: string;
  /** `end` (the default) or `start`: when in each period the deposit is made. */
  timing?: string;
  rate?: string;
  /** How many times a year interest is added: 1, 2, 4, 12 (the default), 52 or 365. */
  compounding?: string;
  years?: string;
  currency?: string;
}

/** One year as plain decimal strings at the currency's smallest unit. */
export interface SavingsRow {
  year: number;
  deposits: string;
  interest: string;
  balance: string;
}

export interface SavingsSummary {
  currency: string;
  /** Decimal places of the currency's smallest unit. */
  decimals: number;
  start: string;
  deposit: string;
  timing: 'end' | 'start';
  /** The yearly rate in percent as typed. */
  rate: string;
  perYear: number;
  years: number;
  /** Compounding periods in the whole term. */
  periods: number;
  finalBalance: string;
  totalDeposits: string;
  totalInterest: string;
  /** Percent, to 4 places. */
  effectiveYield: string;
}

export interface SavingsResult {
  summary: SavingsSummary;
  rows: SavingsRow[];
  /** The formulas, the typed numbers put into them, and the result before and after rounding. */
  working: string;
}

function parseAmount(text: string | undefined, field: string, currency: string, dp: number): Dec {
  if (text === undefined || isBlank(text)) return new D(0);
  const value = parseDecimal(text, field);
  if (value.decimalPlaces() > dp) {
    throw new MoneyInputError(
      field,
      `${currency} amounts have at most ${dp} decimal places, so the deposits can add up to the last cent`,
    );
  }
  return value;
}

/** Works out the growth from the page's typed values, or returns null when every number field is blank. */
export function calculateSavings(texts: SavingsTexts): SavingsResult | null {
  const startText = texts.start ?? '';
  const depositText = texts.deposit ?? '';
  const rateText = texts.rate ?? '';
  const yearsText = texts.years ?? '';
  if (isBlank(startText) && isBlank(depositText) && isBlank(rateText) && isBlank(yearsText)) return null;

  const currency = parseCurrency(texts.currency ?? 'USD', FIELD_CURRENCY);
  const dp = minorUnits(currency);
  const start = parseAmount(startText, FIELD_START, currency, dp);
  const deposit = parseAmount(depositText, FIELD_DEPOSIT, currency, dp);

  if (isBlank(rateText)) {
    throw new MoneyInputError(FIELD_RATE, 'missing, type the yearly rate in percent, for example 5');
  }
  const rate = parseDecimal(rateText, FIELD_RATE);
  if (rate.gt(100)) throw new MoneyInputError(FIELD_RATE, 'must be from 0 to 100 percent');
  const years = parseCount(yearsText, FIELD_YEARS, 1, MAX_YEARS);

  const compoundingText =
    texts.compounding === undefined || isBlank(texts.compounding) ? '12' : texts.compounding.trim();
  const perYear = COMPOUNDING.find((times) => String(times) === compoundingText);
  if (perYear === undefined) {
    throw new MoneyInputError(FIELD_COMPOUNDING, `choose ${COMPOUNDING.join(', ')} times a year`);
  }
  const timingText = texts.timing === undefined || isBlank(texts.timing) ? 'end' : texts.timing.trim();
  if (timingText !== 'end' && timingText !== 'start') {
    throw new MoneyInputError(FIELD_TIMING, 'choose the end or the start of each period');
  }
  const timing: 'end' | 'start' = timingText;
  const payType: PayType = timing === 'start' ? 1 : 0;

  if (start.isZero() && deposit.isZero()) {
    throw new MoneyInputError(FIELD_START, 'type a starting amount or a regular deposit, both are 0');
  }

  const periods = years * perYear;
  const exact = futureValue(start, deposit, rate, perYear, periods, payType);
  if (exact.gte(TOO_LARGE)) {
    throw new MoneyInputError(
      FIELD_RATE,
      `${rate.toFixed()} percent for ${years} years grows the balance to 1,000,000,000,000,000,000 or more, which is too large to show exactly, try a lower rate or fewer years`,
    );
  }
  const table = yearlyTable(start, deposit, rate, perYear, years, payType, dp);
  const last = table[table.length - 1]!;
  const finalBalance = last.balance;
  const totalDeposits = deposit.times(periods);
  const totalInterest = finalBalance.minus(start).minus(totalDeposits);
  const effective = effectiveAnnualYield(rate, perYear);

  const r = rate.div(100).div(perYear);
  const rShown = toPlain(r, 12);
  const money = (x: Dec) => x.toFixed(dp);
  const working = [
    'Balance with regular deposits, from OpenFormula 6.12.20 FV, which solves the equation in 6.12.41 PV (positive amounts: money you put in and the balance you get out):',
    '  r = yearly rate / 100 / compounding periods per year',
    '  n = years x compounding periods per year',
    '  PayType = 0 when each deposit is made at the end of a period, 1 when it is made at the start',
    '  FV = P x (1 + r)^n + D x (1 + r x PayType) x ((1 + r)^n - 1) / r',
    '  when r is 0 the equation for Rate 0 gives FV = P + D x n, with no division',
    '',
    'With your numbers:',
    `  P = ${money(start)}, D = ${money(deposit)} (one deposit each period), PayType = ${payType} (${timing} of each period)`,
    `  r = ${rate.toFixed()} / 100 / ${perYear} = ${rShown} (shown to 12 places, 40 significant digits are used)`,
    `  n = ${years} x ${perYear} = ${periods}`,
    r.isZero()
      ? `  FV = P + D x n = ${money(start)} + ${money(deposit)} x ${periods}`
      : `  FV = ${money(start)} x (1 + ${rShown})^${periods} + ${money(deposit)} x (1 + ${rShown} x ${payType}) x ((1 + ${rShown})^${periods} - 1) / ${rShown}`,
    `  exact FV = ${toPlain(exact, 12)}`,
    `  final balance = ${money(finalBalance)} (rounded half away from zero to ${dp} decimal places, the smallest unit of ${currency})`,
    '',
    "Year by year: each year-end balance is worked out at full precision from the start and rounded once. A year's interest is the rounded balance at its end minus the rounded balance a year earlier minus its deposits, so the interest column adds up exactly to the final balance minus the start minus all deposits.",
    `  total deposits = ${money(deposit)} x ${periods} = ${money(totalDeposits)}`,
    `  total interest = ${money(finalBalance)} - ${money(start)} - ${money(totalDeposits)} = ${money(totalInterest)}`,
    '',
    `Effective annual yield = (1 + r)^m - 1 with m = ${perYear} compounding periods a year: ${toPlain(effective, 4)} percent (to 4 places).`,
    'Regulation DD (12 CFR 1030 Appendix A) defines the annual percentage yield as 100 x ((1 + Interest / Principal)^(365 / Days in term) - 1); for money left alone for a 365-day year it gives the same figure as the effective annual yield above.',
  ].join('\n');

  return {
    summary: {
      currency,
      decimals: dp,
      start: money(start),
      deposit: money(deposit),
      timing,
      rate: rate.toFixed(),
      perYear,
      years,
      periods,
      finalBalance: money(finalBalance),
      totalDeposits: money(totalDeposits),
      totalInterest: money(totalInterest),
      effectiveYield: toPlain(effective, 4),
    },
    rows: table.map((row) => ({
      year: row.year,
      deposits: money(row.deposits),
      interest: money(row.interest),
      balance: money(row.balance),
    })),
    working,
  };
}
