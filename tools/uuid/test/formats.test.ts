import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  CROCKFORD_ALPHABET,
  IdentifierError,
  KSUID_EPOCH_SECONDS,
  NANOID_DEFAULT_SIZE,
  NANOID_URL_ALPHABET,
  SNOWFLAKE_DEFAULT_EPOCH,
  decodeKsuid,
  decodeObjectId,
  decodeSnowflake,
  decodeUlid,
  detectIdentifier,
  encodeKsuid,
  encodeSnowflake,
  generateKsuids,
  generateNanoIds,
  generateObjectIds,
  generateSnowflakes,
  generateUlids,
  parseEpoch,
  pickAlphabetIndex,
} from '../src/index';

// Every expected value below is a literal taken from a published source, or computed by a method written in this file
// that shares no code with the package (a bit string for base32, repeated division for base62, Python 3.14 datetime for
// the times). Where a value came from is written next to it.

const T0 = 1_700_000_000_000; // 2023-11-14T22:13:20.000Z, the fixed clock of most tests

const spies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  for (const name of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    spies.push(vi.spyOn(console, name).mockImplementation(() => undefined));
  }
});
afterEach(() => {
  const written = spies.reduce((total, spy) => total + spy.mock.calls.length, 0);
  for (const spy of spies.splice(0)) spy.mockRestore();
  vi.restoreAllMocks();
  expect(written, 'nothing may be written to the console').toBe(0);
});

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe('IdentifierError');
    return (error as Error).message;
  }
  throw new Error('expected a refusal, but the call returned');
}

/** Independent base32: the 130 bit string (two zero bits, 48 time bits, 80 random bits) read five bits at a time. */
function ulidFromParts(ms: number, randomHex: string): string {
  const bits =
    '00' +
    ms.toString(2).padStart(48, '0') +
    BigInt('0x' + randomHex)
      .toString(2)
      .padStart(80, '0');
  let out = '';
  for (let i = 0; i < 130; i += 5) out += '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

/** Independent base62: repeated division of the 160 bit number, least significant digit first. */
function ksuidFromParts(timestamp: number, payloadHex: string): string {
  let n = (BigInt(timestamp) << 128n) + BigInt('0x' + payloadHex);
  const digits: string[] = [];
  while (digits.length < 27) {
    digits.push('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'[Number(n % 62n)]!);
    n /= 62n;
  }
  return digits.reverse().join('');
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

it('ULID decodes the specification example to its time and refuses a first character above 7', () => {
  // The ULID specification, https://github.com/ulid/spec (README): ulid() // 01ARZ3NDEKTSV4RRFFQ69G5FAV
  // The time and the random part were computed with Python 3.14 from the 130 bit string.
  const decoded = decodeUlid('01ARZ3NDEKTSV4RRFFQ69G5FAV');
  expect(decoded.ms).toBe(1469922850259);
  expect(decoded.iso).toBe('2016-07-30T23:54:10.259Z');
  expect(decoded.randomHex).toBe('d6764c61efb99302bd5b');
  expect(decodeUlid('01arz3ndektsv4rrffq69g5fav')).toEqual(decoded);
  expect(decodeUlid('  01ARZ3NDEKTSV4RRFFQ69G5FAV  ')).toEqual(decoded);

  // The specification: the largest valid ULID is 7ZZZZZZZZZZZZZZZZZZZZZZZZZ, the time 281474976710655 (2^48 - 1).
  const largest = decodeUlid('7ZZZZZZZZZZZZZZZZZZZZZZZZZ');
  expect(largest.ms).toBe(281474976710655);
  expect(largest.randomHex).toBe('ffffffffffffffffffff');
  expect(largest.iso).toBe('+010889-08-02T05:31:50.655Z');
  expect(decodeUlid('00000000000000000000000000')).toEqual({
    ms: 0,
    iso: '1970-01-01T00:00:00.000Z',
    randomHex: '00000000000000000000',
  });

  // "Any attempt to decode or encode a ULID larger than this should be rejected."
  const tooBig = /above 7/;
  expect(messageOf(() => decodeUlid('8ZZZZZZZZZZZZZZZZZZZZZZZZZ'))).toMatch(tooBig);
  expect(messageOf(() => decodeUlid('ZZZZZZZZZZZZZZZZZZZZZZZZZZ'))).toMatch(tooBig);
  expect(messageOf(() => decodeUlid('8ZZZZZZZZZZZZZZZZZZZZZZZZZ'))).toBe(
    'A ULID cannot start with a character above 7: the largest ULID is 7ZZZZZZZZZZZZZZZZZZZZZZZZZ.',
  );

  // The alphabet has no I, L, O or U, and the length is exactly 26.
  expect(messageOf(() => decodeUlid('01ARZ3NDEKTSV4RRFFQ6 G5FAV'))).toBe(
    'A ULID uses only the characters 0 to 9 and A to Z without I, L, O and U.',
  );
  for (const bad of ['I', 'L', 'O', 'U', 'u', '-', '!', '~']) {
    expect(messageOf(() => decodeUlid('01ARZ3NDEKTSV4RRFFQ69G5FA' + bad))).toBe(
      'A ULID uses only the characters 0 to 9 and A to Z without I, L, O and U.',
    );
  }
  for (const bad of ['', '01ARZ3NDEKTSV4RRFFQ69G5FA', '01ARZ3NDEKTSV4RRFFQ69G5FAVV']) {
    expect(messageOf(() => decodeUlid(bad))).toBe('A ULID has exactly 26 characters.');
  }
  expect(CROCKFORD_ALPHABET).toBe('0123456789ABCDEFGHJKMNPQRSTVWXYZ');
});

it('ULID generation is monotonic within one millisecond and sorts by time', () => {
  const ids = generateUlids(1000, T0);
  expect(ids).toHaveLength(1000);
  for (let i = 0; i < ids.length; i++) {
    expect(ids[i]).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(decodeUlid(ids[i]!).ms).toBe(T0);
    if (i > 0) {
      expect(ids[i]! > ids[i - 1]!, `id ${i} sorts after id ${i - 1}`).toBe(true);
      // The specification: within one millisecond the random part is incremented by 1 in its lowest bit.
      expect(BigInt('0x' + decodeUlid(ids[i]!).randomHex) - BigInt('0x' + decodeUlid(ids[i - 1]!).randomHex)).toBe(1n);
    }
  }
  // The specification's own pair (README, monotonicity section): ...MMVRZ then ...MMVS0 differ by one.
  const first = decodeUlid('01BX5ZZKBKACTAV9WEVGEMMVRZ');
  const second = decodeUlid('01BX5ZZKBKACTAV9WEVGEMMVS0');
  expect(first.ms).toBe(1508808576371);
  expect(second.ms).toBe(first.ms);
  expect(BigInt('0x' + second.randomHex) - BigInt('0x' + first.randomHex)).toBe(1n);

  // A later call in the same millisecond carries on from where the last one stopped; a later millisecond sorts after.
  const more = generateUlids(3, T0);
  expect(more[0]! > ids[999]!).toBe(true);
  const later = generateUlids(2, T0 + 1);
  expect(decodeUlid(later[0]!).ms).toBe(T0 + 1);
  expect(later[0]! > more[2]!).toBe(true);
  const times = [T0 + 10, T0 + 5000, T0 + 86_400_000].map((now) => generateUlids(1, now)[0]!);
  expect([...times].sort()).toEqual(times);
});

it('ULID refuses to overflow its random part within one millisecond and keeps counting across calls', () => {
  // The specification: more than 2^80 ULIDs in one millisecond, or an overflow with fewer, makes generation fail.
  const now = T0 + 777;
  const spy = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(((array: Uint8Array) => {
    array.fill(0xff);
    return array;
  }) as never);
  expect(generateUlids(1, now)).toEqual([ulidFromParts(now, 'ffffffffffffffffffff')]);
  expect(messageOf(() => generateUlids(1, now))).toBe(
    'Too many ULIDs in one millisecond: the 80-bit random part would overflow.',
  );
  spy.mockRestore();
  // A new millisecond starts again with a fresh random part.
  expect(decodeUlid(generateUlids(1, now + 1)[0]!).ms).toBe(now + 1);
});

it('KSUID decodes each published example to its timestamp and payload', () => {
  // The KSUID README (vendored, test/fixtures/ksuid/README.md): the four JSON template examples.
  const published: [string, number, string][] = [
    ['0uk1Hbc9dQ9pxyTqJ93IUrfhdGq', 107611700, '9850EEEC191BF4FF26F99315CE43B0C8'],
    ['0uk1HdCJ6hUZKDgcxhpJwUl5ZEI', 107611700, 'CC55072555316F45B8CA2D2979D3ED0A'],
    ['0uk1HcdvF0p8C20KtTfdRSB9XIm', 107611700, 'BA1C205D6177F0992D15EE606AE32238'],
    ['0uk1Ha7hGJ1Q9Xbnkt0yZgNwg3g', 107611700, '67517BA309EA62AE7991B27BB6F2FCAC'],
    // The two inspect examples (the README prints the time in Pacific time; the UTC times were computed with Python).
    ['0ujtsYcgvSTl8PAuAdqWYSMnLOv', 107608047, 'B5A1CD34B5F99D1154FB6853345C9735'],
    ['0ujzPyRiIAffKhBux4PvQdDqMHY', 107610780, '73FC1AA3B2446246D6E89FCD909E8FE8'],
  ];
  for (const [text, timestamp, payloadHex] of published) {
    const decoded = decodeKsuid(text);
    expect(decoded.timestamp, text).toBe(timestamp);
    expect(decoded.payloadHex, text).toBe(payloadHex);
    expect(decoded.iso, text).toBe(new Date((KSUID_EPOCH_SECONDS + timestamp) * 1000).toISOString());
  }
  expect(decodeKsuid('0uk1Hbc9dQ9pxyTqJ93IUrfhdGq').iso).toBe('2017-10-10T05:01:40.000Z');
  expect(decodeKsuid('0ujtsYcgvSTl8PAuAdqWYSMnLOv').iso).toBe('2017-10-10T04:00:47.000Z'); // README: 2017-10-09 21:00:47 -0700
  expect(decodeKsuid('0ujzPyRiIAffKhBux4PvQdDqMHY').iso).toBe('2017-10-10T04:46:20.000Z'); // README: 2017-10-09 21:46:20 -0700
  expect(KSUID_EPOCH_SECONDS).toBe(1_400_000_000); // ksuid.go: epochStamp int64 = 1400000000 (2014-05-13T16:53:20Z)

  // ksuid.go: minStringEncoded is 27 zeros and maxStringEncoded is aWgEPTl1tmebfsQzFP4bxwgy80V (all 20 bytes 0xFF).
  expect(decodeKsuid('000000000000000000000000000')).toEqual({
    timestamp: 0,
    iso: '2014-05-13T16:53:20.000Z',
    payloadHex: '00000000000000000000000000000000',
  });
  const largest = decodeKsuid('aWgEPTl1tmebfsQzFP4bxwgy80V');
  expect(largest.timestamp).toBe(4294967295);
  expect(largest.payloadHex).toBe('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF');
  expect(largest.iso).toBe('2150-06-19T23:21:35.000Z');
  expect(messageOf(() => decodeKsuid('aWgEPTl1tmebfsQzFP4bxwgy80W'))).toBe(
    'A KSUID cannot be larger than aWgEPTl1tmebfsQzFP4bxwgy80V.',
  );
  expect(messageOf(() => decodeKsuid('zzzzzzzzzzzzzzzzzzzzzzzzzzz'))).toBe(
    'A KSUID cannot be larger than aWgEPTl1tmebfsQzFP4bxwgy80V.',
  );
  expect(messageOf(() => decodeKsuid('0uk1Hbc9dQ9pxyTqJ93IUrfhdG'))).toBe('A KSUID has exactly 27 characters.');
  expect(messageOf(() => decodeKsuid('0uk1Hbc9dQ9pxyTqJ93IUrfhdGq0'))).toBe('A KSUID has exactly 27 characters.');
  expect(messageOf(() => decodeKsuid('0uk1Hbc9dQ9pxyTqJ93IUrfhdG-'))).toBe(
    'A KSUID uses only the characters 0 to 9, A to Z and a to z.',
  );
});

it('KSUID encodes the published raw bytes to the published text', () => {
  // The README inspect output prints Raw: the 20 bytes the text stands for.
  expect(encodeKsuid(hexToBytes('0669F7EFB5A1CD34B5F99D1154FB6853345C9735'))).toBe('0ujtsYcgvSTl8PAuAdqWYSMnLOv');
  expect(encodeKsuid(hexToBytes('066A029C73FC1AA3B2446246D6E89FCD909E8FE8'))).toBe('0ujzPyRiIAffKhBux4PvQdDqMHY');
  expect(encodeKsuid(hexToBytes('FF'.repeat(20)))).toBe('aWgEPTl1tmebfsQzFP4bxwgy80V');
  expect(encodeKsuid(new Uint8Array(20))).toBe('0'.repeat(27));
  expect(() => encodeKsuid(new Uint8Array(19))).toThrow(IdentifierError);
});

it('ObjectId decodes the published example to its timestamp, random part and counter', () => {
  // The MongoDB ObjectId reference page (https://www.mongodb.com/docs/manual/reference/method/ObjectId/): a 4-byte
  // timestamp in seconds, a 5-byte random value and a 3-byte counter, big-endian. Its example ids are decoded here.
  // Times and the counter were computed with Python 3.14 (int(hex, 16) and datetime).
  const first = decodeObjectId('507f1f77bcf86cd799439011');
  expect(first.timestamp).toBe(1350508407);
  expect(first.iso).toBe('2012-10-17T21:13:27.000Z');
  expect(first.randomHex).toBe('bcf86cd799');
  expect(first.counter).toBe(0x439011);
  expect(first.counter).toBe(4427793);

  const second = decodeObjectId('507F191E810C19729DE860EA');
  expect(second).toEqual({
    timestamp: 1350506782,
    iso: '2012-10-17T20:46:22.000Z',
    randomHex: '810c19729d',
    counter: 15229162,
  });
  expect(decodeObjectId('000000000000000000000000').iso).toBe('1970-01-01T00:00:00.000Z');
  expect(decodeObjectId('ffffffffffffffffffffffff')).toEqual({
    timestamp: 4294967295,
    iso: '2106-02-07T06:28:15.000Z',
    randomHex: 'ffffffffff',
    counter: 16777215,
  });
  for (const bad of [
    '',
    '507f1f77bcf86cd79943901',
    '507f1f77bcf86cd7994390111',
    '507f1f77bcf86cd79943901g',
    '507f1f77 bcf86cd7994390',
  ]) {
    expect(messageOf(() => decodeObjectId(bad))).toBe('An ObjectId has exactly 24 hexadecimal digits.');
  }
});

it('ObjectId draws its random part and counter once and counts on with a wrap', async () => {
  // A fresh copy of the module, so the once-per-page-load draw is seen from the start.
  vi.resetModules();
  const fresh = (await import('../src/objectid')) as typeof import('../src/objectid');
  const feed = [1, 2, 3, 4, 5, 0xff, 0xff, 0xfe];
  const spy = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(((array: Uint8Array) => {
    for (let i = 0; i < array.length; i++) array[i] = feed.shift() ?? 0;
    return array;
  }) as never);
  const now = 1_350_508_407_000; // 507f1f77
  const ids = fresh.generateObjectIds(3, now);
  expect(ids).toEqual([
    '507f1f77' + '0102030405' + 'fffffe',
    '507f1f77' + '0102030405' + 'ffffff',
    '507f1f77' + '0102030405' + '000000',
  ]);
  const draws = spy.mock.calls.length;
  expect(draws).toBe(2); // the five random bytes and the counter start, once
  const more = fresh.generateObjectIds(2, now + 5000);
  expect(more).toEqual(['507f1f7c' + '0102030405' + '000001', '507f1f7c' + '0102030405' + '000002']);
  expect(spy.mock.calls.length).toBe(draws);
  expect(messageOf(() => fresh.generateObjectIds(1, -1000))).toBe(
    'The time is outside what an ObjectId can hold (0 to 2^32 - 1 seconds since 1970).',
  );
  expect(messageOf(() => fresh.generateObjectIds(1, 4294967296 * 1000))).toBe(
    'The time is outside what an ObjectId can hold (0 to 2^32 - 1 seconds since 1970).',
  );

  // Another page load with a counter that starts at 0x123456: all three counter bytes are written in order.
  vi.resetModules();
  const other = (await import('../src/objectid')) as typeof import('../src/objectid');
  feed.push(0xa0, 0xb1, 0xc2, 0xd3, 0xe4, 0x12, 0x34, 0x56);
  expect(other.generateObjectIds(2, now)).toEqual([
    '507f1f77' + 'a0b1c2d3e4' + '123456',
    '507f1f77' + 'a0b1c2d3e4' + '123457',
  ]);
});

it('Snowflake ids decode with BigInt to time, datacenter, worker and sequence for a chosen epoch', () => {
  // The published layout (https://en.wikipedia.org/wiki/Snowflake_ID): one zero bit, 41 bits of milliseconds since a
  // chosen epoch, 10 machine bits (5 datacenter and 5 worker bits), 12 sequence bits. Its worked example: the id
  // 1888944671579078978 with the epoch 1288834974657 is 1739194479256 ms (2025-02-10T13:34:39.256Z), machine bits
  // 01 0110 1000 and sequence 322. 360 is 11 and 8 as two 5 bit numbers (Python 3.14: (id >> 17) & 31, (id >> 12) & 31).
  expect(SNOWFLAKE_DEFAULT_EPOCH).toBe(1288834974657);
  const example = decodeSnowflake('1888944671579078978', SNOWFLAKE_DEFAULT_EPOCH);
  expect(example).toEqual({
    ms: 1739194479256,
    iso: '2025-02-10T13:34:39.256Z',
    datacenter: 11,
    worker: 8,
    sequence: 322,
  });
  // The same id against the Unix epoch is just the time offset.
  expect(decodeSnowflake('1888944671579078978', 0).ms).toBe(450359504599);

  // Built from known parts and decoded again (datacenter 3, worker 7, sequence 5), for two epochs.
  for (const epoch of [0, SNOWFLAKE_DEFAULT_EPOCH, 1_420_070_400_000]) {
    const ms = epoch + 123_456_789;
    const id = encodeSnowflake({ ms, datacenter: 3, worker: 7, sequence: 5 }, epoch);
    expect(id).toBe(((BigInt(ms - epoch) << 22n) | (3n << 17n) | (7n << 12n) | 5n).toString());
    expect(decodeSnowflake(id, epoch)).toEqual({
      ms,
      iso: new Date(ms).toISOString(),
      datacenter: 3,
      worker: 7,
      sequence: 5,
    });
  }

  // The largest id keeps all 63 bits: 2^63 - 1. Anything above it is refused, and 19 digits is the longest text.
  const largest = decodeSnowflake('9223372036854775807', 0);
  expect(largest).toMatchObject({ ms: 2199023255551, datacenter: 31, worker: 31, sequence: 4095 });
  expect(decodeSnowflake('0', 0)).toMatchObject({ ms: 0, datacenter: 0, worker: 0, sequence: 0 });
  expect(messageOf(() => decodeSnowflake('9223372036854775808', 0))).toBe(
    'A Snowflake ID cannot be larger than 9223372036854775807 (2^63 - 1).',
  );
  for (const bad of ['', '12a', '-5', '1.5', ' ', '12345678901234567890', '1e5']) {
    expect(messageOf(() => decodeSnowflake(bad, 0))).toBe('A Snowflake ID is a whole number of 1 to 19 digits.');
  }
  expect(messageOf(() => decodeSnowflake('1', -1))).toBe(
    'Epoch must be a whole number of milliseconds since 1970-01-01, or an ISO 8601 date such as 2010-11-04 or 2010-11-04T01:42:54.657Z (a time needs an offset such as Z or +02:00).',
  );
});

it('Snowflake generation counts the sequence and moves to the next millisecond after 4096 ids', () => {
  const options = { count: 5000, epoch: SNOWFLAKE_DEFAULT_EPOCH, datacenter: 9, worker: 21 };
  const ids = generateSnowflakes(options, T0 + 2000);
  expect(ids).toHaveLength(5000);
  const decoded = ids.map((id) => decodeSnowflake(id, SNOWFLAKE_DEFAULT_EPOCH));
  expect(decoded[0]).toMatchObject({ ms: T0 + 2000, datacenter: 9, worker: 21, sequence: 0 });
  expect(decoded[4095]).toMatchObject({ ms: T0 + 2000, sequence: 4095 });
  expect(decoded[4096]).toMatchObject({ ms: T0 + 2001, sequence: 0 });
  expect(decoded[4999]).toMatchObject({ ms: T0 + 2001, sequence: 903 });
  for (let i = 1; i < ids.length; i++) expect(BigInt(ids[i]!) > BigInt(ids[i - 1]!)).toBe(true);
  expect(new Set(ids).size).toBe(5000);

  // A later call in a millisecond that is already used carries on after the last id; a later millisecond starts at 0.
  const next = generateSnowflakes({ ...options, count: 2 }, T0 + 2001);
  expect(decodeSnowflake(next[0]!, SNOWFLAKE_DEFAULT_EPOCH)).toMatchObject({ ms: T0 + 2001, sequence: 904 });
  const fresh = generateSnowflakes({ ...options, count: 1 }, T0 + 9000);
  expect(decodeSnowflake(fresh[0]!, SNOWFLAKE_DEFAULT_EPOCH)).toMatchObject({ ms: T0 + 9000, sequence: 0 });
  // A different machine starts at 0 in the same millisecond.
  const other = generateSnowflakes({ ...options, count: 1, worker: 22 }, T0 + 9000);
  expect(decodeSnowflake(other[0]!, SNOWFLAKE_DEFAULT_EPOCH)).toMatchObject({ ms: T0 + 9000, worker: 22, sequence: 0 });

  // 2^41 - 1 milliseconds after the epoch is the last time the layout holds.
  const base = { count: 1, epoch: 0, datacenter: 1, worker: 1 };
  expect(decodeSnowflake(generateSnowflakes(base, 2199023255551)[0]!, 0).ms).toBe(2199023255551);
  expect(messageOf(() => generateSnowflakes({ ...base, datacenter: 2 }, 2199023255552))).toBe(
    'The time is before the epoch or more than 2^41 - 1 milliseconds after it, which a Snowflake ID cannot hold.',
  );
  expect(messageOf(() => generateSnowflakes({ ...base, epoch: 1000, datacenter: 3 }, 999))).toBe(
    'The time is before the epoch or more than 2^41 - 1 milliseconds after it, which a Snowflake ID cannot hold.',
  );
});

it('NanoID uses the URL-safe alphabet and size 21 by default and has no bias for any alphabet size', () => {
  // The alphabet is the one in NanoID's url-alphabet/index.js (vendored): 64 symbols A-Za-z0-9_- in a fixed order.
  const vendored = readFileSync(fileURLToPath(new URL('./fixtures/nanoid/url-alphabet.js', import.meta.url)), 'utf8');
  expect(vendored).toContain(`'${NANOID_URL_ALPHABET}'`);
  expect(NANOID_URL_ALPHABET).toHaveLength(64);
  expect([...NANOID_URL_ALPHABET].sort().join('')).toBe(
    [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'].sort().join(''),
  );
  expect(NANOID_DEFAULT_SIZE).toBe(21);

  // The README: "returns an ID with 21 characters", for example "V1StGXR8_Z5jdHi6B-myT".
  const readme = readFileSync(fileURLToPath(new URL('./fixtures/nanoid/README.md', import.meta.url)), 'utf8');
  expect(readme).toContain('nanoid(); //=> "V1StGXR8_Z5jdHi6B-myT"');
  expect(readme).toContain('returns an ID\nwith 21 characters');
  expect('V1StGXR8_Z5jdHi6B-myT').toHaveLength(21);
  for (const ch of 'V1StGXR8_Z5jdHi6B-myT') expect(NANOID_URL_ALPHABET.includes(ch)).toBe(true);

  const ids = generateNanoIds({ count: 200 });
  expect(ids).toHaveLength(200);
  for (const id of ids) {
    expect(id).toHaveLength(21);
    for (const ch of id) expect(NANOID_URL_ALPHABET.includes(ch), id).toBe(true);
  }
  expect(new Set(ids).size).toBe(200);
  expect(generateNanoIds({ count: 3, size: 255, alphabet: 'ab' }).every((id) => /^[ab]{255}$/.test(id))).toBe(true);
  expect(generateNanoIds({ count: 1, size: 1, alphabet: 'xy' })[0]).toMatch(/^[xy]$/);

  // A fixed byte stream: for the three symbols a, b and c a byte of 255 would favour the first symbol (256 is not a
  // multiple of 3), so it is redrawn. The stream 255, 3, 4, 5 repeats: 255 is skipped, then 3, 4, 5 give a, b, c.
  const cycle = [255, 3, 4, 5];
  let at = 0;
  const source = (n: number): Uint8Array => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = cycle[at++ % cycle.length]!;
    return out;
  };
  expect(generateNanoIds({ count: 2, size: 4, alphabet: 'abc' }, source)).toEqual(['abca', 'bcab']);

  // For every alphabet size from 2 to 255, one pass over all 256 byte values accepts each symbol the same number of
  // times (floor(256 / size)), which is what no bias means.
  for (let size = 2; size <= 255; size++) {
    let next = 0;
    const counts = new Array<number>(size).fill(0);
    const stream = (): number => {
      if (next >= 256) throw new Error('end of stream');
      return next++;
    };
    try {
      for (;;) counts[pickAlphabetIndex(size, stream)]!++;
    } catch (error) {
      expect((error as Error).message).toBe('end of stream');
    }
    const each = Math.floor(256 / size);
    expect(
      counts.every((c) => c === each),
      `size ${size}`,
    ).toBe(true);
  }
  expect(pickAlphabetIndex(1, () => 200)).toBe(0);
  expect(pickAlphabetIndex(256, () => 200)).toBe(200);

  // Symbols are code points: an alphabet of emoji and letters counts each one once, whole.
  const wide = generateNanoIds({ count: 5, size: 8, alphabet: 'a\u{1F600}b' });
  for (const id of wide) {
    expect(Array.from(id)).toHaveLength(8);
    for (const ch of Array.from(id)) expect(['a', '\u{1F600}', 'b']).toContain(ch);
  }
});

it('round trips of every new format give back the same text', () => {
  const ulids = generateUlids(200, T0 + 100_000);
  for (const id of ulids) {
    const decoded = decodeUlid(id);
    expect(decoded.ms).toBe(T0 + 100_000);
    expect(ulidFromParts(decoded.ms, decoded.randomHex)).toBe(id);
    expect(detectIdentifier(id, SNOWFLAKE_DEFAULT_EPOCH)).toMatchObject({ format: 'ulid', ms: T0 + 100_000 });
  }

  const ksuids = generateKsuids(200, T0 + 200_999);
  for (const id of ksuids) {
    expect(id).toHaveLength(27);
    const decoded = decodeKsuid(id);
    expect(decoded.timestamp).toBe(Math.floor((T0 + 200_999) / 1000) - KSUID_EPOCH_SECONDS);
    expect(decoded.iso).toBe(new Date(Math.floor((T0 + 200_999) / 1000) * 1000).toISOString());
    expect(ksuidFromParts(decoded.timestamp, decoded.payloadHex)).toBe(id);
    expect(encodeKsuid(hexToBytes(decoded.timestamp.toString(16).padStart(8, '0') + decoded.payloadHex))).toBe(id);
    expect(detectIdentifier(id, SNOWFLAKE_DEFAULT_EPOCH)).toMatchObject({ format: 'ksuid' });
  }
  const sortedKsuids = [1, 2, 3, 4000, 90_000].map((s) => generateKsuids(1, T0 + s * 1000)[0]!);
  expect([...sortedKsuids].sort()).toEqual(sortedKsuids);

  const objectIds = generateObjectIds(200, T0 + 300_999);
  for (const id of objectIds) {
    expect(id).toMatch(/^[0-9a-f]{24}$/);
    const decoded = decodeObjectId(id);
    expect(decoded.timestamp).toBe(Math.floor((T0 + 300_999) / 1000));
    expect(
      decoded.timestamp.toString(16).padStart(8, '0') +
        decoded.randomHex +
        decoded.counter.toString(16).padStart(6, '0'),
    ).toBe(id);
    expect(detectIdentifier(id, SNOWFLAKE_DEFAULT_EPOCH)).toMatchObject({ format: 'objectid' });
  }
  for (let i = 1; i < objectIds.length; i++) {
    // The counter counts up by one (wrapping at 2^24) and the five random bytes stay the same for the whole page load.
    expect(
      (decodeObjectId(objectIds[i]!).counter - decodeObjectId(objectIds[i - 1]!).counter + 2 ** 24) % 2 ** 24,
    ).toBe(1);
    expect(decodeObjectId(objectIds[i]!).randomHex).toBe(decodeObjectId(objectIds[0]!).randomHex);
  }

  for (const epoch of [0, SNOWFLAKE_DEFAULT_EPOCH, 1_420_070_400_000]) {
    const snowflakes = generateSnowflakes(
      { count: 50, epoch, datacenter: 4, worker: 5 },
      T0 + 400_000 + (epoch % 1000),
    );
    for (const id of snowflakes) {
      const decoded = decodeSnowflake(id, epoch);
      expect(decoded).toMatchObject({ datacenter: 4, worker: 5 });
      expect(encodeSnowflake(decoded, epoch)).toBe(id);
      expect(detectIdentifier(id, epoch)).toMatchObject({ format: 'snowflake', datacenter: 4, worker: 5 });
    }
  }

  const nanoIds = generateNanoIds({ count: 20, size: 12, alphabet: '0123456789abcdef' });
  for (const id of nanoIds) expect(id).toMatch(/^[0-9a-f]{12}$/);
});

it('the cryptographic source is the only source of randomness for every new format', () => {
  const math = vi.spyOn(Math, 'random').mockImplementation(() => {
    throw new Error('Math.random must never be used');
  });
  const crypto = vi.spyOn(globalThis.crypto, 'getRandomValues');
  const before = () => crypto.mock.calls.length;

  let seen = before();
  generateUlids(3, T0 + 500_000);
  expect(before()).toBeGreaterThan(seen);
  seen = before();
  generateKsuids(3, T0 + 500_000);
  expect(before()).toBeGreaterThan(seen);
  seen = before();
  generateNanoIds({ count: 3 });
  expect(before()).toBeGreaterThan(seen);
  seen = before();
  generateObjectIds(3, T0 + 500_000); // the page-load draw may have happened in an earlier call; the counter still counts
  generateSnowflakes({ count: 3, epoch: 0, datacenter: 0, worker: 0 }, T0 + 500_000); // deterministic: no random part
  expect(math).not.toHaveBeenCalled();
  expect(before()).toBeGreaterThanOrEqual(seen);

  // Every draw asks for whole bytes and for no more than the platform allows in one call.
  for (const call of crypto.mock.calls) {
    const array = call[0] as Uint8Array;
    expect(array).toBeInstanceOf(Uint8Array);
    expect(array.length).toBeGreaterThan(0);
    expect(array.length).toBeLessThanOrEqual(65536);
  }

  // The source file text agrees: no Math.random anywhere in the new files.
  for (const name of ['ulid', 'ksuid', 'objectid', 'snowflake', 'nanoid', 'detect', 'id-errors']) {
    const text = readFileSync(fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url)), 'utf8');
    expect(text.includes('Math.random'), name).toBe(false);
  }
});

it('counts, sizes, alphabets, epochs and machine numbers outside their ranges are refused with fixed messages', () => {
  const COUNT = 'The count must be a whole number from 1 to 10,000.';
  // -98765123456 is the shape of the number the privacy sweep types into every number field.
  for (const count of [0, -1, -98765123456, 10001, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(messageOf(() => generateUlids(count, T0))).toBe(COUNT);
    expect(messageOf(() => generateKsuids(count, T0))).toBe(COUNT);
    expect(messageOf(() => generateObjectIds(count, T0))).toBe(COUNT);
    expect(messageOf(() => generateNanoIds({ count }))).toBe(COUNT);
    expect(messageOf(() => generateSnowflakes({ count, epoch: 0, datacenter: 0, worker: 0 }, T0))).toBe(COUNT);
  }
  expect(generateUlids(10000, T0 + 600_000)).toHaveLength(10000);
  expect(generateKsuids(10000, T0)).toHaveLength(10000);

  const SIZE = 'Size must be a whole number from 1 to 255.';
  for (const size of [0, -1, -98765123456, 256, 2.5, Number.NaN]) {
    expect(messageOf(() => generateNanoIds({ count: 1, size }))).toBe(SIZE);
  }
  const hundred = 'Alphabet must hold 2 to 255 different characters.';
  expect(messageOf(() => generateNanoIds({ count: 1, alphabet: '' }))).toBe(hundred);
  expect(messageOf(() => generateNanoIds({ count: 1, alphabet: 'a' }))).toBe(hundred);
  const many = Array.from({ length: 256 }, (_, i) => String.fromCodePoint(0x100 + i)).join('');
  expect(messageOf(() => generateNanoIds({ count: 1, alphabet: many }))).toBe(hundred);
  expect(generateNanoIds({ count: 1, size: 5, alphabet: many.slice(0, 255) })[0]).toHaveLength(5);
  expect(messageOf(() => generateNanoIds({ count: 1, alphabet: 'abca' }))).toBe(
    'Alphabet repeats a character: each character may appear only once.',
  );
  expect(messageOf(() => generateNanoIds({ count: 1, alphabet: 'a\u{1F600}\u{1F600}' }))).toBe(
    'Alphabet repeats a character: each character may appear only once.',
  );
  const FORBIDDEN = 'Alphabet holds a control or direction character, which is not allowed.';
  for (const code of [
    0x00, 0x07, 0x0a, 0x1b, 0x7f, 0x85, 0x200e, 0x200f, 0x202a, 0x202e, 0x2066, 0x2069, 0x061c, 0x2028, 0xd800,
  ]) {
    expect(messageOf(() => generateNanoIds({ count: 1, alphabet: 'ab' + String.fromCharCode(code) }))).toBe(FORBIDDEN);
  }

  const DATACENTER = 'Datacenter must be a whole number from 0 to 31.';
  const WORKER = 'Worker must be a whole number from 0 to 31.';
  for (const bad of [-1, -98765123456, 32, 1.5, Number.NaN]) {
    expect(messageOf(() => generateSnowflakes({ count: 1, epoch: 0, datacenter: bad, worker: 0 }, T0))).toBe(
      DATACENTER,
    );
    expect(messageOf(() => generateSnowflakes({ count: 1, epoch: 0, datacenter: 0, worker: bad }, T0))).toBe(WORKER);
  }
  expect(generateSnowflakes({ count: 1, epoch: 0, datacenter: 31, worker: 31 }, T0 + 700_000)).toHaveLength(1);

  // Times outside what a format can hold are refused too.
  expect(messageOf(() => generateUlids(1, -1))).toBe(
    'The time is outside what a ULID can hold (0 to 2^48 - 1 milliseconds).',
  );
  expect(messageOf(() => generateUlids(1, 281474976710656))).toBe(
    'The time is outside what a ULID can hold (0 to 2^48 - 1 milliseconds).',
  );
  expect(messageOf(() => generateUlids(1, 1.5))).toBe(
    'The time is outside what a ULID can hold (0 to 2^48 - 1 milliseconds).',
  );
  expect(messageOf(() => generateKsuids(1, 1_399_999_999_000))).toBe(
    'The time is outside what a KSUID can hold (2014-05-13T16:53:20Z plus up to 2^32 - 1 seconds).',
  );
  expect(messageOf(() => generateKsuids(1, (KSUID_EPOCH_SECONDS + 4294967296) * 1000))).toBe(
    'The time is outside what a KSUID can hold (2014-05-13T16:53:20Z plus up to 2^32 - 1 seconds).',
  );
});

it('the epoch is milliseconds or an ISO 8601 date with an offset and is refused otherwise', () => {
  const now = 1_800_000_000_000;
  expect(parseEpoch('1288834974657', now)).toBe(1288834974657);
  expect(parseEpoch('0', now)).toBe(0);
  expect(parseEpoch('  42  ', now)).toBe(42);
  expect(parseEpoch('2010-11-04T01:42:54.657Z', now)).toBe(1288834974657);
  expect(parseEpoch('2010-11-04T03:42:54.657+02:00', now)).toBe(1288834974657);
  expect(parseEpoch('2010-11-03T20:42:54.657-05:00', now)).toBe(1288834974657);
  expect(parseEpoch('2010-11-04T01:42:54Z', now)).toBe(1288834974000);
  expect(parseEpoch('2010-11-04T01:42Z', now)).toBe(1288834920000);
  expect(parseEpoch('2010-11-04T01:42:54.5Z', now)).toBe(1288834974500);
  // A date alone is midnight UTC (Python 3.14: datetime(2010, 11, 4, tzinfo=utc).timestamp() * 1000).
  expect(parseEpoch('2010-11-04', now)).toBe(1288828800000);
  expect(parseEpoch('1970-01-01T00:00:00Z', now)).toBe(0);
  expect(parseEpoch('2000-02-29', now)).toBe(951782400000);
  expect(parseEpoch('1800000000000', now)).toBe(now);

  const FORMAT =
    'Epoch must be a whole number of milliseconds since 1970-01-01, or an ISO 8601 date such as 2010-11-04 or 2010-11-04T01:42:54.657Z (a time needs an offset such as Z or +02:00).';
  for (const bad of [
    '',
    '   ',
    'now',
    '-1',
    '1.5',
    '1e12',
    '0x10',
    '12345678901234567',
    '2010-11-04T01:42:54', // a time without an offset depends on the machine
    '2010-11-04 01:42:54Z',
    '2010-11-04T01:42:54.6571Z',
    '2010-02-30',
    '2010-13-01',
    '2010-11-31',
    '2001-02-29',
    '2010-11-04T24:00:00Z',
    '2010-11-04T01:60:00Z',
    '2010-11-04T01:42:60Z',
    '2010-11-04T01:42:54+24:00',
    '2010-11-04T01:42:54+02',
    '10-11-04',
    '2010-1-4',
  ]) {
    expect(
      messageOf(() => parseEpoch(bad, now)),
      JSON.stringify(bad),
    ).toBe(FORMAT);
  }
  expect(messageOf(() => parseEpoch('1800000000001', now))).toBe('Epoch cannot be in the future.');
  expect(messageOf(() => parseEpoch('2099-01-01', now))).toBe('Epoch cannot be in the future.');
  expect(messageOf(() => parseEpoch('1969-12-31T23:59:59Z', now))).toBe('Epoch cannot be before 1970-01-01.');
});

it('nothing is written to the console while generating or decoding identifiers', () => {
  generateUlids(5, T0 + 800_000);
  generateKsuids(5, T0);
  generateObjectIds(5, T0);
  generateNanoIds({ count: 5 });
  generateSnowflakes({ count: 5, epoch: 0, datacenter: 0, worker: 2 }, T0 + 800_000);
  for (const text of [
    '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    '0uk1Hbc9dQ9pxyTqJ93IUrfhdGq',
    '507f1f77bcf86cd799439011',
    '1888944671579078978',
    'nonsense',
  ]) {
    detectIdentifier(text, SNOWFLAKE_DEFAULT_EPOCH);
  }
  for (const attempt of [
    () => decodeUlid('x'),
    () => decodeKsuid('x'),
    () => decodeObjectId('x'),
    () => decodeSnowflake('x', 0),
    () => generateNanoIds({ count: 1, alphabet: 'a' }),
    () => parseEpoch('x'),
  ]) {
    expect(attempt).toThrow(IdentifierError);
  }
  // The afterEach hook asserts the spies on console.log, info, warn, error and debug saw no call.
});

it('messages never repeat pasted text and pasted text is judged by length before any big integer work', () => {
  const marker = 'FODT-MARKER-5521';
  const attempts: (() => unknown)[] = [
    () => decodeUlid(marker),
    () => decodeUlid(marker.toUpperCase().replace(/[^0-9A-Z]/g, '9') + marker),
    () => decodeUlid('8' + marker.replace(/[^0-9A-Z]/gi, '0').padEnd(25, '0')),
    () => decodeKsuid(marker),
    () => decodeKsuid(marker + marker),
    () => decodeObjectId(marker),
    () => decodeObjectId('zzzz' + marker + 'zzzz'),
    () => decodeSnowflake(marker, 0),
    () => decodeSnowflake('9'.repeat(19) + marker, 0),
    () => parseEpoch(marker),
    () => parseEpoch('2010-11-04T01:42:54.657' + marker),
    () => generateNanoIds({ count: 1, alphabet: marker }),
    () => generateNanoIds({ count: 1, alphabet: marker.toLowerCase() + String.fromCharCode(7) }),
  ];
  for (const attempt of attempts) {
    const message = messageOf(attempt);
    expect(message.toLowerCase().includes('fodt'), message).toBe(false);
    expect(message.includes('5521'), message).toBe(false);
    expect(message.length).toBeLessThan(200);
  }

  // A very long paste is refused by its length alone; the time covers only the decoders.
  const huge = 'Z'.repeat(5_000_000);
  const started = performance.now();
  const messages = [
    messageOf(() => decodeUlid(huge)),
    messageOf(() => decodeKsuid(huge)),
    messageOf(() => decodeObjectId(huge)),
    messageOf(() => decodeSnowflake('9'.repeat(5_000_000), 0)),
    messageOf(() => parseEpoch('9'.repeat(5_000_000))),
  ];
  const detected = detectIdentifier(huge, 0);
  const elapsed = performance.now() - started;
  expect(elapsed).toBeLessThan(2000);
  expect(detected).toBeNull();
  expect(messages.every((m) => m.length > 0 && m.length < 200)).toBe(true);
}, 60_000);

it('the vendored upstream files are the recorded blobs and hold the published values the tests use', () => {
  const recorded: Record<string, { size: number; blob: string; sha256: string }> = {
    'ksuid/README.md': {
      size: 10422,
      blob: '0f21345219d86d1e1f8435d0f86dd55bc22e21d5',
      sha256: '9a8d6bd72ff5d7b611b3e9469c28747485ea051c49bc37b0a09794b9b4e30103',
    },
    'ksuid/ksuid.go': {
      size: 8975,
      blob: '79bbe5629c1d3dba2e2c8dd53d54539e6ad7e1f9',
      sha256: 'ccdd2f4f6f0e07f8f764cfd7ecda49132c0c2faab165771f3f0d4cdbfb48247d',
    },
    'ksuid/LICENSE.txt': {
      size: 1067,
      blob: 'aefb79318943a645a0aaa8909c97b616b7727ae8',
      sha256: '4b49998660abb6ea23d6e9d6353e56480e31710aa1e4bb3ea2664b3d58211d5b',
    },
    'nanoid/README.md': {
      size: 13655,
      blob: '9a91f0705ba49e8e299977ea267eb33aa3051d17',
      sha256: '7ed8e93357f1084880d0804b6e30ea398e00ddc116824c9953a42a8ffcef2636',
    },
    'nanoid/url-alphabet.js': {
      size: 604,
      blob: '423532e103a006a10ce41fcfc62ff2804aa88ab0',
      sha256: '679b6b3d0d01525d2e490362d0d071acf65b4e34213eb15566082d2b5af55d66',
    },
    'nanoid/LICENSE.txt': {
      size: 1095,
      blob: 'b2e78ae87460b8ffaa39286084e2dddc9261ca21',
      sha256: '4383cb2c3608397ce7a4159502614ed66890f8999c2a9c056dd3b1024d6721f0',
    },
  };
  for (const [name, want] of Object.entries(recorded)) {
    const bytes = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
    expect(bytes.length, name).toBe(want.size);
    const blob = createHash('sha1')
      .update(Buffer.from(`blob ${bytes.length}`))
      .update(Buffer.from([0]))
      .update(bytes)
      .digest('hex');
    expect(blob, name).toBe(want.blob);
    expect(createHash('sha256').update(bytes).digest('hex'), name).toBe(want.sha256);
  }

  // The published values quoted in the tests above are in the vendored text.
  const readme = readFileSync(fileURLToPath(new URL('./fixtures/ksuid/README.md', import.meta.url)), 'utf8');
  for (const value of [
    '0uk1Hbc9dQ9pxyTqJ93IUrfhdGq',
    '9850EEEC191BF4FF26F99315CE43B0C8',
    '0uk1HdCJ6hUZKDgcxhpJwUl5ZEI',
    'CC55072555316F45B8CA2D2979D3ED0A',
    '0uk1HcdvF0p8C20KtTfdRSB9XIm',
    'BA1C205D6177F0992D15EE606AE32238',
    '0uk1Ha7hGJ1Q9Xbnkt0yZgNwg3g',
    '67517BA309EA62AE7991B27BB6F2FCAC',
    '0ujtsYcgvSTl8PAuAdqWYSMnLOv',
    '0669F7EFB5A1CD34B5F99D1154FB6853345C9735',
    'B5A1CD34B5F99D1154FB6853345C9735',
    '107608047',
    '0ujzPyRiIAffKhBux4PvQdDqMHY',
    '066A029C73FC1AA3B2446246D6E89FCD909E8FE8',
    '73FC1AA3B2446246D6E89FCD909E8FE8',
    '107610780',
    '107611700',
  ]) {
    expect(readme.includes(value), value).toBe(true);
  }
  const source = readFileSync(fileURLToPath(new URL('./fixtures/ksuid/ksuid.go', import.meta.url)), 'utf8');
  expect(source).toContain('epochStamp int64 = 1400000000');
  expect(source).toContain('stringEncodedLength = 27');
  expect(source).toContain('maxStringEncoded = "aWgEPTl1tmebfsQzFP4bxwgy80V"');
  expect(source).toContain('minStringEncoded = "000000000000000000000000000"');
});
