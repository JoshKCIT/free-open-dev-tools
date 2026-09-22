import { describe, it, expect } from 'vitest';
import { detectUnit, toMilliseconds, render, parseInput, isoWeek, relativeTime, isValidZone } from '../src/index';

const NOW = Date.UTC(2026, 0, 1, 0, 0, 0);

describe('unit detection', () => {
  it('reads a ten digit number as seconds', () => {
    // 1767225600 is 2026-01-01T00:00:00Z.
    expect(detectUnit(1767225600).unit).toBe('seconds');
  });

  it('reads a thirteen digit number as milliseconds', () => {
    expect(detectUnit(1767225600000).unit).toBe('milliseconds');
  });

  it('reads a sixteen digit number as microseconds', () => {
    expect(detectUnit(1767225600000000).unit).toBe('microseconds');
  });

  it('reads a nineteen digit number as nanoseconds', () => {
    expect(detectUnit(1767225600000000000).unit).toBe('nanoseconds');
  });

  it('is not confident about a small number, which could be anything', () => {
    expect(detectUnit(5).confident).toBe(false);
    expect(detectUnit(1000).confident).toBe(false);
  });

  it('handles negative timestamps, which are before 1970', () => {
    expect(detectUnit(-1000000000).unit).toBe('seconds');
  });

  it('gives a reason for every guess', () => {
    for (const v of [0, 1, 1e9, 1e12, 1e15, 1e18]) {
      expect(detectUnit(v).reason.length).toBeGreaterThan(10);
    }
  });
});

describe('unit conversion', () => {
  it('converts each unit to milliseconds', () => {
    expect(toMilliseconds(1, 'seconds')).toBe(1000);
    expect(toMilliseconds(1000, 'milliseconds')).toBe(1000);
    expect(toMilliseconds(1000000, 'microseconds')).toBe(1000);
    expect(toMilliseconds(1000000000, 'nanoseconds')).toBe(1000);
  });
});

describe('rendering', () => {
  const r = render(Date.UTC(2026, 0, 15, 12, 30, 45, 123), { timeZone: 'UTC', now: NOW });

  it('produces an ISO 8601 string', () => {
    expect(r.iso).toBe('2026-01-15T12:30:45.123Z');
  });

  it('produces the HTTP date format', () => {
    expect(r.rfc7231).toBe('Thu, 15 Jan 2026 12:30:45 GMT');
  });

  it('reports the day of the week and day of the year', () => {
    expect(r.dayOfWeek).toBe('Thursday');
    expect(r.dayOfYear).toBe(15);
  });

  it('reports the quarter', () => {
    expect(r.quarter).toBe(1);
    expect(render(Date.UTC(2026, 6, 1), { now: NOW }).quarter).toBe(3);
    expect(render(Date.UTC(2026, 11, 31), { now: NOW }).quarter).toBe(4);
  });

  it('gives the epoch value in every unit', () => {
    const t = render(1000, { now: NOW });
    expect(t.epochSeconds).toBe(1);
    expect(t.epochMilliseconds).toBe(1000);
    expect(t.epochMicroseconds).toBe(1000000);
    expect(t.epochNanoseconds).toBe('1000000000');
  });

  it('uses a string for nanoseconds, which exceed safe integer range', () => {
    const t = render(Date.UTC(2026, 0, 1), { now: NOW });
    expect(typeof t.epochNanoseconds).toBe('string');
    expect(t.epochNanoseconds).toBe('1767225600000000000');
  });
});

describe('leap years', () => {
  it('follows the Gregorian rule, including the century exceptions', () => {
    expect(render(Date.UTC(2024, 0, 1), { now: NOW }).isLeapYear).toBe(true);
    expect(render(Date.UTC(2026, 0, 1), { now: NOW }).isLeapYear).toBe(false);
    expect(render(Date.UTC(1900, 0, 1), { now: NOW }).isLeapYear).toBe(false);
    expect(render(Date.UTC(2000, 0, 1), { now: NOW }).isLeapYear).toBe(true);
  });

  it('counts 29 February as day 60 of a leap year', () => {
    expect(render(Date.UTC(2024, 1, 29), { now: NOW }).dayOfYear).toBe(60);
  });

  it('counts 31 December as day 366 of a leap year and 365 otherwise', () => {
    expect(render(Date.UTC(2024, 11, 31), { now: NOW }).dayOfYear).toBe(366);
    expect(render(Date.UTC(2026, 11, 31), { now: NOW }).dayOfYear).toBe(365);
  });
});

describe('ISO week numbering', () => {
  // The awkward cases are the turn of the year, where the ISO week can belong
  // to the neighbouring year.
  it('puts 2026-01-01, a Thursday, in week 1 of 2026', () => {
    expect(isoWeek(new Date(Date.UTC(2026, 0, 1)))).toEqual({ year: 2026, week: 1 });
  });

  it('puts 2021-01-01, a Friday, in week 53 of 2020', () => {
    expect(isoWeek(new Date(Date.UTC(2021, 0, 1)))).toEqual({ year: 2020, week: 53 });
  });

  it('puts 2019-12-30, a Monday, in week 1 of 2020', () => {
    expect(isoWeek(new Date(Date.UTC(2019, 11, 30)))).toEqual({ year: 2020, week: 1 });
  });

  it('formats the week with a leading zero', () => {
    expect(render(Date.UTC(2026, 0, 1), { now: NOW }).isoWeek).toBe('2026-W01');
  });
});

describe('time zones', () => {
  it('shows a New York time with the winter offset', () => {
    const r = render(Date.UTC(2026, 0, 15, 17, 0, 0), { timeZone: 'America/New_York', now: NOW });
    expect(r.inZone).toBe('2026-01-15 12:00:00');
    expect(r.zoneOffset).toBe('-05:00');
  });

  it('shows the summer offset for the same zone, which is the point of using IANA names', () => {
    const r = render(Date.UTC(2026, 6, 15, 16, 0, 0), { timeZone: 'America/New_York', now: NOW });
    expect(r.inZone).toBe('2026-07-15 12:00:00');
    expect(r.zoneOffset).toBe('-04:00');
  });

  it('handles a half-hour offset zone', () => {
    const r = render(Date.UTC(2026, 0, 15, 6, 30, 0), { timeZone: 'Asia/Kolkata', now: NOW });
    expect(r.inZone).toBe('2026-01-15 12:00:00');
    expect(r.zoneOffset).toBe('+05:30');
  });

  it('handles a zone ahead of UTC that crosses the date line', () => {
    const r = render(Date.UTC(2026, 0, 15, 23, 0, 0), { timeZone: 'Pacific/Auckland', now: NOW });
    expect(r.inZone.slice(0, 10)).toBe('2026-01-16');
  });

  it('validates zone names', () => {
    expect(isValidZone('Europe/London')).toBe(true);
    expect(isValidZone('Mars/Olympus_Mons')).toBe(false);
  });
});

describe('parsing input', () => {
  it('reads a bare number and says which unit it assumed', () => {
    const p = parseInput('1767225600');
    expect(p.ok).toBe(true);
    expect(p.ms).toBe(Date.UTC(2026, 0, 1));
    expect(p.detectedUnit).toBe('seconds');
    expect(p.interpretation).toMatch(/read as seconds/);
  });

  it('honours a unit you choose over its own guess', () => {
    const p = parseInput('1767225600', 'milliseconds');
    expect(p.ms).toBe(1767225600);
    expect(p.interpretation).toMatch(/chosen by you/);
  });

  it('reads a bare date as UTC, not as local time', () => {
    // This is the difference that silently shifts a date by a day.
    const p = parseInput('2026-01-15');
    expect(p.ms).toBe(Date.UTC(2026, 0, 15));
    expect(p.interpretation).toMatch(/read as UTC/);
  });

  it('reads a bare date-time as UTC', () => {
    expect(parseInput('2026-01-15T12:30:00').ms).toBe(Date.UTC(2026, 0, 15, 12, 30));
    expect(parseInput('2026-01-15 12:30:00').ms).toBe(Date.UTC(2026, 0, 15, 12, 30));
  });

  it('honours an explicit offset when one is given', () => {
    expect(parseInput('2026-01-15T12:30:00+05:00').ms).toBe(Date.UTC(2026, 0, 15, 7, 30));
    expect(parseInput('2026-01-15T12:30:00Z').ms).toBe(Date.UTC(2026, 0, 15, 12, 30));
  });

  it('accepts an RFC 2822 date', () => {
    expect(parseInput('Thu, 15 Jan 2026 12:30:45 GMT').ms).toBe(Date.UTC(2026, 0, 15, 12, 30, 45));
  });

  it('rejects text that is not a date', () => {
    const p = parseInput('not a date');
    expect(p.ok).toBe(false);
    expect(p.error).toMatch(/ISO 8601/);
  });

  it('rejects an empty input', () => {
    expect(parseInput('  ').ok).toBe(false);
  });

  it('accepts a twenty digit value, which as nanoseconds is still a real date', () => {
    // Worth pinning down: this reads as nanoseconds and lands in the year 5138,
    // so it is in range even though the number looks absurd.
    const p = parseInput('99999999999999999999');
    expect(p.ok).toBe(true);
    expect(p.detectedUnit).toBe('nanoseconds');
    expect(render(p.ms!, { now: NOW }).iso.slice(0, 4)).toBe('5138');
  });

  it('rejects a value beyond the representable range', () => {
    const p = parseInput('9'.repeat(30));
    expect(p.ok).toBe(false);
    expect(p.error).toMatch(/outside the range/);
  });

  it('rejects an in-range-looking number when a unit forces it out of range', () => {
    const p = parseInput('99999999999999999999', 'seconds');
    expect(p.ok).toBe(false);
    expect(p.error).toMatch(/outside the range/);
  });
});

describe('dates outside the common range', () => {
  it('handles the epoch itself', () => {
    expect(render(0, { now: NOW }).iso).toBe('1970-01-01T00:00:00.000Z');
  });

  it('handles a date before 1970', () => {
    expect(render(-86400000, { now: NOW }).iso).toBe('1969-12-31T00:00:00.000Z');
  });

  it('handles the 32-bit signed overflow moment in 2038', () => {
    // 2147483647 seconds is where a signed 32-bit time_t runs out.
    const p = parseInput('2147483647');
    expect(render(p.ms!, { now: NOW }).iso).toBe('2038-01-19T03:14:07.000Z');
  });

  it('handles the moment after the 2038 overflow', () => {
    expect(render(2147483648000, { now: NOW }).iso).toBe('2038-01-19T03:14:08.000Z');
  });

  it('throws a clear error rather than producing Invalid Date', () => {
    expect(() => render(Number.NaN, { now: NOW })).toThrow(/outside the range/);
    expect(() => render(8.64e15 + 1, { now: NOW })).toThrow(/outside the range/);
  });
});

describe('relative time', () => {
  it('describes past and future', () => {
    expect(relativeTime(NOW - 5000, NOW)).toBe('5 seconds ago');
    expect(relativeTime(NOW + 5000, NOW)).toBe('in 5 seconds');
    expect(relativeTime(NOW, NOW)).toBe('now');
  });

  it('picks a sensible unit', () => {
    expect(relativeTime(NOW - 3600000, NOW)).toBe('1 hour ago');
    expect(relativeTime(NOW - 86400000 * 3, NOW)).toBe('3 days ago');
    expect(relativeTime(NOW - 86400000 * 400, NOW)).toBe('1 year ago');
  });

  it('uses the singular for one', () => {
    expect(relativeTime(NOW - 60000, NOW)).toBe('1 minute ago');
    expect(relativeTime(NOW - 120000, NOW)).toBe('2 minutes ago');
  });
});

describe('round trips', () => {
  it('a timestamp survives rendering and reparsing', () => {
    for (const ms of [0, 1000, Date.UTC(2026, 0, 15, 12, 30, 45), -86400000, 2147483647000]) {
      const r = render(ms, { now: NOW });
      expect(parseInput(r.iso).ms).toBe(ms);
      expect(parseInput(String(r.epochMilliseconds), 'milliseconds').ms).toBe(ms);
    }
  });
});
