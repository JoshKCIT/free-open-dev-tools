import { test, expect } from 'vitest';
import { processLines } from '../src/index';

// The blank lines of a list (an empty line, or one of spaces and tabs) are not lines that failed to be an address, so
// sorting as IP addresses reports how many of the lines it did not place were blank, and the page can leave them out
// of what it says. `nonAddressLines` keeps counting every line that follows the addresses, blank ones included.
// Addresses and their order follow Python 3.14.3's ipaddress, as in layout.test.ts.

test('sorting as IP addresses reports how many of the lines that follow the addresses were blank', () => {
  const trailing = processLines('10.0.0.2\n10.0.0.1\n', 'sort', { order: 'ip' });
  expect(trailing.output).toBe('10.0.0.1\n10.0.0.2\n');
  expect(trailing.nonAddressLines).toBe(1);
  expect(trailing.blankLines).toBe(1);

  const mixed = processLines('b\n10.0.0.1\n   \n\t\nnot an address\n', 'sort', { order: 'ip' });
  expect(mixed.output).toBe('10.0.0.1\nb\n   \n\t\nnot an address\n');
  expect(mixed.nonAddressLines).toBe(5);
  expect(mixed.blankLines).toBe(3);
});

test('a list with no blank line reports no blank lines, and other orders report neither count', () => {
  const plain = processLines('x\n10.0.0.1', 'sort', { order: 'ip' });
  expect(plain.nonAddressLines).toBe(1);
  expect(plain.blankLines).toBe(0);
  const other = processLines('b\n\na', 'sort', { order: 'codepoint' });
  expect(other.nonAddressLines).toBeUndefined();
  expect(other.blankLines).toBeUndefined();
});
