import meta from './meta.json';
import {
  D,
  type Dec,
  MoneyInputError,
  isBlank,
  formatMoney,
  parseCurrency,
  parseRows,
  cellDecimal,
  cellText,
  roundTo,
  toPlain,
  minorUnits,
} from './money';

export { meta, D, MoneyInputError, isBlank, formatMoney };
export type { Dec };

/** The most amount lines accepted. */
export const MAX_LINES = 200;
/** The most tax components accepted. */
export const MAX_COMPONENTS = 10;
/** Longest description or tax name accepted, so a table cell stays readable. */
const MAX_DESCRIPTION = 60;
const MAX_NAME = 40;
/** Decimal places used for the unrounded figures in the working. */
const WORKING_PLACES = 10;
/** The most lines whose arithmetic is written out in the working; the table shows all of them. */
const WORKING_LINES = 10;

const FIELD_MODE = 'Mode';
const FIELD_AMOUNTS = 'Amounts';
const FIELD_RATES = 'Tax rates';
const FIELD_ROUNDING = 'Rounding';
const FIELD_CURRENCY = 'Currency (ISO 4217 code)';

const HUNDRED = new D(100);

/** One amount line: an optional description, the amount, and its 1-based line number in the text. */
export interface AmountLine {
  description: string;
  amount: Dec;
  line: number;
}

/** One tax component: its name, its rate in percent (0 to 100) and its 1-based line number in the text. */
export interface TaxComponent {
  name: string;
  rate: Dec;
  line: number;
}

/**
 * Reads the amounts text: one amount per line, either `amount` or `description | amount`. Amounts are 0 or more and
 * have no more decimal places than the currency's smallest unit. Up to 200 lines; a problem names the line and column.
 */
export function parseAmountLines(text: string, currency: string): AmountLine[] {
  const places = minorUnits(currency);
  const rows = parseRows(text, FIELD_AMOUNTS, { columns: ['description', 'amount'], required: 1, maxRows: MAX_LINES });
  return rows.map((row) => {
    const described = row.cells.length > 1;
    const index = described ? 1 : 0;
    const description = described ? cellText(row, 0) : '';
    if (description.length > MAX_DESCRIPTION) {
      throw new MoneyInputError(FIELD_AMOUNTS, `description: at most ${MAX_DESCRIPTION} characters`, {
        line: row.line,
        column: row.starts[0] ?? 1,
      });
    }
    const amount = cellDecimal(row, index, FIELD_AMOUNTS, 'amount');
    if (amount.dp() > places) {
      throw new MoneyInputError(
        FIELD_AMOUNTS,
        `amount: at most ${places} decimal places for ${currency}, the smallest unit of ${currency}`,
        { line: row.line, column: row.starts[index] ?? 1 },
      );
    }
    return { description, amount, line: row.line };
  });
}

/**
 * Reads the tax rates text: one component per line, either `rate` or `name | rate`, the rate in percent from 0 to 100.
 * Up to 10 lines; a problem names the line and column. A component with no name is called Tax (or Tax 1, Tax 2, ...
 * when there are several rows).
 */
export function parseTaxComponents(text: string): TaxComponent[] {
  const rows = parseRows(text, FIELD_RATES, { columns: ['name', 'rate'], required: 1, maxRows: MAX_COMPONENTS });
  return rows.map((row, position) => {
    const named = row.cells.length > 1;
    const index = named ? 1 : 0;
    const typedName = named ? cellText(row, 0) : '';
    if (typedName.length > MAX_NAME) {
      throw new MoneyInputError(FIELD_RATES, `name: at most ${MAX_NAME} characters`, {
        line: row.line,
        column: row.starts[0] ?? 1,
      });
    }
    const rate = cellDecimal(row, index, FIELD_RATES, 'rate');
    if (rate.gt(HUNDRED)) {
      throw new MoneyInputError(FIELD_RATES, 'rate: must be from 0 to 100 percent', {
        line: row.line,
        column: row.starts[index] ?? 1,
      });
    }
    const fallback = rows.length === 1 ? 'Tax' : `Tax ${position + 1}`;
    return { name: typedName === '' ? fallback : typedName, rate, line: row.line };
  });
}

function gcd(a: Dec, b: Dec): Dec {
  let x = a;
  let y = b;
  while (!y.isZero()) {
    const rest = x.mod(y);
    x = y;
    y = rest;
  }
  return x;
}

/**
 * The VAT fraction for a rate in percent, as reduced fraction text: rate / (100 + rate), as HMRC VAT Notice 700 section
 * 7.3.1 gives it (20 is 1/6, 5 is 1/21, 12.5 is 1/9). Worked out with whole numbers: both parts are scaled by a power
 * of ten until they are whole, then divided by their greatest common divisor.
 */
export function vatFraction(ratePercent: Dec): string {
  const scale = new D(10).pow(ratePercent.dp());
  const numerator = ratePercent.times(scale);
  const denominator = ratePercent.plus(HUNDRED).times(scale);
  const divisor = gcd(numerator, denominator);
  return `${numerator.div(divisor).toFixed()}/${denominator.div(divisor).toFixed()}`;
}

/** `total` rounds each component once on the total of all lines (the default); `line` rounds every line's tax. */
export type Rounding = 'total' | 'line';
const ROUNDINGS: readonly Rounding[] = ['total', 'line'];

/** One line of a result. `taxes` holds one tax per component, each rounded to the minor unit for display. */
export interface TaxRow {
  line: number;
  description: string;
  net: Dec;
  taxes: Dec[];
  gross: Dec;
  /** The tax per component before rounding. */
  exactTaxes: Dec[];
}

export interface TaxTotals {
  net: Dec;
  /** One per component: the exact sum rounded once (`total`) or the sum of the rounded lines (`line`). */
  taxes: Dec[];
  tax: Dec;
  gross: Dec;
}

export interface TaxResult {
  mode: 'add' | 'extract';
  rounding: Rounding;
  rows: TaxRow[];
  totals: TaxTotals;
  /** The exact tax per component summed over all lines, before any rounding. */
  exactTaxes: Dec[];
}

function sum(values: readonly Dec[]): Dec {
  return values.reduce((total, value) => total.plus(value), new D(0));
}

function compute(
  mode: 'add' | 'extract',
  lines: readonly AmountLine[],
  components: readonly TaxComponent[],
  rounding: Rounding,
  currency: string,
): TaxResult {
  const places = minorUnits(currency);
  const ratesSum = sum(components.map((c) => c.rate));
  const divisor = ratesSum.plus(HUNDRED);
  const rows: TaxRow[] = lines.map((l) => {
    // Adding: each component's tax is net x rate / 100. Taking out: net x rate / 100 with net = gross / (1 + R / 100)
    // is gross x rate / (100 + R), where R is the sum of the rates.
    const exactTaxes = components.map((c) =>
      mode === 'add' ? l.amount.times(c.rate).div(HUNDRED) : l.amount.times(c.rate).div(divisor),
    );
    const taxes = exactTaxes.map((t) => roundTo(t, places));
    const tax = sum(taxes);
    return mode === 'add'
      ? { line: l.line, description: l.description, net: l.amount, taxes, gross: l.amount.plus(tax), exactTaxes }
      : { line: l.line, description: l.description, net: l.amount.minus(tax), taxes, gross: l.amount, exactTaxes };
  });
  const exactTaxes = components.map((_, i) => sum(rows.map((r) => r.exactTaxes[i] ?? new D(0))));
  const taxes = components.map((_, i) =>
    rounding === 'total' ? roundTo(exactTaxes[i] ?? new D(0), places) : sum(rows.map((r) => r.taxes[i] ?? new D(0))),
  );
  const tax = sum(taxes);
  const totals: TaxTotals =
    mode === 'add'
      ? { net: sum(rows.map((r) => r.net)), taxes, tax, gross: sum(rows.map((r) => r.net)).plus(tax) }
      : { net: sum(rows.map((r) => r.gross)).minus(tax), taxes, tax, gross: sum(rows.map((r) => r.gross)) };
  return { mode, rounding, rows, totals, exactTaxes };
}

/**
 * Adds tax to net amounts. Each component's tax is net x rate / 100 on the net amount (components are not compounded).
 * `total` adds the exact tax of each component over all lines and rounds once; `line` rounds each line's tax and the
 * total is the sum of the rounded lines. Rounding is half away from zero to the currency's smallest unit.
 */
export function addTax(
  lines: readonly AmountLine[],
  components: readonly TaxComponent[],
  rounding: Rounding,
  currency: string,
): TaxResult {
  return compute('add', lines, components, rounding, currency);
}

/**
 * Takes tax out of gross amounts. With R the rates added together, the tax inside a gross amount is gross x R / (100 + R)
 * (the VAT fraction) and each component's share is gross x rate / (100 + R). Rounded taxes are taken from the gross, so
 * net plus tax equals gross exactly on every line (and on the totals).
 */
export function extractTax(
  lines: readonly AmountLine[],
  components: readonly TaxComponent[],
  rounding: Rounding,
  currency: string,
): TaxResult {
  return compute('extract', lines, components, rounding, currency);
}

export type SalesTaxMode = 'add' | 'extract';
const MODES: readonly SalesTaxMode[] = ['add', 'extract'];

/** The values the page holds, exactly as typed. Any of them may be left out. */
export interface SalesTaxTexts {
  /** `add` (the default) or `extract`. */
  mode?: string;
  /** One amount per line: `amount` or `description | amount`. */
  lines?: string;
  /** One component per line: `rate` or `name | rate`, in percent. */
  rates?: string;
  /** `total` (the default) or `line`. */
  rounding?: string;
  currency?: string;
}

/** One line of the page's table, every figure as plain decimal text at the currency's decimal places. */
export interface SalesTaxRow {
  line: number;
  description: string;
  net: string;
  taxes: string[];
  gross: string;
}

export interface SalesTaxSummary {
  mode: SalesTaxMode;
  rounding: Rounding;
  currency: string;
  /** Decimal places of the currency's smallest unit. */
  currencyDecimals: number;
  components: { name: string; rate: string }[];
  rows: SalesTaxRow[];
  totals: { net: string; taxes: string[]; tax: string; gross: string };
  /** The VAT fraction as reduced text such as 1/6, only for one component when taking tax out; otherwise null. */
  fraction: string | null;
  notes: string[];
}

export interface SalesTaxResult {
  summary: SalesTaxSummary;
  /** The formulas, the typed numbers put into them, and how the rounding was done. */
  working: string;
}

/** A figure for the working: rounded half away from zero to 10 places with trailing zeros dropped. */
function exactText(x: Dec): string {
  return roundTo(x, WORKING_PLACES).toFixed();
}

/** Adds or removes tax on the amounts typed, with the rates typed, or returns null when both text boxes are blank. */
export function calculateSalesTax(texts: SalesTaxTexts): SalesTaxResult | null {
  const modeText = texts.mode === undefined || isBlank(texts.mode) ? 'add' : texts.mode.trim();
  const mode = MODES.find((m) => m === modeText);
  if (mode === undefined) {
    throw new MoneyInputError(FIELD_MODE, 'choose add tax to net amounts or take tax out of gross amounts');
  }
  const linesText = texts.lines ?? '';
  const ratesText = texts.rates ?? '';
  if (isBlank(linesText) && isBlank(ratesText)) return null;

  const currency = parseCurrency(texts.currency ?? 'USD', FIELD_CURRENCY);
  const places = minorUnits(currency);
  const roundingText = texts.rounding === undefined || isBlank(texts.rounding) ? 'total' : texts.rounding.trim();
  const rounding = ROUNDINGS.find((r) => r === roundingText);
  if (rounding === undefined) {
    throw new MoneyInputError(FIELD_ROUNDING, 'choose round on the total or round each line');
  }
  if (isBlank(linesText)) throw new MoneyInputError(FIELD_AMOUNTS, 'missing, type an amount such as 2.40');
  if (isBlank(ratesText)) throw new MoneyInputError(FIELD_RATES, 'missing, type a rate such as VAT | 20');
  const lines = parseAmountLines(linesText, currency);
  const components = parseTaxComponents(ratesText);

  const result =
    mode === 'add' ? addTax(lines, components, rounding, currency) : extractTax(lines, components, rounding, currency);
  const money = (x: Dec) => toPlain(x, places);
  const summaryRows: SalesTaxRow[] = result.rows.map((r) => ({
    line: r.line,
    description: r.description,
    net: money(r.net),
    taxes: r.taxes.map(money),
    gross: money(r.gross),
  }));
  const totals = {
    net: money(result.totals.net),
    taxes: result.totals.taxes.map(money),
    tax: money(result.totals.tax),
    gross: money(result.totals.gross),
  };
  const single = components.length === 1 ? components[0] : undefined;
  const fraction = mode === 'extract' && single !== undefined ? vatFraction(single.rate) : null;

  const notes: string[] = [];
  if (rounding === 'total') {
    const linesDiffer =
      !sum(result.rows.map((r) => r.net)).eq(result.totals.net) ||
      !sum(result.rows.map((r) => sum(r.taxes))).eq(result.totals.tax) ||
      !sum(result.rows.map((r) => r.gross)).eq(result.totals.gross);
    if (linesDiffer) {
      notes.push(
        'Rounding on the total: each line is shown rounded, but the total is worked out from the exact amounts and rounded once, so the lines may not add up to the total.',
      );
    }
  }
  notes.push(
    'The HMRC concession (VAT Notice 700 section 17.5) that lets the total VAT on an invoice be rounded down to a whole penny is not applied: every rounding here is half away from zero.',
    'The rates and the rounding rule are the ones you chose; whether they match the rules where you are is yours to check.',
  );

  const rateText = (c: TaxComponent) => `${c.name} ${c.rate.toFixed()}`;
  const working: string[] = [];
  if (mode === 'add') {
    working.push(
      'Add tax to net amounts. No tax rates are built in: the rates are the ones you typed.',
      '  tax of one component on a line = net x rate / 100 (each component applies to the net amount, not on top of another)',
      '  gross = net + tax',
    );
  } else {
    working.push('Take tax out of gross amounts. No tax rates are built in: the rates are the ones you typed.');
    if (single !== undefined && fraction !== null) {
      const rate = single.rate.toFixed();
      working.push(
        'The VAT fraction (HMRC VAT Notice 700 section 7.3.1) is the share of a price that is VAT when the price already includes it:',
        '  VAT fraction = rate / (100 + rate)',
        `  VAT fraction at ${rate} percent = ${rate} / (100 + ${rate}) = ${fraction}`,
      );
    }
    const ratesSum = sum(components.map((c) => c.rate));
    working.push(
      single !== undefined
        ? `  R = ${single.rate.toFixed()} (the rate)`
        : `  R = ${components.map((c) => c.rate.toFixed()).join(' + ')} = ${ratesSum.toFixed()} (the rates added together, each applying to the net amount)`,
      '  tax inside a gross amount = gross x R / (100 + R)',
      '  net = gross / (1 + R / 100)',
      '  each component takes its share: gross x rate / (100 + R)',
    );
  }
  working.push(
    rounding === 'total'
      ? `Rounding on the total: the exact tax of each component is added up over all lines and rounded once, half away from zero to ${places} decimal places (the smallest unit of ${currency}).`
      : `Rounding each line: the tax of each component on each line is rounded half away from zero to ${places} decimal places (the smallest unit of ${currency}), and the total is the sum of the rounded lines.`,
    '',
    'With your numbers:',
  );
  const divisor = sum(components.map((c) => c.rate)).plus(HUNDRED);
  result.rows.slice(0, WORKING_LINES).forEach((row, rowIndex) => {
    const source = lines[rowIndex];
    const label = row.description === '' ? '' : ` (${row.description})`;
    working.push(
      `  line ${row.line}${label}: ${mode === 'add' ? 'net' : 'gross'} ${(source?.amount ?? new D(0)).toFixed()}`,
    );
    components.forEach((c, i) => {
      const exact = row.exactTaxes[i] ?? new D(0);
      const base = (source?.amount ?? new D(0)).toFixed();
      const formula =
        mode === 'add'
          ? `${base} x ${c.rate.toFixed()} / 100`
          : `${base} x ${c.rate.toFixed()} / ${exactText(divisor)}`;
      working.push(`    ${c.name}: ${formula} = ${exactText(exact)}, shown as ${money(row.taxes[i] ?? new D(0))}`);
    });
    if (mode === 'extract') {
      working.push(
        `    net = ${(source?.amount ?? new D(0)).toFixed()} - ${money(sum(row.taxes))} = ${money(row.net)}`,
      );
    }
  });
  if (result.rows.length > WORKING_LINES) {
    working.push(`  ... and ${result.rows.length - WORKING_LINES} more lines (the table shows them all)`);
  }
  components.forEach((c, i) => {
    const exact = result.exactTaxes[i] ?? new D(0);
    const total = money(result.totals.taxes[i] ?? new D(0));
    working.push(
      rounding === 'total'
        ? `  ${rateText(c)} percent, all lines: exact tax ${exactText(exact)}, rounded once to ${total}`
        : `  ${rateText(c)} percent, all lines: the rounded lines add up to ${total}`,
    );
  });
  working.push(
    `  total tax = ${totals.tax}, ${mode === 'add' ? 'gross' : 'net'} total = ${mode === 'add' ? totals.gross : totals.net}`,
    '',
    'The HMRC concession to round the total VAT down to a whole penny (VAT Notice 700 section 17.5) is not applied.',
  );

  return {
    summary: {
      mode,
      rounding,
      currency,
      currencyDecimals: places,
      components: components.map((c) => ({ name: c.name, rate: c.rate.toFixed() })),
      rows: summaryRows,
      totals,
      fraction,
      notes,
    },
    working: working.join('\n'),
  };
}
