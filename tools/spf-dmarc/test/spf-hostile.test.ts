import { expect, it } from 'vitest';
import { checkSpf, parseSpf, readTxtRecords } from '../src/index';
import { HOSTILE, MAX_SCALING_RATIO, scalingRatio } from './scaling';

// The six shared hostile strings plus this tool's own: a record of many ip4 terms, many includes, many quotes and many
// parentheses and semicolons for the zone reader. Each parser is timed on an input of size n and of size 2n; a ratio over 6
// means it does more than a bounded number of passes over its input.
const OWN: ReadonlyArray<(n: number) => string> = [
  (n) => 'ip4:1.2.3.4 '.repeat(Math.ceil(n / 12)),
  (n) => 'include:a.example '.repeat(Math.ceil(n / 18)),
  (n) => 'a '.repeat(Math.ceil(n / 2)),
  (n) => '"'.repeat(n),
  (n) => '(;'.repeat(Math.floor(n / 2)),
  (n) => '%{'.repeat(Math.floor(n / 2)),
  (n) => 'a:' + '%{d}'.repeat(Math.floor(n / 4)),
  (n) => 'ip6:' + '1:'.repeat(Math.floor(n / 2)),
  (n) => '\\'.repeat(n),
  (n) => 'a:x' + '/1'.repeat(Math.floor(n / 2)) + 'z',
  (n) => 'mx:x' + '/1'.repeat(Math.floor(n / 2)) + 'z',
];

// Arguments of a and mx full of slashes, where a scan from every slash to the end of the argument is quadratic.
const SLASHES: ReadonlyArray<[string, (n: number) => string]> = [
  ['a:x/1/1/.../1z', (n) => 'a:x' + '/1'.repeat(Math.floor(n / 2)) + 'z'],
  ['mx:x/1/1/.../1z', (n) => 'mx:x' + '/1'.repeat(Math.floor(n / 2)) + 'z'],
  ['a:x/1/1/.../1', (n) => 'a:x' + '/1'.repeat(Math.floor(n / 2))],
  ['mx:x/z/z/.../z/24', (n) => 'mx:x' + '/z'.repeat(Math.floor(n / 2)) + '/24'],
];

// The record sizes stay inside the 16,384 character cap at 2n; the box sizes stay inside 65,536.
const RECORD_N = 4_000;
const BOX_N = 16_000;

it('every SPF parser stays linear on hostile input', () => {
  const makers = [...HOSTILE, ...OWN];
  const parse = (input: string): unknown => checkSpf(parseSpf(input));
  for (const [i, make] of makers.entries()) {
    const asRecord = (n: number): string => 'v=spf1 ' + make(n);
    const ratio = scalingRatio(parse, asRecord, RECORD_N);
    expect(ratio, `parseSpf and checkSpf, string ${i}`).toBeLessThan(MAX_SCALING_RATIO);
  }
  for (const [i, make] of makers.entries()) {
    const ratio = scalingRatio((input) => readTxtRecords(input, 'spf'), make, BOX_N);
    expect(ratio, `readTxtRecords, string ${i}`).toBeLessThan(MAX_SCALING_RATIO);
    const quoted = scalingRatio(
      (input) => readTxtRecords(input, 'spf'),
      (n) => 'TXT "' + make(n) + '"',
      BOX_N,
    );
    expect(quoted, `readTxtRecords inside quotes, string ${i}`).toBeLessThan(MAX_SCALING_RATIO);
  }
  // Many lines that hold no record (comments and blank lines) are skipped one by one.
  const lines = scalingRatio(
    (input) => readTxtRecords(input, 'spf'),
    (n) => '; a comment\n\n'.repeat(Math.ceil(n / 13)),
    BOX_N,
  );
  expect(lines, 'readTxtRecords over many lines').toBeLessThan(MAX_SCALING_RATIO);
});

it('the prefix length of an a or mx argument full of slashes is found in one pass', () => {
  // Quadratic growth is about 4 times per doubling, which the limit of 6 lets through, so these inputs are also timed at a
  // size four times as large: one pass gives about 4, a scan per slash about 16, and the limit is 12 (three times the
  // linear 4, as 6 is three times the linear 2 of a doubling).
  const parse = (input: string): unknown => checkSpf(parseSpf(input));
  const quadrupled =
    (make: (n: number) => string) =>
    (m: number): string =>
      'v=spf1 ' + make(Math.floor((m * m) / RECORD_N));
  for (const [name, make] of SLASHES) {
    let ratio = scalingRatio(parse, quadrupled(make), RECORD_N);
    // The limit is not loosened. A ratio over it is measured twice more and the median of the three is judged.
    if (ratio > 2 * MAX_SCALING_RATIO) {
      const again = [ratio, scalingRatio(parse, quadrupled(make), RECORD_N)];
      again.push(scalingRatio(parse, quadrupled(make), RECORD_N));
      ratio = again.sort((a, b) => a - b)[1] ?? ratio;
    }
    expect(ratio, `${name}, four times as long`).toBeLessThan(2 * MAX_SCALING_RATIO);
  }
  // The split is unchanged: the prefix length starts at the first slash of the trailing run of digits and slashes.
  const term = (text: string) => parseSpf(`v=spf1 ${text}`).terms[0];
  expect(term('a:example.com/24')?.domain).toBe('example.com');
  expect(term('a:example.com/24')?.cidr4).toBe(24);
  expect(term('mx:example.com/24//64')?.cidr6).toBe(64);
  expect(term('a:x/y/24')?.domain).toBe('x/y');
  expect(term('a:%{d}/1.example/24')?.domain).toBe('%{d}/1.example');
  expect(term('a:x/1/1z')?.domain).toBe('x/1/1z');
  expect(term('a:x/1/1z')?.problems.length).toBeGreaterThan(0);
});

it('a record of 5,000 terms is read in one pass and the whole table of terms is kept for the page to cut', () => {
  const text = 'v=spf1 ' + 'ip4:1.2.3.4 '.repeat(1_300) + '-all';
  const record = parseSpf(text);
  expect(record.errors).toEqual([]);
  expect(record.terms.length).toBe(1_301);
  const many = parseSpf('v=spf1 ' + 'a '.repeat(5_000));
  expect(many.terms.length).toBe(5_000);
  expect(checkSpf(many).lookupCount).toBe(5_000);
  expect(checkSpf(many).withinLimit).toBe(false);
});
