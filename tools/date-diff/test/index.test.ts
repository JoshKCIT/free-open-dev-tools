import { it, expect } from 'vitest';
import { parseMoment, parseDuration, diffMoments, addDuration, formatIsoDuration, DateDiffError } from '../src/index';

/**
 * RFC 3339 Appendix A, quoted verbatim (fetched live this session,
 * https://www.rfc-editor.org/rfc/rfc3339.txt):
 *
 *   dur-second        = 1*DIGIT "S"
 *   dur-minute        = 1*DIGIT "M" [dur-second]
 *   dur-hour          = 1*DIGIT "H" [dur-minute]
 *   dur-time          = "T" (dur-hour / dur-minute / dur-second)
 *   dur-day           = 1*DIGIT "D"
 *   dur-week          = 1*DIGIT "W"
 *   dur-month         = 1*DIGIT "M" [dur-day]
 *   dur-year          = 1*DIGIT "Y" [dur-month]
 *   dur-date          = (dur-day / dur-month / dur-year) [dur-time]
 *   duration          = "P" (dur-date / dur-time / dur-week)
 *
 * RFC 3339 itself says of this grammar: "This is informational only and
 * may contain errors. ISO 8601 remains the authoritative reference." Taken
 * literally, `dur-date` only allows ONE of day/month/year, not a combined
 * `P1Y2M10D`. This tool accepts the fuller combined form, matching the
 * wider ISO 8601-1:2019 duration grammar (cited alongside RFC 3339 in
 * meta.json's own `standards`) rather than RFC 3339's own admittedly
 * incomplete collected ABNF.
 */

it('RFC 3339 Appendix A durations such as P1Y2M10DT2H30M and P1W parse and malformed durations are rejected', () => {
  expect(parseDuration('P1Y2M10DT2H30M')).toEqual({ years: 1, months: 2, days: 10, hours: 2, minutes: 30, seconds: 0 });
  expect(parseDuration('P1W')).toEqual({ years: 0, months: 0, days: 7, hours: 0, minutes: 0, seconds: 0 });
  expect(parseDuration('PT30S')).toEqual({ years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 30 });

  expect(() => parseDuration('P1.5D')).toThrow(DateDiffError);
  expect(() => parseDuration('P')).toThrow(DateDiffError);
  expect(() => parseDuration('PT')).toThrow(DateDiffError);
  expect(() => parseDuration('1D')).toThrow(DateDiffError);
});

it('ISO 8601 month addition from January 31 clamps to February 29 in a leap year and February 28 otherwise', () => {
  const leap = addDuration(parseMoment('2024-01-31'), parseDuration('P1M'), 1);
  const leapDate = new Date(leap);
  expect(leapDate.getUTCFullYear()).toBe(2024);
  expect(leapDate.getUTCMonth()).toBe(1); // February, 0-indexed
  expect(leapDate.getUTCDate()).toBe(29);

  const nonLeap = addDuration(parseMoment('2023-01-31'), parseDuration('P1M'), 1);
  const nonLeapDate = new Date(nonLeap);
  expect(nonLeapDate.getUTCFullYear()).toBe(2023);
  expect(nonLeapDate.getUTCMonth()).toBe(1);
  expect(nonLeapDate.getUTCDate()).toBe(28);
});

it('February 29 plus one year clamps to February 28', () => {
  const result = addDuration(parseMoment('2024-02-29'), parseDuration('P1Y'), 1);
  const date = new Date(result);
  expect(date.getUTCFullYear()).toBe(2025);
  expect(date.getUTCMonth()).toBe(1);
  expect(date.getUTCDate()).toBe(28);
});

it('the calendar difference from 2024-01-31 to 2024-03-01 is 1 month and 1 day and exactly 30 days', () => {
  const diff = diffMoments(parseMoment('2024-01-31'), parseMoment('2024-03-01'));
  expect(diff.sign).toBe(1);
  expect(diff.calendar).toEqual({ years: 0, months: 1, days: 1, hours: 0, minutes: 0, seconds: 0 });
  expect(diff.exact).toEqual({ days: 30, hours: 0, minutes: 0, seconds: 0 });
  expect(diff.totalSeconds).toBe(30 * 86400);
  expect(formatIsoDuration(diff.calendar)).toBe('P1M1D');
});

it('years below 100 are not shifted into the 1900s', () => {
  const ms = parseMoment('0050-01-01');
  const date = new Date(ms);
  expect(date.getUTCFullYear()).toBe(50);

  const next = addDuration(ms, parseDuration('P1D'), 1);
  const nextDate = new Date(next);
  expect(nextDate.getUTCFullYear()).toBe(50);
  expect(nextDate.getUTCMonth()).toBe(0);
  expect(nextDate.getUTCDate()).toBe(2);
});

it('offsets on the two moments are honoured', () => {
  const a = parseMoment('2024-01-01T00:00+02:00');
  const b = parseMoment('2023-12-31T22:00Z');
  const diff = diffMoments(a, b);
  expect(diff.sign).toBe(0);
  expect(diff.totalSeconds).toBe(0);
});
