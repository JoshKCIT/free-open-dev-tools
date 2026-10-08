import { it, expect } from 'vitest';
import { evaluateExpression, formatResult } from '../src/index';

// The expected values in this file come from ISO C draft N1570 (the C11 committee draft) and from hand work, never from
// the code under test. Section 6.5.6 (additive operators) is above section 6.5.7 (bitwise shift operators) in the order
// of the grammar, so an addition is done before a shift: 1 + 2 << 3 is (1 + 2) << 3. Each result is then wrapped to the
// width as if it were stored back into a variable of that type.

it('C precedence makes one plus two shifted left by three equal 24 at 8 bits unsigned', () => {
  const result = evaluateExpression('1 + 2 << 3', { width: 8, signed: false });
  // N1570 6.5.6 and 6.5.7: (1 + 2) << 3 is 3 << 3 is 24; reading it as 1 + (2 << 3) would give 17.
  expect(result.value).toBe(24n);
  expect(result.value).not.toBe(17n);
  expect(result.bits).toBe(24n);
  expect(result.wrapped).toBe(0);
  expect(result.steps.map((s) => [s.operation, s.result])).toEqual([
    ['+', 3n],
    ['<<', 24n],
  ]);
  // The same expression with its parentheses written out is the same answer; the other grouping is a different one.
  expect(evaluateExpression('(1 + 2) << 3', { width: 8, signed: false }).value).toBe(24n);
  expect(evaluateExpression('1 + (2 << 3)', { width: 8, signed: false }).value).toBe(17n);
});

it('the result is written as hexadecimal of the width, unsigned and signed decimal, octal and binary', () => {
  const at8 = evaluateExpression('1 + 2 << 3', { width: 8, signed: false });
  expect(formatResult(at8, 8, { uppercase: false })).toEqual({
    hex: '0x18',
    unsigned: '24',
    signed: '24',
    octal: '0o30',
    binary: '00011000',
  });
  // At 16 bits the hexadecimal has four digits and the binary sixteen.
  const at16 = evaluateExpression('1 + 2 << 3', { width: 16, signed: false });
  expect(formatResult(at16, 16, { uppercase: false })).toEqual({
    hex: '0x0018',
    unsigned: '24',
    signed: '24',
    octal: '0o30',
    binary: '0000000000011000',
  });
  // A negative signed value is shown as its bit pattern in the unsigned fields: minus one at 8 bits is 0xff, 255, 0o377.
  const minusOne = evaluateExpression('0 - 1', { width: 8, signed: true });
  expect(minusOne.value).toBe(-1n);
  expect(formatResult(minusOne, 8, { uppercase: false })).toEqual({
    hex: '0xff',
    unsigned: '255',
    signed: '-1',
    octal: '0o377',
    binary: '11111111',
  });
  // Upper case changes the hexadecimal digits and keeps the 0x prefix.
  const high = evaluateExpression('0xAB', { width: 8, signed: false });
  expect(formatResult(high, 8, { uppercase: true }).hex).toBe('0xAB');
  expect(formatResult(high, 8, { uppercase: false }).hex).toBe('0xab');
});
