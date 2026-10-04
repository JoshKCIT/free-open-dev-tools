/**
 * ISO 8601 week dates by integer day arithmetic.
 *
 * Weeks start on Monday and week 1 is the week that holds the first Thursday of January, so the Thursday of a week
 * decides which year the week belongs to. Early January can therefore be in the last week of the year before, and late
 * December in week 1 of the next. Nothing here reads a clock, a time zone or a local-time function.
 */

import {
  CalendarDateError,
  dayNumber,
  formatCalendarDate,
  fromDayNumber,
  isoWeekday,
  MAX_YEAR,
  MIN_YEAR,
  type CalendarDate,
} from './calendar-date';

/** Most dates read in one go. */
export const MAX_DATE_LINES = 5_000;

export interface IsoWeekDate {
  /** The week-numbering year, which is not always the calendar year. */
  weekYear: number;
  /** 1 to 52, or 1 to 53 in a long year. */
  week: number;
  /** 1 Monday to 7 Sunday. */
  weekday: number;
  /** The written form `YYYY-Www-D`. */
  text: string;
}

/** The week date of a calendar date: its Thursday sits in the week-numbering year, and the week counts from there. */
export function isoWeekDate(date: CalendarDate): IsoWeekDate {
  const n = dayNumber(date);
  const weekday = isoWeekday(n);
  const thursday = n - weekday + 4;
  const weekYear = fromDayNumber(thursday).year;
  const week = Math.floor((thursday - dayNumber({ year: weekYear, month: 1, day: 1 })) / 7) + 1;
  const text = `${String(weekYear).padStart(4, '0')}-W${String(week).padStart(2, '0')}-${weekday}`;
  return { weekYear, week, weekday, text };
}

/** 53 when 1 January is a Thursday, or a Wednesday in a leap year; otherwise 52. */
export function weeksInIsoYear(year: number): 52 | 53 {
  const startsOn = isoWeekday(dayNumber({ year, month: 1, day: 1 }));
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return startsOn === 4 || (leap && startsOn === 3) ? 53 : 52;
}

/** The Monday that starts a week: week 1 starts on the Monday of the week that holds 4 January. */
export function mondayOfIsoWeek(weekYear: number, week: number): CalendarDate {
  if (!Number.isInteger(weekYear) || weekYear < MIN_YEAR || weekYear > MAX_YEAR) {
    throw new CalendarDateError('The week-numbering year must be from 0001 to 9999.');
  }
  if (!Number.isInteger(week) || week < 1 || week > weeksInIsoYear(weekYear)) {
    throw new CalendarDateError('That week does not exist in that year.');
  }
  const january4 = dayNumber({ year: weekYear, month: 1, day: 4 });
  const firstMonday = january4 - (isoWeekday(january4) - 1);
  return fromDayNumber(firstMonday + (week - 1) * 7);
}

/** The Monday that starts the week of a calendar date, written `YYYY-MM-DD`. */
export function weekStartText(date: CalendarDate): string {
  const n = dayNumber(date);
  return formatCalendarDate(fromDayNumber(n - (isoWeekday(n) - 1)));
}
