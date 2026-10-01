/**
 * Validators for the number, date and time strings of the WHATWG HTML Living
 * Standard: 2.3.4 (signed integers, non-negative integers, floating-point
 * numbers) and 2.3.5 (months, dates, yearless dates, times, local dates and
 * times, time-zone offsets, global dates and times, weeks, durations, and the
 * date string with optional time).
 *
 * Each `isValid...` function implements the grammar of the same name: it says
 * whether a string is a valid one, which is the authoring rule, and is stricter
 * than the lenient rules a browser uses to parse. Only ASCII digits count, and
 * letters (T, Z, W, P) are the capitals the grammar writes.
 *
 * Pure functions: no Date object (it mishandles years below 100), no clock.
 */

/** WHATWG 2.3.4.2: one or more ASCII digits. */
export function isValidNonNegativeInteger(s: string): boolean {
  return /^[0-9]+$/.test(s);
}

/** WHATWG 2.3.4.1: one or more ASCII digits, optionally prefixed with a hyphen-minus. */
export function isValidInteger(s: string): boolean {
  return /^-?[0-9]+$/.test(s);
}

/**
 * WHATWG 2.3.4.3: an optional hyphen-minus, then digits, or a point and digits, or digits, a point and digits,
 * then optionally e or E, an optional sign and digits. No leading plus, no trailing point, no NaN or Infinity.
 */
export function isValidFloat(s: string): boolean {
  return /^-?(?:[0-9]+|\.[0-9]+|[0-9]+\.[0-9]+)(?:[eE][-+]?[0-9]+)?$/.test(s);
}

/**
 * The number a valid floating-point string represents, rounded to the nearest double. Returns null for a string
 * that is not valid and for one that rounds to an infinity (WHATWG 2.3.4.3, rules for parsing floating-point
 * number values, step "Conversion"). Negative zero is returned as zero, because the standard's set excludes it.
 */
export function parseValidFloat(s: string): number | null {
  if (!isValidFloat(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n === 0 ? 0 : n;
}

function isLeapYear(year: bigint): boolean {
  return year % 400n === 0n || (year % 4n === 0n && year % 100n !== 0n);
}

/** The number of days in a month of a year (WHATWG 2.3.5): 29 for February of a leap year, 28 otherwise. */
export function daysInMonth(year: number | bigint, month: number): number {
  if (month === 1 || month === 3 || month === 5 || month === 7 || month === 8 || month === 10 || month === 12)
    return 31;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return isLeapYear(BigInt(year)) ? 29 : 28;
}

/**
 * The number of weeks in a week-year (WHATWG 2.3.5.8): 53 when 1 January is a Thursday, or a Wednesday in a leap
 * year, otherwise 52. The weekday of 1 January comes from integer arithmetic (Gauss), never a Date object.
 */
export function weeksInYear(year: number | bigint): number {
  const y = BigInt(year);
  const a = y - 1n;
  const weekday = Number((1n + 5n * (a % 4n) + 4n * (a % 100n) + 6n * (a % 400n)) % 7n); // 0 is Sunday
  if (weekday === 4) return 53;
  if (weekday === 3 && isLeapYear(y)) return 53;
  return 52;
}

/** Four or more ASCII digits representing a year greater than zero. */
function parseYear(s: string): bigint | null {
  if (!/^[0-9]{4,}$/.test(s)) return null;
  const y = BigInt(s);
  return y > 0n ? y : null;
}

/** WHATWG 2.3.5.1: four or more digits for a year greater than zero, a hyphen-minus, and a month 01 to 12. */
export function isValidMonth(s: string): boolean {
  const m = /^([0-9]{4,})-([0-9]{2})$/.exec(s);
  if (!m) return false;
  const year = parseYear(m[1] as string);
  const month = Number(m[2]);
  return year !== null && month >= 1 && month <= 12;
}

/** WHATWG 2.3.5.2: a valid month string, a hyphen-minus and a day from 01 to the days in that month of that year. */
export function isValidDate(s: string): boolean {
  const m = /^([0-9]{4,})-([0-9]{2})-([0-9]{2})$/.exec(s);
  if (!m) return false;
  const year = parseYear(m[1] as string);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year === null || month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

/** WHATWG 2.3.5.3: optionally two hyphen-minus characters, a month, a hyphen-minus and a day (29 February allowed). */
export function isValidYearlessDate(s: string): boolean {
  const m = /^(?:--)?([0-9]{2})-([0-9]{2})$/.exec(s);
  if (!m) return false;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(2000, month);
}

function timeParts(s: string): [number, number, number] | null {
  const m = /^([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.[0-9]{1,3})?)?$/.exec(s);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = m[3] === undefined ? 0 : Number(m[3]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return [hour, minute, second];
}

/**
 * WHATWG 2.3.5.4: hh:mm, optionally :ss, and after the seconds optionally a point and one to three digits.
 * Hour 0 to 23, minute and second 0 to 59 (leap seconds cannot be written).
 */
export function isValidTime(s: string): boolean {
  return timeParts(s) !== null;
}

/** WHATWG 2.3.5.5: a valid date string, a T or one space, and a valid time string. */
export function isValidLocalDateTime(s: string): boolean {
  const m = /^([0-9]{4,}-[0-9]{2}-[0-9]{2})[T ](.+)$/.exec(s);
  return m !== null && isValidDate(m[1] as string) && isValidTime(m[2] as string);
}

/**
 * WHATWG 2.3.5.6: Z, or a plus sign or (only for a non-zero offset) a hyphen-minus, two hour digits 0 to 23,
 * an optional colon and two minute digits 0 to 59.
 */
export function isValidTimeZoneOffset(s: string): boolean {
  if (s === 'Z') return true;
  const m = /^([+-])([0-9]{2}):?([0-9]{2})$/.exec(s);
  if (!m) return false;
  const hours = Number(m[2]);
  const minutes = Number(m[3]);
  if (hours > 23 || minutes > 59) return false;
  return m[1] === '+' || hours !== 0 || minutes !== 0;
}

const GLOBAL_DATE_TIME =
  /^([0-9]{4,}-[0-9]{2}-[0-9]{2})[T ]([0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]{1,3})?)?)(Z|[+-][0-9]{2}:?[0-9]{2})$/;

/** WHATWG 2.3.5.7: a valid date string, a T or one space, a valid time string and a valid time-zone offset string. */
export function isValidGlobalDateTime(s: string): boolean {
  const m = GLOBAL_DATE_TIME.exec(s);
  return (
    m !== null && isValidDate(m[1] as string) && isValidTime(m[2] as string) && isValidTimeZoneOffset(m[3] as string)
  );
}

/** WHATWG 2.3.5.8: four or more digits for a year greater than zero, -W, and a week from 01 to the weeks in that year. */
export function isValidWeek(s: string): boolean {
  const m = /^([0-9]{4,})-W([0-9]{2})$/.exec(s);
  if (!m) return false;
  const year = parseYear(m[1] as string);
  const week = Number(m[2]);
  return year !== null && week >= 1 && week <= weeksInYear(year);
}

/** Four or more ASCII digits for a year greater than zero (the year form of the time element, WHATWG 4.5.14). */
export function isValidYear(s: string): boolean {
  return parseYear(s) !== null;
}

const ISO_DURATION = /^P(?:([0-9]+)D)?(?:(T)(?:([0-9]+)H)?(?:([0-9]+)M)?(?:([0-9]+(?:\.[0-9]{1,3})?)S)?)?$/;
const HUMAN_COMPONENT = /^[\t\n\f\r ]*([0-9]+)(?:\.([0-9]{1,3}))?[\t\n\f\r ]*([WwDdHhMmSs])[\t\n\f\r ]*/;

function isValidIsoDuration(s: string): boolean {
  const m = ISO_DURATION.exec(s);
  if (!m || s === 'P') return false;
  // A T must be followed by at least one of hours, minutes and seconds.
  if (m[2] !== undefined && m[3] === undefined && m[4] === undefined && m[5] === undefined) return false;
  return true;
}

function isValidHumanDuration(s: string): boolean {
  let rest = s;
  const scales = new Set<string>();
  let count = 0;
  while (rest.length > 0) {
    const m = HUMAN_COMPONENT.exec(rest);
    if (!m) return false;
    const unit = (m[3] as string).toLowerCase();
    // A fraction is only allowed on seconds, and each scale may be used once.
    if (m[2] !== undefined && unit !== 's') return false;
    if (scales.has(unit)) return false;
    scales.add(unit);
    count++;
    rest = rest.slice(m[0].length);
  }
  return count > 0;
}

/**
 * WHATWG 2.3.5.9: either the P form (days, then T with hours, minutes and seconds, in that order; seconds may carry
 * one to three fraction digits) or one or more human components such as 4h 18m 3s in any order with distinct units.
 * Months and years cannot be written.
 */
export function isValidDuration(s: string): boolean {
  return isValidIsoDuration(s) || isValidHumanDuration(s);
}

/** WHATWG 2.3.5.10: a valid date string or a valid global date and time string (the rule for ins and del). */
export function isValidDateOrGlobalDateTime(s: string): boolean {
  return isValidDate(s) || isValidGlobalDateTime(s);
}

/**
 * The syntaxes the datetime value of a time element may match (WHATWG 4.5.14): a month, date, yearless date, time,
 * local date and time, time-zone offset, global date and time, week, a year (four or more digits, at least one not
 * zero) or a duration.
 */
export function isValidTimeElementValue(s: string): boolean {
  return (
    isValidMonth(s) ||
    isValidDate(s) ||
    isValidYearlessDate(s) ||
    isValidTime(s) ||
    isValidLocalDateTime(s) ||
    isValidTimeZoneOffset(s) ||
    isValidGlobalDateTime(s) ||
    isValidWeek(s) ||
    isValidYear(s) ||
    isValidDuration(s)
  );
}

type Comparable = readonly (number | bigint)[];

function keyOf(kind: string, s: string): Comparable {
  switch (kind) {
    case 'number': {
      const n = parseValidFloat(s);
      if (n === null) break;
      return [n];
    }
    case 'month': {
      const m = /^([0-9]{4,})-([0-9]{2})$/.exec(s);
      if (m && isValidMonth(s)) return [BigInt(m[1] as string), Number(m[2])];
      break;
    }
    case 'date': {
      const m = /^([0-9]{4,})-([0-9]{2})-([0-9]{2})$/.exec(s);
      if (m && isValidDate(s)) return [BigInt(m[1] as string), Number(m[2]), Number(m[3])];
      break;
    }
    case 'week': {
      const m = /^([0-9]{4,})-W([0-9]{2})$/.exec(s);
      if (m && isValidWeek(s)) return [BigInt(m[1] as string), Number(m[2])];
      break;
    }
    case 'time':
      if (isValidTime(s)) return [timeMilliseconds(s)];
      break;
    case 'datetime-local': {
      const m = /^([0-9]{4,})-([0-9]{2})-([0-9]{2})[T ](.+)$/.exec(s);
      if (m && isValidLocalDateTime(s)) {
        return [BigInt(m[1] as string), Number(m[2]), Number(m[3]), timeMilliseconds(m[4] as string)];
      }
      break;
    }
    default:
      throw new Error(`compareTyped: "${kind}" is not one of number, date, month, week, time, datetime-local`);
  }
  throw new Error(`compareTyped: "${s}" is not a valid ${kind} string`);
}

function timeMilliseconds(s: string): number {
  const m = /^([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.([0-9]{1,3}))?)?$/.exec(s) as RegExpExecArray;
  const seconds = (Number(m[1]) * 60 + Number(m[2])) * 60 + (m[3] === undefined ? 0 : Number(m[3]));
  const fraction = m[4] === undefined ? 0 : Number(m[4].padEnd(3, '0'));
  return seconds * 1000 + fraction;
}

/**
 * Orders two valid strings of one kind: -1 when a comes first, 0 when they are equal, 1 when a comes later. A string
 * that is not valid for the kind throws, so callers validate first.
 */
export function compareTyped(
  kind: 'number' | 'date' | 'month' | 'week' | 'time' | 'datetime-local',
  a: string,
  b: string,
): -1 | 0 | 1 {
  const x = keyOf(kind, a);
  const y = keyOf(kind, b);
  for (let i = 0; i < x.length; i++) {
    const p = x[i] as number | bigint;
    const q = y[i] as number | bigint;
    if (p < q) return -1;
    if (p > q) return 1;
  }
  return 0;
}
