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
  parseIsoDate,
  daysBetween,
  formatIsoDate,
  roundTo,
  toPlain,
  minorUnits,
} from './money';

export { meta, D, MoneyInputError, isBlank, formatMoney };
export type { Dec };

/** An annualised return of this many percent or more is not shown: it is too large to read, and past 40 digits it is not exact. */
const TOO_LARGE_PERCENT = new D('1e18');
/** Decimal places used for the unrounded figures in the working. */
const WORKING_PLACES = 10;

const FIELD_MODE = 'Mode';
const FIELD_BUY_PRICE = 'Buy price';
const FIELD_SELL_PRICE = 'Sell price';
const FIELD_QUANTITY = 'Quantity';
const FIELD_START_VALUE = 'Start value';
const FIELD_END_VALUE = 'End value';
const FIELD_BUY_FEES = 'Fees when buying (optional)';
const FIELD_SELL_FEES = 'Fees when selling (optional)';
const FIELD_START_DATE = 'Start date (optional, YYYY-MM-DD)';
const FIELD_END_DATE = 'End date (optional, YYYY-MM-DD)';
const FIELD_DECIMALS = 'Decimal places';
const FIELD_CURRENCY = 'Currency (ISO 4217 code)';
const FIELD_COST = 'Total cost';
const FIELD_PROCEEDS = 'Total proceeds';
const FIELD_YEARS = 'Years held';

/**
 * The average annual rate T (a fraction, 0.0845 is 8.45 percent) that solves SEC Form N-1A Item 26(b)(1),
 * P(1+T)^n = ERV, for a start amount P, an ending value ERV and n years: T = (ERV / P)^(1/n) - 1. The fractional
 * power goes through decimal.js `pow`. Returns null when `years` is zero (there is no year count to annualise
 * over); an ending value of 0 gives exactly -1.
 */
export function annualisedReturn(start: Dec, end: Dec, years: Dec): Dec | null {
  if (!start.gt(0)) throw new MoneyInputError(FIELD_COST, 'must be more than 0 to work out an annualised return');
  if (end.lt(0)) throw new MoneyInputError(FIELD_PROCEEDS, 'must not be below 0 to work out an annualised return');
  if (years.lt(0)) throw new MoneyInputError(FIELD_YEARS, 'must not be below 0');
  if (years.isZero()) return null;
  return end.div(start).pow(new D(1).div(years)).minus(1);
}

/** What `investmentReturn` is given: exact amounts, and the days held when both dates are known. */
export interface ReturnInput {
  cost: Dec;
  proceeds: Dec;
  /** Whole days between the two dates, or null when no dates were given. */
  days: number | null;
}

export interface ReturnFigures {
  profit: Dec;
  /** Profit divided by cost, in percent. */
  roiPercent: Dec;
  /** days / 365, or null with no days. */
  years: Dec | null;
  /** The annualised return in percent, or null with no days, zero days or a figure too large to show. */
  annualisedPercent: Dec | null;
}

/** Profit, return on investment and (with a day count) the annualised return, all exact. Cost must be more than 0. */
export function investmentReturn(input: ReturnInput): ReturnFigures {
  const { cost, proceeds, days } = input;
  if (!cost.gt(0)) throw new MoneyInputError(FIELD_COST, 'must be more than 0 to work out a return');
  const profit = proceeds.minus(cost);
  const roiPercent = profit.div(cost).times(100);
  if (days === null) return { profit, roiPercent, years: null, annualisedPercent: null };
  const years = new D(days).div(365);
  const rate = annualisedReturn(cost, proceeds, years);
  const percent = rate === null ? null : rate.times(100);
  return {
    profit,
    roiPercent,
    years,
    annualisedPercent: percent !== null && percent.abs().lt(TOO_LARGE_PERCENT) ? percent : null,
  };
}

/** The values the page holds, exactly as typed. Any of them may be left out. */
export interface InvestmentTexts {
  /** `prices` (the default) or `values`. */
  mode?: string;
  buyPrice?: string;
  sellPrice?: string;
  quantity?: string;
  startValue?: string;
  endValue?: string;
  buyFees?: string;
  sellFees?: string;
  startDate?: string;
  endDate?: string;
  /** Decimal places of the percentages, 0 to 4, 2 by default. */
  decimals?: string;
  currency?: string;
}

export interface InvestmentSummary {
  mode: 'prices' | 'values';
  currency: string;
  /** Decimal places of the currency's smallest unit. */
  currencyDecimals: number;
  /** Decimal places of the percentages. */
  decimals: number;
  cost: string;
  proceeds: string;
  profit: string;
  /** Percent. */
  roi: string;
  /** Whole days between the dates, or null with no dates. */
  days: number | null;
  /** days / 365 to 4 places, or null with no days. */
  years: string | null;
  /** Percent, or null (see `annualisedNote`). */
  annualised: string | null;
  /** Why there is no annualised return, or null when there is one. */
  annualisedNote: string | null;
}

export interface InvestmentResult {
  summary: InvestmentSummary;
  /** The formulas, the typed numbers put into them, and the results before and after rounding. */
  working: string;
}

/** Reads an optional amount: blank counts as 0. */
function optionalAmount(text: string | undefined, field: string): Dec {
  return text === undefined || isBlank(text) ? new D(0) : parseDecimal(text, field);
}

/** Reads a required amount. */
function requiredAmount(
  text: string | undefined,
  field: string,
  opts: { maxInt?: number; maxFrac?: number } = {},
): Dec {
  return parseDecimal(text ?? '', field, opts);
}

/** A figure for the working: rounded half away from zero to 10 places with trailing zeros dropped. */
function exact(x: Dec): string {
  return roundTo(x, WORKING_PLACES).toFixed();
}

/** Works out the return from the page's typed values, or returns null when nothing the chosen mode needs is typed. */
export function calculateInvestment(texts: InvestmentTexts): InvestmentResult | null {
  const modeText = texts.mode === undefined || isBlank(texts.mode) ? 'prices' : texts.mode.trim();
  if (modeText !== 'prices' && modeText !== 'values') {
    throw new MoneyInputError(FIELD_MODE, 'choose buy and sell prices or start and end values');
  }
  const mode: 'prices' | 'values' = modeText;

  const needed =
    mode === 'prices' ? [texts.buyPrice, texts.sellPrice, texts.quantity] : [texts.startValue, texts.endValue];
  if (needed.every((text) => text === undefined || isBlank(text))) return null;

  const currency = parseCurrency(texts.currency ?? 'USD', FIELD_CURRENCY);
  const dp = minorUnits(currency);
  const decimals =
    texts.decimals === undefined || isBlank(texts.decimals) ? 2 : parseCount(texts.decimals, FIELD_DECIMALS, 0, 4);

  // A price and a quantity may have up to 12 digits before the point and 6 after, so their product (24 before, 12
  // after) and the fees on top stay inside the 40 significant digits and the cost is exact.
  const priceDigits = { maxInt: 12, maxFrac: 6 };
  let buyBase: Dec;
  let sellBase: Dec;
  let buyLine: string;
  let sellLine: string;
  let costFormula: string;
  let proceedsFormula: string;
  const buyFees = optionalAmount(texts.buyFees, FIELD_BUY_FEES);
  const sellFees = optionalAmount(texts.sellFees, FIELD_SELL_FEES);
  if (mode === 'prices') {
    const buyPrice = requiredAmount(texts.buyPrice, FIELD_BUY_PRICE, priceDigits);
    const sellPrice = requiredAmount(texts.sellPrice, FIELD_SELL_PRICE, priceDigits);
    const quantity = requiredAmount(texts.quantity, FIELD_QUANTITY, priceDigits);
    if (!quantity.gt(0)) throw new MoneyInputError(FIELD_QUANTITY, 'must be more than 0');
    buyBase = buyPrice.times(quantity);
    sellBase = sellPrice.times(quantity);
    costFormula = 'cost = buy price x quantity + fees paid when buying';
    proceedsFormula = 'proceeds = sell price x quantity - fees paid when selling';
    buyLine = `${buyPrice.toFixed()} x ${quantity.toFixed()}`;
    sellLine = `${sellPrice.toFixed()} x ${quantity.toFixed()}`;
  } else {
    buyBase = requiredAmount(texts.startValue, FIELD_START_VALUE);
    sellBase = requiredAmount(texts.endValue, FIELD_END_VALUE);
    costFormula = 'cost = start value + fees paid when buying';
    proceedsFormula = 'proceeds = end value - fees paid when selling';
    buyLine = buyBase.toFixed();
    sellLine = sellBase.toFixed();
  }
  const cost = buyBase.plus(buyFees);
  const proceeds = sellBase.minus(sellFees);
  if (!cost.gt(0)) {
    throw new MoneyInputError(
      mode === 'prices' ? FIELD_BUY_PRICE : FIELD_START_VALUE,
      `the total cost is ${cost.toFixed()}, it must be more than 0 to work out a return`,
    );
  }
  if (proceeds.lt(0)) {
    throw new MoneyInputError(
      FIELD_SELL_FEES,
      `fees of ${sellFees.toFixed()} are more than the sale of ${sellBase.toFixed()}, which leaves proceeds below 0, type smaller fees`,
    );
  }

  // Dates: both or neither. One alone only means there is nothing to annualise over yet.
  const startText = texts.startDate ?? '';
  const endText = texts.endDate ?? '';
  let days: number | null = null;
  let startShown = '';
  let endShown = '';
  let missingDate = false;
  if (!isBlank(startText) || !isBlank(endText)) {
    const start = isBlank(startText) ? null : parseIsoDate(startText, FIELD_START_DATE);
    const end = isBlank(endText) ? null : parseIsoDate(endText, FIELD_END_DATE);
    if (start && end) {
      days = daysBetween(start, end);
      startShown = formatIsoDate(start);
      endShown = formatIsoDate(end);
    } else {
      missingDate = true;
    }
  }

  const figures = investmentReturn({ cost, proceeds, days });
  const { profit, roiPercent, years, annualisedPercent } = figures;

  let annualised: string | null = null;
  let annualisedNote: string | null = null;
  if (annualisedPercent !== null) {
    annualised = toPlain(annualisedPercent, decimals);
  } else if (missingDate) {
    annualisedNote = 'Type both a start date and an end date to see an annualised return.';
  } else if (days === null) {
    annualisedNote = 'Type a start date and an end date to see an annualised return.';
  } else if (days === 0) {
    annualisedNote =
      'The holding period is 0 days, so there is no number of years to annualise over. Use dates at least one day apart.';
  } else {
    annualisedNote =
      'The annualised return is too large to show: it is 1,000,000,000,000,000,000 percent or more over this short a period.';
  }

  const money = (x: Dec) => toPlain(x, dp);
  const costNumbers = mode === 'values' ? `start value + fees paid when buying = ${buyLine}` : buyLine;
  const proceedsNumbers = mode === 'values' ? `end value - fees paid when selling = ${sellLine}` : sellLine;
  const lines: string[] = [
    'Cost, proceeds and profit:',
    `  ${costFormula}`,
    `  ${proceedsFormula}`,
    '  profit = proceeds - cost',
    '  return on investment = profit / cost x 100',
    '',
    'With your numbers:',
    `  cost = ${costNumbers} + ${buyFees.toFixed()} = ${cost.toFixed()}`,
    `  proceeds = ${proceedsNumbers} - ${sellFees.toFixed()} = ${proceeds.toFixed()}`,
    `  profit = ${proceeds.toFixed()} - ${cost.toFixed()} = ${profit.toFixed()}`,
    `  return on investment = ${profit.toFixed()} / ${cost.toFixed()} x 100 = ${exact(roiPercent)} percent`,
    `  shown as: cost ${money(cost)}, proceeds ${money(proceeds)}, profit ${money(profit)} ${currency} (rounded half away from zero to ${dp} decimal places, the smallest unit of ${currency}) and return on investment ${toPlain(roiPercent, decimals)} percent (rounded half away from zero to ${decimals} decimal places)`,
  ];
  if (days !== null && years !== null) {
    lines.push(
      '',
      'Annualised return, SEC Form N-1A Item 26(b)(1): P(1+T)^n = ERV, where P is the amount put in, ERV the ending redeemable value, T the average annual total return and n the number of years. Solving for T:',
      '  T = (ERV / P)^(1/n) - 1',
      '  n = days held / 365 (the form does not fix how days become years; this page uses 365)',
      '',
      'With your numbers:',
      `  days = ${days} (${startShown} to ${endShown}), n = ${days} / 365 = ${exact(years)}`,
    );
    if (annualisedPercent !== null) {
      const rate = annualisedPercent.div(100);
      lines.push(
        `  T = (${proceeds.toFixed()} / ${cost.toFixed()})^(1 / ${exact(years)}) - 1 = ${exact(rate)}`,
        `  annualised return = T x 100 = ${exact(annualisedPercent)} percent, shown as ${annualised} percent (rounded half away from zero to ${decimals} decimal places; SEC Form N-1A Item 26 Instruction 5 quotes it to the nearest hundredth of one percent)`,
      );
    } else if (annualisedNote !== null) {
      lines.push(`  ${annualisedNote}`);
    }
  } else if (annualisedNote !== null) {
    lines.push('', annualisedNote);
  }

  return {
    summary: {
      mode,
      currency,
      currencyDecimals: dp,
      decimals,
      cost: money(cost),
      proceeds: money(proceeds),
      profit: money(profit),
      roi: toPlain(roiPercent, decimals),
      days,
      years: years === null ? null : toPlain(years, 4),
      annualised,
      annualisedNote,
    },
    working: lines.join('\n'),
  };
}
