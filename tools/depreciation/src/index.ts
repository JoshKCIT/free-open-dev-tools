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
  parseRows,
  cellDecimal,
  roundTo,
  toPlain,
  minorUnits,
} from './money';

export { meta, D, MoneyInputError, isBlank, formatMoney };
export type { Dec };

/** The longest useful life accepted, in years. */
export const MAX_YEARS = 100;
/** The most yearly unit counts accepted for units of production. */
export const MAX_UNIT_ROWS = 100;
/** The largest declining balance factor accepted. */
export const MAX_FACTOR = 10;

const FIELD_METHOD = 'Method';
const FIELD_COST = 'Cost';
const FIELD_SALVAGE = 'Salvage value';
const FIELD_LIFE = 'Useful life (years)';
const FIELD_FACTOR = 'Declining balance factor';
const FIELD_UNITS = 'Units each year';
const FIELD_TOTAL_UNITS = 'Total units over the asset life';
const FIELD_CURRENCY = 'Currency (ISO 4217 code)';

const ZERO = new D(0);
const ONE = new D(1);
/** A book value this close to the salvage value counts as having reached it (40 digits are kept, so rounding noise is far smaller). */
const REACHED = new D('1e-30');

/** One year of a schedule as plain decimal strings at the currency's smallest unit. */
export type DepreciationRow = {
  year: number;
  opening: string;
  depreciation: string;
  accumulated: string;
  closing: string;
};

const lesser = (a: Dec, b: Dec): Dec => (a.lt(b) ? a : b);

/** An exact value shown to at most 12 places with no trailing zeros, for the working. */
const plain12 = (x: Dec): string => new D(toPlain(x, 12)).toFixed();

/**
 * Turns exact yearly amounts into table rows. Each year is rounded half away from zero to `dp` places and never
 * takes more than what is left above the salvage value. When the method fully depreciates the asset, the last year
 * that has an amount takes whatever is left, so the years add up to exactly the opening book value minus the
 * salvage value. Opening, accumulated and closing values come from the rounded years.
 */
function buildRows(openingBook: Dec, salvage: Dec, exact: Dec[], dp: number, fully: boolean): DepreciationRow[] {
  let remaining = openingBook.gt(salvage) ? openingBook.minus(salvage) : ZERO;
  let lastPositive = -1;
  exact.forEach((amount, i) => {
    if (amount.gt(0)) lastPositive = i;
  });
  let book = openingBook;
  let accumulated = ZERO;
  return exact.map((amount, i) => {
    let depreciation = fully && i === lastPositive ? remaining : roundTo(amount, dp);
    if (depreciation.gt(remaining)) depreciation = remaining;
    if (depreciation.isNeg()) depreciation = ZERO;
    remaining = remaining.minus(depreciation);
    const opening = book;
    book = book.minus(depreciation);
    accumulated = accumulated.plus(depreciation);
    return {
      year: i + 1,
      opening: toPlain(opening, dp),
      depreciation: toPlain(depreciation, dp),
      accumulated: toPlain(accumulated, dp),
      closing: toPlain(book, dp),
    };
  });
}

/** The amount that can be depreciated: cost minus salvage, or 0 when the salvage is not below the cost. */
function depreciable(cost: Dec, salvage: Dec): Dec {
  return cost.gt(salvage) ? cost.minus(salvage) : ZERO;
}

/**
 * Straight line, OpenFormula 6.12.45 SLN: (cost - salvage) / life in every year. The specification's syntax line for
 * SLN misnames it DDB; its parameters (Cost, Salvage, LifeTime) are what is followed here. The last year carries the
 * rounding residue so the years add up to exactly cost minus salvage.
 */
export function straightLine(cost: Dec, salvage: Dec, life: number, dp: number = 2): DepreciationRow[] {
  const yearly = depreciable(cost, salvage).div(life);
  return buildRows(
    cost,
    salvage,
    Array.from({ length: life }, () => yearly),
    dp,
    true,
  );
}

interface DeclineRun {
  /** The exact amount of each period. */
  amounts: Dec[];
  /** The exact book value at the start of each period. */
  openings: Dec[];
  /** The first period where the straight line amount was equal or greater and was taken, or null. */
  switchPeriod: number | null;
  finalBook: Dec;
}

/**
 * The declining balance engine. Each period the declining amount is min(book x rate, book - salvage) (OpenFormula
 * 6.12.14 DDB, with the rate capped at 1). With the switch the straight line amount, (book - salvage) / remaining
 * life and the whole of book - salvage when the remaining life is below 1, is taken instead when it is equal or
 * greater (6.12.50 VDB with noSwitch false; IRS Publication 946: switch "in the first year for which it will give an
 * equal or greater deduction"). The remaining life falls by 1 each period and may start fractional.
 */
function declineRun(
  openingBook: Dec,
  salvage: Dec,
  rate: Dec,
  remainingLife: Dec,
  periods: number,
  switchToStraightLine: boolean,
): DeclineRun {
  const capped = rate.gt(1) ? ONE : rate;
  let book = openingBook;
  let life = remainingLife;
  let switchPeriod: number | null = null;
  const amounts: Dec[] = [];
  const openings: Dec[] = [];
  for (let period = 1; period <= periods; period++) {
    const room = book.gt(salvage) ? book.minus(salvage) : ZERO;
    const declined = lesser(book.times(capped), room);
    let amount = declined;
    if (switchToStraightLine) {
      const straight = life.lt(1) ? room : lesser(room.div(life), room);
      if (straight.gt(0) && straight.gte(declined)) {
        amount = straight;
        if (switchPeriod === null) switchPeriod = period;
      }
    }
    openings.push(book);
    amounts.push(amount);
    book = book.minus(amount);
    life = life.minus(1);
  }
  return { amounts, openings, switchPeriod, finalBook: book };
}

/** Whether the book value after the last period has reached the salvage value, so the schedule fully depreciates. */
function reachedSalvage(run: DeclineRun, salvage: Dec): boolean {
  return run.finalBook.minus(salvage).abs().lt(REACHED);
}

/**
 * The lower-level declining balance schedule: from an opening book value, with a yearly rate as a fraction (0.4 is
 * 40 percent) and a remaining life that may be fractional, for a number of periods. Reproduces a schedule that
 * starts part way through an asset's life, such as years 2 to 6 of IRS Publication 946 chapter 4 Example 1.
 */
export function decliningRows(
  openingBook: Dec,
  salvage: Dec,
  rate: Dec,
  remainingLife: Dec,
  periods: number,
  switchToStraightLine: boolean,
  dp: number = 2,
): DepreciationRow[] {
  const run = declineRun(openingBook, salvage, rate, remainingLife, periods, switchToStraightLine);
  return buildRows(openingBook, salvage, run.amounts, dp, reachedSalvage(run, salvage));
}

export interface DecliningInput {
  cost: Dec;
  salvage: Dec;
  /** Useful life in whole years. */
  life: number;
  /** The factor over the life gives the yearly rate: 2 is the double rate. */
  factor: Dec;
  switchToStraightLine: boolean;
}

/** Declining balance by a factor over the useful life, with or without the switch to straight line. */
export function decliningBalance(input: DecliningInput, dp: number = 2): DepreciationRow[] {
  const rate = input.factor.div(input.life);
  return decliningRows(input.cost, input.salvage, rate, new D(input.life), input.life, input.switchToStraightLine, dp);
}

/** The sum of the years digits amounts of OpenFormula 6.12.46 SYD, exact, one for each year. */
function sydAmounts(cost: Dec, salvage: Dec, life: number): Dec[] {
  const room = depreciable(cost, salvage);
  const digits = (life + 1) * life;
  return Array.from({ length: life }, (_, i) =>
    room
      .times(life - i)
      .times(2)
      .div(digits),
  );
}

/**
 * Sum of the years digits, OpenFormula 6.12.46 SYD: (cost - salvage) x (life + 1 - period) x 2 / ((life + 1) x life).
 * The last year carries the rounding residue.
 */
export function sumOfYearsDigits(cost: Dec, salvage: Dec, life: number, dp: number = 2): DepreciationRow[] {
  return buildRows(cost, salvage, sydAmounts(cost, salvage, life), dp, true);
}

/** The exact units of production amounts, capped so they never add up to more than cost minus salvage. */
function unitsAmounts(cost: Dec, salvage: Dec, totalUnits: Dec, unitsByYear: Dec[]): Dec[] {
  const room = depreciable(cost, salvage);
  let used = ZERO;
  return unitsByYear.map((units) => {
    const amount = lesser(room.times(units).div(totalUnits), room.minus(used));
    used = used.plus(amount);
    return amount.isNeg() ? ZERO : amount;
  });
}

/**
 * Units of production: (cost - salvage) x units used in the year / total units over the asset's life, one row for
 * each yearly count. Depreciation stops at cost minus salvage. When the units add up to the total the last year
 * carries the rounding residue; when they add up to less the asset stays above its salvage value.
 */
export function unitsOfProduction(
  cost: Dec,
  salvage: Dec,
  totalUnits: Dec,
  unitsByYear: Dec[],
  dp: number = 2,
): DepreciationRow[] {
  const fully = unitsByYear.reduce((total, units) => total.plus(units), ZERO).gte(totalUnits);
  return buildRows(cost, salvage, unitsAmounts(cost, salvage, totalUnits, unitsByYear), dp, fully);
}

export type DepreciationMethod = 'straight' | 'declining' | 'syd' | 'units';

const METHOD_LABELS: Record<DepreciationMethod, string> = {
  straight: 'Straight line',
  declining: 'Declining balance, switching to straight line',
  syd: 'Sum of the years digits',
  units: 'Units of production',
};

export interface DepreciationTexts {
  method?: string;
  cost?: string;
  salvage?: string;
  life?: string;
  factor?: string;
  units?: string;
  totalUnits?: string;
  currency?: string;
}

export interface DepreciationSummary {
  method: DepreciationMethod;
  methodLabel: string;
  currency: string;
  /** Decimal places of the currency's smallest unit. */
  decimals: number;
  cost: string;
  salvage: string;
  /** Cost minus salvage. */
  depreciableAmount: string;
  /** Years in the schedule: the useful life, or the number of yearly unit counts. */
  life: number;
  totalDepreciation: string;
  finalBookValue: string;
  /** The declining balance factor as typed, or null for the other methods. */
  factor: string | null;
  /** The year the schedule switches to straight line, or null when it does not (or the method has no switch). */
  switchYear: number | null;
  /** Units of production only: the units typed and the total, as plain decimals. */
  unitsUsed: string | null;
  totalUnits: string | null;
}

export interface DepreciationResult {
  summary: DepreciationSummary;
  rows: DepreciationRow[];
  /** The formulas, the typed numbers put into them, and the specification sections they follow. */
  working: string;
}

function parseAmount(text: string | undefined, field: string, currency: string, dp: number): Dec {
  const value = parseDecimal(text ?? '', field);
  if (value.decimalPlaces() > dp) {
    throw new MoneyInputError(
      field,
      `${currency} amounts have at most ${dp} decimal places, so the years can add up to the last unit`,
    );
  }
  return value;
}

function parseMethod(text: string | undefined): DepreciationMethod {
  const t = text === undefined || isBlank(text) ? 'straight' : text.trim();
  if (t === 'straight' || t === 'declining' || t === 'syd' || t === 'units') return t;
  throw new MoneyInputError(
    FIELD_METHOD,
    'choose straight line, declining balance, sum of the years digits or units of production',
  );
}

/** Builds the working: the formula, the typed numbers put into it, and the specification sections. */
function workingFor(
  method: DepreciationMethod,
  money: (x: Dec) => string,
  cost: Dec,
  salvage: Dec,
  life: number,
  currency: string,
  dp: number,
  extra: {
    factor?: Dec;
    rate?: Dec;
    run?: DeclineRun;
    unswitched?: DepreciationRow[];
    units?: Dec[];
    totalUnits?: Dec;
  },
): string {
  const room = depreciable(cost, salvage);
  const lines: string[] = [
    `Cost = ${money(cost)}, salvage value = ${money(salvage)}, so the amount to depreciate is cost - salvage = ${money(room)}.`,
    '',
  ];
  if (method === 'straight') {
    lines.push(
      "Straight line, OpenFormula 6.12.45 SLN (the specification's syntax line names it DDB by mistake; its parameters Cost, Salvage and LifeTime and its description are followed):",
      '  depreciation each year = (cost - salvage) / life',
      `  = (${money(cost)} - ${money(salvage)}) / ${life} = ${plain12(room.div(life))} (shown to 12 places, 40 digits are used)`,
    );
  } else if (method === 'declining') {
    const { factor, rate, run, unswitched } = extra as Required<
      Pick<typeof extra, 'factor' | 'rate' | 'run' | 'unswitched'>
    >;
    lines.push(
      'Declining balance, OpenFormula 6.12.14 DDB and 6.12.50 VDB:',
      '  rate = factor / life, capped at 1 (6.12.14: if rate >= 1 then rate = 1)',
      '  declining amount each year = min(book value at the start of the year x rate, book value at the start - salvage)',
      '  straight line amount each year = (book value at the start - salvage) / remaining life',
      '  With the switch (6.12.50 VDB with noSwitch false; IRS Publication 946: switch to the straight line method beginning in the first year for which it will give an equal or greater deduction) each year takes the straight line amount when it is equal or greater, and the declining amount otherwise.',
      '',
      'With your numbers:',
      `  rate = ${factor.toFixed()} / ${life} = ${plain12(rate)}${rate.gt(1) ? ', capped at 1' : ''}`,
    );
    const book = run.openings[0]!;
    const declined = lesser(book.times(rate.gt(1) ? ONE : rate), depreciable(book, salvage));
    const straight = lesser(depreciable(book, salvage).div(life), depreciable(book, salvage));
    lines.push(
      `  year 1: declining ${money(book)} x ${plain12(rate.gt(1) ? ONE : rate)} = ${money(declined)}, straight line (${money(book)} - ${money(salvage)}) / ${life} = ${money(straight)}`,
    );
    if (run.switchPeriod === null) {
      lines.push('  The declining amount is larger in every year, so the schedule does not switch to straight line.');
    } else {
      const p = run.switchPeriod;
      const start = run.openings[p - 1]!;
      const remaining = life - (p - 1);
      lines.push(
        `  The schedule switches to straight line in year ${p}, the first year where it is equal or greater: book value at the start ${money(start)}, (${money(start)} - ${money(salvage)}) / ${remaining} remaining years = ${money(run.amounts[p - 1]!)}${p < life ? ', and every year after it follows straight line' : ''}.`,
      );
    }
    const left = unswitched[unswitched.length - 1]!;
    lines.push(
      '',
      `  For comparison, without the switch (6.12.14 DDB alone) the years are ${unswitched.map((row) => row.depreciation).join(', ')}, leaving a book value of ${left.closing}${new D(left.closing).gt(salvage) ? `, which is ${money(new D(left.closing).minus(salvage))} above the salvage value` : ''}.`,
    );
  } else if (method === 'syd') {
    const digits = (life * (life + 1)) / 2;
    lines.push(
      'Sum of the years digits, OpenFormula 6.12.46 SYD:',
      '  depreciation in year p = (cost - salvage) x (life + 1 - p) x 2 / ((life + 1) x life)',
      `  the digits 1 to ${life} add up to ${life} x ${life + 1} / 2 = ${digits}`,
      `  year 1 = ${money(room)} x (${life} + 1 - 1) x 2 / ((${life} + 1) x ${life}) = ${toPlain(
        room
          .times(life)
          .times(2)
          .div((life + 1) * life),
        12,
      )}`,
      `  year ${life} = ${money(room)} x (${life} + 1 - ${life}) x 2 / ((${life} + 1) x ${life}) = ${plain12(room.times(2).div((life + 1) * life))}`,
    );
  } else {
    const { units = [], totalUnits = ZERO } = extra;
    const used = units.reduce((total, u) => total.plus(u), ZERO);
    lines.push(
      'Units of production (the specification has no function for it; this is the usual definition):',
      '  depreciation in a year = (cost - salvage) x units used in the year / total units over the asset life, stopping once cost - salvage has been depreciated',
      `  year 1 = ${money(room)} x ${units[0]!.toFixed()} / ${totalUnits.toFixed()} = ${plain12(room.times(units[0]!).div(totalUnits))}`,
      `  units typed: ${used.toFixed()} of ${totalUnits.toFixed()} in ${units.length} year${units.length === 1 ? '' : 's'}`,
    );
    if (used.lt(totalUnits)) {
      lines.push('  The units typed are fewer than the total, so the asset is left above its salvage value.');
    } else if (used.gt(totalUnits)) {
      lines.push(
        '  The units typed are more than the total, so depreciation stops at cost - salvage and later years show 0.',
      );
    }
  }
  lines.push(
    '',
    `Each year is rounded half away from zero to ${dp} decimal places, the smallest unit of ${currency}. Where the method fully depreciates the asset, the last year takes cost - salvage minus the earlier rounded years, so the schedule adds up exactly.`,
  );
  return lines.join('\n');
}

/** Builds a depreciation schedule from the page's typed values, or returns null when every number field is blank. */
export function calculateDepreciation(texts: DepreciationTexts): DepreciationResult | null {
  const method = parseMethod(texts.method);
  const costText = texts.cost ?? '';
  const salvageText = texts.salvage ?? '';
  const lifeText = texts.life ?? '';
  const unitsText = texts.units ?? '';
  const totalUnitsText = texts.totalUnits ?? '';
  const noInput =
    isBlank(costText) &&
    isBlank(salvageText) &&
    (method === 'units' ? isBlank(unitsText) && isBlank(totalUnitsText) : isBlank(lifeText));
  if (noInput) return null;

  const currency = parseCurrency(texts.currency ?? 'USD', FIELD_CURRENCY);
  const dp = minorUnits(currency);
  const cost = parseAmount(costText, FIELD_COST, currency, dp);
  if (!cost.gt(0)) throw new MoneyInputError(FIELD_COST, 'must be more than 0, type what the asset cost');
  const salvage = isBlank(salvageText) ? ZERO : parseAmount(salvageText, FIELD_SALVAGE, currency, dp);
  if (salvage.gt(cost)) {
    throw new MoneyInputError(FIELD_SALVAGE, 'cannot be more than the cost, type what the asset is worth at the end');
  }
  const money = (x: Dec) => toPlain(x, dp);

  let rows: DepreciationRow[];
  let life = 0;
  let factorShown: string | null = null;
  let switchYear: number | null = null;
  let unitsUsed: string | null = null;
  let totalUnitsShown: string | null = null;
  let working: string;

  if (method === 'units') {
    const lines = parseRows(unitsText, FIELD_UNITS, { columns: ['units'], required: 1, maxRows: MAX_UNIT_ROWS });
    if (lines.length === 0) {
      throw new MoneyInputError(FIELD_UNITS, 'missing, type the units used in each year, one number per line');
    }
    const units = lines.map((row) => cellDecimal(row, 0, FIELD_UNITS, 'units'));
    const totalUnits = parseDecimal(totalUnitsText, FIELD_TOTAL_UNITS);
    if (!totalUnits.gt(0)) {
      throw new MoneyInputError(
        FIELD_TOTAL_UNITS,
        'must be more than 0, type the units the asset can produce in its life',
      );
    }
    life = units.length;
    rows = unitsOfProduction(cost, salvage, totalUnits, units, dp);
    unitsUsed = units.reduce((total, u) => total.plus(u), ZERO).toFixed();
    totalUnitsShown = totalUnits.toFixed();
    working = workingFor(method, money, cost, salvage, life, currency, dp, { units, totalUnits });
  } else {
    life = parseCount(lifeText, FIELD_LIFE, 1, MAX_YEARS);
    if (method === 'straight') {
      rows = straightLine(cost, salvage, life, dp);
      working = workingFor(method, money, cost, salvage, life, currency, dp, {});
    } else if (method === 'syd') {
      rows = sumOfYearsDigits(cost, salvage, life, dp);
      working = workingFor(method, money, cost, salvage, life, currency, dp, {});
    } else {
      const factorText = texts.factor ?? '';
      const factor = isBlank(factorText) ? new D(2) : parseDecimal(factorText, FIELD_FACTOR);
      if (!factor.gt(0) || factor.gt(MAX_FACTOR)) {
        throw new MoneyInputError(
          FIELD_FACTOR,
          `must be more than 0 and at most ${MAX_FACTOR}, 2 is the usual double rate`,
        );
      }
      const rate = factor.div(life);
      const run = declineRun(cost, salvage, rate, new D(life), life, true);
      rows = buildRows(cost, salvage, run.amounts, dp, reachedSalvage(run, salvage));
      const unswitched = decliningBalance({ cost, salvage, life, factor, switchToStraightLine: false }, dp);
      factorShown = factor.toFixed();
      switchYear = run.switchPeriod;
      working = workingFor(method, money, cost, salvage, life, currency, dp, { factor, rate, run, unswitched });
    }
  }

  const last = rows[rows.length - 1]!;
  return {
    summary: {
      method,
      methodLabel: METHOD_LABELS[method],
      currency,
      decimals: dp,
      cost: money(cost),
      salvage: money(salvage),
      depreciableAmount: money(depreciable(cost, salvage)),
      life,
      totalDepreciation: last.accumulated,
      finalBookValue: last.closing,
      factor: factorShown,
      switchYear,
      unitsUsed,
      totalUnits: totalUnitsShown,
    },
    rows,
    working,
  };
}
