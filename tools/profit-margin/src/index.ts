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
const FIELD_COST = 'Cost';
const FIELD_PRICE = 'Price';
const FIELD_TARGET_MARGIN = 'Target margin (percent)';
const FIELD_TARGET_MARKUP = 'Target markup (percent)';
const FIELD_FIXED = 'Fixed costs';
const FIELD_UNIT_PRICE = 'Unit price';
const FIELD_UNIT_COST = 'Unit variable cost';
const FIELD_DECIMALS = 'Decimal places';
const FIELD_CURRENCY = 'Currency (ISO 4217 code)';

/** The profit, and the margin and markup of that profit; each of the two is null when its divisor is 0. */
export interface ProfitFigures {
  profit: Dec;
  /** Profit over price, in percent; null for a price of 0. */
  margin: Dec | null;
  /** Profit over cost, in percent; null for a cost of 0. */
  markup: Dec | null;
}

/** Profit is price minus cost, margin is profit over price times 100, markup is profit over cost times 100. A loss is negative. */
export function profitMarginMarkup(cost: Dec, price: Dec): ProfitFigures {
  const profit = price.minus(cost);
  return {
    profit,
    margin: price.isZero() ? null : profit.div(price).times(100),
    markup: cost.isZero() ? null : profit.div(cost).times(100),
  };
}

/** The price that gives a margin of `marginPercent` on `cost`: cost / (1 - margin / 100). The margin must be below 100. */
export function priceForMargin(cost: Dec, marginPercent: Dec): Dec {
  if (marginPercent.gte(100)) {
    throw new MoneyInputError(
      FIELD_TARGET_MARGIN,
      'must be below 100 percent, a margin of 100 percent or more needs an endless price',
    );
  }
  return cost.div(new D(1).minus(marginPercent.div(100)));
}

/** The price that gives a markup of `markupPercent` on `cost`: cost x (1 + markup / 100). The markup must be at least -100. */
export function priceForMarkup(cost: Dec, markupPercent: Dec): Dec {
  if (markupPercent.lt(-100)) {
    throw new MoneyInputError(
      FIELD_TARGET_MARKUP,
      'must be at least -100 percent, a lower markup would give a negative price',
    );
  }
  return cost.times(new D(1).plus(markupPercent.div(100)));
}

/** The units that cover the fixed costs: the exact quotient and that quotient rounded up to a whole unit. */
export interface BreakEven {
  /** Unit price minus unit variable cost. */
  contribution: Dec;
  /** Fixed costs over the contribution, exactly. */
  exact: Dec;
  /** The exact quotient rounded up to the next whole unit (a count, not money rounding). */
  units: Dec;
}

/** Break-even units, or null when the unit price is at or below the unit variable cost so break-even is never reached. */
export function breakEvenUnits(fixed: Dec, unitPrice: Dec, unitCost: Dec): BreakEven | null {
  const contribution = unitPrice.minus(unitCost);
  if (!contribution.gt(0)) return null;
  const exact = fixed.div(contribution);
  return { contribution, exact, units: exact.ceil() };
}

export type ProfitMode = 'margin' | 'target-margin' | 'target-markup' | 'break-even';
const MODES: readonly ProfitMode[] = ['margin', 'target-margin', 'target-markup', 'break-even'];

/** The values the page holds, exactly as typed. Any of them may be left out. */
export interface ProfitTexts {
  /** `margin` (the default), `target-margin`, `target-markup` or `break-even`. */
  mode?: string;
  cost?: string;
  price?: string;
  targetMargin?: string;
  targetMarkup?: string;
  fixedCosts?: string;
  unitPrice?: string;
  unitCost?: string;
  /** Decimal places of margins, markups and the exact break-even quotient, 0 to 4, 2 by default. */
  decimals?: string;
  currency?: string;
}

/** One row of the page: `money` is shown with the currency, `percent` and `ratio` to the chosen decimal places, `count` as whole digits. */
export interface ProfitLine {
  label: string;
  value: string;
  kind: 'money' | 'percent' | 'ratio' | 'count';
}

export interface ProfitSummary {
  mode: ProfitMode;
  currency: string;
  /** Decimal places of the currency's smallest unit. */
  currencyDecimals: number;
  /** Decimal places of margins and markups. */
  decimals: number;
  /** The headline figure as plain decimal text (margin, price or whole units), or null when there is none (see `notes`). */
  result: string | null;
  lines: ProfitLine[];
  /** Plain statements about a missing figure or an unusual input. */
  notes: string[];
}

export interface ProfitResult {
  summary: ProfitSummary;
  /** The formula, the typed numbers put into it, and the result before and after rounding. */
  working: string;
}

/** A figure for the working: rounded half away from zero to 10 places with trailing zeros dropped. */
function exactText(x: Dec): string {
  return roundTo(x, WORKING_PLACES).toFixed();
}

/** What each mode needs, in the order it is read: the text and its field label. */
function needs(mode: ProfitMode, t: ProfitTexts): [string | undefined, string][] {
  switch (mode) {
    case 'margin':
      return [
        [t.cost, FIELD_COST],
        [t.price, FIELD_PRICE],
      ];
    case 'target-margin':
      return [
        [t.cost, FIELD_COST],
        [t.targetMargin, FIELD_TARGET_MARGIN],
      ];
    case 'target-markup':
      return [
        [t.cost, FIELD_COST],
        [t.targetMarkup, FIELD_TARGET_MARKUP],
      ];
    case 'break-even':
      return [
        [t.fixedCosts, FIELD_FIXED],
        [t.unitPrice, FIELD_UNIT_PRICE],
        [t.unitCost, FIELD_UNIT_COST],
      ];
  }
}

/** Works out the chosen figure from the page's typed values, or returns null when nothing the chosen mode needs is typed. */
export function calculateProfit(texts: ProfitTexts): ProfitResult | null {
  const modeText = texts.mode === undefined || isBlank(texts.mode) ? 'margin' : texts.mode.trim();
  const mode = MODES.find((m) => m === modeText);
  if (mode === undefined) {
    throw new MoneyInputError(
      FIELD_MODE,
      'choose profit, margin and markup, price for a target margin, price for a target markup or break-even units',
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

  const lines: ProfitLine[] = [];
  const notes: string[] = [];
  let working: string[] = [];
  let result: string | null = null;

  if (mode === 'margin') {
    const cost = amount(texts.cost, FIELD_COST);
    const price = amount(texts.price, FIELD_PRICE);
    const figures = profitMarginMarkup(cost, price);
    lines.push(
      { label: 'Cost', value: money(cost), kind: 'money' },
      { label: 'Price', value: money(price), kind: 'money' },
      { label: 'Profit', value: money(figures.profit), kind: 'money' },
    );
    working = [
      'Profit, margin and markup (no standards body publishes these definitions; they are the usual ones):',
      '  profit = price - cost',
      '  margin = profit / price x 100',
      '  markup = profit / cost x 100',
      '',
      'With your numbers:',
      `  profit = ${price.toFixed()} - ${cost.toFixed()} = ${exactText(figures.profit)}`,
      `  ${shownMoney(figures.profit)}`,
    ];
    if (figures.margin === null) {
      notes.push(
        'A price of 0 gives no margin: the margin divides the profit by the price, and 0 cannot be a divisor.',
      );
      working.push('  the price is 0, so there is no margin');
    } else {
      result = ratio(figures.margin);
      lines.push({ label: 'Margin', value: result, kind: 'percent' });
      working.push(
        `  margin = ${exactText(figures.profit)} / ${price.toFixed()} x 100 = ${exactText(figures.margin)} percent`,
        `  ${shownRatio(figures.margin, ' percent')}`,
      );
    }
    if (figures.markup === null) {
      notes.push('A cost of 0 gives no markup: the markup divides the profit by the cost, and 0 cannot be a divisor.');
      working.push('  the cost is 0, so there is no markup');
    } else {
      lines.push({ label: 'Markup', value: ratio(figures.markup), kind: 'percent' });
      working.push(
        `  markup = ${exactText(figures.profit)} / ${cost.toFixed()} x 100 = ${exactText(figures.markup)} percent`,
        `  ${shownRatio(figures.markup, ' percent')}`,
      );
    }
  } else if (mode === 'target-margin') {
    const cost = amount(texts.cost, FIELD_COST);
    const target = amount(texts.targetMargin, FIELD_TARGET_MARGIN, true);
    const price = priceForMargin(cost, target);
    const profit = price.minus(cost);
    result = money(price);
    lines.push(
      { label: 'Cost', value: money(cost), kind: 'money' },
      { label: 'Price', value: result, kind: 'money' },
      { label: 'Profit', value: money(profit), kind: 'money' },
    );
    working = [
      'Price for a target margin. The margin is (price - cost) / price, so solving for the price gives:',
      '  price = cost / (1 - target margin / 100)',
      '',
      'With your numbers:',
      `  price = ${cost.toFixed()} / (1 - ${target.toFixed()} / 100) = ${exactText(price)}`,
      `  ${shownMoney(price)}`,
      `  profit = price - cost = ${exactText(price)} - ${cost.toFixed()} = ${exactText(profit)}`,
    ];
    if (cost.isZero()) {
      notes.push('A cost of 0 gives no markup: the markup divides the profit by the cost, and 0 cannot be a divisor.');
      working.push('  the cost is 0, so there is no markup');
    } else {
      const markup = profit.div(cost).times(100);
      lines.push({ label: 'Markup', value: ratio(markup), kind: 'percent' });
      working.push(
        `  markup at that price = profit / cost x 100 = ${exactText(profit)} / ${cost.toFixed()} x 100 = ${exactText(markup)} percent`,
        `  ${shownRatio(markup, ' percent')}`,
      );
    }
  } else if (mode === 'target-markup') {
    const cost = amount(texts.cost, FIELD_COST);
    const target = amount(texts.targetMarkup, FIELD_TARGET_MARKUP, true);
    const price = priceForMarkup(cost, target);
    const profit = price.minus(cost);
    result = money(price);
    lines.push(
      { label: 'Cost', value: money(cost), kind: 'money' },
      { label: 'Price', value: result, kind: 'money' },
      { label: 'Profit', value: money(profit), kind: 'money' },
    );
    working = [
      'Price for a target markup. The markup is (price - cost) / cost, so solving for the price gives:',
      '  price = cost x (1 + target markup / 100)',
      '',
      'With your numbers:',
      `  price = ${cost.toFixed()} x (1 + ${target.toFixed()} / 100) = ${exactText(price)}`,
      `  ${shownMoney(price)}`,
      `  profit = price - cost = ${exactText(price)} - ${cost.toFixed()} = ${exactText(profit)}`,
    ];
    if (price.isZero()) {
      notes.push(
        'A price of 0 gives no margin: the margin divides the profit by the price, and 0 cannot be a divisor.',
      );
      working.push('  the price is 0, so there is no margin');
    } else {
      const margin = profit.div(price).times(100);
      lines.push({ label: 'Margin', value: ratio(margin), kind: 'percent' });
      working.push(
        `  margin at that price = profit / price x 100 = ${exactText(profit)} / ${exactText(price)} x 100 = ${exactText(margin)} percent`,
        `  ${shownRatio(margin, ' percent')}`,
      );
    }
  } else {
    const fixed = amount(texts.fixedCosts, FIELD_FIXED);
    const unitPrice = amount(texts.unitPrice, FIELD_UNIT_PRICE);
    const unitCost = amount(texts.unitCost, FIELD_UNIT_COST);
    const be = breakEvenUnits(fixed, unitPrice, unitCost);
    const contribution = unitPrice.minus(unitCost);
    lines.push({ label: 'Contribution per unit', value: money(contribution), kind: 'money' });
    working = [
      'Break-even units: each unit sold adds its price minus its variable cost toward the fixed costs.',
      '  contribution per unit = unit price - unit cost',
      '  break-even units = fixed costs / (unit price - unit cost)',
      '  whole units needed = break-even units rounded up to the next whole unit (rounding up, not money rounding)',
      '',
      'With your numbers:',
      `  contribution per unit = ${unitPrice.toFixed()} - ${unitCost.toFixed()} = ${exactText(contribution)}`,
    ];
    if (be === null) {
      notes.push(
        `Break-even is never reached: the unit price (${unitPrice.toFixed()}) is at or below the unit variable cost (${unitCost.toFixed()}), so each unit sold adds nothing toward the fixed costs.`,
      );
      working.push('  the unit price is at or below the unit cost, so break-even is never reached');
    } else {
      result = be.units.toFixed();
      lines.push(
        { label: 'Units before rounding up', value: ratio(be.exact), kind: 'ratio' },
        { label: 'Whole units needed (rounded up)', value: result, kind: 'count' },
      );
      working.push(
        `  break-even units = ${fixed.toFixed()} / (${unitPrice.toFixed()} - ${unitCost.toFixed()}) = ${exactText(be.exact)}`,
        `  ${shownRatio(be.exact, ' units')}`,
        `  rounded up to the next whole unit: ${result} units`,
      );
    }
  }

  return {
    summary: { mode, currency, currencyDecimals: dp, decimals, result, lines, notes },
    working: working.join('\n'),
  };
}
