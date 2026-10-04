import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  CalendarDateError,
  MAX_HOLIDAY_LINES,
  countBusinessDays,
  dayNumber,
  isoWeekDate,
  fromDayNumber,
  formatCalendarDate,
  parseCalendarDate,
  parseIsoDuration,
  parseWeekend,
  readDateLines,
} from '../src/index';

/**
 * Business day counts are compared with a table that Python recorded: a plain day-by-day loop over date.toordinal()
 * with date.isoweekday(), written down by test/fixtures/make-tables.py (Python and its date are in the file's header
 * and in test/fixtures/README.md). The hand-worked cases below were checked by the same loop.
 */
interface BusinessRow {
  start: string;
  end: string;
  weekend: number[];
  holidays: string[];
  includeEnd: boolean;
  count: number;
  sign: 1 | -1;
  calendarDays: number;
  weekendDays: number;
  holidaysSkipped: number;
  holidaysOnWeekend: number;
}

const table = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/business-days.json', import.meta.url)), 'utf8'),
) as { python: string; seed: number; rows: BusinessRow[] };

const day = (text: string): number => dayNumber(parseCalendarDate(text));

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

const SAT_SUN = new Set([6, 7]);
const MARKER = 'FODT-MARKER-3141';

function count(start: string, end: string, weekend: ReadonlySet<number>, holidays: string[], includeEnd: boolean) {
  return countBusinessDays({ start: day(start), end: day(end), weekend, holidays: holidays.map(day), includeEnd });
}

it('business days between two dates skip the chosen weekend days and typed holidays, counted once', () => {
  // 2024-01-01 is a Monday and 2024-01-06 a Saturday (date.isoweekday() in Python gives 1 and 6).
  const plain = count('2024-01-01', '2024-01-08', SAT_SUN, [], false);
  expect(plain.count).toBe(5);
  expect(plain.calendarDays).toBe(7);
  expect(plain.weekendDays).toBe(2);
  expect(count('2024-01-01', '2024-01-08', SAT_SUN, [], true).count).toBe(6);

  // A holiday on a Saturday changes nothing: it is a weekend day already, and is reported as such.
  const onWeekend = count('2024-01-01', '2024-01-08', SAT_SUN, ['2024-01-06'], false);
  expect(onWeekend.count).toBe(5);
  expect(onWeekend.holidaysOnWeekend).toBe(1);
  expect(onWeekend.holidaysSkipped).toBe(0);

  // A holiday on a Wednesday takes one day away, however many times it is typed.
  const onWednesday = count('2024-01-01', '2024-01-08', SAT_SUN, ['2024-01-03', '2024-01-03', '2024-01-03'], false);
  expect(onWednesday.count).toBe(4);
  expect(onWednesday.holidaysSkipped).toBe(1);

  // Other weekend sets: Friday and Saturday; none; Sunday only with a Sunday holiday and a Wednesday holiday.
  expect(count('2024-01-01', '2024-01-08', new Set([5, 6]), [], false).count).toBe(5);
  expect(count('2024-01-01', '2024-01-08', new Set(), [], false).count).toBe(7);
  expect(count('2024-01-01', '2024-01-08', new Set([7]), ['2024-01-03', '2024-01-07'], true).count).toBe(6);

  // A holiday outside the range, or on the end day when the end is not counted, takes nothing away.
  expect(count('2024-01-01', '2024-01-08', SAT_SUN, ['2023-12-25', '2024-01-08', '2024-02-01'], false).count).toBe(5);
  expect(count('2024-01-01', '2024-01-08', SAT_SUN, ['2024-01-08'], true).count).toBe(5);

  // The same worked example is a row of the recorded table, so Python agrees.
  const recorded = table.rows.find(
    (row) => row.start === '2024-01-01' && row.end === '2024-01-08' && row.holidays.join() === '2024-01-06',
  );
  expect(recorded?.count).toBe(5);
});

it('business day counts agree with the recorded Python table', () => {
  expect(table.rows.length).toBeGreaterThanOrEqual(500);
  expect(table.python).toMatch(/^3[.]\d+[.]\d+$/);
  const seen = { reversed: 0, equal: 0, included: 0, noWeekend: 0, holidays: 0, huge: 0 };
  const disagreements: string[] = [];
  const started = Date.now();
  const results = table.rows.map((row) =>
    countBusinessDays({
      start: day(row.start),
      end: day(row.end),
      weekend: new Set(row.weekend),
      holidays: row.holidays.map(day),
      includeEnd: row.includeEnd,
    }),
  );
  const elapsed = Date.now() - started;
  table.rows.forEach((row, index) => {
    const got = results[index]!;
    if (row.sign === -1) seen.reversed++;
    if (row.start === row.end) seen.equal++;
    if (row.includeEnd) seen.included++;
    if (row.weekend.length === 0) seen.noWeekend++;
    if (row.holidays.length > 0) seen.holidays++;
    if (row.calendarDays > 1_000_000) seen.huge++;
    const same =
      got.count === row.count &&
      got.sign === row.sign &&
      got.calendarDays === row.calendarDays &&
      got.weekendDays === row.weekendDays &&
      got.holidaysSkipped === row.holidaysSkipped &&
      got.holidaysOnWeekend === row.holidaysOnWeekend;
    if (!same) disagreements.push(`${row.start} ${row.end} [${row.weekend}] ${row.includeEnd}`);
  });
  expect(disagreements).toEqual([]);
  // The table reaches every kind of case that matters.
  expect(seen.reversed).toBeGreaterThan(50);
  expect(seen.equal).toBeGreaterThan(20);
  expect(seen.included).toBeGreaterThan(200);
  expect(seen.noWeekend).toBeGreaterThan(10);
  expect(seen.holidays).toBeGreaterThan(200);
  expect(seen.huge).toBeGreaterThanOrEqual(2);
  // Whole-week arithmetic: 579 ranges, three of them thousands of years long, take a moment, not a day-by-day walk.
  expect(elapsed).toBeLessThan(2000);
}, 60_000);

it('a start equal to the end and an end before the start follow the stated rule', () => {
  // Monday 2024-01-01: one business day with the end counted, none with it left out.
  expect(count('2024-01-01', '2024-01-01', SAT_SUN, [], true).count).toBe(1);
  expect(count('2024-01-01', '2024-01-01', SAT_SUN, [], false).count).toBe(0);
  // Saturday 2024-01-06 is a weekend day: nothing either way. A holiday on a Monday also leaves nothing.
  expect(count('2024-01-06', '2024-01-06', SAT_SUN, [], true).count).toBe(0);
  expect(count('2024-01-06', '2024-01-06', SAT_SUN, [], false).count).toBe(0);
  expect(count('2024-01-01', '2024-01-01', SAT_SUN, ['2024-01-01'], true).count).toBe(0);
  expect(count('2024-01-01', '2024-01-01', SAT_SUN, [], true).sign).toBe(1);

  // An end before the start counts the same days as the range from the earlier date to the later one, with a minus sign.
  const forward = count('2024-01-01', '2024-01-08', SAT_SUN, ['2024-01-03'], false);
  const backward = count('2024-01-08', '2024-01-01', SAT_SUN, ['2024-01-03'], false);
  expect(forward.sign).toBe(1);
  expect(backward.sign).toBe(-1);
  expect({ ...backward, sign: 1 }).toEqual(forward);
  expect(count('2024-01-08', '2024-01-01', SAT_SUN, [], true).count).toBe(6);
  expect(count('2024-01-08', '2024-01-01', SAT_SUN, [], true).sign).toBe(-1);

  // The recorded table holds the same cases: Python counted every reversed and every equal range.
  const reversed = table.rows.filter((row) => row.sign === -1);
  const equal = table.rows.filter((row) => row.start === row.end);
  expect(reversed.length).toBeGreaterThan(50);
  expect(equal.length).toBeGreaterThan(20);
  for (const row of [...reversed, ...equal]) {
    const got = countBusinessDays({
      start: day(row.start),
      end: day(row.end),
      weekend: new Set(row.weekend),
      holidays: row.holidays.map(day),
      includeEnd: row.includeEnd,
    });
    expect([got.count, got.sign]).toEqual([row.count, row.sign]);
  }
});

it('dates outside years 1 to 9999 and holiday lists over 5000 lines are refused with fixed messages', () => {
  const refusal = (text: string): CalendarDateError | undefined => {
    try {
      parseCalendarDate(text);
    } catch (error) {
      return error instanceof CalendarDateError ? error : undefined;
    }
    return undefined;
  };
  // Years 0001 and 9999 are dates; 0000 and 10000 are not.
  expect(formatCalendarDate(parseCalendarDate('0001-01-01'))).toBe('0001-01-01');
  expect(formatCalendarDate(parseCalendarDate('9999-12-31'))).toBe('9999-12-31');
  expect(refusal('0000-01-01')?.message).toBe('The year must be from 0001 to 9999.');
  expect(refusal('10000-01-01')?.message).toMatch(/^A date must be written YYYY-MM-DD/);
  expect(refusal('2024-13-01')?.message).toBe('The month must be from 01 to 12.');
  expect(refusal('2024-00-10')?.message).toBe('The month must be from 01 to 12.');
  expect(refusal('2023-02-29')?.message).toBe('That day does not exist in that month.');
  expect(refusal('2024-04-31')?.message).toBe('That day does not exist in that month.');
  expect(parseCalendarDate('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
  expect(refusal('1900-02-29')?.message).toBe('That day does not exist in that month.');
  expect(parseCalendarDate('2000-02-29')).toEqual({ year: 2000, month: 2, day: 29 });
  // A time, a zone, another separator or nothing at all is not a date here.
  for (const text of ['2024-01-31T12:00:00Z', '2024/01/31', '31-01-2024', '2024-1-31', '', '   ', '2024-01-3x']) {
    expect(refusal(text)?.message).toMatch(/^A date must be written YYYY-MM-DD/);
  }
  // The message never holds the text, so pasted text cannot come back through it.
  for (const text of [`${MARKER}`, `2024-01-${MARKER}`, `${MARKER}-01-01`, `0000-${MARKER}`, '9'.repeat(5000)]) {
    expect(refusal(text)?.message).not.toContain(MARKER);
    expect(refusal(text)?.message.length).toBeLessThan(120);
  }

  // A list of 5,000 lines is read; 5,001 is refused before any line is parsed.
  const lines = (n: number) => Array.from({ length: n }, () => '2024-01-02').join('\n');
  expect(readDateLines(lines(MAX_HOLIDAY_LINES), MAX_HOLIDAY_LINES, 200_000).dates).toHaveLength(MAX_HOLIDAY_LINES);
  expect(readDateLines(lines(MAX_HOLIDAY_LINES) + '\n', MAX_HOLIDAY_LINES, 200_000).dates).toHaveLength(
    MAX_HOLIDAY_LINES,
  );
  let tooMany: CalendarDateError | undefined;
  try {
    readDateLines(lines(MAX_HOLIDAY_LINES + 1), MAX_HOLIDAY_LINES, 200_000);
  } catch (error) {
    tooMany = error as CalendarDateError;
  }
  expect(tooMany).toBeInstanceOf(CalendarDateError);
  expect(tooMany?.message).toBe('The list has more than 5000 lines. The limit is 5000.');
  // A paste of millions of line breaks is refused by its size, in a moment.
  const huge = '\n'.repeat(5_000_000);
  const started = Date.now();
  let tooLong: CalendarDateError | undefined;
  try {
    readDateLines(huge, MAX_HOLIDAY_LINES, 200_000);
  } catch (error) {
    tooLong = error as CalendarDateError;
  }
  const elapsed = Date.now() - started;
  expect(tooLong?.message).toBe(
    'This paste is 5000000 characters. The limit is 200000 because a list holds at most 5000 dates.',
  );
  expect(elapsed).toBeLessThan(1000);
  // Line numbers count blank lines, bad lines are reported by number with fixed sentences, good lines are kept.
  const mixed = readDateLines(`2024-01-01\r\n\r\nnot a date ${MARKER}\n2024-02-30\r2024-03-01`, 100, 10_000);
  expect(mixed.dates.map((entry) => [entry.line, formatCalendarDate(entry.date)])).toEqual([
    [1, '2024-01-01'],
    [5, '2024-03-01'],
  ]);
  expect(mixed.problems.map((problem) => problem.line)).toEqual([3, 4]);
  expect(JSON.stringify(mixed.problems)).not.toContain(MARKER);
}, 60_000);

it('weekend names and numbers are read in any case and lookups treat __proto__, constructor and toString as unknown', () => {
  expect([...parseWeekend('Sat, Sun')].sort()).toEqual([6, 7]);
  expect([...parseWeekend('saturday sunday')].sort()).toEqual([6, 7]);
  expect([...parseWeekend('SAT,SUN')].sort()).toEqual([6, 7]);
  expect([...parseWeekend('6 7')].sort()).toEqual([6, 7]);
  expect([...parseWeekend('5,6')].sort()).toEqual([5, 6]);
  expect([...parseWeekend('Fri Sat 7')].sort()).toEqual([5, 6, 7]);
  expect([...parseWeekend('Mon, TUE, wed, Thu, fri, Sat')].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  expect([...parseWeekend('Monday Tuesday Wednesday Thursday Friday Saturday')].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  expect(parseWeekend('Sun,Sun,7')).toEqual(new Set([7]));
  // Nothing typed means no weekend days.
  expect(parseWeekend('').size).toBe(0);
  expect(parseWeekend('  ,  ').size).toBe(0);

  const refusals = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'Satur', '0', '8', '12', 'x'];
  for (const text of refusals) {
    expect(() => parseWeekend(text), text).toThrow(CalendarDateError);
    expect(() => parseWeekend(`Sat, ${text}`), text).toThrow(CalendarDateError);
  }
  // All seven days leave no business days at all.
  expect(() => parseWeekend('1 2 3 4 5 6 7')).toThrow(CalendarDateError);
  expect(() => parseWeekend('Mon Tue Wed Thu Fri Sat Sun')).toThrow(CalendarDateError);
  // Messages are fixed sentences and do not repeat the text, whatever is pasted.
  for (const text of [`${MARKER}`, `Sat ${MARKER}`, 'x'.repeat(5000)]) {
    let message = '';
    try {
      parseWeekend(text);
    } catch (error) {
      message = (error as CalendarDateError).message;
    }
    expect(message).not.toBe('');
    expect(message).not.toContain(MARKER);
    expect(message.length).toBeLessThan(160);
  }
});

it('nothing is written to the console while counting, numbering or parsing', () => {
  const holidays = Array.from({ length: 500 }, (_, index) => day('2024-01-01') + index);
  countBusinessDays({ start: day('2024-01-01'), end: day('2030-01-01'), weekend: SAT_SUN, holidays, includeEnd: true });
  parseWeekend('Sat, Sun');
  try {
    parseWeekend('nonsense');
  } catch {
    // refused, and still silent
  }
  readDateLines('2024-01-01\nbad\n', 10, 100);
  isoWeekDate(parseCalendarDate('2021-01-03'));
  parseIsoDuration('P1Y2M3W4DT5H6M7.5S');
  try {
    parseIsoDuration('P');
  } catch {
    // refused, and still silent
  }
  expect(formatCalendarDate(fromDayNumber(day('2024-02-29')))).toBe('2024-02-29');
  // The after-each hook asserts that the console was not touched.
});
