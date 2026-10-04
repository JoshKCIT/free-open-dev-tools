import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  dayNumber,
  formatCalendarDate,
  fromDayNumber,
  isoWeekDate,
  isoWeekday,
  mondayOfIsoWeek,
  parseCalendarDate,
  weekStartText,
  weeksInIsoYear,
} from '../src/index';

/**
 * ISO 8601 week dates are compared with a table that Python recorded: date.isocalendar() for every year 1900 to 2200
 * (the week count and the Monday that starts week 1), for 5,000 seeded dates, for the days around every year end and
 * for a few extreme dates, written down by test/fixtures/make-tables.py (Python and its date are in the file's header
 * and in test/fixtures/README.md). The browser's own Temporal is a second opinion in e2e/dev-oracles.spec.ts.
 */
type WeekRow = [string, number, number, number];

const table = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/iso-weeks.json', import.meta.url)), 'utf8'),
) as {
  python: string;
  years: { year: number; weeks: number; week1Monday: string }[];
  dates: WeekRow[];
  boundaries: WeekRow[];
  extremes: WeekRow[];
};

const spies = {
  log: vi.spyOn(console, 'log'),
  warn: vi.spyOn(console, 'warn'),
  error: vi.spyOn(console, 'error'),
};

beforeEach(() => {
  for (const spy of Object.values(spies)) spy.mockClear();
});

afterEach(() => {
  for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
});

function disagreements(rows: WeekRow[]): string[] {
  const bad: string[] = [];
  for (const [text, weekYear, week, weekday] of rows) {
    const got = isoWeekDate(parseCalendarDate(text));
    const same = got.weekYear === weekYear && got.week === week && got.weekday === weekday;
    const written = `${String(weekYear).padStart(4, '0')}-W${String(week).padStart(2, '0')}-${weekday}`;
    if (!same || got.text !== written) bad.push(text);
  }
  return bad;
}

it('ISO week numbers agree with Python isocalendar from 1900 to 2200', () => {
  expect(table.python).toMatch(/^3[.]\d+[.]\d+$/);
  expect(table.years).toHaveLength(301);
  expect(table.years[0]!.year).toBe(1900);
  expect(table.years[300]!.year).toBe(2200);
  expect(table.dates).toHaveLength(5000);

  const yearProblems: number[] = [];
  for (const row of table.years) {
    const monday = formatCalendarDate(mondayOfIsoWeek(row.year, 1));
    if (weeksInIsoYear(row.year) !== row.weeks || monday !== row.week1Monday) yearProblems.push(row.year);
  }
  expect(yearProblems).toEqual([]);
  expect(disagreements(table.dates)).toEqual([]);
  expect(table.boundaries.length).toBeGreaterThan(4000);
  expect(disagreements(table.boundaries)).toEqual([]);
  expect(disagreements(table.extremes)).toEqual([]);

  // The week count of the last week really is where the year ends: its Monday, 6 days on, still belongs to that year.
  for (const row of table.years) {
    const last = mondayOfIsoWeek(row.year, row.weeks);
    const sunday = isoWeekDate(fromDayNumber(dayNumber(last) + 6));
    expect([sunday.weekYear, sunday.week, sunday.weekday]).toEqual([row.year, row.weeks, 7]);
  }
}, 60_000);

it('2021-01-03 is in week 53 of 2020 and years with 53 weeks are named', () => {
  // The date the week-numbering rule is usually checked with (Python: date(2021, 1, 3).isocalendar() is 2020, 53, 7).
  const sunday = isoWeekDate(parseCalendarDate('2021-01-03'));
  expect(sunday).toEqual({ weekYear: 2020, week: 53, weekday: 7, text: '2020-W53-7' });
  expect(weeksInIsoYear(2020)).toBe(53);
  expect(weeksInIsoYear(2021)).toBe(52);
  expect(formatCalendarDate(mondayOfIsoWeek(2020, 53))).toBe('2020-12-28');
  expect(formatCalendarDate(mondayOfIsoWeek(2021, 1))).toBe('2021-01-04');
  expect(weekStartText(parseCalendarDate('2021-01-03'))).toBe('2020-12-28');
  expect(weekStartText(parseCalendarDate('2020-12-28'))).toBe('2020-12-28');
  // Late December in week 1 of the next year, early January in the last week of the year before.
  expect(isoWeekDate(parseCalendarDate('2024-12-30')).text).toBe('2025-W01-1');
  expect(isoWeekDate(parseCalendarDate('2027-01-01')).text).toBe('2026-W53-5');
  expect(isoWeekDate(parseCalendarDate('2009-12-31')).text).toBe('2009-W53-4');
  expect(isoWeekDate(parseCalendarDate('2010-01-03')).text).toBe('2009-W53-7');

  // The years from 1990 to 2040 with 53 weeks, as Python's date(year, 12, 28).isocalendar().week gave them.
  const long = [];
  for (let year = 1990; year <= 2040; year++) if (weeksInIsoYear(year) === 53) long.push(year);
  expect(long).toEqual([1992, 1998, 2004, 2009, 2015, 2020, 2026, 2032, 2037]);

  // 28 December is always in the last week of its year and 4 January always in week 1, in every year 0001 to 9999.
  // Weeks start on a Monday: the Monday of a week is the day number minus the weekday minus one.
  const bad: number[] = [];
  for (let year = 1; year <= 9999; year++) {
    const december28 = isoWeekDate({ year, month: 12, day: 28 });
    const january4 = isoWeekDate({ year, month: 1, day: 4 });
    const monday = dayNumber({ year, month: 12, day: 28 }) - (december28.weekday - 1);
    if (
      december28.weekYear !== year ||
      december28.week !== weeksInIsoYear(year) ||
      january4.weekYear !== year ||
      january4.week !== 1 ||
      isoWeekday(monday) !== 1
    ) {
      bad.push(year);
    }
  }
  expect(bad).toEqual([]);
  // The first and last days of the calendar (Python: date(1, 1, 1) is 1, 1, 1 and date(9999, 12, 31) is 9999, 52, 5).
  expect(isoWeekDate(parseCalendarDate('0001-01-01')).text).toBe('0001-W01-1');
  expect(isoWeekDate(parseCalendarDate('9999-12-31')).text).toBe('9999-W52-5');
});
