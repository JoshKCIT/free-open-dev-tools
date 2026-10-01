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

const FIELD_AMOUNT = 'Amount in the source currency';
const FIELD_SOURCE = 'Source currency (ISO 4217 code)';
const FIELD_TARGET = 'Target currency (ISO 4217 code)';
const FIELD_OFFERED = 'Rate offered (target per 1 source)';
const FIELD_MID = 'Reference mid-market rate (target per 1 source)';
const FIELD_DECIMALS = 'Decimal places of the percentage';

const HUNDRED = new D(100);

/** The figures of one conversion, all exact: nothing is rounded here. */
export interface MarkupFigures {
  /** The amount converted at the offered rate, in the target currency. */
  convertedOffered: Dec;
  /** The amount converted at the reference rate, in the target currency. */
  convertedMid: Dec;
  /** (mid - offered) / mid x 100: positive when the offer is worse than the reference rate, negative when better. */
  markupPercent: Dec;
  /** amount x (mid - offered), in the target currency. */
  hiddenTarget: Dec;
  /** The hidden cost in the target currency divided by the reference rate, in the source currency. */
  hiddenSource: Dec;
}

/**
 * Compares an offered rate with a reference rate. Both rates are units of the target currency per one unit of the
 * source currency. The markup is the gap between the rates as a percentage of the reference rate; the hidden cost is
 * the amount times that gap, in the target currency, and divided by the reference rate, in the source currency.
 */
export function markup(amount: Dec, offered: Dec, mid: Dec): MarkupFigures {
  const gap = mid.minus(offered);
  const hiddenTarget = amount.times(gap);
  return {
    convertedOffered: amount.times(offered),
    convertedMid: amount.times(mid),
    markupPercent: gap.div(mid).times(HUNDRED),
    hiddenTarget,
    hiddenSource: hiddenTarget.div(mid),
  };
}

/** The values the page holds, exactly as typed. Any of them may be left out. */
export interface MarkupTexts {
  amount?: string;
  /** Default EUR. */
  source?: string;
  /** Default USD. */
  target?: string;
  /** The rate offered, target currency per 1 source currency. */
  offered?: string;
  /** The reference mid-market rate, target currency per 1 source currency. */
  mid?: string;
  /** Decimal places of the percentage, 0 to 4; default 2. */
  decimals?: string;
}

/** Whether the offered rate is worse than, equal to or better than the reference rate. */
export type MarkupDirection = 'worse' | 'equal' | 'better';

export interface MarkupSummary {
  source: string;
  target: string;
  /** Decimal places of the source currency's smallest unit. */
  sourceDecimals: number;
  /** Decimal places of the target currency's smallest unit. */
  targetDecimals: number;
  /** The amount typed, in plain text at the source currency's decimal places. */
  amount: string;
  /** The rates as typed. */
  offered: string;
  mid: string;
  convertedOffered: string;
  convertedMid: string;
  markupPercent: string;
  hiddenTarget: string;
  hiddenSource: string;
  direction: MarkupDirection;
  notes: string[];
}

export interface MarkupResult {
  summary: MarkupSummary;
  /** The formulas, the typed numbers put into them, and how the rounding was done. */
  working: string;
}

/** A rate as typed, trimmed, for showing back to the visitor. */
function typed(text: string): string {
  return text.trim().replace(/^\+/, '');
}

/** A figure for the working: rounded half away from zero to 10 places with trailing zeros dropped. */
function exactText(x: Dec): string {
  return roundTo(x, WORKING_PLACES).toFixed();
}

function parseRate(text: string | undefined, field: string, example: string): Dec {
  if (text === undefined || isBlank(text)) throw new MoneyInputError(field, `missing, type a rate such as ${example}`);
  const rate = parseDecimal(text, field);
  if (!rate.gt(0)) throw new MoneyInputError(field, 'must be above zero, type a rate such as ' + example);
  return rate;
}

/**
 * Works out the markup of an offered rate over a reference rate and the hidden cost in each currency, or returns
 * null when no amount is typed. A missing or zero rate, an amount of zero or a bad currency code is refused by name.
 */
export function calculateMarkup(texts: MarkupTexts): MarkupResult | null {
  const amountText = texts.amount ?? '';
  if (isBlank(amountText)) return null;

  const source = parseCurrency(
    texts.source === undefined || isBlank(texts.source) ? 'EUR' : texts.source,
    FIELD_SOURCE,
  );
  const target = parseCurrency(
    texts.target === undefined || isBlank(texts.target) ? 'USD' : texts.target,
    FIELD_TARGET,
  );
  const sourceDecimals = minorUnits(source);
  const targetDecimals = minorUnits(target);
  const percentDecimals = parseCount(
    texts.decimals === undefined || isBlank(texts.decimals) ? '2' : texts.decimals,
    FIELD_DECIMALS,
    0,
    4,
  );

  const amount = parseDecimal(amountText, FIELD_AMOUNT);
  if (amount.dp() > sourceDecimals) {
    throw new MoneyInputError(
      FIELD_AMOUNT,
      `${source} has ${sourceDecimals} decimal place${sourceDecimals === 1 ? '' : 's'}, so type at most that many`,
    );
  }
  if (!amount.gt(0)) throw new MoneyInputError(FIELD_AMOUNT, 'must be above zero, type an amount such as 1000');
  const offered = parseRate(texts.offered, FIELD_OFFERED, '1.0780');
  const mid = parseRate(texts.mid, FIELD_MID, '1.1000');

  const figures = markup(amount, offered, mid);
  const direction: MarkupDirection = figures.markupPercent.gt(0)
    ? 'worse'
    : figures.markupPercent.lt(0)
      ? 'better'
      : 'equal';

  const inTarget = (x: Dec) => toPlain(x, targetDecimals);
  const inSource = (x: Dec) => toPlain(x, sourceDecimals);
  const summary: MarkupSummary = {
    source,
    target,
    sourceDecimals,
    targetDecimals,
    amount: inSource(amount),
    offered: typed(texts.offered ?? ''),
    mid: typed(texts.mid ?? ''),
    convertedOffered: inTarget(figures.convertedOffered),
    convertedMid: inTarget(figures.convertedMid),
    markupPercent: toPlain(figures.markupPercent, percentDecimals),
    hiddenTarget: inTarget(figures.hiddenTarget),
    hiddenSource: inSource(figures.hiddenSource),
    direction,
    notes: [],
  };

  if (direction === 'better') {
    summary.notes.push(
      'The offered rate is better than the reference rate, so the markup and the hidden cost are negative: a saving against the reference rate, not a charge.',
    );
  }
  if (direction !== 'equal' && roundTo(figures.markupPercent, percentDecimals).isZero()) {
    summary.notes.push(
      `The markup is not zero: it is ${exactText(figures.markupPercent)} percent, which shows as ${summary.markupPercent} at ${percentDecimals} decimal places.`,
    );
  }

  const offeredText = summary.offered;
  const midText = summary.mid;
  const amountShown = typed(amountText);
  const working: string[] = [
    `Rates are read as units of the target currency per 1 unit of the source currency (${target} per 1 ${source} here).`,
    'No exchange rate is built in: both rates are the ones you typed.',
    '  converted at the offered rate = amount x offered rate',
    '  converted at the reference rate = amount x reference rate',
    '  markup = (reference rate - offered rate) / reference rate x 100, a percentage over the reference rate',
    '    (Regulation (EU) 2019/518 Article 3a(1) asks for charges as a percentage mark-up over a reference rate and gives no formula; this is the formula used here)',
    `  hidden cost in ${target} = amount x (reference rate - offered rate)`,
    `  hidden cost in ${source} = hidden cost in ${target} / reference rate`,
    '',
    'With your numbers:',
    `  converted at the offered rate = ${amountShown} x ${offeredText} = ${exactText(figures.convertedOffered)} ${target}, shown as ${summary.convertedOffered}`,
    `  converted at the reference rate = ${amountShown} x ${midText} = ${exactText(figures.convertedMid)} ${target}, shown as ${summary.convertedMid}`,
    `  markup = (${midText} - ${offeredText}) / ${midText} x 100 = ${exactText(figures.markupPercent)} percent, shown as ${summary.markupPercent} percent`,
    `  hidden cost in ${target} = ${amountShown} x (${midText} - ${offeredText}) = ${exactText(figures.hiddenTarget)} ${target}, shown as ${summary.hiddenTarget}`,
    `  hidden cost in ${source} = ${exactText(figures.hiddenTarget)} / ${midText} = ${exactText(figures.hiddenSource)} ${source}, shown as ${summary.hiddenSource}`,
  ];
  if (direction === 'equal') {
    working.push('The two rates are equal, so the markup is 0 and there is no hidden cost.');
  } else if (direction === 'better') {
    working.push(
      'The offered rate is better than the reference rate, so the markup and the hidden cost are negative: a saving against the reference rate.',
    );
  }
  working.push(
    '',
    `Rounding: each amount is rounded half away from zero to the smallest unit of its own currency (${sourceDecimals} decimal places for ${source}, ${targetDecimals} for ${target}) and the percentage to ${percentDecimals} decimal places, only when shown; every step before that keeps 40 significant digits.`,
  );

  return { summary, working: working.join('\n') };
}
