/**
 * Reads the time a visitor types: whole Unix seconds, or an ISO 8601 date. It reads by bounded character checks and
 * `Date.UTC`, never by a lenient date parser (`new Date(text)` accepts text no one meant as a date), so the same text
 * gives the same instant in every browser and time zone. Nothing here reads the clock.
 *
 * RULE, stated once and enforced by a test: no message thrown or returned from this file may repeat the text that was
 * typed. Describe the shape of the problem, never the content.
 */

export const MAX_TIME_CHARS = 64;
/** 9999-12-31T23:59:59Z, the last second a four digit year can hold. */
export const MAX_UNIX_SECONDS = 253402300799;

export class TimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeError';
  }
}

const SHAPE = 'Write whole Unix seconds such as 59, or a date such as 2009-02-13T23:31:30Z.';

/** The value of `count` decimal digits starting at `start`, or -1 when any of them is not an ASCII digit. */
function digitsAt(text: string, start: number, count: number): number {
  if (start + count > text.length) return -1;
  let value = 0;
  for (let i = start; i < start + count; i++) {
    const code = text.charCodeAt(i);
    if (code < 48 || code > 57) return -1;
    value = value * 10 + (code - 48);
  }
  return value;
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysIn(year: number, month: number): number {
  if (month === 2) return isLeap(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function range(seconds: number): number {
  if (seconds < 0) {
    throw new TimeError('This time is before 1970-01-01 00:00:00 UTC, where time based codes start counting.');
  }
  if (seconds > MAX_UNIX_SECONDS)
    throw new TimeError('This time is after 9999-12-31 23:59:59 UTC, the last time this page reads.');
  return seconds;
}

/**
 * Whole Unix seconds (0 to 253402300799), or an ISO 8601 date: `YYYY-MM-DD`, or `YYYY-MM-DDTHH:MM` with optional `:SS`,
 * an optional fraction of 1 to 9 digits after the seconds (cut to whole seconds) and an optional `Z` or `+HH:MM` or
 * `-HH:MM` offset. `T` may be a space and `T` and `Z` may be lower case. With no offset the time is UTC.
 */
export function parseTimeInput(text: string): number {
  if (text.length > MAX_TIME_CHARS) {
    throw new TimeError(
      `This time is ${text.length} characters. The limit is ${MAX_TIME_CHARS} because a time is never longer.`,
    );
  }
  const s = text.trim();
  if (s === '') throw new TimeError(`Type a time. ${SHAPE}`);

  // Whole Unix seconds: digits only, so no sign, no fraction, no exponent, no separators.
  if (digitsAt(s, 0, s.length) >= 0) {
    const value = Number(s);
    if (value > MAX_UNIX_SECONDS) {
      throw new TimeError(
        'This Unix time is after 253402300799 (9999-12-31 23:59:59 UTC), the last time this page reads.',
      );
    }
    return value;
  }

  const year = digitsAt(s, 0, 4);
  const month = year < 0 || s[4] !== '-' ? -1 : digitsAt(s, 5, 2);
  const day = month < 0 || s[7] !== '-' ? -1 : digitsAt(s, 8, 2);
  if (year < 0 || month < 0 || day < 0) throw new TimeError(`This is not a time this page reads. ${SHAPE}`);
  if (year < 1900)
    throw new TimeError('This time is before 1970-01-01 00:00:00 UTC, where time based codes start counting.');
  if (month < 1 || month > 12) throw new TimeError('The month must be 01 to 12.');
  if (day < 1 || day > daysIn(year, month)) throw new TimeError('The day is not a day of that month.');

  let hour = 0;
  let minute = 0;
  let second = 0;
  let offsetSeconds = 0;
  if (s.length > 10) {
    const separator = s[10];
    if (separator !== 'T' && separator !== 't' && separator !== ' ') {
      throw new TimeError(`This is not a time this page reads. ${SHAPE}`);
    }
    hour = digitsAt(s, 11, 2);
    minute = hour < 0 || s[13] !== ':' ? -1 : digitsAt(s, 14, 2);
    if (hour < 0 || minute < 0) throw new TimeError(`This is not a time this page reads. ${SHAPE}`);
    let i = 16;
    if (s[i] === ':') {
      second = digitsAt(s, i + 1, 2);
      if (second < 0) throw new TimeError(`This is not a time this page reads. ${SHAPE}`);
      i += 3;
      if (s[i] === '.') {
        let j = i + 1;
        while (j < s.length && s.charCodeAt(j) >= 48 && s.charCodeAt(j) <= 57) j++;
        if (j - (i + 1) < 1 || j - (i + 1) > 9)
          throw new TimeError('The fraction of a second must have 1 to 9 digits.');
        i = j;
      }
    }
    if (i < s.length) {
      const zone = s[i];
      if ((zone === 'Z' || zone === 'z') && i + 1 === s.length) {
        // UTC.
      } else if ((zone === '+' || zone === '-') && i + 6 === s.length && s[i + 3] === ':') {
        const offsetHours = digitsAt(s, i + 1, 2);
        const offsetMinutes = digitsAt(s, i + 4, 2);
        if (offsetHours < 0 || offsetMinutes < 0) throw new TimeError(`This is not a time this page reads. ${SHAPE}`);
        if (offsetHours > 23 || offsetMinutes > 59) throw new TimeError('The offset from UTC must be at most 23:59.');
        offsetSeconds = (zone === '+' ? 1 : -1) * (offsetHours * 3600 + offsetMinutes * 60);
      } else {
        throw new TimeError(`This is not a time this page reads. ${SHAPE}`);
      }
    }
    if (hour > 23) throw new TimeError('The hour must be 00 to 23.');
    if (minute > 59) throw new TimeError('The minute must be 00 to 59.');
    if (second > 59) throw new TimeError('The second must be 00 to 59.');
  }
  return range(Date.UTC(year, month - 1, day, hour, minute, second) / 1000 - offsetSeconds);
}

/** Whole Unix seconds as `YYYY-MM-DD HH:MM:SS` in UTC. */
export function formatUtc(seconds: number): string {
  return new Date(seconds * 1000)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.000Z$/, '');
}
