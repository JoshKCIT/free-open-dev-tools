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

const FIELD_MODE = 'Mode';
const FIELD_EARNINGS = 'Earnings';
const FIELD_SHARES = 'Shares outstanding';
const FIELD_PRICE = 'Share price';
const FIELD_EPS = 'Earnings per share';
const FIELD_DIVIDEND = 'Annual dividend per share';
const FIELD_DIVIDENDS = 'Dividends paid';
const FIELD_BUY_PRICE = 'Buy price';
const FIELD_INITIAL = 'Initial margin (percent)';
const FIELD_MAINTENANCE = 'Maintenance margin (percent)';
const FIELD_DECIMALS = 'Decimal places';
const FIELD_CURRENCY = 'Currency (ISO 4217 code)';

/** Earnings per share: earnings divided by the shares outstanding. Earnings may be negative; shares must be more than 0. */
export function earningsPerShare(earnings: Dec, shares: Dec): Dec {
  if (!shares.gt(0)) throw new MoneyInputError(FIELD_SHARES, 'must be more than 0');
  return earnings.div(shares);
}

/** Price to earnings ratio: the share price divided by earnings per share, or null when earnings per share is 0 or below. */
export function priceToEarnings(price: Dec, eps: Dec): Dec | null {
  if (!price.gt(0)) throw new MoneyInputError(FIELD_PRICE, 'must be more than 0');
  if (!eps.gt(0)) return null;
  return price.div(eps);
}

/** Dividend yield in percent: the annual dividend per share divided by the share price, times 100. */
export function dividendYield(dividend: Dec, price: Dec): Dec {
  if (!price.gt(0)) throw new MoneyInputError(FIELD_PRICE, 'must be more than 0');
  return dividend.div(price).times(100);
}

/** Payout ratio in percent: dividends divided by earnings, times 100, both on the same basis. Earnings must be more than 0. */
export function payoutRatio(dividends: Dec, earnings: Dec): Dec {
  if (!earnings.gt(0)) {
    throw new MoneyInputError(FIELD_EARNINGS, 'must be more than 0 to work out a payout ratio');
  }
  return dividends.div(earnings).times(100);
}

/**
 * The price below which a share bought on margin and held long gets a margin call. With the buy price P0, the
 * initial margin i and the maintenance margin m as fractions, the loan is L = P0 x (1 - i); at price P the equity is
 * P - L, and a call comes when that is below the maintenance share of the market value, P - L < m x P, that is
 * P < L / (1 - m) = P0 x (1 - i) / (1 - m). Interest on the loan is ignored. Returns null for an initial margin of
 * 100 percent (no loan, so no call). The initial margin must be more than 0 and at most 100, the maintenance margin
 * at least 0 and below 100, and the buy price more than 0.
 */
export function marginCallPrice(price: Dec, initialPercent: Dec, maintenancePercent: Dec): Dec | null {
  if (!price.gt(0)) throw new MoneyInputError(FIELD_BUY_PRICE, 'must be more than 0');
  if (!initialPercent.gt(0) || initialPercent.gt(100)) {
    throw new MoneyInputError(FIELD_INITIAL, 'must be more than 0 and at most 100 percent');
  }
  if (maintenancePercent.lt(0) || maintenancePercent.gte(100)) {
    throw new MoneyInputError(FIELD_MAINTENANCE, 'must be at least 0 and below 100 percent');
  }
  if (initialPercent.eq(100)) return null;
  const loan = price.times(new D(1).minus(initialPercent.div(100)));
  return loan.div(new D(1).minus(maintenancePercent.div(100)));
}

export type StockMode = 'eps' | 'pe' | 'yield' | 'payout' | 'margin';
const MODES: readonly StockMode[] = ['eps', 'pe', 'yield', 'payout', 'margin'];

/** The values the page holds, exactly as typed. Any of them may be left out. */
export interface StockTexts {
  /** `eps` (the default), `pe`, `yield`, `payout` or `margin`. */
  mode?: string;
  earnings?: string;
  shares?: string;
  price?: string;
  eps?: string;
  dividend?: string;
  dividends?: string;
  buyPrice?: string;
  initialMargin?: string;
  maintenanceMargin?: string;
  /** Decimal places of ratios and percentages, 0 to 4, 2 by default. */
  decimals?: string;
  currency?: string;
}

/** One row of the page: `money` is shown with the currency, `ratio` and `percent` to the chosen decimal places. */
export interface StockLine {
  label: string;
  value: string;
  kind: 'money' | 'ratio' | 'percent';
}

export interface StockSummary {
  mode: StockMode;
  currency: string;
  /** Decimal places of the currency's smallest unit. */
  currencyDecimals: number;
  /** Decimal places of ratios and percentages. */
  decimals: number;
  /** The headline figure as plain decimal text, or null when there is none (see `notes`). */
  result: string | null;
  lines: StockLine[];
  /** Plain statements about a missing ratio or an unusual input. */
  notes: string[];
}

export interface StockResult {
  summary: StockSummary;
  /** The formula, the typed numbers put into it, and the result before and after rounding. */
  working: string;
}

/** A figure for the working: rounded half away from zero to 10 places with trailing zeros dropped. */
function exact(x: Dec): string {
  return roundTo(x, WORKING_PLACES).toFixed();
}

/** What each mode needs, in the order they are read: the text, its field label and what it must satisfy. */
function needs(mode: StockMode, t: StockTexts): [string | undefined, string][] {
  switch (mode) {
    case 'eps':
      return [
        [t.earnings, FIELD_EARNINGS],
        [t.shares, FIELD_SHARES],
      ];
    case 'pe':
      return [
        [t.price, FIELD_PRICE],
        [t.eps, FIELD_EPS],
      ];
    case 'yield':
      return [
        [t.dividend, FIELD_DIVIDEND],
        [t.price, FIELD_PRICE],
      ];
    case 'payout':
      return [
        [t.dividends, FIELD_DIVIDENDS],
        [t.earnings, FIELD_EARNINGS],
      ];
    case 'margin':
      return [
        [t.buyPrice, FIELD_BUY_PRICE],
        [t.initialMargin, FIELD_INITIAL],
        [t.maintenanceMargin, FIELD_MAINTENANCE],
      ];
  }
}

/** Works out the chosen figure from the page's typed values, or returns null when nothing the chosen mode needs is typed. */
export function calculateStock(texts: StockTexts): StockResult | null {
  const modeText = texts.mode === undefined || isBlank(texts.mode) ? 'eps' : texts.mode.trim();
  const mode = MODES.find((m) => m === modeText);
  if (mode === undefined) {
    throw new MoneyInputError(
      FIELD_MODE,
      'choose earnings per share, price to earnings, dividend yield, payout ratio or margin call price',
    );
  }
  const required = needs(mode, texts);
  if (required.every(([text]) => text === undefined || isBlank(text))) return null;

  const currency = parseCurrency(texts.currency ?? 'USD', FIELD_CURRENCY);
  const dp = minorUnits(currency);
  const decimals =
    texts.decimals === undefined || isBlank(texts.decimals) ? 2 : parseCount(texts.decimals, FIELD_DECIMALS, 0, 4);
  const money = (x: Dec) => toPlain(x, dp);
  const ratio = (x: Dec) => toPlain(x, decimals);
  const shownMoney = (x: Dec) =>
    `shown as ${money(x)} ${currency} (rounded half away from zero to ${dp} decimal places, the smallest unit of ${currency})`;
  const shownRatio = (x: Dec, unit: string) =>
    `shown as ${ratio(x)}${unit} (rounded half away from zero to ${decimals} decimal places)`;

  const amount = (text: string | undefined, field: string, allowNegative = false) =>
    parseDecimal(text ?? '', field, { allowNegative });

  const lines: StockLine[] = [];
  const notes: string[] = [];
  let working: string[] = [];
  let result: string | null = null;

  if (mode === 'eps') {
    const earnings = amount(texts.earnings, FIELD_EARNINGS, true);
    const shares = amount(texts.shares, FIELD_SHARES);
    const eps = earningsPerShare(earnings, shares);
    result = money(eps);
    lines.push({ label: 'Earnings per share', value: result, kind: 'money' });
    working = [
      "Earnings per share, as the SEC Investor.gov glossary defines it: a public company's net profit divided by the number of its common shares.",
      '  earnings per share = earnings / shares outstanding',
      '',
      'With your numbers:',
      `  earnings per share = ${earnings.toFixed()} / ${shares.toFixed()} = ${exact(eps)}`,
      `  ${shownMoney(eps)}`,
    ];
  } else if (mode === 'pe') {
    const price = amount(texts.price, FIELD_PRICE);
    const eps = amount(texts.eps, FIELD_EPS, true);
    const pe = priceToEarnings(price, eps);
    working = [
      'Price to earnings ratio (no standards body publishes this definition; it is the usual price over earnings per share):',
      '  price to earnings ratio = share price / earnings per share',
      '',
      'With your numbers:',
    ];
    if (pe === null) {
      notes.push(
        `The price to earnings ratio is not meaningful when earnings per share is 0 or below (you typed ${eps.toFixed()}), so none is shown.`,
      );
      working.push(`  earnings per share is ${eps.toFixed()}, which is 0 or below, so the ratio is not meaningful`);
    } else {
      result = ratio(pe);
      lines.push({ label: 'Price to earnings ratio', value: result, kind: 'ratio' });
      working.push(
        `  price to earnings ratio = ${price.toFixed()} / ${eps.toFixed()} = ${exact(pe)}`,
        `  ${shownRatio(pe, '')}`,
      );
    }
  } else if (mode === 'yield') {
    const dividend = amount(texts.dividend, FIELD_DIVIDEND);
    const price = amount(texts.price, FIELD_PRICE);
    const yieldPercent = dividendYield(dividend, price);
    result = ratio(yieldPercent);
    lines.push({ label: 'Dividend yield', value: result, kind: 'percent' });
    working = [
      'Dividend yield (no standards body publishes this definition; it is the usual annual dividend per share over the price):',
      '  dividend yield = annual dividend per share / share price x 100',
      '',
      'With your numbers:',
      `  dividend yield = ${dividend.toFixed()} / ${price.toFixed()} x 100 = ${exact(yieldPercent)} percent`,
      `  ${shownRatio(yieldPercent, ' percent')}`,
    ];
  } else if (mode === 'payout') {
    const dividends = amount(texts.dividends, FIELD_DIVIDENDS);
    const earnings = amount(texts.earnings, FIELD_EARNINGS, true);
    const payout = payoutRatio(dividends, earnings);
    result = ratio(payout);
    lines.push({ label: 'Payout ratio', value: result, kind: 'percent' });
    working = [
      'Payout ratio (no standards body publishes this definition; it is the usual dividends over earnings, both on the same basis):',
      '  payout ratio = dividends / earnings x 100',
      '',
      'With your numbers:',
      `  payout ratio = ${dividends.toFixed()} / ${earnings.toFixed()} x 100 = ${exact(payout)} percent`,
      `  ${shownRatio(payout, ' percent')}`,
    ];
  } else {
    const price = amount(texts.buyPrice, FIELD_BUY_PRICE);
    const initial = amount(texts.initialMargin, FIELD_INITIAL);
    const maintenance = amount(texts.maintenanceMargin, FIELD_MAINTENANCE);
    const call = marginCallPrice(price, initial, maintenance);
    const loan = price.times(new D(1).minus(initial.div(100)));
    const equity = price.minus(loan);
    lines.push(
      { label: 'Buy price', value: money(price), kind: 'money' },
      { label: 'Initial margin', value: ratio(initial), kind: 'percent' },
      { label: 'Maintenance margin', value: ratio(maintenance), kind: 'percent' },
      { label: 'Loan per share', value: money(loan), kind: 'money' },
      { label: 'Equity per share at purchase', value: money(equity), kind: 'money' },
    );
    working = [
      'Margin call price for one share bought on margin and held long.',
      'The margin terms: 12 CFR 220.12(a) (Regulation T) sets the required margin for a margin equity security at 50 percent of the current market value, and FINRA Rule 4210(c)(1) sets the maintenance margin for margin securities held long at 25 percent of the current market value. This page uses the percentages you type.',
      '  loan per share L = buy price x (1 - initial margin / 100)',
      '  equity at price P = P - L',
      '  a call comes when the equity is below the maintenance share of the market value: P - L < maintenance margin / 100 x P',
      '  solving for P gives P < L / (1 - maintenance margin / 100), so',
      '  margin call price = buy price x (1 - initial margin / 100) / (1 - maintenance margin / 100)',
      '',
      'With your numbers:',
      `  L = ${price.toFixed()} x (1 - ${initial.toFixed()} / 100) = ${exact(loan)}`,
    ];
    if (call === null) {
      notes.push(
        'An initial margin of 100 percent means no loan, so there is no margin call: the whole price is paid in cash.',
      );
      working.push('  the initial margin is 100 percent, so the loan is 0 and there is no margin call');
    } else {
      result = money(call);
      lines.push({ label: 'Margin call price', value: result, kind: 'money' });
      working.push(
        `  margin call price = ${price.toFixed()} x (1 - ${initial.toFixed()} / 100) / (1 - ${maintenance.toFixed()} / 100) = ${exact(call)}`,
        `  ${shownMoney(call)}`,
      );
      if (call.lte(price)) {
        const fall = price.minus(call).div(price).times(100);
        lines.push({ label: 'Fall from the buy price to the call', value: ratio(fall), kind: 'percent' });
        working.push(
          `  fall from the buy price to the call = (${price.toFixed()} - ${exact(call)}) / ${price.toFixed()} x 100 = ${exact(fall)} percent, ${shownRatio(fall, ' percent')}`,
        );
      }
      if (initial.lt(maintenance)) {
        notes.push(
          `The initial margin of ${initial.toFixed()} percent is below the maintenance margin of ${maintenance.toFixed()} percent, so the position is already below the maintenance requirement when bought (the call price is above the buy price).`,
        );
      }
    }
    working.push('', 'Interest on the margin loan and any broker fees are not included.');
  }

  return {
    summary: { mode, currency, currencyDecimals: dp, decimals, result, lines, notes },
    working: working.join('\n'),
  };
}
