import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { decodeBase32, encodeBase32 } from '../src/base32';
import { hotp, secondsLeft, totpStep, totpWindow, type OtpAlgorithm } from '../src/otp';
import { MAX_TIME_CHARS, TimeError, formatUtc, parseTimeInput } from '../src/time';
import { Base32Error, TotpError, computeCodes, meta as toolMeta } from '../src/index';
import { otpauthUri } from '../src/uri';
import { HOTP_CASES, PYOTP_VERSION, TOTP_CASES } from './fixtures/pyotp-cases';

/**
 * Expected values come only from the specifications: RFC 4226 Appendix D (the ten HOTP values), RFC 6238 Appendix B (the
 * eighteen TOTP values, with the 20, 32 and 64 byte seeds the RFC's own reference code uses in Appendix A) and the UTC
 * times that table prints beside each Unix time. Nothing here is computed by the code under test.
 */

const spies = {
  log: vi.spyOn(console, 'log'),
  warn: vi.spyOn(console, 'warn'),
  error: vi.spyOn(console, 'error'),
};
beforeEach(() => {
  for (const spy of Object.values(spies)) spy.mockImplementation(() => undefined);
});
afterEach(() => {
  for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  for (const spy of Object.values(spies)) spy.mockReset();
});

function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from({ length: hex.length / 2 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

// RFC 4226 Appendix D: the secret is the ASCII string 12345678901234567890 = 0x3132333435363738393031323334353637383930.
const RFC4226_SECRET_HEX = '3132333435363738393031323334353637383930';
const RFC4226_CODES = [
  '755224',
  '287082',
  '359152',
  '969429',
  '338314',
  '254676',
  '287922',
  '162583',
  '399871',
  '520489',
];

// RFC 6238 Appendix A, the Java reference code: "Seed for HMAC-SHA1 - 20 bytes", "Seed for HMAC-SHA256 - 32 bytes" (the
// 20 bytes then 313233343536373839303132) and "Seed for HMAC-SHA512 - 64 bytes" (the 20 bytes three times then 31323334).
const SEED_20 = hexBytes(RFC4226_SECRET_HEX);
const SEED_32 = hexBytes(RFC4226_SECRET_HEX + '313233343536373839303132');
const SEED_64 = hexBytes(RFC4226_SECRET_HEX + RFC4226_SECRET_HEX + RFC4226_SECRET_HEX + '31323334');
const SEEDS: Record<OtpAlgorithm, Uint8Array> = { SHA1: SEED_20, SHA256: SEED_32, SHA512: SEED_64 };

// RFC 6238 Appendix B, Table 1 (time step 30, T0 0, 8 digits): Unix time, value of T in hex, UTC time, then the codes.
const RFC6238_TABLE: { time: number; t: string; utc: string; SHA1: string; SHA256: string; SHA512: string }[] = [
  {
    time: 59,
    t: '0000000000000001',
    utc: '1970-01-01T00:00:59Z',
    SHA1: '94287082',
    SHA256: '46119246',
    SHA512: '90693936',
  },
  {
    time: 1111111109,
    t: '00000000023523EC',
    utc: '2005-03-18T01:58:29Z',
    SHA1: '07081804',
    SHA256: '68084774',
    SHA512: '25091201',
  },
  {
    time: 1111111111,
    t: '00000000023523ED',
    utc: '2005-03-18T01:58:31Z',
    SHA1: '14050471',
    SHA256: '67062674',
    SHA512: '99943326',
  },
  {
    time: 1234567890,
    t: '000000000273EF07',
    utc: '2009-02-13T23:31:30Z',
    SHA1: '89005924',
    SHA256: '91819424',
    SHA512: '93441116',
  },
  {
    time: 2000000000,
    t: '0000000003F940AA',
    utc: '2033-05-18T03:33:20Z',
    SHA1: '69279037',
    SHA256: '90698825',
    SHA512: '38618901',
  },
  {
    time: 20000000000,
    t: '0000000027BC86AA',
    utc: '2603-10-11T11:33:20Z',
    SHA1: '65353130',
    SHA256: '77737706',
    SHA512: '47863826',
  },
];

it('RFC 4226 Appendix D gives the ten HOTP values for counts 0 to 9', () => {
  expect(SEED_20.length).toBe(20);
  expect(String.fromCharCode(...SEED_20)).toBe('12345678901234567890');
  RFC4226_CODES.forEach((code, count) => {
    expect(hotp(SEED_20, BigInt(count), 6, 'SHA1'), `count ${count}`).toBe(code);
  });
  // Section 5.3 and Appendix D: the last six digits of the truncated decimal for count 0 (1284755224) are 755224, and the
  // code has leading zeros kept (count 2 truncates to 137359152, so 359152; the TOTP table has 07081804 with its zero).
  expect(hotp(SEED_20, 0n, 8, 'SHA1')).toBe('84755224');
  expect(hotp(SEED_20, 1n, 7, 'SHA1')).toBe('4287082');
});

it('RFC 6238 Appendix B gives all eighteen TOTP values with the 20, 32 and 64 byte seeds of Appendix A', () => {
  expect(SEED_32.length).toBe(32);
  expect(SEED_64.length).toBe(64);
  expect(String.fromCharCode(...SEED_32)).toBe('12345678901234567890123456789012');
  expect(String.fromCharCode(...SEED_64)).toBe('1234567890123456789012345678901234567890123456789012345678901234');
  let checked = 0;
  for (const row of RFC6238_TABLE) {
    const step = totpStep(row.time, 30);
    expect(step.toString(16).toUpperCase().padStart(16, '0'), `value of T at ${row.time}`).toBe(row.t);
    for (const algorithm of ['SHA1', 'SHA256', 'SHA512'] as const) {
      expect(hotp(SEEDS[algorithm], step, 8, algorithm), `${algorithm} at ${row.time}`).toBe(row[algorithm]);
      checked++;
    }
  }
  expect(checked).toBe(18);
  // The window the page shows holds the same current code, and the step for 20000000000 does not fit 32 bits.
  const window = totpWindow(SEED_20, { seconds: 59, period: 30, digits: 8, algorithm: 'SHA1' });
  expect(window.find((row) => row.label === 'current')?.code).toBe('94287082');
  // Pitfall the RFC's table hides: SHA-256 and SHA-512 with the 20 byte seed do not give the table's codes.
  expect(hotp(SEED_20, 1n, 8, 'SHA256')).not.toBe('46119246');
  expect(hotp(SEED_20, 1n, 8, 'SHA512')).not.toBe('90693936');
});

it('time input accepts Unix seconds and ISO 8601 dates exactly and refuses anything else', () => {
  // Whole Unix seconds, 0 to 253402300799 (9999-12-31T23:59:59Z).
  expect(parseTimeInput('0')).toBe(0);
  expect(parseTimeInput('59')).toBe(59);
  expect(parseTimeInput('  1234567890  ')).toBe(1234567890);
  expect(parseTimeInput('20000000000')).toBe(20000000000);
  expect(parseTimeInput('253402300799')).toBe(253402300799);
  // Digits only are always Unix seconds, so a date written without hyphens is a number of seconds, not a date.
  expect(parseTimeInput('20090213')).toBe(20090213);
  // The UTC times RFC 6238 Appendix B prints beside the Unix times, in every form this page reads.
  for (const row of RFC6238_TABLE) {
    expect(parseTimeInput(row.utc), row.utc).toBe(row.time);
    expect(parseTimeInput(row.utc.replace('Z', '+00:00')), `${row.utc} with an offset`).toBe(row.time);
    expect(parseTimeInput(row.utc.replace('T', ' ')), `${row.utc} with a space`).toBe(row.time);
    expect(parseTimeInput(row.utc.toLowerCase()), `${row.utc} in lower case`).toBe(row.time);
    expect(parseTimeInput(row.utc.slice(0, 16)), `${row.utc} without seconds or a zone`).toBe(
      row.time - (row.time % 60),
    );
    expect(formatUtc(row.time), `formatUtc ${row.time}`).toBe(row.utc.replace('T', ' ').replace('Z', ''));
  }
  // The same instant written with offsets (RFC 3339 section 5.6 numeric offsets).
  expect(parseTimeInput('2009-02-14T00:31:30+01:00')).toBe(1234567890);
  expect(parseTimeInput('2009-02-13T18:31:30-05:00')).toBe(1234567890);
  expect(parseTimeInput('2009-02-14T05:01:30+05:30')).toBe(1234567890);
  // A fraction is cut to whole seconds, a date alone is midnight UTC, and no zone means UTC.
  expect(parseTimeInput('2009-02-13T23:31:30.999Z')).toBe(1234567890);
  expect(parseTimeInput('2009-02-13T23:31:30.123456789')).toBe(1234567890);
  expect(parseTimeInput('1970-01-02')).toBe(86400);
  expect(parseTimeInput('1970-01-01T00:01')).toBe(60);
  expect(parseTimeInput('9999-12-31T23:59:59Z')).toBe(253402300799);
  // Leap years by the Gregorian rule: 2008 and 2000 have a 29 February, 2009 and 2100 do not.
  expect(parseTimeInput('2008-02-29')).toBe(1204243200);
  expect(parseTimeInput('2000-02-29')).toBe(951782400);
  // Everything else is refused with a plain sentence that does not repeat the text.
  const refused = [
    '',
    '   ',
    '-1',
    '+5',
    '1e9',
    '1.5',
    '1,000',
    '0x10',
    'NaN',
    'Infinity',
    '253402300800',
    '99999999999999999999',
    '2009-02-30',
    '2009-02-29',
    '2100-02-29',
    '2009-13-01',
    '2009-00-10',
    '2009-02-00',
    '2009-2-3',
    '09-02-13',
    '2009/02/13',
    '2009-02-13T',
    '2009-02-13T24:00:00Z',
    '2009-02-13T23:60:00Z',
    '2009-02-13T23:31:60Z',
    '2009-02-13T23',
    '2009-02-13T23:31:30.Z',
    '2009-02-13T23:31:30.1234567890Z',
    '2009-02-13T23:31:30+24:00',
    '2009-02-13T23:31:30+01:60',
    '2009-02-13T23:31:30+0100',
    '2009-02-13T23:31:30+01',
    '2009-02-13T23:31:30ZZ',
    '2009-02-13T23:31:30 Z',
    '1969-12-31T23:59:59Z',
    '1970-01-01T00:00:00+01:00',
    '10000-01-01',
    '9999-12-31T23:59:59-01:00',
    '٢٠٠٩-02-13',
    '١٢٣',
    'last tuesday',
    'now',
    'MARKER-MARKER-MARKER',
  ];
  for (const input of refused) {
    let caught: unknown;
    try {
      parseTimeInput(input);
    } catch (err) {
      caught = err;
    }
    expect(caught, `accepted ${JSON.stringify(input)}`).toBeInstanceOf(TimeError);
    const message = (caught as TimeError).message;
    expect(message, 'a plain sentence').toMatch(/^[A-Z][^]*\.$/);
    expect(message.includes('MARKER'), 'the message repeats the text').toBe(false);
  }
  // A text longer than 64 characters is refused by its length before it is read.
  expect(MAX_TIME_CHARS).toBe(64);
  expect(() => parseTimeInput('1'.repeat(65))).toThrowError(/65 characters.*64/);
  expect(() => parseTimeInput('0'.repeat(64))).not.toThrow();
});

it('second 59 is the last second of step 1 and second 60 starts step 2 with 30 seconds left', () => {
  expect(totpStep(59, 30)).toBe(1n);
  expect(secondsLeft(59, 30)).toBe(1);
  expect(totpStep(60, 30)).toBe(2n);
  expect(secondsLeft(60, 30)).toBe(30);
  expect(totpStep(0, 30)).toBe(0n);
  expect(secondsLeft(0, 30)).toBe(30);
  expect(totpStep(29, 30)).toBe(0n);
  expect(secondsLeft(29, 30)).toBe(1);
  expect(totpStep(30, 30)).toBe(1n);
  expect(secondsLeft(30, 30)).toBe(30);
  // The shortest and longest periods the page accepts.
  expect(totpStep(7, 1)).toBe(7n);
  expect(secondsLeft(7, 1)).toBe(1);
  expect(totpStep(86399, 86400)).toBe(0n);
  expect(secondsLeft(86399, 86400)).toBe(1);
  expect(totpStep(86400, 86400)).toBe(1n);
  expect(secondsLeft(86400, 86400)).toBe(86400);
  // The same codes either side of the boundary: second 59 and second 30 are one step, second 60 is the next.
  const code = (seconds: number) => hotp(SEED_20, totpStep(seconds, 30), 8, 'SHA1');
  expect(code(30)).toBe(code(59));
  expect(code(59)).toBe('94287082');
  expect(code(60)).not.toBe(code(59));
  expect(code(60)).toBe(hotp(SEED_20, 2n, 8, 'SHA1'));
});

it('meta pins @noble/hashes exactly', () => {
  expect(toolMeta.id).toBe('totp-generator');
  expect(toolMeta.dependencies['@noble/hashes']).toBe('2.4.0');
});

// The RFC 4226 and RFC 6238 test secret as the Base32 text an app is given, grouped by spaces.
const RFC_SEED_B32 = 'GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ';

it('the window lists the previous, current, next and following steps with their start and end', () => {
  const at59 = totpWindow(SEED_20, { seconds: 59, period: 30, digits: 8, algorithm: 'SHA1' });
  expect(at59.map((row) => [row.label, row.step, row.startSeconds, row.endSeconds])).toEqual([
    ['previous', 0n, 0, 29],
    ['current', 1n, 30, 59],
    ['next', 2n, 60, 89],
    ['after next', 3n, 90, 119],
  ]);
  // RFC 4226 Appendix D "Truncated Decimal" for counts 0 to 3 is 1284755224, 1094287082, 137359152 and 1726969429; the
  // last eight digits of each are the 8 digit codes of the steps (and step 1 is the RFC 6238 value for time 59).
  expect(at59.map((row) => row.code)).toEqual(['84755224', '94287082', '37359152', '26969429']);
  // At the very first second there is no previous step.
  const at0 = totpWindow(SEED_20, { seconds: 0, period: 30, digits: 6, algorithm: 'SHA1' });
  expect(at0.map((row) => [row.label, row.step])).toEqual([
    ['current', 0n],
    ['next', 1n],
    ['after next', 2n],
  ]);
  expect(at0.map((row) => row.code)).toEqual(['755224', '287082', '359152']);
  // The last second of step 0 and the first of step 1.
  expect(totpWindow(SEED_20, { seconds: 29, period: 30, digits: 6, algorithm: 'SHA1' })[0]?.label).toBe('current');
  expect(totpWindow(SEED_20, { seconds: 30, period: 30, digits: 6, algorithm: 'SHA1' })[0]?.label).toBe('previous');
  // A period of one second: every step is one second, so start and end are the same second.
  const one = totpWindow(SEED_20, { seconds: 5, period: 1, digits: 6, algorithm: 'SHA1' });
  expect(one.map((row) => [row.step, row.startSeconds, row.endSeconds])).toEqual([
    [4n, 4, 4],
    [5n, 5, 5],
    [6n, 6, 6],
    [7n, 7, 7],
  ]);
  // The longest period, a day, ending on the last second of the day.
  const day = totpWindow(SEED_20, { seconds: 86399, period: 86400, digits: 6, algorithm: 'SHA1' });
  expect(day.map((row) => [row.label, row.startSeconds, row.endSeconds])).toEqual([
    ['current', 0, 86399],
    ['next', 86400, 172799],
    ['after next', 172800, 259199],
  ]);
  // The same through computeCodes: the seconds left as of the run are reported with the window.
  const totpOf = (over: Partial<Parameters<typeof computeCodes>[0]> = {}) =>
    computeCodes({ mode: 'totp', secret: RFC_SEED_B32, algorithm: 'SHA1', digits: 6, period: 30, seconds: 0, ...over });
  const result = totpOf({ digits: 8, seconds: 59 });
  expect(result.window.map((row) => row.code)).toEqual(['84755224', '94287082', '37359152', '26969429']);
  expect(result.secondsLeft).toBe(1);
  expect(result.counters).toEqual([]);
  expect(totpOf({ digits: 8, seconds: 60 }).secondsLeft).toBe(30);
  // Period and time limits: 1 and 86400 are accepted, 0 and 86401 are refused naming the field.
  for (const period of [1, 86400]) expect(() => totpOf({ period })).not.toThrow();
  for (const period of [0, 86401, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => totpOf({ period }), String(period)).toThrowError('Period must be a whole number from 1 to 86400.');
  }
  for (const seconds of [-1, 1.5, 253402300800, Number.NaN]) {
    expect(() => totpOf({ seconds }), String(seconds)).toThrowError(TotpError);
  }
});

it('HOTP lists counters N to N+4 and refuses counters beyond 9007199254740991', () => {
  const hotpOf = (over: Partial<Parameters<typeof computeCodes>[0]> = {}) =>
    computeCodes({ mode: 'hotp', secret: RFC_SEED_B32, algorithm: 'SHA1', digits: 6, counter: 0, ...over });
  const rowsAt = (counter: number) => hotpOf({ counter }).counters;
  // RFC 4226 Appendix D: counts 0 to 9.
  expect(rowsAt(0).map((row) => [row.counter, row.code])).toEqual(
    RFC4226_CODES.slice(0, 5).map((code, count) => [BigInt(count), code]),
  );
  expect(rowsAt(5).map((row) => [row.counter, row.code])).toEqual(
    RFC4226_CODES.slice(5, 10).map((code, count) => [BigInt(count + 5), code]),
  );
  const result = hotpOf({ counter: 3 });
  expect(result.window).toEqual([]);
  expect(result.secondsLeft).toBeUndefined();
  // The largest counter is accepted and its rows run on past it as 64 bit counters.
  const top = rowsAt(9007199254740991);
  expect(top.map((row) => row.counter)).toEqual([
    9007199254740991n,
    9007199254740992n,
    9007199254740993n,
    9007199254740994n,
    9007199254740995n,
  ]);
  expect(top.map((row) => row.code)).toEqual(top.map((row) => hotp(SEED_20, row.counter, 6, 'SHA1')));
  // Larger, negative, fractional and non-numeric counters are refused naming the field.
  for (const counter of [9007199254740992, 1e300, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => rowsAt(counter), String(counter)).toThrowError(
      'Counter must be a whole number from 0 to 9007199254740991.',
    );
  }
  expect(() => hotpOf({ counter: '5' as unknown as number })).toThrowError(TotpError);
  expect(() => hotpOf({ counter: undefined })).toThrowError(TotpError);
  // Each mode reads only its own fields: a hidden period, time or counter never blocks the mode in use.
  expect(() => hotpOf({ counter: 1, period: 0, seconds: -5 })).not.toThrow();
  expect(() =>
    computeCodes({
      mode: 'totp',
      secret: RFC_SEED_B32,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      seconds: 59,
      counter: -1,
    }),
  ).not.toThrow();
  // A mode that is neither is refused.
  expect(() => hotpOf({ mode: 'both' as unknown as 'hotp' })).toThrowError(TotpError);
});

it('60 random cases recorded from pyotp 2.10.0 give the same codes', () => {
  expect(PYOTP_VERSION).toBe('2.10.0');
  expect(TOTP_CASES.length).toBe(60);
  // The cases cover all three algorithms, all three digit counts and all three periods.
  expect(new Set(TOTP_CASES.map((c) => c.algorithm))).toEqual(new Set(['SHA1', 'SHA256', 'SHA512']));
  expect(new Set(TOTP_CASES.map((c) => c.digits))).toEqual(new Set([6, 7, 8]));
  expect(new Set(TOTP_CASES.map((c) => c.period))).toEqual(new Set([15, 30, 60]));
  for (const c of TOTP_CASES) {
    const seed = hexBytes(c.seedHex);
    // pyotp wrote the Base32 text, so reading it back is also checked against Python's encoder.
    expect(Array.from(decodeBase32(c.seedB32)), c.seedB32).toEqual(Array.from(seed));
    expect(encodeBase32(seed, false)).toBe(c.seedB32);
    expect(
      hotp(seed, totpStep(c.seconds, c.period), c.digits, c.algorithm),
      `${c.algorithm} ${c.digits} ${c.period} ${c.seconds}`,
    ).toBe(c.code);
    const current = computeCodes({
      mode: 'totp',
      secret: c.seedB32.toLowerCase(),
      algorithm: c.algorithm,
      digits: c.digits,
      period: c.period,
      seconds: c.seconds,
    }).window.find((row) => row.label === 'current');
    expect(current?.code).toBe(c.code);
  }
});

it('20 random HOTP cases recorded from pyotp 2.10.0 give the same codes, with counters past 32 and 53 bits', () => {
  expect(HOTP_CASES.length).toBe(20);
  const counters = HOTP_CASES.map((c) => c.counter);
  for (const wide of [
    '4294967295',
    '4294967296',
    '9007199254740991',
    '9007199254740992',
    '9223372036854775808',
    '18446744073709551615',
  ]) {
    expect(counters, wide).toContain(wide);
  }
  for (const c of HOTP_CASES) {
    expect(
      hotp(hexBytes(c.seedHex), BigInt(c.counter), c.digits, c.algorithm),
      `${c.algorithm} ${c.digits} ${c.counter}`,
    ).toBe(c.code);
  }
  // A counter that needs more than 8 bytes is refused by the algorithm itself.
  expect(() => hotp(SEED_20, 18446744073709551616n, 6, 'SHA1')).toThrowError(TotpError);
  expect(() => hotp(SEED_20, -1n, 6, 'SHA1')).toThrowError(TotpError);
});

it('200 random HOTP values equal an HMAC built with Node crypto', () => {
  // A small seeded generator (mulberry32), never an unseeded random source.
  let state = 0x14050;
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const algorithms = ['SHA1', 'SHA256', 'SHA512'] as const;
  for (let round = 0; round < 200; round++) {
    const secret = Uint8Array.from({ length: 10 + Math.floor(next() * 50) }, () => Math.floor(next() * 256));
    const algorithm = algorithms[Math.floor(next() * 3)]!;
    const digits = (6 + Math.floor(next() * 3)) as 6 | 7 | 8;
    const counter = (BigInt(Math.floor(next() * 2 ** 32)) << 21n) | BigInt(Math.floor(next() * 2 ** 21));
    // RFC 4226 section 5.3 written out again here with Node's own HMAC: an 8 byte big-endian counter, the low 4 bits of the
    // last byte as the offset, 31 bits from there, then the last `digits` decimal digits.
    const message = Buffer.alloc(8);
    message.writeBigUInt64BE(counter);
    const mac = createHmac(algorithm.toLowerCase(), secret).update(message).digest();
    const offset = mac[mac.length - 1]! & 0x0f;
    const bin = mac.readUInt32BE(offset) & 0x7fffffff;
    expect(hotp(secret, counter, digits, algorithm), `${algorithm} ${digits} ${counter}`).toBe(
      String(bin % 10 ** digits).padStart(digits, '0'),
    );
  }
}, 60_000);

it('short secrets, 7 digits and non-default settings give their notes', () => {
  const SHORT = 'This secret is 64 bits. RFC 4226 requires at least 128 bits and recommends 160.';
  const SEVEN = 'Many authenticator apps do not accept 7-digit codes.';
  const OTHER =
    'SHA-1, 6 digits and a 30-second period work in every authenticator app. Other settings are written into the link, but some apps ignore them and show wrong codes; check against the codes shown here before relying on it.';
  const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255);
  const totpOf = (secret: Uint8Array, over: Partial<Parameters<typeof computeCodes>[0]> = {}) =>
    computeCodes({
      mode: 'totp',
      secret: encodeBase32(secret),
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      seconds: 59,
      ...over,
    });
  const hotpOf = (over: Partial<Parameters<typeof computeCodes>[0]> = {}) =>
    computeCodes({ mode: 'hotp', secret: encodeBase32(bytes(20)), algorithm: 'SHA1', digits: 6, counter: 0, ...over });
  // RFC 4226 section 4 requirement R6: at least 128 bits, 160 recommended.
  expect(totpOf(bytes(8)).warnings).toEqual([SHORT]);
  expect(totpOf(bytes(15)).warnings).toEqual([
    'This secret is 120 bits. RFC 4226 requires at least 128 bits and recommends 160.',
  ]);
  expect(totpOf(bytes(16)).warnings).toEqual([]);
  expect(totpOf(bytes(20)).warnings).toEqual([]);
  // The warning is a warning: the codes are still made.
  expect(totpOf(bytes(8)).window.length).toBe(4);
  // The usual settings give no note at all.
  expect(totpOf(bytes(20)).notes).toEqual([]);
  expect(totpOf(bytes(20), { digits: 7 }).notes).toEqual([SEVEN, OTHER]);
  expect(totpOf(bytes(20), { digits: 8 }).notes).toEqual([OTHER]);
  expect(totpOf(bytes(20), { algorithm: 'SHA256' }).notes).toEqual([OTHER]);
  expect(totpOf(bytes(20), { algorithm: 'SHA512' }).notes).toEqual([OTHER]);
  expect(totpOf(bytes(20), { period: 60 }).notes).toEqual([OTHER]);
  expect(totpOf(bytes(20), { period: 1 }).notes).toEqual([OTHER]);
  // HOTP has no period, so a period never gives a note there; its algorithm and digits still do.
  expect(hotpOf({ period: 60 }).notes).toEqual([]);
  expect(hotpOf({ digits: 7 }).notes).toEqual([SEVEN, OTHER]);
  expect(hotpOf({ algorithm: 'SHA256' }).notes).toEqual([OTHER]);
  // The link is made only when an account name is given, and carries the settings.
  expect(totpOf(bytes(20)).uri).toBeUndefined();
  expect(totpOf(bytes(20), { account: '   ' }).uri).toBeUndefined();
  const withLink = totpOf(bytes(20), { issuer: 'Example', account: 'alice', digits: 8 });
  expect(withLink.uri).toBe(
    otpauthUri({
      type: 'totp',
      secret: bytes(20),
      issuer: 'Example',
      account: 'alice',
      algorithm: 'SHA1',
      digits: 8,
      period: 30,
      counter: 0n,
    }),
  );
  const hotpLink = hotpOf({ issuer: 'Example', account: 'alice', counter: 9 });
  expect(hotpLink.uri?.endsWith('&issuer=Example&counter=9')).toBe(true);
  // Issuer and account have a length limit of 256 characters each.
  expect(() => totpOf(bytes(20), { account: 'a'.repeat(257) })).toThrowError(
    /Account is 257 characters. The limit is 256/,
  );
  expect(() => totpOf(bytes(20), { issuer: 'i'.repeat(257), account: 'a' })).toThrowError(
    /Issuer is 257 characters. The limit is 256/,
  );
  expect(() => totpOf(bytes(20), { issuer: 'i'.repeat(256), account: 'a'.repeat(256) })).not.toThrow();
  // A secret over 1,024 characters is refused by its length before it is read; 1,024 is read.
  const longSecret = (length: number) => () =>
    computeCodes({ mode: 'totp', secret: 'A'.repeat(length), algorithm: 'SHA1', digits: 6, period: 30, seconds: 0 });
  expect(longSecret(1025)).toThrowError(/This secret is 1025 characters. The limit is 1,024/);
  expect(longSecret(1024)).not.toThrow();
  // An empty secret, digits and an algorithm out of range are refused plainly.
  expect(() => totpOf(new Uint8Array(0))).toThrowError(TotpError);
  expect(() => totpOf(bytes(20), { secret: '- = -' })).toThrowError(TotpError);
  expect(() => totpOf(bytes(20), { digits: 9 })).toThrowError('Digits must be a whole number from 6 to 8.');
  expect(() => totpOf(bytes(20), { digits: 5 })).toThrowError('Digits must be a whole number from 6 to 8.');
  for (const algorithm of ['MD5', '__proto__', 'toString', 'constructor', 'sha1']) {
    expect(() => totpOf(bytes(20), { algorithm: algorithm as unknown as 'SHA1' }), algorithm).toThrowError(
      'Algorithm must be SHA1, SHA256 or SHA512.',
    );
  }
});

it('no thrown message, warning or note holds the secret', () => {
  // A 20 byte secret that is not one of the RFC seeds, as Base32 text and as hexadecimal.
  const seed = Uint8Array.from({ length: 20 }, (_, i) => (i * 53 + 7) & 255);
  const base32 = encodeBase32(seed, false);
  const hex = Array.from(seed, (b) => b.toString(16).padStart(2, '0')).join('');
  const windows = (text: string, size: number): string[] =>
    Array.from({ length: text.length - size + 1 }, (_, i) => text.slice(i, i + size));
  const hexWindows = windows(hex, 8);
  const leaks = (text: string, typed: string): boolean =>
    windows(typed.replace(/[ -]/g, ''), 8).some((w) => text.includes(w)) || hexWindows.some((w) => text.includes(w));
  const typedForms = [
    base32,
    base32.toLowerCase(),
    `${base32.slice(0, 16)} ${base32.slice(16)}`,
    `${base32.slice(0, 7)}1${base32.slice(8)}`,
    `${base32}!`,
    `${base32}${base32}`.slice(0, 41),
    base32.slice(0, 9),
  ];
  const seen: string[] = [];
  const variations: Partial<Parameters<typeof computeCodes>[0]>[] = [
    {},
    { period: 0 },
    { seconds: -1 },
    { digits: 9 },
    { mode: 'hotp', counter: -1 },
    { account: 'a'.repeat(300) },
    { issuer: 'x', account: 'ok' },
  ];
  for (const typed of typedForms) {
    for (const over of variations) {
      try {
        const result = computeCodes({
          mode: 'totp',
          secret: typed,
          algorithm: 'SHA1',
          digits: 6,
          period: 30,
          seconds: 59,
          ...over,
        });
        seen.push(...result.warnings, ...result.notes);
      } catch (err) {
        expect(err instanceof TotpError || err instanceof Base32Error, 'an error of an unknown kind').toBe(true);
        seen.push((err as Error).message);
      }
    }
  }
  expect(seen.length).toBeGreaterThan(20);
  for (const text of seen) {
    for (const typed of typedForms) expect(leaks(text, typed), text).toBe(false);
    expect(text.includes('otpauth'), text).toBe(false);
  }
  // A time typed as text is never repeated either.
  for (const text of ['ZQXJ-MARKER-1', '2009-02-30-MARKER']) {
    expect(() => parseTimeInput(text)).toThrowError(TimeError);
    try {
      parseTimeInput(text);
    } catch (err) {
      expect((err as Error).message.includes('MARKER')).toBe(false);
    }
  }
});
