import { expect, it } from 'vitest';
import { EXTRA_OID_NAMES, describeBytes, lookupOidName } from '../src/index';
import { OID_NAMES } from '../src/oids';
import { der, mulberry32, readFixture, toHex } from './helpers';

/*
 * How each value type is decoded. The expectations come from ITU-T X.690 (02/2021) clause 8 (INTEGER 8.3, REAL 8.5,
 * OBJECT IDENTIFIER 8.19, strings 8.23, times 8.25 and 8.26), written independently of the package: integers through
 * BigInt.asIntN, object identifiers through an encoder written here, REAL from the values pyasn1 0.6.4 recorded and the
 * values clause 8.5 gives by hand (fixtures/real), names from OpenSSL's own (fixtures/openssl/oid-names.json).
 */

/** The first node of a structure read from bytes. */
function first(bytes: number[]) {
  return describeBytes(new Uint8Array(bytes), { tryInside: false }).nodes[0]!;
}

function hexBytes(hex: string): number[] {
  return Array.from({ length: hex.length / 2 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

/** The base 128 subidentifier octets of a number, most significant first (clause 8.19.2). */
function base128(value: bigint): number[] {
  const octets = [Number(value & 0x7fn)];
  for (let rest = value >> 7n; rest > 0n; rest >>= 7n) octets.unshift(Number(rest & 0x7fn) | 0x80);
  return octets;
}

/** The content octets of an object identifier (clause 8.19.4: the first subidentifier is 40 x first + second). */
function oidContent(arcs: bigint[]): number[] {
  return [...base128(arcs[0]! * 40n + arcs[1]!), ...arcs.slice(2).flatMap(base128)];
}

interface RealRecording {
  recordedAt: string;
  python: string;
  pyasn1: string;
  encoded: { value: number | string; hex: string; pyasn1: number | string | null }[];
  decoded: {
    label: string;
    clause: string;
    hex: string;
    derived: number | string;
    pyasn1: number | string | null;
    pyasn1Differs?: boolean;
  }[];
}
const REAL = JSON.parse(readFixture('real', 'recorded.json')) as RealRecording;

/** A recorded number: the words stand for the values JSON cannot hold. */
function recorded(value: number | string): number {
  if (value === 'inf') return Infinity;
  if (value === '-inf') return -Infinity;
  if (value === 'nan') return NaN;
  return value as number;
}

function same(actual: number | undefined, expected: number): boolean {
  if (actual === undefined) return false;
  return Number.isNaN(expected) ? Number.isNaN(actual) : Object.is(actual, expected);
}

it('INTEGER, OBJECT IDENTIFIER, REAL, string and time values decode as X.690 and the recorded second opinions say', () => {
  // INTEGER (clause 8.3.3): a two's complement number. Fixed cases first.
  const fixed: [string, bigint][] = [
    ['00', 0n],
    ['7f', 127n],
    ['0080', 128n],
    ['ff', -1n],
    ['80', -128n],
    ['ff7f', -129n],
    ['0100', 256n],
    ['8000', -32768n],
  ];
  for (const [hex, value] of fixed) {
    const node = first(der(0x02, hexBytes(hex)));
    expect(node.value?.integer, hex).toBe(value);
    expect(node.value?.text, hex).toBe(`${value} (0x${hex})`);
  }
  // Seeded lengths 1 to 64 bytes: exact through BigInt, with the hex always and the decimal up to 64 bytes.
  const random = mulberry32(8301);
  for (let i = 0; i < 300; i++) {
    const length = 1 + Math.floor(random() * 64);
    const content = Array.from({ length }, () => Math.floor(random() * 256));
    const unsigned = BigInt('0x' + toHex(new Uint8Array(content)));
    const expected = BigInt.asIntN(length * 8, unsigned);
    const node = first(der(0x02, content));
    expect(node.value?.integer).toBe(expected);
    expect(node.value?.text).toBe(`${expected} (0x${toHex(new Uint8Array(content))})`);
  }
  // Above 64 bytes only the size and the start of the hex are shown; an ENUMERATED reads like an INTEGER.
  const long = first(der(0x02, [0x01, ...Array.from({ length: 64 }, () => 0xab)]));
  expect(long.value?.text).toMatch(/^a number of 65 bytes, 0x01abab/);
  expect(long.value?.integer).toBeUndefined();
  expect(first(der(0x0a, [0x05])).value?.integer).toBe(5n);
  const empty = describeBytes(new Uint8Array([0x02, 0x00]));
  expect(empty.findings.some((finding) => finding.message.includes('no content octets'))).toBe(true);

  // OBJECT IDENTIFIER (clause 8.19): the first two arcs share the first subidentifier. The standard's own example first.
  expect(first([0x06, 0x03, 0x88, 0x37, 0x03]).value?.oid).toBe('2.999.3');
  expect(first([0x0d, 0x04, 0xc2, 0x7b, 0x03, 0x02]).value?.oid).toBe('8571.3.2');
  const arcsOf = (): bigint[] => {
    const head = BigInt(Math.floor(random() * 3));
    const second = head === 2n ? BigInt(Math.floor(random() * 100000)) : BigInt(Math.floor(random() * 40));
    const arcs = [head, second];
    const count = Math.floor(random() * 12);
    for (let i = 0; i < count; i++)
      arcs.push(BigInt(Math.floor(random() * 2 ** 31)) * (random() < 0.2 ? 2n ** 40n : 1n));
    return arcs;
  };
  for (let i = 0; i < 300; i++) {
    const arcs = arcsOf();
    const node = first(der(0x06, oidContent(arcs)));
    expect(node.value?.oid).toBe(arcs.join('.'));
    expect(node.value?.problems).toEqual([]);
  }
  // An arc above 2 to the 64 stays exact.
  expect(first(der(0x06, oidContent([2n, 5n, 2n ** 70n]))).value?.oid).toBe(`2.5.${2n ** 70n}`);
  // Padding, an arc cut off, nothing and too long are said in words.
  expect(first([0x06, 0x03, 0x2a, 0x80, 0x01]).value?.problems.join(' ')).toContain('padding octet');
  expect(first([0x06, 0x02, 0x2a, 0x86]).value?.problems.join(' ')).toContain('ends in the middle of an arc');
  expect(first([0x06, 0x00]).value?.text).toBe('no content octets');
  expect(
    first(
      der(
        0x06,
        Array.from({ length: 513 }, () => 0x2a),
      ),
    ).value?.text,
  ).toContain('not decoded');
  expect(first([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]).value?.text).toBe(
    '1.2.840.113549.1.1.11 (sha256WithRSAEncryption)',
  );

  // REAL (clause 8.5). What pyasn1 wrote, read back as the number it was given.
  expect(REAL.pyasn1).toBe('0.6.4');
  for (const row of REAL.encoded) {
    const node = first(hexBytes(row.hex));
    expect(same(node.value?.number, recorded(row.value)), `${row.hex} is ${row.value}`).toBe(true);
  }
  // Hand-made encodings: the value clause 8.5 gives; pyasn1 agrees except where it is listed as different.
  for (const row of REAL.decoded) {
    const node = first(hexBytes(row.hex));
    expect(same(node.value?.number, recorded(row.derived)), `${row.label} (${row.clause})`).toBe(true);
    if (row.pyasn1Differs !== true) expect(same(node.value?.number, recorded(row.pyasn1!)), row.label).toBe(true);
  }
  expect(REAL.decoded.filter((row) => row.pyasn1Differs === true).map((row) => row.label)).toEqual([
    'NOT-A-NUMBER',
    'minus zero',
    'decimal NR3 with a comma',
  ]);
  // A reserved first octet is a problem, not a value.
  expect(describeBytes(new Uint8Array([0x09, 0x02, 0x7f, 0x01])).findings.length).toBeGreaterThan(0);

  // Character strings (clause 8.23). Non-ASCII text is built from code points at run time.
  const accented =
    'h' +
    String.fromCodePoint(0xe9) +
    'llo ' +
    String.fromCodePoint(0x4e16, 0x754c) +
    ' ' +
    String.fromCodePoint(0x1f600);
  const utf8 = Array.from(new TextEncoder().encode(accented));
  expect(first(der(0x0c, utf8)).value?.string).toBe(accented);
  const badUtf8 = describeBytes(new Uint8Array([0x0c, 0x02, 0xff, 0xfe]));
  expect(badUtf8.nodes[0]!.value?.string).toContain(String.fromCodePoint(0xfffd));
  expect(badUtf8.findings.some((finding) => finding.message.includes('not valid'))).toBe(true);
  const ascii = (text: string): number[] => Array.from(text, (ch) => ch.charCodeAt(0));
  for (const tag of [0x13, 0x16, 0x12, 0x1a])
    expect(first(der(tag, ascii('Test Root 01'))).value?.string).toBe('Test Root 01');
  expect(first(der(0x13, [0x41, 0xe9])).value?.string).toBe('A' + String.fromCodePoint(0xfffd));
  // TeletexString is read as Latin-1.
  expect(first(der(0x14, [0x41, 0xe9])).value?.string).toBe('A' + String.fromCodePoint(0xe9));
  // BMPString: UTF-16 big endian, with a surrogate pair; a lone surrogate and an odd length are replaced and noted.
  const bmp = [0x4e, 0x16, 0xd8, 0x3d, 0xde, 0x00];
  expect(first(der(0x1e, bmp)).value?.string).toBe(String.fromCodePoint(0x4e16, 0x1f600));
  expect(describeBytes(new Uint8Array(der(0x1e, [0xd8, 0x3d, 0x00, 0x41]))).findings.length).toBeGreaterThan(0);
  expect(describeBytes(new Uint8Array(der(0x1e, [0x00, 0x41, 0x00]))).findings.length).toBeGreaterThan(0);
  // UniversalString: four octets a character; a value past U+10FFFF is replaced and noted.
  expect(first(der(0x1c, [0, 0, 0x4e, 0x16, 0, 1, 0xf6, 0x00])).value?.string).toBe(
    String.fromCodePoint(0x4e16, 0x1f600),
  );
  expect(describeBytes(new Uint8Array(der(0x1c, [0, 0x11, 0, 0]))).findings.length).toBeGreaterThan(0);
  // Long and hidden: 300 characters are cut at 200 with the count; a direction override is written out, never obeyed.
  const longText = first(der(0x0c, ascii('a'.repeat(300))));
  expect(longText.value?.text).toContain('(300 characters)');
  expect(Array.from(longText.value!.string!)).toHaveLength(201);
  const override = String.fromCodePoint(0x202e);
  const hidden = first(der(0x0c, Array.from(new TextEncoder().encode('a' + override + 'b'))));
  expect(hidden.value?.string).toBe('a\\u{202E}b');

  // Times (clauses 8.25 and 8.26 with X.680): two-digit years of 50 to 99 are 19xx, below 50 are 20xx.
  const time = (tag: number, text: string) => first(der(tag, ascii(text))).value;
  expect(time(0x17, '500101000000Z')?.time).toBe('1950-01-01T00:00:00Z');
  expect(time(0x17, '991231235959Z')?.time).toBe('1999-12-31T23:59:59Z');
  expect(time(0x17, '491231235959Z')?.time).toBe('2049-12-31T23:59:59Z');
  expect(time(0x17, '261003043759Z')?.text).toBe('2026-10-03T04:37:59Z (261003043759Z)');
  expect(time(0x17, '2610030437Z')?.time).toBe('2026-10-03T04:37:00Z');
  expect(time(0x17, '261003043759+0530')?.time).toBe('2026-10-03T04:37:59+05:30');
  expect(time(0x18, '20261003043759Z')?.time).toBe('2026-10-03T04:37:59Z');
  expect(time(0x18, '20261003043759.25Z')?.time).toBe('2026-10-03T04:37:59.25Z');
  expect(time(0x18, '20261003043759-0800')?.time).toBe('2026-10-03T04:37:59-08:00');
  expect(time(0x18, '2026100304Z')?.time).toBe('2026-10-03T04:00:00Z');
  expect(time(0x18, '20240229120000Z')?.time).toBe('2024-02-29T12:00:00Z');
  // Not times: no leap day in 2023, month 13, hour 24 (the standard's own invalid example 19920520240000Z), letters.
  for (const [tag, text] of [
    [0x18, '20230229120000Z'],
    [0x17, '261303043759Z'],
    [0x18, '19920520240000Z'],
    [0x18, 'not a time at all'],
    [0x17, '26100304375Z'],
  ] as const) {
    const value = time(tag, text);
    expect(value?.time, text).toBeUndefined();
    expect(value?.problems.length, text).toBeGreaterThan(0);
  }
});

it('object identifier names come from the copied table and then the extra table, and every extra entry matches its OpenSSL name', () => {
  // The copied table first, then the extra table.
  expect(lookupOidName('1.2.840.113549.1.1.11')).toBe('sha256WithRSAEncryption');
  expect(lookupOidName('1.2.840.113549.1.7.2')).toBe('pkcs7-signedData');
  expect(lookupOidName('1.3.6.1.5.5.7.48.1.2')).toBe('OCSP Nonce');
  expect(lookupOidName('1.2.3.4.5.6.7.8')).toBeUndefined();
  // Only Map reads: words that are properties of every object find nothing.
  for (const word of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    expect(lookupOidName(word), word).toBeUndefined();
  }
  // The two tables do not overlap, so which one answers never matters.
  for (const key of EXTRA_OID_NAMES.keys()) expect(OID_NAMES.has(key), key).toBe(false);

  // Every extra entry is in the OpenSSL recording, under the same name, and OpenSSL turned that name into the same digits.
  const recording = JSON.parse(readFixture('openssl', 'oid-names.json')) as {
    openssl: string;
    recordedAt: string;
    entries: { dotted: string; name: string; resolved: string | null }[];
  };
  expect(recording.openssl).toContain('3.5.5');
  expect(recording.recordedAt).toMatch(/^2026-/);
  expect(recording.entries.length).toBe(EXTRA_OID_NAMES.size);
  for (const entry of recording.entries) {
    expect(EXTRA_OID_NAMES.get(entry.dotted), entry.dotted).toBe(entry.name);
    expect(entry.resolved, `${entry.name} in OpenSSL`).toBe(entry.dotted);
  }
});
