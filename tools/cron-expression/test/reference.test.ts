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

/**
 * Quartz expressions cron-parser also understands, each paired with its
 * cron-parser-syntax translation: cron-parser has no year field (dropped),
 * "?" is its own alias for "*" (translated literally), and its day-of-week
 * numbering is 0-7 (0 or 7 = Sunday) where Quartz's is 1-7 (1 = Sunday) --
 * so a plain Quartz weekday number N becomes cron-parser's N-1, and
 * Quartz's day-of-week "nL" (last such weekday) becomes cron-parser's own
 * "(n-1)L" form, which cron-parser documents identically ("the range 0L -
 * 7L ... means 'last occurrence of this weekday for the month in
 * progress'"). cron-parser has no W support at all (confirmed by its
 * absence from the fetched README's special-character table), so W, LW,
 * L-n and year-restricted expressions are checked only against the
 * tutorial's own documented examples in index.test.ts, never here.
 */
const QUARTZ_SHARED_EXPRESSIONS: [quartz: string, cronParser: string][] = [
  ['0 0 12 * * ?', '0 0 12 * * *'], // noon every day
  ['0 15 10 ? * 2-6', '0 15 10 * * 1-5'], // 10:15am every weekday (Quartz Mon=2..Fri=6, cron-parser Mon=1..Fri=5)
  ['0 0 0 1 * ?', '0 0 0 1 * *'], // midnight on the 1st of every month
  ['0 30 9 ? * 6', '0 30 9 * * 5'], // 9:30am every Friday (Quartz 6, cron-parser 5)
  ['0 0/15 14 ? * 2-6', '0 0/15 14 * * 1-5'], // every 15 minutes from 2pm, weekdays
  ['0 0 12 L * ?', '0 0 12 L * *'], // noon on the last day of every month
  ['0 0 0 ? * 6L', '0 0 0 * * 5L'], // midnight on the last Friday of every month
  ['0 0 0 ? * 2L', '0 0 0 * * 1L'], // midnight on the last Monday of every month
  ['0 0 6 1/10 * ?', '0 0 6 1/10 * *'], // 6am every 10 days, restarting each month
  ['0 0 0 ? * 1', '0 0 0 * * 0'], // midnight every Sunday (Quartz 1, cron-parser 0)
];

it('Quartz next runs match cron-parser for the shared-feature expression table', () => {
  expect(QUARTZ_SHARED_EXPRESSIONS.length).toBeGreaterThanOrEqual(8);
  for (const [quartzExpr, cronParserExpr] of QUARTZ_SHARED_EXPRESSIONS) {
    const parsed = parseCron(quartzExpr, 'quartz');
    const ours = nextRuns(parsed, FROM, COUNT).runs.map((d) => d.toISOString());

    const interval = CronExpressionParser.parse(cronParserExpr, { currentDate: FROM.toISOString(), tz: 'UTC' });
    const theirs = interval.take(COUNT).map((d) => d.toDate().toISOString());

    expect(ours, `mismatch for "${quartzExpr}" (cron-parser: "${cronParserExpr}")`).toEqual(theirs);
  }
});
