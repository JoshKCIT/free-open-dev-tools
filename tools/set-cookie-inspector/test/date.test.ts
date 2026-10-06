import { expect, it } from 'vitest';
import { parseCookieDate, parseUtcTime } from '../src/index';
import { NOW } from './helpers';

// Section 5.1.1 of draft-ietf-httpbis-rfc6265bis-22: the cookie date algorithm. The expected moments are worked out from
// the calendar and written with Date.UTC, never taken from the output of the package.

it('the cookie date algorithm maps two-digit years and refuses year 1600, day 32, hour 24 and minute 60', () => {
  // Steps 3 and 4: two-digit years 70 to 99 are 19xx and 0 to 69 are 20xx (not the rule of the email standard).
  expect(parseCookieDate('01 Jan 70 00:00:00')).toBe(Date.UTC(1970, 0, 1));
  expect(parseCookieDate('01 Jan 69 00:00:00')).toBe(Date.UTC(2069, 0, 1));
  expect(parseCookieDate('01 Jan 99 00:00:00')).toBe(Date.UTC(1999, 0, 1));
  expect(parseCookieDate('01 Jan 00 00:00:00')).toBe(Date.UTC(2000, 0, 1));
  expect(parseCookieDate('01 Jan 50 00:00:00')).toBe(Date.UTC(2050, 0, 1));
  // The year is two to four digits: 0099 is the year 99, which becomes 1999.
  expect(parseCookieDate('1 Jan 0099 0:0:0')).toBe(Date.UTC(1999, 0, 1));
  // Step 5: a year below 1601 fails, the year 1601 is accepted.
  expect(parseCookieDate('Mon, 01 Jan 1601 00:00:00 GMT')).toBe(-11_644_473_600_000);
  expect(parseCookieDate('Mon, 31 Dec 1600 23:59:59 GMT')).toBeNull();
  expect(parseCookieDate('01 Jan 1600 00:00:00')).toBeNull();
  expect(parseCookieDate('01 Jan 123 00:00:00')).toBeNull();
  // Day of month: 1 to 31, and a day that does not exist in that month fails (step 6).
  expect(parseCookieDate('31 Jan 2026 00:00:00')).toBe(Date.UTC(2026, 0, 31));
  expect(parseCookieDate('32 Jan 2026 00:00:00')).toBeNull();
  expect(parseCookieDate('00 Jan 2026 00:00:00')).toBeNull();
  expect(parseCookieDate('31 Feb 2026 00:00:00')).toBeNull();
  expect(parseCookieDate('29 Feb 2024 00:00:00')).toBe(Date.UTC(2024, 1, 29));
  expect(parseCookieDate('29 Feb 2026 00:00:00')).toBeNull();
  expect(parseCookieDate('31 Apr 2026 00:00:00')).toBeNull();
  // Hour, minute and second: 23, 59 and 59 are accepted; 24, 60 and 60 fail.
  expect(parseCookieDate('01 Jan 2026 23:59:59')).toBe(Date.UTC(2026, 0, 1, 23, 59, 59));
  expect(parseCookieDate('01 Jan 2026 24:00:00')).toBeNull();
  expect(parseCookieDate('01 Jan 2026 00:60:00')).toBeNull();
  expect(parseCookieDate('01 Jan 2026 00:00:60')).toBeNull();
  // The draft's own examples.
  expect(parseCookieDate('Sun, 06 Nov 1994 08:49:37 GMT')).toBe(Date.UTC(1994, 10, 6, 8, 49, 37));
  expect(parseCookieDate('Wed, 09 Jun 2026 10:18:14 GMT')).toBe(Date.UTC(2026, 5, 9, 10, 18, 14));
  // Any order of day, month, year and time is read (the tokens are matched one by one), and the day name is ignored.
  const expected = Date.UTC(1980, 3, 10, 16, 33, 12);
  for (const text of [
    'Thu, 10 Apr 1980 16:33:12 GMT',
    'Thu Apr 10 1980 16:33:12 GMT',
    'Apr 10 1980 16:33:12 GMT',
    '16:33:12 10 Apr 1980',
    '1980 Apr 10 16:33:12',
    'Thu Apr 10 16:33:12 1980',
    'Thu Apr 10 1980 16:33:12 GMT-0700 (Pacific Daylight Time)',
    'thu apr 10 1980 16:33:12 gmt',
    'APRIL 10th 1980 16:33:12abc',
    '10-Apr-1980 16:33:12',
    '10/Apr/1980;16:33:12',
  ]) {
    expect(parseCookieDate(text), text).toBe(expected);
  }
  // A month is read from its first three letters, whatever follows.
  expect(parseCookieDate('01 janet 2026 00:00:00')).toBe(Date.UTC(2026, 0, 1));
  expect(parseCookieDate('01 Janxx 2026 00:00:00')).toBe(Date.UTC(2026, 0, 1));
  // A flag that is never set fails the whole date.
  expect(parseCookieDate('01 Jan 2026')).toBeNull();
  expect(parseCookieDate('Jan 2026 00:00:00')).toBeNull();
  expect(parseCookieDate('01 2026 00:00:00')).toBeNull();
  expect(parseCookieDate('01 Jan 00:00:00')).toBeNull();
  expect(parseCookieDate('001:02:03 01 Jan 2026')).toBeNull();
  expect(parseCookieDate('')).toBeNull();
  expect(parseCookieDate('nonsense')).toBeNull();
  // The first token that fits a part sets it: a second year-like token does not replace the first.
  expect(parseCookieDate('01 Jan 2026 00:00:00 2027')).toBe(Date.UTC(2026, 0, 1));
  // At most 1,000 tokens are read, so a date that starts after them is not found, and one before them still is.
  expect(parseCookieDate(`${'x '.repeat(1000)}01 Jan 2026 00:00:00`)).toBeNull();
  expect(parseCookieDate(`01 Jan 2026 00:00:00 ${'x '.repeat(5000)}`)).toBe(Date.UTC(2026, 0, 1));
});

it('a full UTC time is read to the millisecond and anything else is refused', () => {
  expect(parseUtcTime('2026-10-06T12:00:00Z')).toBe(NOW);
  expect(parseUtcTime('2026-10-06T12:00:00.5Z')).toBe(NOW + 500);
  expect(parseUtcTime('2026-10-06T12:00:00.123Z')).toBe(NOW + 123);
  expect(parseUtcTime('2024-02-29T23:59:59Z')).toBe(Date.UTC(2024, 1, 29, 23, 59, 59));
  for (const text of [
    '',
    '2026-10-06',
    '2026-10-06T12:00:00',
    '2026-10-06T12:00:00+00:00',
    '2026-10-06 12:00:00Z',
    '2026-10-06t12:00:00z',
    '2026-02-30T00:00:00Z',
    '2025-02-29T00:00:00Z',
    '2026-13-01T00:00:00Z',
    '2026-00-10T00:00:00Z',
    '2026-10-00T00:00:00Z',
    '2026-10-06T24:00:00Z',
    '2026-10-06T12:60:00Z',
    '2026-10-06T12:00:60Z',
    '2026-10-06T12:00:00.1234Z',
    '0050-10-06T12:00:00Z',
    ' 2026-10-06T12:00:00Z',
  ]) {
    expect(parseUtcTime(text), text).toBeNull();
  }
});
