import { test, expect } from 'vitest';
import { wrapLines, parseIp } from '../src/layout';

// A line with tens of thousands of spaces in it is ordinary input for a text tool, and reading it has to take time
// that grows with its length, not with the square of it. The results are the ones GNU coreutils 8.32 `fold -s` and
// Python 3.14.3's ipaddress give for the same shapes at a small size (see layout.test.ts); only the size changes here.

test('wrapping a line that ends in 80,000 spaces, or has 80,000 spaces inside it, takes well under two seconds', () => {
  const spaces = ' '.repeat(80_000);

  let started = Date.now();
  expect(wrapLines(`a b${spaces}`, 2, false)).toBe('a\nb');
  expect(Date.now() - started).toBeLessThan(2_000);

  started = Date.now();
  expect(wrapLines(`aaaa${spaces}bbbb`, 6, false)).toBe(`aaaa\nbbbb`);
  expect(Date.now() - started).toBeLessThan(2_000);

  started = Date.now();
  const kept = wrapLines(`${spaces}x`, 100_000, false);
  expect(kept).toBe(`${spaces}x`);
  expect(Date.now() - started).toBeLessThan(2_000);
}, 60_000);

test('reading an address from a line with 80,000 spaces around or inside it takes well under two seconds', () => {
  const spaces = ' '.repeat(80_000);

  let started = Date.now();
  expect(parseIp(`1.2.3.4${spaces}`)).toEqual({ version: 4, value: 0x01020304n, prefix: 32 });
  expect(parseIp(`${spaces}1.2.3.4`)?.value).toBe(0x01020304n);
  expect(Date.now() - started).toBeLessThan(2_000);

  started = Date.now();
  expect(parseIp(`x${spaces}x`)).toBeNull();
  expect(parseIp(`\t${spaces}\t`)).toBeNull();
  expect(Date.now() - started).toBeLessThan(2_000);
}, 60_000);

test('cutting a 200,000 character word into pieces of one character takes well under two seconds', () => {
  const started = Date.now();
  const wrapped = wrapLines('x'.repeat(200_000), 1, true).split('\n');
  expect(Date.now() - started).toBeLessThan(2_000);
  expect(wrapped).toHaveLength(200_000);
  expect(wrapped.every((piece) => piece === 'x')).toBe(true);
}, 60_000);

test('wrapping and reading an address give the same results as before for ordinary spacing', () => {
  expect(wrapLines('a   b cccccc', 7, false)).toBe('a   b\ncccccc');
  expect(wrapLines('aaa bbb  ', 5, false)).toBe('aaa\nbbb');
  expect(wrapLines('  ab cd ef', 6, false)).toBe('  ab\ncd ef');
  expect(wrapLines('😀😀😀 x', 3, false)).toBe('😀😀😀\nx');
  expect(parseIp(' \t10.0.0.1/8\t ')).toEqual({ version: 4, value: 0x0a000001n, prefix: 8 });
  expect(parseIp('1.2.3.4 5')).toBeNull();
});
