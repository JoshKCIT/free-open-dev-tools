import { expect, it } from 'vitest';
import { Base32Error, computeCodes, decodeBase32, formatUtc } from '../src/index';

// Tests for the findings of the phase 14 code review (part B) against the TOTP generator.

// B-IN-01: the message about padding read "from at character 9".
it('the padding message says where the padding starts in plain words', () => {
  let message = '';
  try {
    decodeBase32('MZXW6YTB=');
  } catch (err) {
    expect(err).toBeInstanceOf(Base32Error);
    message = (err as Base32Error).message;
  }
  expect(message).toMatch(/^The padding at the end of this secret starts at character 9 and is not the length/);
  expect(message).not.toMatch(/from at/);
  // The position it names is where the padding sign was typed, counted from 1, with a separator before it.
  try {
    decodeBase32('MZXW6 YTB ==');
  } catch (err) {
    message = (err as Base32Error).message;
  }
  expect(message).toMatch(/starts at character 11 and/);
});

// B-IN-02: rows past the last time the page reads printed years such as +010000.
// RFC 4226 Appendix D's secret, 12345678901234567890, in Base32.
const SECRET = ['GEZDGNBVGY3TQOJQ', 'GEZDGNBVGY3TQOJQ'].join('');
const LAST_SECOND = 253402300799; // 9999-12-31T23:59:59Z
const options = { mode: 'totp' as const, secret: SECRET, algorithm: 'SHA1' as const, digits: 6, period: 30 };

it('the window leaves out steps that start after 9999-12-31 and no row prints a year past 9999', () => {
  // 253402300800 is a multiple of 30, so the last step of the supported range ends exactly at the last second.
  const last = computeCodes({ ...options, seconds: LAST_SECOND });
  expect(last.window.map((row) => row.label)).toEqual(['previous', 'current']);
  expect(last.window[1]?.endSeconds).toBe(LAST_SECOND);
  expect(formatUtc(last.window[1]!.endSeconds)).toBe('9999-12-31 23:59:59');
  // 31 seconds earlier the next step is still inside the range, and the one after it is not.
  const near = computeCodes({ ...options, seconds: LAST_SECOND - 31 });
  expect(near.window.map((row) => row.label)).toEqual(['previous', 'current', 'next']);
  expect(near.window[2]?.startSeconds).toBe(LAST_SECOND - 29);
  // A period that does not divide the range: the last step is cut at the last second, and no row starts past it.
  const odd = computeCodes({ ...options, seconds: LAST_SECOND, period: 7 });
  expect(odd.window.map((row) => row.label)).toEqual(['previous', 'current']);
  expect(odd.window[1]?.endSeconds).toBe(LAST_SECOND);
  for (const result of [last, near, odd]) {
    for (const row of result.window) {
      expect(row.startSeconds).toBeLessThanOrEqual(LAST_SECOND);
      expect(row.endSeconds).toBeLessThanOrEqual(LAST_SECOND);
      expect(formatUtc(row.startSeconds)).toMatch(/^\d{4}-/);
      expect(formatUtc(row.endSeconds)).toMatch(/^\d{4}-/);
    }
  }
  // Earlier times are untouched: four rows, as before.
  expect(computeCodes({ ...options, seconds: 59 }).window.map((row) => row.label)).toEqual([
    'previous',
    'current',
    'next',
    'after next',
  ]);
});
