import { it, expect } from 'vitest';
import { CronExpressionParser } from 'cron-parser';
import { parseCron, nextRuns } from '../src/index';

/**
 * Differential test against cron-parser 5.10.1 (test-only devDependency,
 * never imported by src/index.ts — see the CRON-ORACLE-TEST-ONLY structural
 * check). Every expression below was independently confirmed this session
 * to produce output cron-parser agrees with — the one case where cron-parser
 * disagrees with crontab(5) itself (a day-of-month step starting with "*"
 * not triggering the either-day OR rule) is deliberately excluded here and
 * checked in index.test.ts against the manual instead, per this plan's own
 * instruction.
 */
const FROM = new Date('2024-01-01T00:00:00Z');
const COUNT = 10;

const REFERENCE_EXPRESSIONS = [
  '30 4 1,15 * 5', // list; both day fields restricted (the man page's own worked example)
  '0 0 * * 0', // day-of-week by number
  '0 0 * * 7', // 7 as an alias for Sunday
  '*/15 9-17 * * mon-fri', // step + range + weekday names
  '0 9 * jan-mar mon,wed,fri', // month name range + weekday name list
  '0 22 * * 1-5', // weekday range, dayOfMonth unrestricted
  '15 14 1 * *', // single day-of-month, dayOfWeek unrestricted
  '5 0 * * *', // every day
  '10-40/10 * * * *', // range + step in the minute field
  '0 0 1 * 1', // day 1 OR Monday: both day fields restricted
  '@weekly',
  '@daily',
  '@monthly',
  '@hourly',
];

it('Unix next runs match cron-parser for the reference expression table', () => {
  expect(REFERENCE_EXPRESSIONS.length).toBeGreaterThanOrEqual(12);
  for (const expression of REFERENCE_EXPRESSIONS) {
    const parsed = parseCron(expression, 'unix');
    const ours = nextRuns(parsed, FROM, COUNT).runs.map((d) => d.toISOString());

    const interval = CronExpressionParser.parse(expression, { currentDate: FROM.toISOString(), tz: 'UTC' });
    const theirs = interval.take(COUNT).map((d) => d.toDate().toISOString());

    expect(ours, `mismatch for "${expression}"`).toEqual(theirs);
  }
});
