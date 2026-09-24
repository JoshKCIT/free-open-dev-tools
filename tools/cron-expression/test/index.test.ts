import { it, expect } from 'vitest';
import { meta, parseCron, nextRuns, CronError, DIALECTS } from '../src/index';

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
