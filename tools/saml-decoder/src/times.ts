export interface ParsedTime {
  /** Milliseconds since 1970-01-01T00:00:00Z. */
  ms: number;
  /** True when the text ended in Z or an offset of +00:00 or -00:00. */
  utc: boolean;
  /** True when the text carried a time zone at all. */
  hadZone: boolean;
  /** The offset written, in minutes (0 for Z or when none was written). */
  offsetMinutes: number;
}

const MAX_FRACTION_DIGITS = 12;

function digits(text: string, start: number, count: number): number {
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

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeap(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** Days from 1970-01-01 to a calendar date, by the proleptic Gregorian calendar. */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/**
 * Reads a strict xs:dateTime as SAML writes it: a four digit year, month, day, `T`, hour, minute and second with an optional
 * fraction, then `Z` or an offset like `+02:00`, or nothing. Returns `null` for anything else, including a second of 60, an
 * hour of 24 and a day that the month does not have.
 */
export function parseDateTime(text: string): ParsedTime | null {
  const t = text.trim();
  if (t.length < 19) return null;
  const year = digits(t, 0, 4);
  const month = digits(t, 5, 2);
  const day = digits(t, 8, 2);
  const hour = digits(t, 11, 2);
  const minute = digits(t, 14, 2);
  const second = digits(t, 17, 2);
  if (t[4] !== '-' || t[7] !== '-' || t[10] !== 'T' || t[13] !== ':' || t[16] !== ':') return null;
  if (year < 0 || month < 1 || month > 12 || day < 1 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  if (second < 0 || second > 59 || day > daysInMonth(year, month)) return null;
  let at = 19;
  let fractionMs = 0;
  if (t[at] === '.') {
    let end = at + 1;
    while (end < t.length && t.charCodeAt(end) >= 48 && t.charCodeAt(end) <= 57) end++;
    const length = end - at - 1;
    if (length < 1 || length > MAX_FRACTION_DIGITS) return null;
    fractionMs = Number((t.slice(at + 1, end) + '000').slice(0, 3));
    at = end;
  }
  let offsetMinutes = 0;
  let hadZone = false;
  let utc = true;
  if (at < t.length) {
    hadZone = true;
    if (t[at] === 'Z' && at === t.length - 1) {
      at++;
    } else if ((t[at] === '+' || t[at] === '-') && t.length === at + 6 && t[at + 3] === ':') {
      const hh = digits(t, at + 1, 2);
      const mm = digits(t, at + 4, 2);
      if (hh < 0 || mm < 0 || hh > 14 || mm > 59) return null;
      offsetMinutes = (t[at] === '-' ? -1 : 1) * (hh * 60 + mm);
      utc = offsetMinutes === 0;
      at = t.length;
    } else return null;
  }
  const ms =
    daysFromCivil(year, month, day) * 86_400_000 +
    hour * 3_600_000 +
    minute * 60_000 +
    second * 1000 +
    fractionMs -
    offsetMinutes * 60_000;
  return { ms, utc, hadZone, offsetMinutes };
}

/** A time as UTC text, like 2004-12-05T09:17:05Z (with the milliseconds when there are any). */
export function formatUtc(ms: number): string {
  const text = new Date(ms).toISOString();
  return text.endsWith('.000Z') ? text.slice(0, -5) + 'Z' : text;
}

/** How far a time is from `now` in words: `in 5 min`, `3 h 4 min ago`, or `now`. No clock skew is allowed for. */
export function describeTime(ms: number, now: number): string {
  const diff = ms - now;
  const seconds = Math.round(Math.abs(diff) / 1000);
  if (seconds < 1) return 'now';
  let span: string;
  if (seconds < 60) span = `${seconds} s`;
  else if (seconds < 3600) {
    const rest = seconds % 60;
    span = `${Math.floor(seconds / 60)} min${rest > 0 ? ` ${rest} s` : ''}`;
  } else if (seconds < 86_400) {
    const rest = Math.floor((seconds % 3600) / 60);
    span = `${Math.floor(seconds / 3600)} h${rest > 0 ? ` ${rest} min` : ''}`;
  } else {
    const days = Math.floor(seconds / 86_400);
    if (days >= 730) span = `about ${Math.round(days / 365)} years`;
    else {
      const rest = Math.floor((seconds % 86_400) / 3600);
      span = `${days} d${rest > 0 ? ` ${rest} h` : ''}`;
    }
  }
  return diff > 0 ? `in ${span}` : `${span} ago`;
}
