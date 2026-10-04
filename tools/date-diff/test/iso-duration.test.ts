import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as everything from '../src/index';
import {
  IsoDurationError,
  buildIsoDuration,
  parseDuration,
  parseIsoDuration,
  timePartSeconds,
  type IsoDuration,
} from '../src/index';

/**
 * ISO 8601 durations (ISO 8601-1:2019 section 5.5.2, as openly described) and RFC 3339 Appendix A. The browser's own
 * Temporal.Duration is the second opinion for what a duration parses to, in e2e/dev-oracles.spec.ts; Node 22 has no
 * Temporal, so these tests hold literals from the grammar and from a Temporal run recorded in the research notes:
 * Temporal.Duration.from('P1Y2M3W4DT5H6M7.5S') gives years 1, months 2, weeks 3, days 4, hours 5, minutes 6, seconds 7
 * and milliseconds 500 in Chromium, Firefox and WebKit.
 */
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

const MARKER = 'FODT-MARKER-3141';
const SHAPE_MESSAGE =
  'Each part is a number and its capital letter: Y, M, W and D, then T and H, M and S, in that order and each once.';

function parts(overrides: Partial<IsoDuration>): IsoDuration {
  return { years: '0', months: '0', weeks: '0', days: '0', hours: '0', minutes: '0', seconds: '0', ...overrides };
}

function refusal(text: string): IsoDurationError | undefined {
  try {
    parseIsoDuration(text);
  } catch (error) {
    return error instanceof IsoDurationError ? error : undefined;
  }
  return undefined;
}

it('ISO 8601 durations with weeks and a decimal fraction on the smallest unit parse and build back', () => {
  const full = parseIsoDuration('P1Y2M3W4DT5H6M7.5S');
  expect(full).toEqual({ years: '1', months: '2', weeks: '3', days: '4', hours: '5', minutes: '6', seconds: '7.5' });
  expect(buildIsoDuration(full)).toBe('P1Y2M3W4DT5H6M7.5S');

  // A comma is a decimal sign too, and the text written back uses a dot.
  expect(parseIsoDuration('P0,5D')).toEqual(parts({ days: '0.5' }));
  expect(buildIsoDuration(parseIsoDuration('P0,5D'))).toBe('P0.5D');
  expect(parseIsoDuration('PT1,5H')).toEqual(parts({ hours: '1.5' }));
  expect(parseIsoDuration('PT0.25S')).toEqual(parts({ seconds: '0.25' }));
  expect(parseIsoDuration('P1.5Y')).toEqual(parts({ years: '1.5' }));
  expect(parseIsoDuration('P2.5W')).toEqual(parts({ weeks: '2.5' }));

  // Weeks may stand alone or be combined with other parts.
  expect(parseIsoDuration('P2W')).toEqual(parts({ weeks: '2' }));
  expect(parseIsoDuration('P1W2D')).toEqual(parts({ weeks: '1', days: '2' }));
  expect(parseIsoDuration('P1Y2W')).toEqual(parts({ years: '1', weeks: '2' }));
  expect(buildIsoDuration(parseIsoDuration('P1W2DT3H'))).toBe('P1W2DT3H');

  // The same letter M is months before the T and minutes after it.
  expect(parseIsoDuration('P3M')).toEqual(parts({ months: '3' }));
  expect(parseIsoDuration('PT3M')).toEqual(parts({ minutes: '3' }));
  expect(parseIsoDuration('P1M2DT3M')).toEqual(parts({ months: '1', days: '2', minutes: '3' }));

  // Leading zeros and trailing fraction zeros carry no value; zero parts read as written and drop out on the way back.
  expect(parseIsoDuration('P007Y')).toEqual(parts({ years: '7' }));
  expect(parseIsoDuration('P1.50D')).toEqual(parts({ days: '1.5' }));
  expect(parseIsoDuration('P1.0D')).toEqual(parts({ days: '1' }));
  expect(buildIsoDuration(parseIsoDuration('P0Y0M3DT0H0M0S'))).toBe('P3D');
  expect(buildIsoDuration(parseIsoDuration('P0D'))).toBe('PT0S');
  expect(buildIsoDuration(parseIsoDuration('PT0.0S'))).toBe('PT0S');
  expect(parseIsoDuration('  P1D  ')).toEqual(parts({ days: '1' }));

  // Digits are kept exactly as typed, never through floating point: these values cannot be held by a double.
  expect(parseIsoDuration('PT999999999999999.999999999S').seconds).toBe('999999999999999.999999999');
  expect(buildIsoDuration(parseIsoDuration('PT999999999999999.999999999S'))).toBe('PT999999999999999.999999999S');
  expect(parseIsoDuration('P123456789012345D').days).toBe('123456789012345');
  expect(parseIsoDuration('PT0.123456789S').seconds).toBe('0.123456789');
  expect(parseIsoDuration('PT0.1S').seconds).toBe('0.1');

  // Writing from separate parts.
  expect(
    buildIsoDuration({ years: '1', months: '2', weeks: '3', days: '4', hours: '5', minutes: '6', seconds: '7.5' }),
  ).toBe('P1Y2M3W4DT5H6M7.5S');
  expect(buildIsoDuration({ seconds: '7,5' })).toBe('PT7.5S');
  expect(buildIsoDuration({ days: '10', minutes: '30' })).toBe('P10DT30M');
});

it('building an ISO 8601 duration leaves out zero parts and writes PT0S for nothing', () => {
  expect(buildIsoDuration({})).toBe('PT0S');
  expect(buildIsoDuration(parts({}))).toBe('PT0S');
  expect(
    buildIsoDuration({ years: '0', months: '0', weeks: '0', days: '0', hours: '0', minutes: '0', seconds: '0' }),
  ).toBe('PT0S');
  expect(buildIsoDuration({ hours: '1' })).toBe('PT1H');
  expect(buildIsoDuration({ days: '1' })).toBe('P1D');
  expect(buildIsoDuration({ years: '0', seconds: '30' })).toBe('PT30S');
  expect(buildIsoDuration({ weeks: '2', seconds: '0.5' })).toBe('P2WT0.5S');
  expect(buildIsoDuration({ days: '007', seconds: '1.50' })).toBe('P7DT1.5S');
  // A fraction is allowed on the smallest part that is not zero and nowhere else; parts that are zero do not count.
  expect(buildIsoDuration({ years: '1.5' })).toBe('P1.5Y');
  expect(buildIsoDuration({ years: '1.5', months: '0' })).toBe('P1.5Y');
  expect(() => buildIsoDuration({ years: '1.5', months: '1' })).toThrow(IsoDurationError);
  expect(() => buildIsoDuration({ hours: '1.5', seconds: '1' })).toThrow(IsoDurationError);
  // Each part must be a number written in digits.
  for (const bad of ['', ' ', 'x', '-1', '+1', '1e3', '1.', '.5', '1..5', '1 2', `7${MARKER}`, '0x10', '1,,5']) {
    let error: unknown;
    try {
      buildIsoDuration({ seconds: bad });
    } catch (caught) {
      error = caught;
    }
    expect(error, JSON.stringify(bad)).toBeInstanceOf(IsoDurationError);
    expect((error as Error).message).not.toContain(MARKER);
  }
  expect(() => buildIsoDuration({ days: '1234567890123456' })).toThrow(IsoDurationError);
  expect(() => buildIsoDuration({ seconds: '1.1234567891' })).toThrow(IsoDurationError);
});

it('a fraction on any part but the smallest, an empty duration and a sign are refused', () => {
  // Fraction only on the smallest part present (ISO 8601-1 5.5.2.4: the lowest order component may have a fraction).
  for (const text of ['P1.5Y2M', 'P1.5Y1D', 'P1Y2.5M3D', 'PT1.5H30M', 'PT1.5M1S', 'P1.5DT1H', 'P1.5W2D', 'P1.5Y1.5M']) {
    expect(refusal(text)?.message, text).toBe('Only the smallest part present can have a decimal fraction.');
  }
  // Nothing after the P, and a T with nothing after it.
  expect(refusal('P')?.message).toBe('A duration needs at least one part after the P, such as P1D or PT0S.');
  expect(refusal('PT')?.message).toBe('A T must be followed by at least one of hours (H), minutes (M) or seconds (S).');
  expect(refusal('P1DT')?.message).toBe(
    'A T must be followed by at least one of hours (H), minutes (M) or seconds (S).',
  );
  expect(refusal('')?.message).toBe('An ISO 8601 duration starts with P, such as P1Y2M3W4DT5H6M7.5S.');
  expect(refusal('   ')?.message).toBe('An ISO 8601 duration starts with P, such as P1Y2M3W4DT5H6M7.5S.');
  // A sign is not accepted (RFC 3339 Appendix A has none), and neither is a lower case letter or a missing P.
  for (const text of ['-P1D', '+P1D', ' -P1D']) {
    expect(refusal(text)?.message, text).toBe(
      'A sign is not accepted: an ISO 8601 duration here has no minus or plus sign.',
    );
  }
  for (const text of ['p1d', '1D', 'T1H', 'D1']) {
    expect(refusal(text)?.message, text).toBe('An ISO 8601 duration starts with P, such as P1Y2M3W4DT5H6M7.5S.');
  }
  // Wrong shapes: order, repeats, a letter in the wrong half, no digits, no letter, a negative part, white space inside.
  const shapes = [
    'P1D1Y',
    'P1Y1Y',
    'P1M1Y',
    'P1D1W',
    'PT1M2H',
    'PT1S1M',
    'PT1D',
    'P1H',
    'P1S',
    'P1',
    'PD',
    'PYD',
    'P.5D',
    'P1.D',
    'P1,D',
    'P-1D',
    'P1d',
    'PT1h',
    'P1Y T1H',
    'P1 Y',
    'PTT1H',
    'P1DTT1H',
    'P1DT1',
    'P1Y2',
    'P1E3D',
    'P0x1D',
  ];
  for (const text of shapes) {
    expect(refusal(text)?.message, text).toBe(SHAPE_MESSAGE);
  }
  // Limits: 15 digits before the point, 9 after it, 256 characters in all.
  expect(refusal('P1234567890123456D')?.message).toBe(
    'A part has at most 15 digits before the decimal point and 9 after it.',
  );
  expect(refusal('PT0.1234567891S')?.message).toBe(
    'A part has at most 15 digits before the decimal point and 9 after it.',
  );
  expect(refusal('P' + '1D'.repeat(200))?.message).toBe('A duration is at most 256 characters.');
  expect(refusal('P' + '1'.repeat(300) + 'D')?.message).toBe('A duration is at most 256 characters.');
  // The older parser keeps its own stricter grammar: a fraction is still refused there.
  expect(() => parseDuration('P1.5D')).toThrow();
  expect(parseIsoDuration('P1.5D').days).toBe('1.5');
});

it('a nominal duration total is never shown as an exact number of seconds', () => {
  // Only hours, minutes and seconds have an exact length. 1 hour, 2 minutes and 3.5 seconds are 3723.5 seconds.
  expect(timePartSeconds(parseIsoDuration('P1Y2M3W4DT1H2M3.5S'))).toBe('3723.5');
  // Years, months, weeks and days add nothing: a year is 365 or 366 days and a month 28 to 31, depending on the start.
  expect(timePartSeconds(parseIsoDuration('P1Y2M3W4D'))).toBe('0');
  expect(timePartSeconds(parseIsoDuration('P1D'))).toBe('0');
  expect(timePartSeconds(parseIsoDuration('P1Y'))).toBe('0');
  expect(timePartSeconds(parseIsoDuration('PT24H'))).toBe('86400');
  expect(timePartSeconds(parseIsoDuration('PT1,5H'))).toBe('5400');
  expect(timePartSeconds(parseIsoDuration('PT0.000000001S'))).toBe('0.000000001');
  expect(timePartSeconds(parseIsoDuration('PT90M'))).toBe('5400');
  expect(timePartSeconds(parseIsoDuration('PT0S'))).toBe('0');
  // Exact beyond what a double holds (Python: 999999999999999 * 3600 = 3599999999999996400).
  expect(timePartSeconds(parseIsoDuration('PT999999999999999H'))).toBe('3599999999999996400');
  expect(timePartSeconds(parseIsoDuration('PT999999999999999.999999999S'))).toBe('999999999999999.999999999');
  // No function of the package totals the calendar units into seconds.
  const names = Object.keys(everything).filter((name) => /total|nominal|toSeconds|inSeconds/i.test(name));
  expect(names).toEqual([]);
});

it('ISO 8601 duration messages never repeat the text they refuse', () => {
  for (const text of [
    MARKER,
    `P${MARKER}`,
    `P1D${MARKER}`,
    `PT${MARKER}S`,
    `P1.5Y${MARKER}`,
    `-${MARKER}`,
    'P' + MARKER.repeat(40),
  ]) {
    const error = refusal(text);
    expect(error, text).toBeInstanceOf(IsoDurationError);
    expect(error?.message).not.toContain(MARKER);
    expect(error?.message.length).toBeLessThan(140);
  }
});
