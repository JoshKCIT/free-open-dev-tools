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
