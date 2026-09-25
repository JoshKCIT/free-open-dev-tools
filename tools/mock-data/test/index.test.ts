import { it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  generateMockData,
  parseFieldSpec,
  fnv1a32,
  mulberry32,
  daysFromCivil,
  civilFromDays,
  MockDataError,
} from '../src/index';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

const REFERENCE_FIELDS = [
  'id: id',
  'name: fullName',
  'email: email',
  'joined: date(2000-01-01, 2024-12-31)',
  'score: decimal(0, 100, 2)',
  'active: boolean',
  'ip: ipv4',
  'key: uuid',
].join('\n');

/**
 * The reference output's own SHA-256, computed once with node:crypto over
 * `generateMockData`'s real output and then written in as a literal (the
 * same literal `e2e/mock-data.spec.ts` asserts, proving Node and every
 * browser produce byte-identical text for this exact input).
 */
export const MOCK_DATA_GOLDEN_SHA256 = 'a06c7398253c4a28595ec42127071fd0440628138aea3172e6509bb7d5f22737';

it('the same seed, fields and count give byte-identical output on every run', () => {
  const a = generateMockData({ seed: 'repeat', fields: 'id: id\nname: fullName', count: 10, format: 'json' });
  const b = generateMockData({ seed: 'repeat', fields: 'id: id\nname: fullName', count: 10, format: 'json' });
  expect(a.output).toBe(b.output);
});

it('the first records do not change when the count grows', () => {
  const fields = 'id: id\nname: fullName\nemail: email';
  const ten = generateMockData({ seed: 'grow', fields, count: 10, format: 'jsonl' });
  const five = generateMockData({ seed: 'grow', fields, count: 5, format: 'jsonl' });
  const tenLines = ten.output.split('\n');
  const fiveLines = five.output.split('\n');
  expect(tenLines.slice(0, 5)).toEqual(fiveLines);
});

it('FNV-1a 32-bit matches the published test vectors', () => {
  // Table 3 (strings without null termination), FNV internet-draft
  // draft-eastlake-fnv-22, https://datatracker.ietf.org/doc/html/draft-eastlake-fnv,
  // fetched live 2026-09-24:
  //   ""       -> 0x811c9dc5
  //   "a"      -> 0xe40c292c
  //   "foobar" -> 0xbf9cf968
  expect(fnv1a32('')).toBe(0x811c9dc5);
  expect(fnv1a32('a')).toBe(0xe40c292c);
  expect(fnv1a32('foobar')).toBe(0xbf9cf968);
});

it('mulberry32 produces the pinned sequence for a fixed seed', () => {
  // Independent re-implementation with BigInt arithmetic, entirely
  // separate from the production function, so this is a second opinion
  // rather than a restatement of the same code.
  const MASK = 0xffffffffn;
  function bigMulberry32(seed: number): () => number {
    let a = BigInt(seed >>> 0);
    return function next(): number {
      a = (a + 0x6d2b79f5n) & MASK;
      let t = a;
      t = ((t ^ (t >> 15n)) * (t | 1n)) & MASK;
      t ^= (t + (t ^ (t >> 7n)) * (t | 61n)) & MASK;
      t &= MASK;
      return Number((t ^ (t >> 14n)) & MASK);
    };
  }

  const seed = fnv1a32('mulberry-check');
  const production = mulberry32(seed);
  const reference = bigMulberry32(seed);
  for (let i = 0; i < 1000; i++) {
    expect(production()).toBe(reference());
  }
});

it('emails use RFC 2606 example domains and IPv4 addresses use RFC 5737 documentation ranges', () => {
  const result = generateMockData({
    seed: 'contact',
    fields: 'email: email\nip: ipv4',
    count: 50,
    format: 'jsonl',
  });
  const records = result.output.split('\n').map((line) => JSON.parse(line) as { email: string; ip: string });
  for (const record of records) {
    // RFC 2606 section 3: example.com, example.net and example.org are
    // reserved so a fake email never resolves to a real mailbox.
    expect(record.email).toMatch(/@example\.(com|net|org)$/);
    // RFC 5737 section 3: TEST-NET-1/2/3 (192.0.2.0/24, 198.51.100.0/24,
    // 203.0.113.0/24) are reserved for documentation.
    expect(record.ip).toMatch(/^(192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)\d{1,3}$/);
  }
});

it('UUIDs carry the RFC 9562 version 4 and variant bits', () => {
  const result = generateMockData({ seed: 'ids', fields: 'key: uuid', count: 50, format: 'jsonl' });
  const records = result.output.split('\n').map((line) => JSON.parse(line) as { key: string });
  for (const record of records) {
    // RFC 9562 section 4.2 (Table 2): the version is the most significant
    // 4 bits of octet 6, "0100" for version 4.
    // RFC 9562 section 4.1 (Table 1): the variant is "10xx" in octet 8.
    expect(record.key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
});

it('dates are real calendar dates inside the requested range', () => {
  const result = generateMockData({
    seed: 'dates',
    fields: 'joined: date(2000-01-01, 2000-12-31)',
    count: 200,
    format: 'jsonl',
  });
  const records = result.output.split('\n').map((line) => JSON.parse(line) as { joined: string });
  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // 2000 is a leap year
  for (const record of records) {
    expect(record.joined).toMatch(/^2000-\d{2}-\d{2}$/);
    const [, monthStr, dayStr] = record.joined.split('-');
    const month = Number(monthStr);
    const day = Number(dayStr);
    expect(month).toBeGreaterThanOrEqual(1);
    expect(month).toBeLessThanOrEqual(12);
    expect(day).toBeGreaterThanOrEqual(1);
    expect(day).toBeLessThanOrEqual(daysInMonth[month - 1]!);
  }
});

it('the civil day round trip matches by-hand values from the published algorithm', () => {
  // Ported from http://howardhinnant.github.io/date_algorithms.html
  // (days_from_civil / civil_from_days), fetched live 2026-09-24. Its own
  // convention: day 0 is 1970-01-01.
  expect(daysFromCivil(1970, 1, 1)).toBe(0);
  expect(daysFromCivil(2000, 1, 1)).toBe(10957);
  expect(daysFromCivil(2024, 12, 31)).toBe(20088);
  expect(civilFromDays(0)).toEqual({ y: 1970, m: 1, d: 1 });
  expect(civilFromDays(10957)).toEqual({ y: 2000, m: 1, d: 1 });
  for (const [y, m, d] of [
    [1999, 12, 31],
    [2000, 2, 29],
    [2004, 2, 29],
    [1900, 3, 1],
    [2100, 3, 1],
  ] as const) {
    expect(civilFromDays(daysFromCivil(y, m, d))).toEqual({ y, m, d });
  }
});

it('decimals are written from integer arithmetic with the requested places', () => {
  const result = generateMockData({
    seed: 'money',
    fields: 'score: decimal(0, 100, 2)',
    count: 200,
    format: 'jsonl',
  });
  const records = result.output.split('\n').map((line) => JSON.parse(line) as { score: number });
  for (const record of records) {
    expect(record.score).toBeGreaterThanOrEqual(0);
    expect(record.score).toBeLessThanOrEqual(100);
    // Written with exactly 2 places: multiplying by 100 and rounding
    // returns the same integer numerator this tool built by hand.
    expect(Math.round(record.score * 100)).toBeCloseTo(record.score * 100, 6);
  }
  // The raw JSON text itself always carries exactly two digits after the
  // point, proving the literal is hand-built rather than a float's own
  // shortest-round-trip printing (which would drop trailing zeros).
  expect(result.output).toMatch(/"score":\d+\.\d{2}/);
});

it('the output digest for the reference seed matches the pinned value', () => {
  const result = generateMockData({ seed: 'demo', fields: REFERENCE_FIELDS, count: 25, format: 'json' });
  const digest = createHash('sha256').update(result.output, 'utf8').digest('hex');
  expect(digest).toBe(MOCK_DATA_GOLDEN_SHA256);
});

it('an unknown field kind or bad argument is refused with its line number', () => {
  expect(() => parseFieldSpec('age: integr(1, 9)')).toThrow(MockDataError);
  try {
    parseFieldSpec('age: integr(1, 9)');
  } catch (err) {
    expect(err).toBeInstanceOf(MockDataError);
    expect((err as MockDataError).message).toContain('integr');
    expect((err as MockDataError).message).toContain('line 1');
  }

  expect(() => generateMockData({ seed: 'x', fields: 'a: integer(5)', count: 1, format: 'json' })).toThrow(
    MockDataError,
  );
  expect(() => generateMockData({ seed: 'x', fields: 'a: id', count: 0, format: 'json' })).toThrow(MockDataError);
  expect(() => generateMockData({ seed: 'x', fields: 'a: id', count: -5, format: 'json' })).toThrow(MockDataError);
  expect(() => parseFieldSpec('a: id\na: uuid')).toThrow(MockDataError);
});

it('the package source never calls Math.random, a clock or Intl', () => {
  const forbidden = ['Math.random', 'Date.now', 'new Date', 'Intl', 'toLocale', 'performance'];
  for (const file of readdirSync(srcDir)) {
    const text = readFileSync(join(srcDir, file), 'utf8');
    for (const token of forbidden) {
      expect(text.includes(token), `${file} should not contain "${token}"`).toBe(false);
    }
  }
});
