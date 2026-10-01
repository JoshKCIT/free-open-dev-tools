/**
 * Exact money arithmetic helpers, copied byte for byte into every folder that does sums with money.
 *
 * What this file implements:
 *  - a private decimal.js constructor (40 significant digits, half away from zero) so the library's own global
 *    settings are never touched;
 *  - a strict reader for typed amounts that accepts plain decimal text only and says which field was wrong;
 *  - rounding half away from zero, and fixed-place printing that never shows a negative zero;
 *  - currency minor units and amount formatting through the browser's Intl.NumberFormat (ISO 4217 codes),
 *    formatting from decimal text so no amount passes through a JavaScript number.
 */
import Decimal from 'decimal.js';

/** Own constructor: the library's global settings stay at their defaults (precision 20) for any other code. */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -40, toExpPos: 40 });
export type Dec = InstanceType<typeof D>;

/** Every amount is shown with English (United States) grouping and decimal point. */
export const DISPLAY_LOCALE = 'en-US';

/** A problem with something the visitor typed. `field` is the label of the field, so a page can name it. */
export class MoneyInputError extends Error {
  readonly field: string;
  readonly line?: number;
  readonly column?: number;

  constructor(field: string, message: string, position?: { line: number; column: number }) {
    super(message);
    this.name = 'MoneyInputError';
    this.field = field;
    if (position) {
      this.line = position.line;
      this.column = position.column;
    }
  }
}

/** True for empty text and text that is only whitespace. */
export function isBlank(text: string): boolean {
  return text.trim() === '';
}

// Plain decimal text only: no commas, spaces inside, exponents, hex, binary, underscores, NaN or Infinity.
// Checked before anything is handed to decimal.js, which would accept all of those.
const PLAIN_DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

export interface ParseDecimalOptions {
  /** Most digits before the point, leading zeros not counted. Default 15. */
  maxInt?: number;
  /** Most digits after the point. Default 12. */
  maxFrac?: number;
  /** Accept a leading minus sign. Default false. */
  allowNegative?: boolean;
}

/** Reads typed text as an exact decimal. Empty text is "missing", anything but plain digits is refused. */
export function parseDecimal(text: string, field: string, opts: ParseDecimalOptions = {}): Dec {
  const { maxInt = 15, maxFrac = 12, allowNegative = false } = opts;
  if (isBlank(text)) throw new MoneyInputError(field, 'missing, type a value such as 1234.50');
  const t = text.trim();
  if (!PLAIN_DECIMAL.test(t)) {
    throw new MoneyInputError(
      field,
      'type digits with an optional dot, for example 1234.50 (no commas, exponents or symbols)',
    );
  }
  if (t.startsWith('-') && !allowNegative) {
    throw new MoneyInputError(field, 'a negative value is not accepted here, type it without the minus sign');
  }
  const [whole = '', fraction = ''] = t.replace(/^[+-]/, '').split('.');
  if (whole.replace(/^0+/, '').length > maxInt || fraction.length > maxFrac) {
    throw new MoneyInputError(field, `too many digits (at most ${maxInt} before the point and ${maxFrac} after)`);
  }
  return new D(t);
}

/** Rounds to `dp` decimal places, ties away from zero (0.005 gives 0.01, -2.5 gives -3). */
export function roundTo(x: Dec, dp: number): Dec {
  return x.toDecimalPlaces(dp, D.ROUND_HALF_UP);
}

/** Rounds to `dp` places and prints exactly that many, as plain digits. A value that rounds to zero prints without a minus sign. */
export function toPlain(x: Dec, dp: number): string {
  const rounded = roundTo(x, dp);
  return rounded.isZero() ? new D(0).toFixed(dp) : rounded.toFixed(dp);
}

const numberFormats = new Map<string, Intl.NumberFormat>();

function currencyFormat(currency: string, locale: string, digits?: number): Intl.NumberFormat {
  const key = `${locale}|${currency}|${digits ?? ''}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(
      locale,
      digits === undefined
        ? { style: 'currency', currency }
        : { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits },
    );
    numberFormats.set(key, format);
  }
  return format;
}

/** How many decimal places the currency's smallest unit has (USD 2, JPY 0, BHD 3), as the browser reports it. */
export function minorUnits(currency: string, locale: string = DISPLAY_LOCALE): number {
  return currencyFormat(currency, locale).resolvedOptions().maximumFractionDigits ?? 2;
}

/** Formats an amount as money, rounded half away from zero to the currency's minor unit, from decimal text. */
export function formatMoney(x: Dec, currency: string = 'USD', locale: string = DISPLAY_LOCALE): string {
  const digits = minorUnits(currency, locale);
  const text = toPlain(x, digits);
  // Intl.NumberFormat.format also accepts a decimal string (so a long amount is not squeezed through a float);
  // the bundled type declarations only list numbers, hence the narrow cast.
  return (currencyFormat(currency, locale, digits) as unknown as { format(value: string): string }).format(text);
}

/** The currency codes this browser reports, or null when it cannot list them. */
export function currencyCodes(): readonly string[] | null {
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  return typeof supported === 'function' ? supported('currency') : null;
}

/** Reads a three-letter ISO 4217 code. Upper-cased; must be a code the browser reports when it can list them. */
export function parseCurrency(text: string, field: string): string {
  if (isBlank(text)) throw new MoneyInputError(field, 'missing, type a code such as USD');
  const code = text.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new MoneyInputError(field, 'type a three-letter currency code such as USD, EUR or JPY');
  }
  const list = currencyCodes();
  if (list !== null) {
    if (!list.includes(code)) throw new MoneyInputError(field, `${code} is not a currency code this browser knows`);
    return code;
  }
  try {
    new Intl.NumberFormat(DISPLAY_LOCALE, { style: 'currency', currency: code });
  } catch {
    throw new MoneyInputError(field, `${code} is not a currency code this browser accepts`);
  }
  return code;
}

/**
 * Reads a whole number made of digits only (no sign, dot or comma) that lies between `min` and `max`.
 * The only place a typed digit string becomes a JavaScript number, and only for counts, never for amounts.
 */
export function parseCount(text: string, field: string, min: number, max: number): number {
  if (isBlank(text)) throw new MoneyInputError(field, `missing, type a whole number such as ${min}`);
  const t = text.trim();
  const range = `type a whole number from ${min} to ${max}`;
  // At most 9 digits, so a long digit string can never reach an unsafe or infinite value.
  if (!/^\d{1,9}$/.test(t)) throw new MoneyInputError(field, `${range}, digits only`);
  const count = Number(t);
  if (count < min || count > max) throw new MoneyInputError(field, range);
  return count;
}

/** A calendar date with no time of day and no time zone. `month` is 1 to 12. */
export type CalendarDate = { year: number; month: number; day: number };

const MIN_YEAR = 1900;
const MAX_YEAR = 2200;
const MS_PER_DAY = 86_400_000;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** Reads an ISO 8601 calendar date (YYYY-MM-DD) between 1900-01-01 and 2200-12-31. No clock, no time zone. */
export function parseIsoDate(text: string, field: string): CalendarDate {
  if (isBlank(text)) throw new MoneyInputError(field, 'missing, type a date such as 2026-01-31');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) throw new MoneyInputError(field, 'type a date as year-month-day, for example 2026-01-31');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_YEAR || year > MAX_YEAR) {
    throw new MoneyInputError(field, `the year must be from ${MIN_YEAR} to ${MAX_YEAR}`);
  }
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new MoneyInputError(field, `${text.trim()} is not a real calendar date`);
  }
  return { year, month, day };
}

/** Prints a date as YYYY-MM-DD. */
export function formatIsoDate(d: CalendarDate): string {
  return `${pad(d.year, 4)}-${pad(d.month, 2)}-${pad(d.day, 2)}`;
}

/**
 * Adds whole months to the first date and clamps the day to the length of the month it lands in, so 31 January
 * gives 29 February 2024, then 31 March. Always counted from the first date, never chained from the previous one.
 */
export function addMonthsClamped(start: CalendarDate, months: number): CalendarDate {
  const total = start.year * 12 + (start.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return { year, month, day: Math.min(start.day, daysInMonth(year, month)) };
}

/** Adds whole days (negative to go back) in UTC, so a clock change in the viewer's time zone cannot move a date. */
export function addDays(start: CalendarDate, days: number): CalendarDate {
  const moved = new Date(Date.UTC(start.year, start.month - 1, start.day + days));
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
}

/** Whole days from `a` to `b`, leap days included. An end before the start is refused. */
export function daysBetween(a: CalendarDate, b: CalendarDate): number {
  const days = Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / MS_PER_DAY);
  if (days < 0)
    throw new MoneyInputError('End date', `${formatIsoDate(b)} is before the start date ${formatIsoDate(a)}`);
  return days;
}
