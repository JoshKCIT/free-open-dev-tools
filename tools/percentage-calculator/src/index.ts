import meta from './meta.json';
import {
  D,
  type Dec,
  MoneyInputError,
  isBlank,
  formatMoney,
  parseCount,
  parseDecimal,
  parseRows,
  cellDecimal,
  roundTo,
  toPlain,
} from './money';

export { meta, D, MoneyInputError, isBlank, formatMoney };
export type { Dec };

/** Decimal places used for the unrounded figures in the working. */
const WORKING_PLACES = 10;

/** The most stacked discounts accepted. */
export const MAX_DISCOUNTS = 20;

const FIELD_MODE = 'Mode';
const FIELD_PERCENT = 'Percent';
const FIELD_VALUE = 'Number';
const FIELD_PART = 'Part';
const FIELD_WHOLE = 'Whole';
const FIELD_FROM = 'Starting value';
const FIELD_TO = 'Ending value';
const FIELD_PRICE = 'Price';
const FIELD_DISCOUNT = 'Discount (percent)';
const FIELD_DISCOUNTS = 'Discounts';
const FIELD_DECIMALS = 'Decimal places';

const ONE = new D(1);
const HUNDRED = new D(100);

/**
 * X percent of Y. NIST Special Publication 811 section 7.10.2 takes the symbol % to be the number 0.01, so X percent is
 * X x 0.01 and X percent of Y is X x 0.01 x Y. Both may be negative.
 */
export function percentOf(percent: Dec, value: Dec): Dec {
  return percent.div(HUNDRED).times(value);
}

/** What percent `part` is of `whole`: part / whole x 100, or null when the whole is 0. */
export function whatPercent(part: Dec, whole: Dec): Dec | null {
  return whole.isZero() ? null : part.div(whole).times(HUNDRED);
}

/** The percent change from `from` to `to`: (to - from) / |from| x 100, or null when `from` is 0. */
export function percentChange(from: Dec, to: Dec): Dec | null {
  return from.isZero() ? null : to.minus(from).div(from.abs()).times(HUNDRED);
}

function checkDiscount(discount: Dec, field: string, position?: { line: number; column: number }): void {
  if (discount.gt(HUNDRED)) {
    throw new MoneyInputError(
      field,
      'must be at most 100 percent, a discount above 100 percent would make the price negative',
      position,
    );
  }
}

/** A price after a percent discount, and the saving: price x (1 - discount / 100) and price x discount / 100. */
export function discountedPrice(price: Dec, discountPercent: Dec): { price: Dec; saving: Dec } {
  checkDiscount(discountPercent, FIELD_DISCOUNT);
  const saving = price.times(discountPercent).div(HUNDRED);
  return { price: price.times(ONE.minus(discountPercent.div(HUNDRED))), saving };
}

/**
 * The single discount that several discounts, each applied to the price left by the one before, add up to:
 * `factor` is the product of (1 - d / 100) and `percent` is (1 - factor) x 100. 20 then 10 leaves 0.72, so 28 percent.
 */
export function stackedDiscount(discountPercents: readonly Dec[]): { percent: Dec; factor: Dec } {
  let factor = ONE;
  for (const d of discountPercents) {
    checkDiscount(d, FIELD_DISCOUNTS);
    factor = factor.times(ONE.minus(d.div(HUNDRED)));
  }
  return { percent: ONE.minus(factor).times(HUNDRED), factor };
}

/** Reads the discounts textarea: one percent from 0 to 100 per line, 1 to 20 lines. A problem names the line and column. */
function parseDiscounts(text: string): Dec[] {
  const rows = parseRows(text, FIELD_DISCOUNTS, { columns: ['discount'], required: 1, maxRows: MAX_DISCOUNTS });
  return rows.map((row) => {
    const d = cellDecimal(row, 0, FIELD_DISCOUNTS, 'discount');
    checkDiscount(d, FIELD_DISCOUNTS, { line: row.line, column: row.starts[0] ?? 1 });
    return d;
  });
}

export type PercentMode = 'of' | 'what' | 'change' | 'discount' | 'stacked';
const MODES: readonly PercentMode[] = ['of', 'what', 'change', 'discount', 'stacked'];

/** The values the page holds, exactly as typed. Any of them may be left out. */
export interface PercentTexts {
  /** `of` (the default), `what`, `change`, `discount` or `stacked`. */
  mode?: string;
  percent?: string;
  value?: string;
  part?: string;
  whole?: string;
  from?: string;
  to?: string;
  price?: string;
  discount?: string;
  /** One discount percent per line, 1 to 20 lines. */
  discounts?: string;
  /** Decimal places of results, 0 to 4, 2 by default. */
  decimals?: string;
}

/** One row of the page: `percent` is shown with a percent sign, `number` as plain digits. */
export interface PercentLine {
  label: string;
  value: string;
  kind: 'number' | 'percent';
}

export interface PercentSummary {
  mode: PercentMode;
  /** Decimal places of results. */
  decimals: number;
  /** The headline figure as plain decimal text, or null when there is none (see `notes`). */
  result: string | null;
  lines: PercentLine[];
  /** Plain statements about a figure that has no answer. */
  notes: string[];
}

export interface PercentResult {
  summary: PercentSummary;
  /** The formula, the typed numbers put into it, and the result before and after rounding. */
  working: string;
}

/** A figure for the working: rounded half away from zero to 10 places with trailing zeros dropped. */
function exactText(x: Dec): string {
  return roundTo(x, WORKING_PLACES).toFixed();
}

/** What each mode needs, in the order it is read: the text and its field label. A stacked price is optional. */
function needs(mode: PercentMode, t: PercentTexts): [string | undefined, string][] {
  switch (mode) {
    case 'of':
      return [
        [t.percent, FIELD_PERCENT],
        [t.value, FIELD_VALUE],
      ];
    case 'what':
      return [
        [t.part, FIELD_PART],
        [t.whole, FIELD_WHOLE],
      ];
    case 'change':
      return [
        [t.from, FIELD_FROM],
        [t.to, FIELD_TO],
      ];
    case 'discount':
      return [
        [t.price, FIELD_PRICE],
        [t.discount, FIELD_DISCOUNT],
      ];
    case 'stacked':
      return [[t.discounts, FIELD_DISCOUNTS]];
  }
}

/** Answers the chosen question from the page's typed values, or returns null when nothing the chosen mode needs is typed. */
export function calculatePercentage(texts: PercentTexts): PercentResult | null {
  const modeText = texts.mode === undefined || isBlank(texts.mode) ? 'of' : texts.mode.trim();
  const mode = MODES.find((m) => m === modeText);
  if (mode === undefined) {
    throw new MoneyInputError(
      FIELD_MODE,
      'choose percent of a number, what percent, percent change, price after a discount or stacked discounts',
    );
  }
  const required = needs(mode, texts);
  if (required.every(([text]) => text === undefined || isBlank(text))) return null;

  const decimals =
    texts.decimals === undefined || isBlank(texts.decimals) ? 2 : parseCount(texts.decimals, FIELD_DECIMALS, 0, 4);
  const shown = (x: Dec) => toPlain(x, decimals);
  const shownText = (x: Dec, unit = '') =>
    `shown as ${shown(x)}${unit} (rounded half away from zero to ${decimals} decimal places)`;
  const amount = (text: string | undefined, field: string, allowNegative = false) =>
    parseDecimal(text ?? '', field, { allowNegative });

  const lines: PercentLine[] = [];
  const notes: string[] = [];
  let working: string[] = [];
  let result: string | null = null;

  if (mode === 'of') {
    const percent = amount(texts.percent, FIELD_PERCENT, true);
    const value = amount(texts.value, FIELD_VALUE, true);
    const answer = percentOf(percent, value);
    result = shown(answer);
    lines.push({ label: 'Result', value: result, kind: 'number' });
    working = [
      'X percent of Y. NIST Special Publication 811 (section 7.10.2) takes the percent symbol to be the number 0.01:',
      '  X percent = X x 0.01',
      '  X percent of Y = X x 0.01 x Y',
      '',
      'With your numbers:',
      `  ${percent.toFixed()} percent = ${percent.toFixed()} x 0.01 = ${exactText(percent.div(HUNDRED))}`,
      `  ${exactText(percent.div(HUNDRED))} x ${value.toFixed()} = ${exactText(answer)}`,
      `  ${shownText(answer)}`,
    ];
  } else if (mode === 'what') {
    const part = amount(texts.part, FIELD_PART, true);
    const whole = amount(texts.whole, FIELD_WHOLE, true);
    const answer = whatPercent(part, whole);
    working = [
      'What percent X is of Y (no standards body publishes this formula; it is the usual part over whole):',
      '  percent = part / whole x 100',
      '',
      'With your numbers:',
    ];
    if (answer === null) {
      notes.push('A whole of 0 has no percent: the part is divided by the whole, and 0 cannot be a divisor.');
      working.push('  the whole is 0, so there is no percent');
    } else {
      result = shown(answer);
      lines.push({ label: 'Percent', value: result, kind: 'percent' });
      working.push(
        `  percent = ${part.toFixed()} / ${whole.toFixed()} x 100 = ${exactText(answer)} percent`,
        `  ${shownText(answer, ' percent')}`,
      );
    }
  } else if (mode === 'change') {
    const from = amount(texts.from, FIELD_FROM, true);
    const to = amount(texts.to, FIELD_TO, true);
    const answer = percentChange(from, to);
    const difference = to.minus(from);
    lines.push({ label: 'Change', value: shown(difference), kind: 'number' });
    working = [
      'Percent change (no standards body publishes this formula; it is the usual change over the starting value, taken as its absolute value so a rise from a negative value is a rise):',
      '  percent change = (ending value - starting value) / absolute starting value x 100',
      '',
      'With your numbers:',
    ];
    if (answer === null) {
      notes.push(
        'A change from 0 has no percent: the change is divided by the starting value, and 0 cannot be a divisor.',
      );
      working.push('  the starting value is 0, so there is no percent change');
    } else {
      result = shown(answer);
      lines.unshift({ label: 'Percent change', value: result, kind: 'percent' });
      working.push(
        `  percent change = (${to.toFixed()} - ${from.toFixed()}) / ${from.abs().toFixed()} x 100 = ${exactText(answer)} percent`,
        `  ${shownText(answer, ' percent')}`,
      );
    }
  } else if (mode === 'discount') {
    const price = amount(texts.price, FIELD_PRICE);
    const discount = amount(texts.discount, FIELD_DISCOUNT);
    const d = discountedPrice(price, discount);
    result = shown(d.price);
    lines.push(
      { label: 'Price after the discount', value: result, kind: 'number' },
      { label: 'Saving', value: shown(d.saving), kind: 'number' },
    );
    working = [
      'Price after a percent discount (no standards body publishes this formula; the percent is the number 0.01 times the discount, as in NIST Special Publication 811 section 7.10.2):',
      '  price after the discount = price x (1 - discount / 100)',
      '  saving = price x discount / 100',
      '',
      'With your numbers:',
      `  price after the discount = ${price.toFixed()} x (1 - ${discount.toFixed()} / 100) = ${exactText(d.price)}`,
      `  ${shownText(d.price)}`,
      `  saving = ${price.toFixed()} x ${discount.toFixed()} / 100 = ${exactText(d.saving)}`,
      `  ${shownText(d.saving)}`,
    ];
  } else {
    const discounts = parseDiscounts(texts.discounts ?? '');
    const price = texts.price === undefined || isBlank(texts.price) ? null : amount(texts.price, FIELD_PRICE);
    const { percent, factor } = stackedDiscount(discounts);
    result = shown(percent);
    lines.push({ label: 'Single discount', value: result, kind: 'percent' });
    const factors = discounts.map((d) => exactText(ONE.minus(d.div(HUNDRED))));
    working = [
      'Stacked discounts: each discount applies to the price left by the one before, so the price keeps (1 - discount / 100) of itself at every step and the discounts multiply instead of adding.',
      '  single discount = (1 - (1 - d1 / 100) x (1 - d2 / 100) x ...) x 100',
      '',
      'With your numbers:',
    ];
    let running = ONE;
    discounts.forEach((d, index) => {
      running = running.times(ONE.minus(d.div(HUNDRED)));
      working.push(
        `  after ${d.toFixed()} percent off (discount ${index + 1}): the price keeps ${exactText(running)} of itself`,
      );
    });
    working.push(
      `  ${exactText(ONE)} - ${factors.join(' x ')} = ${exactText(ONE.minus(factor))}`,
      `  single discount = ${exactText(ONE.minus(factor))} x 100 = ${exactText(percent)} percent`,
      `  ${shownText(percent, ' percent')}`,
    );
    if (price !== null) {
      const final = price.times(factor);
      const saving = price.minus(final);
      lines.push(
        { label: 'Price after the discounts', value: shown(final), kind: 'number' },
        { label: 'Saving', value: shown(saving), kind: 'number' },
      );
      working.push(
        `  price after the discounts = ${price.toFixed()} x ${exactText(factor)} = ${exactText(final)}, ${shownText(final)}`,
        `  saving = ${price.toFixed()} - ${exactText(final)} = ${exactText(saving)}, ${shownText(saving)}`,
      );
    }
  }

  return { summary: { mode, decimals, result, lines, notes }, working: working.join('\n') };
}
