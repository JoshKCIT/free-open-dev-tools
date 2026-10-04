/**
 * Calendar dates for the business day and ISO week code: a date-only reader with fixed messages and whole day numbers.
 *
 * Everything here is integer arithmetic on the proleptic Gregorian calendar. Nothing reads the clock, a time zone or a
 * local-time function, so an answer is the same on every machine. A message never repeats the text it was given.
 */

/** A problem with a date, a list of dates, a weekend or a duration. `line` is the 1-based line of a pasted list. */
export class CalendarDateError extends Error {
  readonly line?: number;
  constructor(message: string, line?: number) {
    super(message);
    this.name = 'CalendarDateError';
    this.line = line;
  }
}

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export const MIN_YEAR = 1;
export const MAX_YEAR = 9999;

const MESSAGE_FORMAT = 'A date must be written YYYY-MM-DD, with a year from 0001 to 9999, such as 2024-01-31.';
const MESSAGE_YEAR = 'The year must be from 0001 to 9999.';
const MESSAGE_MONTH = 'The month must be from 01 to 12.';
const MESSAGE_DAY = 'That day does not exist in that month.';

/** Longest text the date reader looks at; anything longer cannot be a date and is refused without being scanned. */
const MAX_DATE_TEXT = 64;

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Days in a month of a year (month 1 to 12). */
export function monthLength(year: number, month: number): number {
  return month === 2 && isLeap(year) ? 29 : MONTH_LENGTHS[month - 1]!;
}

function digitValue(code: number): number {
  return code >= 48 && code <= 57 ? code - 48 : -1;
}

/** Reads `count` digits from `text` starting at `at`, or returns -1 when one of them is not a digit. */
function readDigits(text: string, at: number, count: number): number {
  let value = 0;
  for (let i = 0; i < count; i++) {
    const digit = digitValue(text.charCodeAt(at + i));
    if (digit < 0) return -1;
    value = value * 10 + digit;
  }
  return value;
}

/**
 * Reads `YYYY-MM-DD` (years 0001 to 9999, surrounding white space allowed). Anything else is refused with a fixed
 * sentence; the text is never repeated. A time, a zone or a five-digit year is not a date here.
 */
export function parseCalendarDate(text: string, line?: number): CalendarDate {
  if (text.length > MAX_DATE_TEXT) throw new CalendarDateError(MESSAGE_FORMAT, line);
  const trimmed = text.trim();
  if (trimmed.length !== 10 || trimmed.charCodeAt(4) !== 45 || trimmed.charCodeAt(7) !== 45) {
    throw new CalendarDateError(MESSAGE_FORMAT, line);
  }
  const year = readDigits(trimmed, 0, 4);
  const month = readDigits(trimmed, 5, 2);
  const day = readDigits(trimmed, 8, 2);
  if (year < 0 || month < 0 || day < 0) throw new CalendarDateError(MESSAGE_FORMAT, line);
  if (year < MIN_YEAR) throw new CalendarDateError(MESSAGE_YEAR, line);
  if (month < 1 || month > 12) throw new CalendarDateError(MESSAGE_MONTH, line);
  if (day < 1 || day > monthLength(year, month)) throw new CalendarDateError(MESSAGE_DAY, line);
  return { year, month, day };
}

/** The date as `YYYY-MM-DD` with a four-digit year. */
export function formatCalendarDate(date: CalendarDate): string {
  const pad = (value: number, width: number) => String(value).padStart(width, '0');
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

/**
 * Whole days since 1970-01-01 (that day is 0, earlier days are negative), by the days-from-civil method: the year
 * starts in March so the leap day is the last day of the cycle, and 400 years are 146,097 days.
 */
export function dayNumber(date: CalendarDate): number {
  const y = date.month <= 2 ? date.year - 1 : date.year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const shiftedMonth = date.month > 2 ? date.month - 3 : date.month + 9;
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + date.day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** The date for a day number made by `dayNumber`. */
export function fromDayNumber(n: number): CalendarDate {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365,
  );
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * shiftedMonth + 2) / 5) + 1;
  const month = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9;
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  return { year, month, day };
}

/** ISO weekday of a day number: 1 Monday to 7 Sunday (1970-01-01, day 0, was a Thursday). */
export function isoWeekday(n: number): number {
  return ((((n + 3) % 7) + 7) % 7) + 1;
}

export interface DateLine {
  line: number;
  date: CalendarDate;
}

export interface DateLineProblem {
  line: number;
  message: string;
}

export interface DateLines {
  /** The lines that held a date, with their 1-based line numbers. */
  dates: DateLine[];
  /** The lines that held something else, each with a fixed sentence. */
  problems: DateLineProblem[];
}

/**
 * Reads a pasted list with one date per line. Blank lines are skipped (and still count towards line numbers); a line
 * break is a line feed, a carriage return or both. A list longer than `maxLines` lines, or a paste longer than
 * `maxCharacters`, is refused before anything is parsed. Bad lines are collected, never repeated.
 */
export function readDateLines(text: string, maxLines: number, maxCharacters: number): DateLines {
  if (text.length > maxCharacters) {
    throw new CalendarDateError(
      `This paste is ${text.length} characters. The limit is ${maxCharacters} because a list holds at most ${maxLines} dates.`,
    );
  }
  const dates: DateLine[] = [];
  const problems: DateLineProblem[] = [];
  let lineNumber = 0;
  let start = 0;
  const length = text.length;
  while (start < length) {
    let end = start;
    while (end < length) {
      const code = text.charCodeAt(end);
      if (code === 10 || code === 13) break;
      end++;
    }
    lineNumber++;
    if (lineNumber > maxLines) {
      throw new CalendarDateError(`The list has more than ${maxLines} lines. The limit is ${maxLines}.`);
    }
    const lineText = text.slice(start, end);
    if (lineText.trim() !== '') {
      try {
        dates.push({ line: lineNumber, date: parseCalendarDate(lineText, lineNumber) });
      } catch (error) {
        if (!(error instanceof CalendarDateError)) throw error;
        problems.push({ line: lineNumber, message: error.message });
      }
    }
    if (end < length && text.charCodeAt(end) === 13 && text.charCodeAt(end + 1) === 10) end++;
    start = end + 1;
  }
  return { dates, problems };
}
