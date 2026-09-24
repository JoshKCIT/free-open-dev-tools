import { it, expect } from 'vitest';
import { meta, parseCron, nextRuns, describeCron, CronError, DIALECTS } from '../src/index';

const FROM = new Date('2024-01-01T00:00:00Z');

function isoRuns(expression: string, count: number, from: Date = FROM): string[] {
  const parsed = parseCron(expression, 'unix');
  const result = nextRuns(parsed, from, count);
  return result.runs.map((d) => d.toISOString());
}

it('has a meta export and lists the unix dialect', () => {
  expect(meta.id).toBe('cron-expression');
  expect(DIALECTS).toContain('unix');
});

// crontab(5), fetched live 2026-09-24 from man7.org/linux/man-pages/man5/crontab.5.html:
// "'30 4 1,15 * 5' would cause a command to be run at 4:30 am on the 1st
// and 15th of each month, plus every Friday." — the man page's own worked
// example of the either-day OR rule.
it('crontab(5) worked example 30 4 1,15 * 5 runs on the 1st, the 15th and every Friday', () => {
  expect(isoRuns('30 4 1,15 * 5', 5)).toEqual([
    '2024-01-01T04:30:00.000Z', // Monday the 1st
    '2024-01-05T04:30:00.000Z', // Friday
    '2024-01-12T04:30:00.000Z', // Friday
    '2024-01-15T04:30:00.000Z', // Monday the 15th
    '2024-01-19T04:30:00.000Z', // Friday
  ]);
});

// crontab(5)'s own OR rule is defined by a literal test on the field's
// SOURCE TEXT ("do not contain the * character"), not by whether the
// field's resolved value set happens to be its full range. "*/2" contains
// "*" and so is not restricted, even though it only matches half the
// days in the month — cron-parser 5.10.1 disagrees with this reading (it
// treats "*/2" as restricted and applies the OR rule anyway, confirmed
// empirically this session: it returns every odd day of the month PLUS
// every Friday, including even Fridays such as 2024-01-12), so this case
// is checked here against the manual's own wording, not differentially.
it('a day-of-month step starting with an asterisk does not trigger the either-day rule', () => {
  // dayOfMonth "*/2" is NOT restricted (contains "*"); dayOfWeek "5" IS
  // restricted. Only one field restricted -> AND, not OR: the day must be
  // both an odd day-of-month AND a Friday.
  expect(isoRuns('0 0 */2 * 5', 4)).toEqual([
    '2024-01-05T00:00:00.000Z', // Friday, day 5 (odd)
    '2024-01-19T00:00:00.000Z', // Friday, day 19 (odd)
    '2024-02-09T00:00:00.000Z', // Friday, day 9 (odd)
    '2024-02-23T00:00:00.000Z', // Friday, day 23 (odd)
  ]);
  // 2024-01-12 and 2024-01-26 are also Fridays, but fall on an EVEN day
  // of the month, so under the manual's AND reading they are excluded.
  expect(isoRuns('0 0 */2 * 5', 4)).not.toContain('2024-01-12T00:00:00.000Z');
  expect(isoRuns('0 0 */2 * 5', 4)).not.toContain('2024-01-26T00:00:00.000Z');
});

it('steps, ranges, month and weekday names and 7 for Sunday follow crontab(5)', () => {
  // "*/23" in the hours field: crontab(5) NOTES section says this means
  // the hour 0 and the hour 23 within a calendar day, not every 23 hours.
  expect(isoRuns('0 */23 * * *', 4)).toEqual([
    '2024-01-01T23:00:00.000Z',
    '2024-01-02T00:00:00.000Z',
    '2024-01-02T23:00:00.000Z',
    '2024-01-03T00:00:00.000Z',
  ]);
  // Month and weekday names, in ranges and lists, case-insensitively.
  expect(isoRuns('0 9 * jan-mar mon,wed,fri', 3)).toEqual(isoRuns('0 9 * JAN-MAR MON,WED,FRI', 3));
  expect(isoRuns('0 9 * jan-mar mon,wed,fri', 3)).toEqual([
    '2024-01-01T09:00:00.000Z', // Monday
    '2024-01-03T09:00:00.000Z', // Wednesday
    '2024-01-05T09:00:00.000Z', // Friday
  ]);
  // "0 or 7 is Sunday" — both spellings mean the same field.
  expect(isoRuns('0 0 * * 0', 3)).toEqual(isoRuns('0 0 * * 7', 3));
  expect(isoRuns('0 0 * * 0', 1)).toEqual(['2024-01-07T00:00:00.000Z']); // the first Sunday after Jan 1 (a Monday)
});

it('crontab(5) macros expand to their documented schedules and at-reboot is rejected', () => {
  expect(isoRuns('@weekly', 2)).toEqual(isoRuns('0 0 * * 0', 2));
  expect(isoRuns('@yearly', 1)).toEqual(isoRuns('0 0 1 1 *', 1));
  expect(isoRuns('@annually', 1)).toEqual(isoRuns('0 0 1 1 *', 1));
  expect(isoRuns('@monthly', 1)).toEqual(isoRuns('0 0 1 * *', 1));
  expect(isoRuns('@daily', 1)).toEqual(isoRuns('0 0 * * *', 1));
  // cronie's own src/entry.c: `!strcmp("daily", cmd) || !strcmp("midnight", cmd)`
  // -- both macros build the identical schedule.
  expect(isoRuns('@midnight', 1)).toEqual(isoRuns('0 0 * * *', 1));
  expect(isoRuns('@hourly', 1)).toEqual(isoRuns('0 * * * *', 1));
  expect(() => parseCron('@reboot', 'unix')).toThrow(CronError);
  expect(() => parseCron('@reboot', 'unix')).toThrow(/no fixed schedule|system startup/);
});

it('an expression that can never run such as February 30 ends with a message instead of looping', () => {
  const parsed = parseCron('0 0 30 2 *', 'unix');
  const result = nextRuns(parsed, FROM, 5);
  expect(result.runs).toEqual([]);
  expect(result.neverMessage).toBeTruthy();
});

it('unsupported syntax such as H, a tilde range or six fields in the Unix dialect is rejected by name', () => {
  expect(() => parseCron('H * * * *', 'unix')).toThrow(CronError);
  expect(() => parseCron('H * * * *', 'unix')).toThrow(/"H"/);
  expect(() => parseCron('6~15 * * * *', 'unix')).toThrow(CronError);
  expect(() => parseCron('6~15 * * * *', 'unix')).toThrow(/"6~15"/);
  expect(() => parseCron('0 0 * * * *', 'unix')).toThrow(CronError);
  expect(() => parseCron('0 0 * * * *', 'unix')).toThrow(/5 fields/);
  expect(() => parseCron('0 0 ? * *', 'unix')).toThrow(CronError);
  expect(() => parseCron('0 0 ? * *', 'unix')).toThrow(/"\?"/);
  expect(() => parseCron('0 0 L * *', 'unix')).toThrow(CronError);
  expect(() => parseCron('0 0 L * *', 'unix')).toThrow(/"L"/);
  expect(() => parseCron('0 0 W * *', 'unix')).toThrow(CronError);
  expect(() => parseCron('0 0 * * 1#1', 'unix')).toThrow(CronError);
  expect(() => parseCron('0 0 * * 1#1', 'unix')).toThrow(/"1#1"/);
});

it('legitimate day and month names containing the letters L, W or H parse normally, unlike the Quartz-only special characters', () => {
  // "JUL" contains an L, "WED" contains a W, "THU" contains an H --
  // proving the rejection above is never a blanket character scan.
  expect(() => parseCron('0 0 1 JUL *', 'unix')).not.toThrow();
  expect(() => parseCron('0 0 * * WED', 'unix')).not.toThrow();
  expect(() => parseCron('0 0 * * THU', 'unix')).not.toThrow();
});

it('an out-of-range value is rejected with the offending value named', () => {
  expect(() => parseCron('60 0 * * *', 'unix')).toThrow(/60/);
  expect(() => parseCron('0 24 * * *', 'unix')).toThrow(/24/);
  expect(() => parseCron('0 0 32 * *', 'unix')).toThrow(/32/);
});

// ------------------------------------------------------------------- Quartz

function isoQuartzRuns(expression: string, count: number, from: Date = FROM): string[] {
  const parsed = parseCron(expression, 'quartz');
  const result = nextRuns(parsed, from, count);
  return result.runs.map((d) => d.toISOString());
}

// Quartz Scheduler 2.3.0 tutorial, fetched live 2026-09-24 from
// quartz-scheduler.org/documentation/quartz-2.3.0/tutorials/crontrigger.html,
// "Examples" table: "0 15 10 L * ?" -> "Fire at 10:15am on the last day of
// every month"; "0 15 10 L-2 * ?" -> "the 2nd-to-last last day of every
// month"; "0 15 10 ? * 6L" -> "the last Friday of every month"; "0 15 10 ?
// * 6#3" -> "the third Friday of every month"; "0 0 12 1/5 * ?" -> "every 5
// days every month, starting on the first day of the month"; "0 11 11 11
// 11 ?" -> "Fire every November 11th at 11:11am."
it('Quartz L, L-2, 6L, 6#3 and 1/5 examples from the tutorial fire on the documented days', () => {
  expect(isoQuartzRuns('0 15 10 L * ?', 3)).toEqual([
    '2024-01-31T10:15:00.000Z',
    '2024-02-29T10:15:00.000Z', // 2024 is a leap year
    '2024-03-31T10:15:00.000Z',
  ]);
  expect(isoQuartzRuns('0 15 10 L-2 * ?', 2)).toEqual(['2024-01-29T10:15:00.000Z', '2024-02-27T10:15:00.000Z']);
  expect(isoQuartzRuns('0 15 10 ? * 6L', 2)).toEqual(['2024-01-26T10:15:00.000Z', '2024-02-23T10:15:00.000Z']);
  expect(isoQuartzRuns('0 15 10 ? * 6#3', 2)).toEqual(['2024-01-19T10:15:00.000Z', '2024-02-16T10:15:00.000Z']);
  expect(isoQuartzRuns('0 0 12 1/5 * ?', 3)).toEqual([
    '2024-01-01T12:00:00.000Z',
    '2024-01-06T12:00:00.000Z',
    '2024-01-11T12:00:00.000Z',
  ]);
  expect(isoQuartzRuns('0 11 11 11 11 ?', 1)).toEqual(['2024-11-11T11:11:00.000Z']);
});

// Same tutorial, the "W" and "L and W ... 'LW'" prose: "if you specify 1W
// as the value for day-of-month, and the 1st is a Saturday, the trigger
// will fire on Monday the 3rd, as it will not 'jump' over the boundary of
// a month's days" -- June 2024's 1st IS a Saturday (independently confirmed
// this session). "The 'L' and 'W' characters can also be combined ... to
// yield 'LW', which translates to 'last weekday of the month'" -- June
// 2024's last day (the 30th) is a Sunday, so LW should land on Friday the
// 28th.
it('Quartz W fires on the nearest weekday without leaving the month and LW is the last weekday', () => {
  const juneStart = new Date('2024-06-01T00:00:00Z');
  expect(isoQuartzRuns('0 0 0 1W * ?', 1, juneStart)).toEqual(['2024-06-03T00:00:00.000Z']); // 1st is Sat -> Monday the 3rd
  expect(isoQuartzRuns('0 0 0 15W * ?', 1, juneStart)).toEqual(['2024-06-14T00:00:00.000Z']); // 15th is Sat -> Friday the 14th
  expect(isoQuartzRuns('0 0 0 LW * ?', 1, juneStart)).toEqual(['2024-06-28T00:00:00.000Z']); // last day (30th) is Sun -> Friday the 28th
});

// CronExpression.java's own field-summary table (fetched live 2026-09-24
// from github.com/quartz-scheduler/quartz, main branch): "Month ... 1-12 or
// JAN-DEC" (settled per this phase's D-39 -- the OLD "0-11" wording seen
// elsewhere in the same file's prose is a documented artifact, not real
// behaviour) and "Day-of-Week ... 1-7 or SUN-SAT" with the tutorial's own
// "L (...) If used in the day-of-week field by itself, it simply means '7'
// or 'SAT'" confirming 1 is Sunday, not Monday.
it('Quartz month 1 and JAN are the same month and day-of-week 1 is Sunday', () => {
  expect(isoQuartzRuns('0 0 12 1 1 ?', 1)).toEqual(isoQuartzRuns('0 0 12 1 JAN ?', 1));
  expect(isoQuartzRuns('0 0 0 ? * 1', 1)).toEqual(isoQuartzRuns('0 0 0 ? * SUN', 1));
  // 2024-01-01 is a Monday; the first Sunday after it is 2024-01-07.
  expect(isoQuartzRuns('0 0 0 ? * 1', 1)).toEqual(['2024-01-07T00:00:00.000Z']);
});

it('Quartz requires a question mark in exactly one day field and rejects a year outside 1970 to 2099', () => {
  expect(() => parseCron('0 0 12 1-31 * 1-5', 'quartz')).toThrow(CronError); // both restricted
  expect(() => parseCron('0 0 12 * * *', 'quartz')).toThrow(CronError); // neither is "?"
  expect(() => parseCron('0 0 12 ? * ?', 'quartz')).toThrow(CronError); // both are "?"
  expect(() => parseCron('0 0 12 * * ? 1969', 'quartz')).toThrow(CronError);
  expect(() => parseCron('0 0 12 * * ? 2100', 'quartz')).toThrow(CronError);
  expect(() => parseCron('0 0 12 * * ? 2099', 'quartz')).not.toThrow();
  expect(() => parseCron('0 0 12 * * ? 1970', 'quartz')).not.toThrow();
});

// --------------------------------------------------------------- description

function describeExpr(expression: string, dialect: 'unix' | 'quartz'): string {
  return describeCron(parseCron(expression, dialect));
}

it('plain-English descriptions for the reference expressions read as documented', () => {
  // Unix, both day fields restricted: the either-day OR rule is stated.
  expect(describeExpr('30 4 1,15 * 5', 'unix')).toBe('At 04:30, on day-of-month 1 and 15, or on Friday.');
  // Unix, the asterisk-step exception: dayOfMonth is NOT "restricted" in
  // crontab(5)'s literal sense, but its narrowed values still combine with
  // "and", never "or".
  expect(describeExpr('0 0 */2 * 5', 'unix')).toBe('At 00:00, on every 2nd day of the month and on Friday.');
  // Step + contiguous hour range + contiguous weekday range.
  expect(describeExpr('*/15 9-17 * * mon-fri', 'unix')).toBe(
    'Every 15 minutes, from 09:00 to 17:59, on Monday through Friday.',
  );
  // Weekday list (not contiguous) + a contiguous month range.
  expect(describeExpr('0 9 * jan-mar mon,wed,fri', 'unix')).toBe(
    'At 09:00, on Monday, Wednesday and Friday, in January through March.',
  );
  // A day with no restriction at all in either field.
  expect(describeExpr('0 0 * * *', 'unix')).toBe('At 00:00.');
  // Quartz: the nth-weekday-of-month special form, with seconds.
  expect(describeExpr('0 15 10 ? * 6#3', 'quartz')).toBe('At 10:15:00, on the 3rd Friday of the month.');
  // Quartz: the day-of-month "L" special form.
  expect(describeExpr('0 15 10 L * ?', 'quartz')).toBe('At 10:15:00, on the last day of the month.');
  // Quartz: a plain weekday value plus a single restricted month, multiple minute values.
  expect(describeExpr('0 10,44 14 ? 3 WED', 'quartz')).toBe('At 14:10:00 and 14:44:00, on Wednesday, in March.');
});
