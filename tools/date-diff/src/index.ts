import meta from './meta.json';

export { meta };

export class DateDiffError extends Error {
  /** Index into the input where the problem was found, when known. */
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'DateDiffError';
    this.position = position;
  }
}

export interface Duration {
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export interface Difference {
  /** 1 if the second moment is later, -1 if earlier, 0 if the same instant. */
  sign: -1 | 0 | 1;
  totalSeconds: number;
  /** The exact gap, decomposed with no calendar ambiguity: every day is 86,400 seconds. */
  exact: { days: number; hours: number; minutes: number; seconds: number };
  /** The gap as a calendar breakdown, computed from the earlier moment forward. */
  calendar: Duration;
}

// --- Calendar arithmetic, proleptic Gregorian, no Date-object leap-year quirks ---

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Days in `month` (1-12) of `year`, on the proleptic Gregorian calendar. */
function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month - 1]!;
}

/**
 * Builds the UTC instant for the given calendar fields. Uses `Date.UTC`
 * with a fixed base year, then `setUTCFullYear`, so a year below 100 is
 * set literally rather than being shifted into 1900-1999 -- `Date.UTC`'s
 * own year argument special-cases 0-99 that way, but `setUTCFullYear`
 * does not.
 */
function makeUtc(year: number, month: number, day: number, hour: number, minute: number, second: number): number {
  const date = new Date(Date.UTC(2000, month - 1, day, hour, minute, second));
  date.setUTCFullYear(year);
  return date.getTime();
}

/**
 * Adds `addYears` years and `addMonths` months to the moment at `ms`,
 * clamping the day to the last valid day of the target month (the
 * documented, stated convention -- see meta.json's `ambiguities`).
 * Negative values subtract.
 */
function addYearsMonths(ms: number, addYears: number, addMonths: number): number {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1; // 1-12
  const day = d.getUTCDate();
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const second = d.getUTCSeconds();

  const totalMonths = month - 1 + addMonths;
  const newYear = year + addYears + Math.floor(totalMonths / 12);
  const newMonth = (((totalMonths % 12) + 12) % 12) + 1; // 1-12
  const clampedDay = Math.min(day, daysInMonth(newYear, newMonth));

  return makeUtc(newYear, newMonth, clampedDay, hour, minute, second);
}

// --- Moment parsing ---

const MOMENT_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * Parses an ISO 8601 / RFC 3339 date or date-time into a UTC epoch
 * millisecond value. With `Z` or a `±HH:MM` offset, the moment is that
 * exact instant. Without one, it is read as UTC -- a deliberate, stated
 * choice (see meta.json's `ambiguities`), not a local-time-zone guess.
 * Years 0001-9999 only; `Date.UTC`'s own two-digit-year special case
 * never applies, since calendar fields are validated and built by hand.
 */
export function parseMoment(text: string): number {
  const trimmed = text.trim();
  const match = MOMENT_RE.exec(trimmed);
  if (!match) {
    throw new DateDiffError(
      `"${text}" is not an ISO 8601 / RFC 3339 date or date-time, such as 2024-01-31 or 2024-01-31T12:00:00Z.`,
    );
  }

  const [, yStr, moStr, dStr, hStr, miStr, sStr, offsetPart] = match;
  const year = Number(yStr);
  if (year < 1) throw new DateDiffError(`"${text}" has year 0000, which is out of range (years 0001-9999).`);

  const month = Number(moStr);
  if (month < 1 || month > 12) throw new DateDiffError(`"${text}" has an invalid month.`);

  const day = Number(dStr);
  if (day < 1 || day > daysInMonth(year, month))
    throw new DateDiffError(`"${text}" has an invalid day for that month.`);

  const hour = hStr ? Number(hStr) : 0;
  const minute = miStr ? Number(miStr) : 0;
  const second = sStr ? Number(sStr) : 0;
  if (hour > 23) throw new DateDiffError(`"${text}" has an hour out of range.`);
  if (minute > 59) throw new DateDiffError(`"${text}" has a minute out of range.`);
  if (second > 59) throw new DateDiffError(`"${text}" has a second out of range.`);

  const base = makeUtc(year, month, day, hour, minute, second);
  if (!offsetPart || offsetPart === 'Z') return base;

  const sign = offsetPart[0] === '-' ? -1 : 1;
  const [oh, om] = offsetPart.slice(1).split(':').map(Number);
  return base - sign * (oh! * 60 + om!) * 60000;
}

// --- Duration parsing ---

const DURATION_RE = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;
const WEEK_RE = /^P(\d+)W$/;

/**
 * Parses an RFC 3339 Appendix A duration: the combined `PnYnMnDTnHnMnS`
 * form (any subset, integers only, at least one component) or the
 * standalone `PnW` week form. Anything else -- a fractional component, a
 * bare `P`, a `T` with nothing after it, a missing leading `P` -- throws
 * `DateDiffError`.
 */
export function parseDuration(text: string): Duration {
  const trimmed = text.trim();

  const week = WEEK_RE.exec(trimmed);
  if (week) {
    return { years: 0, months: 0, days: Number(week[1]) * 7, hours: 0, minutes: 0, seconds: 0 };
  }

  const malformed = (): never => {
    throw new DateDiffError(`"${text}" is not an RFC 3339 Appendix A duration such as P1Y2M10DT2H30M or P1W.`);
  };

  const match = DURATION_RE.exec(trimmed);
  if (!match) return malformed();

  const [, y, mo, d, h, mi, s] = match;
  const hasTimePart = trimmed.includes('T');
  if (hasTimePart && !h && !mi && !s) return malformed();
  if (!y && !mo && !d && !h && !mi && !s) return malformed();

  return {
    years: Number(y ?? 0),
    months: Number(mo ?? 0),
    days: Number(d ?? 0),
    hours: Number(h ?? 0),
    minutes: Number(mi ?? 0),
    seconds: Number(s ?? 0),
  };
}

/**
 * Adds `duration` to the moment at `momentMs` (or subtracts it when
 * `sign` is -1). Years and months are applied first, clamped to the last
 * valid day of the target month, then weeks (already folded into days by
 * `parseDuration`) and days, then hours, minutes and seconds.
 */
export function addDuration(momentMs: number, duration: Duration, sign: 1 | -1 = 1): number {
  let ms = addYearsMonths(momentMs, sign * duration.years, sign * duration.months);
  ms += sign * duration.days * 86400000;
  ms += sign * duration.hours * 3600000;
  ms += sign * duration.minutes * 60000;
  ms += sign * duration.seconds * 1000;
  return ms;
}

/**
 * The calendar breakdown from `earlierMs` to `laterMs` (`laterMs` must be
 * `>= earlierMs`): the largest whole number of years such that adding
 * them (clamped) does not overshoot, then the largest whole number of
 * months the same way, then the exact remaining days/hours/minutes/
 * seconds. This is the same clamped-day rule `addDuration` uses, applied
 * in reverse, so the two agree with each other.
 */
function calendarDiff(earlierMs: number, laterMs: number): Duration {
  let years = 0;
  while (addYearsMonths(earlierMs, years + 1, 0) <= laterMs) years++;

  let months = 0;
  while (addYearsMonths(earlierMs, years, months + 1) <= laterMs) months++;

  const alignedMs = addYearsMonths(earlierMs, years, months);
  let remainder = laterMs - alignedMs;

  const days = Math.floor(remainder / 86400000);
  remainder -= days * 86400000;
  const hours = Math.floor(remainder / 3600000);
  remainder -= hours * 3600000;
  const minutes = Math.floor(remainder / 60000);
  remainder -= minutes * 60000;
  const seconds = Math.round(remainder / 1000);

  return { years, months, days, hours, minutes, seconds };
}

/**
 * The gap between two moments: an exact elapsed-time breakdown (days,
 * hours, minutes, seconds, total seconds -- every day exactly 86,400
 * seconds, no calendar ambiguity), and a calendar breakdown computed from
 * the earlier moment forward using the same clamped-day rule
 * `addDuration` uses.
 */
export function diffMoments(a: number, b: number): Difference {
  const deltaMs = b - a;
  const sign: -1 | 0 | 1 = deltaMs > 0 ? 1 : deltaMs < 0 ? -1 : 0;
  const absMs = Math.abs(deltaMs);
  const totalSeconds = Math.round(absMs / 1000);

  let remainder = absMs;
  const days = Math.floor(remainder / 86400000);
  remainder -= days * 86400000;
  const hours = Math.floor(remainder / 3600000);
  remainder -= hours * 3600000;
  const minutes = Math.floor(remainder / 60000);
  remainder -= minutes * 60000;
  const seconds = Math.round(remainder / 1000);

  const earlier = Math.min(a, b);
  const later = Math.max(a, b);
  const calendar = calendarDiff(earlier, later);

  return { sign, totalSeconds, exact: { days, hours, minutes, seconds }, calendar };
}

/** Renders a `Duration` as an ISO 8601 duration string, omitting zero fields. */
export function formatIsoDuration(duration: Duration): string {
  const { years, months, days, hours, minutes, seconds } = duration;
  let out = 'P';
  if (years) out += `${years}Y`;
  if (months) out += `${months}M`;
  if (days) out += `${days}D`;
  if (hours || minutes || seconds) {
    out += 'T';
    if (hours) out += `${hours}H`;
    if (minutes) out += `${minutes}M`;
    if (seconds) out += `${seconds}S`;
  }
  return out === 'P' ? 'PT0S' : out;
}
