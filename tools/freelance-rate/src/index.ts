import meta from './meta.json';
import {
  D,
  type Dec,
  MoneyInputError,
  isBlank,
  formatMoney,
  parseCount,
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

const FIELD_INCOME = 'Target yearly income after tax';
const FIELD_EXPENSES = 'Yearly business expenses';
const FIELD_TAX = 'Share of profit set aside for tax (percent)';
const FIELD_WORKING_DAYS = 'Working days in a year';
const FIELD_DAYS_OFF = 'Days off (holidays, sickness, training)';
const FIELD_HOURS = 'Hours in a working day';
const FIELD_BILLABLE = 'Share of working time you can bill (percent)';
const FIELD_CURRENCY = 'Currency (ISO 4217 code)';

/**
 * The revenue a year must bring in: the expenses plus the profit that leaves the income after tax.
 * The tax share applies to the profit, so profit x (1 - tax share) = income and revenue = expenses + income / (1 - tax share).
 * Tax share is 0 to below 100, income is above 0, expenses are 0 or more.
 */
export function requiredRevenue(income: Dec, expenses: Dec, taxPercent: Dec): Dec {
  if (!income.gt(0)) throw new MoneyInputError(FIELD_INCOME, 'must be above 0');
  if (expenses.lt(0)) throw new MoneyInputError(FIELD_EXPENSES, 'must be 0 or more');
  if (taxPercent.lt(0) || taxPercent.gte(100)) {
    throw new MoneyInputError(
      FIELD_TAX,
      'must be 0 or more and below 100 percent, a share of 100 percent or more leaves no income to keep',
    );
  }
  return expenses.plus(income.div(new D(1).minus(taxPercent.div(100))));
}

/**
 * The hours a year that can be billed: (working days - days off) x hours in a working day x billable share / 100.
 * Working days are 1 to 366, days off are 0 and fewer than the working days, hours a day are above 0 and at most 24,
 * the billable share is above 0 and at most 100.
 */
export function billableHours(workingDays: number, daysOff: number, hoursPerDay: Dec, billablePercent: Dec): Dec {
  if (!Number.isInteger(workingDays) || workingDays < 1 || workingDays > 366) {
    throw new MoneyInputError(FIELD_WORKING_DAYS, 'type a whole number from 1 to 366');
  }
  if (!Number.isInteger(daysOff) || daysOff < 0 || daysOff >= workingDays) {
    throw new MoneyInputError(
      FIELD_DAYS_OFF,
      `must be fewer than the ${workingDays} working days, or no days would be left to work`,
    );
  }
  if (!hoursPerDay.gt(0) || hoursPerDay.gt(24)) {
    throw new MoneyInputError(FIELD_HOURS, 'must be above 0 and at most 24');
  }
  if (!billablePercent.gt(0) || billablePercent.gt(100)) {
    throw new MoneyInputError(FIELD_BILLABLE, 'must be above 0 and at most 100 percent');
  }
  return new D(workingDays - daysOff).times(hoursPerDay).times(billablePercent.div(100));
}

/** Everything the rates come from, all exact. */
export interface FreelanceRates {
  /** Profit before tax: the income divided by one minus the tax share. */
  profit: Dec;
  /** Tax set aside: the profit minus the income. */
  tax: Dec;
  /** Required yearly revenue. */
  revenue: Dec;
  daysWorked: number;
  /** Billable hours a year. */
  hours: Dec;
  /** Revenue over billable hours, exact. */
  hourly: Dec;
  /** The exact hourly rate times the hours in a working day, never the rounded hourly rate. */
  daily: Dec;
}

/** The hourly and day rate that reach the income target; nothing is rounded. */
export function freelanceRates(
  income: Dec,
  expenses: Dec,
  taxPercent: Dec,
  workingDays: number,
  daysOff: number,
  hoursPerDay: Dec,
  billablePercent: Dec,
): FreelanceRates {
  const revenue = requiredRevenue(income, expenses, taxPercent);
  const hours = billableHours(workingDays, daysOff, hoursPerDay, billablePercent);
  const hourly = revenue.div(hours);
  const profit = revenue.minus(expenses);
  return {
    profit,
    tax: profit.minus(income),
    revenue,
    daysWorked: workingDays - daysOff,
    hours,
    hourly,
    daily: hourly.times(hoursPerDay),
  };
}

/** The values the page holds, exactly as typed. Any of them may be left out. */
export interface FreelanceTexts {
  income?: string;
  expenses?: string;
  /** The share of profit set aside for tax, in percent. Nothing is filled in for you. */
  taxRate?: string;
  workingDays?: string;
  daysOff?: string;
  hoursPerDay?: string;
  /** The share of working time that can be billed, in percent. */
  billable?: string;
  currency?: string;
}

/** One row of the page: `money` is shown with the currency, `hours` as plain digits. */
export interface FreelanceLine {
  label: string;
  value: string;
  kind: 'money' | 'hours';
}

export interface FreelanceSummary {
  currency: string;
  /** Decimal places of the currency's smallest unit. */
  currencyDecimals: number;
  /** The hourly rate, rounded to the currency's smallest unit, as plain decimal text. */
  hourly: string;
  /** The day rate, from the exact hourly rate, rounded to the currency's smallest unit. */
  daily: string;
  /** Required yearly revenue, rounded for display. */
  revenue: string;
  /** Tax set aside, rounded for display. */
  tax: string;
  /** Billable hours a year to 2 places with trailing zeros dropped. */
  hours: string;
  lines: FreelanceLine[];
  notes: string[];
}

export interface FreelanceResult {
  summary: FreelanceSummary;
  /** Every assumption and figure used, as `[label, value]` pairs ready for a table. */
  assumptions: [string, string][];
  /** Both formulas, the typed numbers put into them, and the result before and after rounding. */
  working: string;
}

/** A figure for the working: rounded half away from zero to 10 places with trailing zeros dropped. */
function exactText(x: Dec): string {
  return roundTo(x, WORKING_PLACES).toFixed();
}

/** Works out the rates from the page's typed values, or returns null when nothing is typed. */
export function calculateFreelance(texts: FreelanceTexts): FreelanceResult | null {
  const typed = [
    texts.income,
    texts.expenses,
    texts.taxRate,
    texts.workingDays,
    texts.daysOff,
    texts.hoursPerDay,
    texts.billable,
  ];
  if (typed.every((text) => text === undefined || isBlank(text))) return null;

  const currency = parseCurrency(texts.currency ?? 'USD', FIELD_CURRENCY);
  const dp = minorUnits(currency);
  const income = parseDecimal(texts.income ?? '', FIELD_INCOME);
  const expenses = parseDecimal(texts.expenses ?? '', FIELD_EXPENSES);
  const taxPercent = parseDecimal(texts.taxRate ?? '', FIELD_TAX);
  const workingDays = parseCount(texts.workingDays ?? '', FIELD_WORKING_DAYS, 1, 366);
  const daysOff = parseCount(texts.daysOff ?? '', FIELD_DAYS_OFF, 0, 366);
  const hoursPerDay = parseDecimal(texts.hoursPerDay ?? '', FIELD_HOURS);
  const billable = parseDecimal(texts.billable ?? '', FIELD_BILLABLE);

  const r = freelanceRates(income, expenses, taxPercent, workingDays, daysOff, hoursPerDay, billable);
  const money = (x: Dec) => toPlain(x, dp);
  const shown = (x: Dec) => formatMoney(x, currency);
  const hoursText = (x: Dec) => roundTo(x, 2).toFixed();

  const summary: FreelanceSummary = {
    currency,
    currencyDecimals: dp,
    hourly: money(r.hourly),
    daily: money(r.daily),
    revenue: money(r.revenue),
    tax: money(r.tax),
    hours: hoursText(r.hours),
    lines: [
      { label: 'Hourly rate', value: money(r.hourly), kind: 'money' },
      { label: 'Day rate', value: money(r.daily), kind: 'money' },
      { label: 'Required yearly revenue', value: money(r.revenue), kind: 'money' },
      { label: 'Billable hours a year', value: hoursText(r.hours), kind: 'hours' },
    ],
    notes: [],
  };

  const assumptions: [string, string][] = [
    ['Target yearly income after tax', shown(income)],
    ['Yearly business expenses', shown(expenses)],
    ['Share of profit set aside for tax', `${taxPercent.toFixed()} %`],
    ['Profit before tax', shown(r.profit)],
    ['Tax set aside', shown(r.tax)],
    ['Required yearly revenue', shown(r.revenue)],
    ['Working days in a year', String(workingDays)],
    ['Days off', String(daysOff)],
    ['Days worked', String(r.daysWorked)],
    ['Hours in a working day', hoursPerDay.toFixed()],
    ['Share of working time you can bill', `${billable.toFixed()} %`],
    ['Billable hours a year', hoursText(r.hours)],
  ];

  const working = [
    'Freelance rate. No standards body publishes a formula for this; these are the steps, with the tax share on profit:',
    '  profit before tax = income / (1 - tax share / 100)   (the tax applies to the profit, not to the expenses)',
    '  required revenue = expenses + profit before tax',
    '  billable hours = (working days - days off) x hours in a working day x billable share / 100',
    '  hourly rate = required revenue / billable hours',
    '  day rate = exact hourly rate x hours in a working day',
    '',
    'With your numbers:',
    `  profit before tax = ${income.toFixed()} / (1 - ${taxPercent.toFixed()} / 100) = ${exactText(r.profit)}`,
    `  tax set aside = ${exactText(r.profit)} - ${income.toFixed()} = ${exactText(r.tax)}`,
    `  required revenue = ${expenses.toFixed()} + ${exactText(r.profit)} = ${exactText(r.revenue)}`,
    `  billable hours = (${workingDays} - ${daysOff}) x ${hoursPerDay.toFixed()} x ${billable.toFixed()} / 100 = ${exactText(r.hours)}`,
    `  hourly rate = ${exactText(r.revenue)} / ${exactText(r.hours)} = ${exactText(r.hourly)}`,
    `  day rate = ${exactText(r.hourly)} x ${hoursPerDay.toFixed()} = ${exactText(r.daily)}`,
    '',
    `Shown, rounded half away from zero to ${dp} decimal places, the smallest unit of ${currency}:`,
    `  hourly rate ${money(r.hourly)} ${currency}, day rate ${money(r.daily)} ${currency}`,
    '  the day rate comes from the exact hourly rate, so it is not the rounded hourly rate times the hours',
  ].join('\n');

  return { summary, assumptions, working };
}
