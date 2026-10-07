import { stripComments } from './comments';

/**
 * This file is deliberately not shared with any cookie code: the two-digit year rule here is RFC 5322 section 4.3 (00 to 49
 * are 20xx, 50 to 99 are 19xx), which is not the cookie date rule (70 to 99 are 19xx, 0 to 69 are 20xx).
 */

/** A date read from a mail header. */
export interface MailDate {
  /** Milliseconds since 1970-01-01T00:00:00Z, the stated zone applied. Always a whole number of seconds. */
  ms: number;
  /** True when the order was month, day, year (the form RFC 8601's own examples use) and not the RFC 5322 order. */
  lenient: boolean;
  /** What was assumed on the way: an obsolete or unknown zone, a two or three digit year, the lenient order. */
  notes: string[];
}

const MONTHS: readonly string[] = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_NAMES: ReadonlySet<string> = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

/** RFC 5322 section 4.3: the obsolete zones and the offsets, in minutes, they are semantically equal to. */
const OBSOLETE_ZONES: ReadonlyMap<string, number> = new Map([
  ['ut', 0],
  ['gmt', 0],
  ['edt', -240],
  ['est', -300],
  ['cdt', -300],
  ['cst', -360],
  ['mdt', -360],
  ['mst', -420],
  ['pdt', -420],
  ['pst', -480],
]);

/** A date is a few words; a value longer than this after its comments are taken out is not one. */
const MAX_DATE_CHARACTERS = 200;
const MAX_DATE_TOKENS = 24;

/** 9999-12-31T23:59:59Z, the last instant a date with a four digit year can state in UTC. */
const LAST_MOMENT_OF_9999 = Date.UTC(9999, 11, 31, 23, 59, 59);

interface Token {
  kind: 'num' | 'word' | 'sym';
  text: string;
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/** Digits, letters and the four symbols a date uses; white space separates; anything else means this is not a date. */
function tokenize(text: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const code = text.charCodeAt(i);
    if (code === 32 || code === 9 || code === 10 || code === 13) {
      i++;
      continue;
    }
    if (tokens.length >= MAX_DATE_TOKENS) return null;
    if (isDigit(code)) {
      let j = i + 1;
      while (j < n && isDigit(text.charCodeAt(j))) j++;
      tokens.push({ kind: 'num', text: text.slice(i, j) });
      i = j;
    } else if (isLetter(code)) {
      let j = i + 1;
      while (j < n && isLetter(text.charCodeAt(j))) j++;
      tokens.push({ kind: 'word', text: text.slice(i, j) });
      i = j;
    } else if (code === 44 || code === 58 || code === 43 || code === 45) {
      tokens.push({ kind: 'sym', text: text[i] ?? '' });
      i++;
    } else {
      return null;
    }
  }
  return tokens;
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, monthIndex: number): number {
  if (monthIndex === 1) return isLeap(year) ? 29 : 28;
  return monthIndex === 3 || monthIndex === 5 || monthIndex === 8 || monthIndex === 10 ? 30 : 31;
}

/**
 * Reads an RFC 5322 date-time (section 3.3) with the obsolete forms of section 4.3: comments and white space between the
 * tokens, a missing day of week, no seconds, two and three digit years, the obsolete zones and the military letters. A
 * date with the month before the day (`Fri, Feb 15 2002 17:19:07 -0800`, the form RFC 8601's examples use) is read too, and
 * the result says it was lenient. Returns null for anything that is not a date: a day past the end of its month, an hour
 * of 24, a minute of 60, a four digit year before 1900, a zone with minutes of 60 or more, a missing zone, extra words,
 * or a time that its zone moves past the end of 9999 in UTC. The notes list what was assumed. The same input always gives the same answer.
 */
export function readMailDate(value: string): MailDate | null {
  const stripped = stripComments(value);
  if (stripped.tooDeep || stripped.unclosed) return null;
  if (stripped.text.length > MAX_DATE_CHARACTERS) return null;
  const tokens = tokenize(stripped.text);
  if (tokens === null) return null;

  const notes: string[] = [];
  let lenient = false;
  let i = 0;

  const dayName = tokens[i];
  if (dayName?.kind === 'word' && dayName.text.length === 3 && DAY_NAMES.has(dayName.text.toLowerCase())) {
    i++;
    const comma = tokens[i];
    if (comma?.kind === 'sym' && comma.text === ',') i++;
  }

  const a = tokens[i];
  const b = tokens[i + 1];
  const c = tokens[i + 2];
  let dayText: string;
  let monthText: string;
  let yearText: string;
  if (a?.kind === 'num' && b?.kind === 'word' && c?.kind === 'num') {
    dayText = a.text;
    monthText = b.text;
    yearText = c.text;
  } else if (a?.kind === 'word' && b?.kind === 'num' && c?.kind === 'num') {
    monthText = a.text;
    dayText = b.text;
    yearText = c.text;
    lenient = true;
    notes.push(
      'The date has the month before the day, as the examples of RFC 8601 write it. RFC 5322 puts the day first. It was read anyway.',
    );
  } else {
    return null;
  }
  i += 3;

  if (dayText.length > 2 || monthText.length !== 3) return null;
  const monthIndex = MONTHS.indexOf(monthText.toLowerCase());
  if (monthIndex < 0) return null;
  const day = Number(dayText);

  let year: number;
  if (yearText.length === 2) {
    year = Number(yearText) <= 49 ? 2000 + Number(yearText) : 1900 + Number(yearText);
    notes.push(`The two digit year ${yearText} is read as ${year}, as RFC 5322 section 4.3 says.`);
  } else if (yearText.length === 3) {
    year = 1900 + Number(yearText);
    notes.push(`The three digit year ${yearText} is read as ${year}, as RFC 5322 section 4.3 says.`);
  } else if (yearText.length === 4) {
    year = Number(yearText);
    if (year < 1900) return null;
  } else {
    return null;
  }
  if (day < 1 || day > daysInMonth(year, monthIndex)) return null;

  const hourToken = tokens[i];
  const colon1 = tokens[i + 1];
  const minuteToken = tokens[i + 2];
  if (hourToken?.kind !== 'num' || hourToken.text.length > 2) return null;
  if (colon1?.kind !== 'sym' || colon1.text !== ':') return null;
  if (minuteToken?.kind !== 'num' || minuteToken.text.length > 2) return null;
  i += 3;
  const hour = Number(hourToken.text);
  const minute = Number(minuteToken.text);
  let second = 0;
  const colon2 = tokens[i];
  if (colon2?.kind === 'sym' && colon2.text === ':') {
    const secondToken = tokens[i + 1];
    if (secondToken?.kind !== 'num' || secondToken.text.length > 2) return null;
    second = Number(secondToken.text);
    i += 2;
  }
  if (hour > 23 || minute > 59 || second > 60) return null;

  let offsetMinutes: number;
  const zone = tokens[i];
  if (zone?.kind === 'sym' && (zone.text === '+' || zone.text === '-')) {
    const digits = tokens[i + 1];
    if (digits?.kind !== 'num' || digits.text.length !== 4) return null;
    const zoneHours = Number(digits.text.slice(0, 2));
    const zoneMinutes = Number(digits.text.slice(2));
    if (zoneHours > 23 || zoneMinutes > 59) return null;
    offsetMinutes = (zone.text === '-' ? -1 : 1) * (zoneHours * 60 + zoneMinutes);
    i += 2;
  } else if (zone?.kind === 'word' && zone.text.length <= 5) {
    const known = OBSOLETE_ZONES.get(zone.text.toLowerCase());
    if (known !== undefined) {
      offsetMinutes = known;
      const sign = known < 0 ? '-' : '+';
      const absolute = Math.abs(known);
      const label = `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}${String(absolute % 60).padStart(2, '0')}`;
      notes.push(`The obsolete zone ${zone.text.toUpperCase()} is read as ${label}, as RFC 5322 section 4.3 says.`);
    } else if (zone.text.length === 1) {
      offsetMinutes = 0;
      notes.push(
        `The military zone letter ${zone.text.toUpperCase()} is read as -0000, which RFC 5322 section 4.3 advises because the old meanings are unreliable.`,
      );
    } else {
      offsetMinutes = 0;
      notes.push(
        `The zone ${zone.text.toUpperCase()} is not one RFC 5322 defines, so it is read as -0000, as section 4.3 advises.`,
      );
    }
    i += 1;
  } else {
    return null;
  }
  if (i !== tokens.length) return null;

  const ms = Date.UTC(year, monthIndex, day, hour, minute, second) - offsetMinutes * 60_000;
  if (!Number.isFinite(ms)) return null;
  // A zone can move the last hours of 9999 into the year 10000, which a four digit year cannot name.
  if (ms > LAST_MOMENT_OF_9999) return null;
  return { ms, lenient, notes };
}

/** The instant a mail date states, in milliseconds since 1970, or null when it is not a date. See `readMailDate`. */
export function parseMailDate(value: string): number | null {
  return readMailDate(value)?.ms ?? null;
}

/**
 * An instant as `YYYY-MM-DD HH:MM:SS` in UTC. The ISO text is split at its T, so a year past 9999 or before year 0
 * (written with a sign and six digits) keeps its date and its time of day whole.
 */
export function formatUtc(ms: number): string {
  const iso = new Date(ms).toISOString();
  const t = iso.indexOf('T');
  return `${iso.slice(0, t)} ${iso.slice(t + 1, t + 9)}`;
}

/** A delay as the page shows it: `N s` under a minute and `N min N s` from a minute up; a negative delay has a minus sign. */
export function formatDelay(seconds: number): string {
  const sign = seconds < 0 ? '-' : '';
  const total = Math.abs(seconds);
  if (total < 60) return `${sign}${total} s`;
  return `${sign}${Math.floor(total / 60)} min ${total % 60} s`;
}
