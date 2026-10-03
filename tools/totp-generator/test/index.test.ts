import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hotp, secondsLeft, totpStep, totpWindow, type OtpAlgorithm } from '../src/otp';
import { MAX_TIME_CHARS, TimeError, formatUtc, parseTimeInput } from '../src/time';
import { meta as toolMeta } from '../src/index';

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
