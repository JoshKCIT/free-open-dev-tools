import meta from './meta.json';
import {
  D,
  type Dec,
  MoneyInputError,
  isBlank,
  formatMoney,
  parseCurrency,
  parseDecimal,
  roundTo,
  toPlain,
  minorUnits,
} from './money';

export { meta, D, MoneyInputError, isBlank, formatMoney };
export type { Dec };

/** Decimal places used for the unrounded figures in the working. */
const WORKING_PLACES = 10;

const FIELD_AMOUNT = 'Pay';
const FIELD_PERIOD = 'Pay is given per';
const FIELD_HOURS = 'Hours a week';
const FIELD_DAYS = 'Days a week';
const FIELD_WEEKS = 'Weeks a year';
const FIELD_CURRENCY = 'Currency (ISO 4217 code)';

export type PayPeriod = 'yearly' | 'monthly' | 'fortnightly' | 'weekly' | 'daily' | 'hourly';

/** The six pay periods in the order they are shown, with the label the page uses. */
export const PAY_PERIODS: readonly { id: PayPeriod; label: string }[] = [
  { id: 'yearly', label: 'Yearly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'fortnightly', label: 'Every two weeks' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'daily', label: 'Daily' },
  { id: 'hourly', label: 'Hourly' },
];

/** Hours a week above 0 and at most 168, days a week 1 to 7, weeks a year above 0 and at most 53. */
function checkTime(hoursPerWeek: Dec, daysPerWeek: Dec, weeksPerYear: Dec): void {
  if (!hoursPerWeek.gt(0) || hoursPerWeek.gt(168)) {
    throw new MoneyInputError(FIELD_HOURS, 'must be above 0 and at most 168, the hours in a week');
  }
  if (daysPerWeek.lt(1) || daysPerWeek.gt(7)) {
    throw new MoneyInputError(FIELD_DAYS, 'must be from 1 to 7');
  }
  if (!weeksPerYear.gt(0) || weeksPerYear.gt(53)) {
    throw new MoneyInputError(FIELD_WEEKS, 'must be above 0 and at most 53');
  }
}

/**
 * How many of `period` there are in a year: yearly 1, monthly 12, fortnightly weeks / 2, weekly weeks,
 * daily days a week x weeks, hourly hours a week x weeks.
 */
export function yearlyFactor(period: PayPeriod, hoursPerWeek: Dec, daysPerWeek: Dec, weeksPerYear: Dec): Dec {
  checkTime(hoursPerWeek, daysPerWeek, weeksPerYear);
  switch (period) {
    case 'yearly':
      return new D(1);
    case 'monthly':
      return new D(12);
    case 'fortnightly':
      return weeksPerYear.div(2);
    case 'weekly':
      return weeksPerYear;
    case 'daily':
      return daysPerWeek.times(weeksPerYear);
    case 'hourly':
      return hoursPerWeek.times(weeksPerYear);
  }
}

export interface PayRow {
  period: PayPeriod;
  label: string;
  /** How many of this period there are in a year. */
  factor: Dec;
  /** The pay for one of this period, exact. */
  amount: Dec;
}

export interface PayConversion {
  /** The exact yearly pay: the typed amount times the number of its periods in a year. */
  yearly: Dec;
  /** One row per period in `PAY_PERIODS` order; each amount is the exact yearly pay divided by its factor. */
  rows: PayRow[];
}

/** Turns `amount` for one `period` into the exact yearly pay and then into every period. Nothing is rounded. */
export function convertPay(
  amount: Dec,
  period: PayPeriod,
  hoursPerWeek: Dec,
  daysPerWeek: Dec,
  weeksPerYear: Dec,
): PayConversion {
  if (amount.lt(0)) throw new MoneyInputError(FIELD_AMOUNT, 'must be 0 or more');
  const factorOf = (p: PayPeriod) => yearlyFactor(p, hoursPerWeek, daysPerWeek, weeksPerYear);
  const yearly = amount.times(factorOf(period));
  const rows = PAY_PERIODS.map(({ id, label }): PayRow => {
    const factor = factorOf(id);
    return { period: id, label, factor, amount: yearly.div(factor) };
  });
  return { yearly, rows };
}

/** The values the page holds, exactly as typed. Any of them may be left out. */
export interface PayTexts {
  amount?: string;
  /** `yearly` (the default), `monthly`, `fortnightly`, `weekly`, `daily` or `hourly`: what the amount is for. */
  period?: string;
  hoursPerWeek?: string;
  daysPerWeek?: string;
  weeksPerYear?: string;
  currency?: string;
}

export interface PaySummaryRow {
  period: PayPeriod;
  label: string;
  /** How many of this period there are in a year, as exact plain decimal text. */
  factor: string;
  /** The pay for one of this period, rounded to the currency's smallest unit, as plain decimal text. */
  amount: string;
}

export interface PaySummary {
  currency: string;
  /** Decimal places of the currency's smallest unit. */
  currencyDecimals: number;
  /** The yearly pay, rounded to the currency's smallest unit. */
  yearly: string;
  rows: PaySummaryRow[];
}

export interface PayResult {
  summary: PaySummary;
  /** The periods in a year, the yearly pay and each division, with the result before and after rounding. */
  working: string;
}

/** A figure for the working: rounded half away from zero to 10 places with trailing zeros dropped. */
function exactText(x: Dec): string {
  return roundTo(x, WORKING_PLACES).toFixed();
}

/** Converts the typed pay into every period, or returns null when no pay is typed. */
export function calculatePay(texts: PayTexts): PayResult | null {
  if (texts.amount === undefined || isBlank(texts.amount)) return null;

  const periodText = texts.period === undefined || isBlank(texts.period) ? 'yearly' : texts.period.trim();
  const period = PAY_PERIODS.find((p) => p.id === periodText);
  if (period === undefined) {
    throw new MoneyInputError(FIELD_PERIOD, 'choose yearly, monthly, every two weeks, weekly, daily or hourly');
  }
  const currency = parseCurrency(texts.currency ?? 'USD', FIELD_CURRENCY);
  const dp = minorUnits(currency);
  const amount = parseDecimal(texts.amount, FIELD_AMOUNT);
  const hoursPerWeek = parseDecimal(texts.hoursPerWeek ?? '', FIELD_HOURS);
  const daysPerWeek = parseDecimal(texts.daysPerWeek ?? '', FIELD_DAYS);
  const weeksPerYear = parseDecimal(texts.weeksPerYear ?? '', FIELD_WEEKS);

  const converted = convertPay(amount, period.id, hoursPerWeek, daysPerWeek, weeksPerYear);
  const money = (x: Dec) => toPlain(x, dp);
  const typedFactor = converted.rows.find((r) => r.period === period.id)!.factor;

  const summary: PaySummary = {
    currency,
    currencyDecimals: dp,
    yearly: money(converted.yearly),
    rows: converted.rows.map((r) => ({
      period: r.period,
      label: r.label,
      factor: exactText(r.factor),
      amount: money(r.amount),
    })),
  };

  const working = [
    'Pay conversion. Every figure goes through the exact yearly pay, so nothing is rounded between steps:',
    '  periods in a year: yearly 1, monthly 12, every two weeks = weeks a year / 2, weekly = weeks a year,',
    '    daily = days a week x weeks a year, hourly = hours a week x weeks a year',
    '  yearly pay = pay x periods in a year of the period you typed',
    '  each figure = yearly pay / the periods in a year of that period',
    '',
    'With your numbers:',
    `  weeks a year ${weeksPerYear.toFixed()}, days a week ${daysPerWeek.toFixed()}, hours a week ${hoursPerWeek.toFixed()}`,
    `  periods in a year: ${converted.rows.map((r) => `${r.label.toLowerCase()} ${exactText(r.factor)}`).join(', ')}`,
    `  yearly pay = ${amount.toFixed()} x ${exactText(typedFactor)} = ${exactText(converted.yearly)}`,
    ...converted.rows.map(
      (r) =>
        `  ${r.label.toLowerCase()} = ${exactText(converted.yearly)} / ${exactText(r.factor)} = ${exactText(r.amount)}, shown as ${money(r.amount)} ${currency}`,
    ),
    '',
    `Shown figures are rounded half away from zero to ${dp} decimal places, the smallest unit of ${currency}.`,
  ].join('\n');

  return { summary, working };
}
