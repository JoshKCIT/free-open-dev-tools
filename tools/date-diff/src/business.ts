/**
 * Business days between two dates: whole-week arithmetic, chosen weekend days and typed holidays.
 *
 * The count never walks the days of the range. A range is some whole weeks (each holds the same number of weekend
 * days) plus a remainder of fewer than seven days that is checked day by day. Holidays are de-duplicated and each is
 * looked at once, so the work is linear in the number of holidays and does not depend on how far apart the dates are.
 */

import { CalendarDateError, isoWeekday } from './calendar-date';

/** Most holiday lines read in one go. */
export const MAX_HOLIDAY_LINES = 5_000;

const WEEKDAY_NAMES = new Map<string, number>([
  ['monday', 1],
  ['mon', 1],
  ['tuesday', 2],
  ['tue', 2],
  ['wednesday', 3],
  ['wed', 3],
  ['thursday', 4],
  ['thu', 4],
  ['friday', 5],
  ['fri', 5],
  ['saturday', 6],
  ['sat', 6],
  ['sunday', 7],
  ['sun', 7],
]);

const MAX_WEEKEND_TEXT = 200;
const MESSAGE_WEEKEND_TOKEN =
  'Weekend days must be names such as Sat or Sunday, or ISO numbers from 1 (Monday) to 7 (Sunday), separated by commas or spaces.';
const MESSAGE_WEEKEND_TOO_LONG = `The weekend text is longer than ${MAX_WEEKEND_TEXT} characters.`;
const MESSAGE_WEEKEND_ALL = 'At most six days can be weekend days; with all seven there would be no business days.';

/**
 * Reads the weekend days: English day names (full or three letters, any case) or ISO weekday numbers 1 (Monday) to
 * 7 (Sunday), separated by commas or white space. An empty text means no weekend days. More than six different
 * days, or anything else, is refused with a fixed sentence.
 */
export function parseWeekend(text: string): Set<number> {
  if (text.length > MAX_WEEKEND_TEXT) throw new CalendarDateError(MESSAGE_WEEKEND_TOO_LONG);
  const days = new Set<number>();
  let token = '';
  const flush = (): void => {
    if (token === '') return;
    const lower = token.toLowerCase();
    let day = WEEKDAY_NAMES.get(lower);
    if (day === undefined && lower.length === 1 && lower >= '1' && lower <= '7') day = lower.charCodeAt(0) - 48;
    if (day === undefined) throw new CalendarDateError(MESSAGE_WEEKEND_TOKEN);
    days.add(day);
    token = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch === ',' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') flush();
    else token += ch;
  }
  flush();
  if (days.size > 6) throw new CalendarDateError(MESSAGE_WEEKEND_ALL);
  return days;
}

export interface BusinessDayInput {
  /** Day numbers from `dayNumber`. */
  start: number;
  end: number;
  /** ISO weekday numbers 1 to 7 that are not working days. */
  weekend: ReadonlySet<number>;
  /** Day numbers of the typed holidays; repeated days count once. */
  holidays: readonly number[];
  /** Whether the end day is itself counted. The start day always is. */
  includeEnd: boolean;
}

export interface BusinessDayCount {
  /** The business days, never negative. */
  count: number;
  /** -1 when the end is before the start, otherwise 1. */
  sign: 1 | -1;
  /** Days in the counted range, weekend days and holidays included. */
  calendarDays: number;
  /** Weekend days in the counted range. */
  weekendDays: number;
  /** Different holidays in the counted range that fall on a working day (each took one business day away). */
  holidaysSkipped: number;
  /** Different holidays in the counted range that fall on a weekend day (nothing more to take away). */
  holidaysOnWeekend: number;
}

/**
 * Counts the days from `start` to `end` that are neither weekend days nor holidays. The start is always counted; the
 * end only with `includeEnd`. With the end before the start the range is mirrored and still counts the start: it covers
 * the day after the end (the end itself with `includeEnd`) up to and including the start, and reports `sign: -1`. A
 * start equal to the end gives 1 or 0 for a business day (by the end rule) and 0 for a weekend day or a holiday.
 */
export function countBusinessDays(input: BusinessDayInput): BusinessDayCount {
  const { start, end, weekend, holidays, includeEnd } = input;
  const reversed = end < start;
  const sign: 1 | -1 = reversed ? -1 : 1;
  // The first and last day counted. Forward: the start up to the end (the end only when counted). Reversed: from the
  // day after the end (the end when counted) up to and including the start, so the start day is never dropped.
  const low = reversed ? (includeEnd ? end : end + 1) : start;
  const last = reversed ? start : includeEnd ? end : end - 1;
  const calendarDays = last < low ? 0 : last - low + 1;

  // Whole weeks hold the same number of weekend days; the remainder is looked at one day at a time.
  const wholeWeeks = Math.floor(calendarDays / 7);
  let weekendDays = wholeWeeks * weekend.size;
  for (let day = low + wholeWeeks * 7; day <= last; day++) {
    if (weekend.has(isoWeekday(day))) weekendDays++;
  }

  let holidaysSkipped = 0;
  let holidaysOnWeekend = 0;
  const seen = new Set<number>();
  for (const holiday of holidays) {
    if (holiday < low || holiday > last || seen.has(holiday)) continue;
    seen.add(holiday);
    if (weekend.has(isoWeekday(holiday))) holidaysOnWeekend++;
    else holidaysSkipped++;
  }

  return {
    count: calendarDays - weekendDays - holidaysSkipped,
    sign,
    calendarDays,
    weekendDays,
    holidaysSkipped,
    holidaysOnWeekend,
  };
}
