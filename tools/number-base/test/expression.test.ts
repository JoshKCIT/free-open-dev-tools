import { it, expect, vi } from 'vitest';
import {
  evaluateExpression,
  formatResult,
  applyBinary,
  applyUnary,
  makeType,
  ExpressionError,
  EXPRESSION_WIDTHS,
  MAX_EXPRESSION_CHARACTERS,
  MAX_NESTING,
  MAX_STEPS_SHOWN,
} from '../src/index';
import { scalingRatio, MAX_SCALING_RATIO } from './scaling';

// The expected values in this file come from ISO C draft N1570 (the C11 committee draft), from the recordings in
// test/fixtures/oracle/ and from hand work, never from the code under test. Section 6.5.6 (additive operators) is above
// section 6.5.7 (bitwise shift operators) in the order of the grammar, so an addition is done before a shift: 1 + 2 << 3
// is (1 + 2) << 3. Each result is then wrapped to the width as if it were stored back into a variable of that type.

const at = (source: string, width = 32, signed = false) => evaluateExpression(source, { width, signed });

/** The refusal an expression gives; fails the test when there is none. */
function refusal(source: string, width = 32, signed = false): ExpressionError {
  try {
    at(source, width, signed);
  } catch (err) {
    expect(err).toBeInstanceOf(ExpressionError);
    return err as ExpressionError;
  }
  throw new Error('the expression was read, but a refusal was expected');
}

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

it('AND binds tighter than XOR and XOR tighter than OR, as C orders them', () => {
  // N1570 6.5.10 (AND), 6.5.11 (exclusive OR) and 6.5.12 (inclusive OR): & is above ^ is above |.
  expect(at('1 | 2 & 4', 8).value).toBe(1n); // 1 | (2 & 4); left to right would give (1 | 2) & 4 = 0
  expect(at('1 | 2 ^ 3', 8).value).toBe(1n); // 1 | (2 ^ 3); left to right would give (1 | 2) ^ 3 = 0
  expect(at('6 ^ 3 & 5', 8).value).toBe(7n); // 6 ^ (3 & 5); left to right would give (6 ^ 3) & 5 = 5
  expect(at('1 | 6 ^ 3 & 5', 8).value).toBe(7n); // 1 | (6 ^ (3 & 5))
  // 6.5.7 shifts are above 6.5.10 &: 1 & 3 << 1 is 1 & (3 << 1) = 0; left to right would give (1 & 3) << 1 = 2.
  expect(at('1 & 3 << 1', 8).value).toBe(0n);
  // 6.5.5 multiplicative is above 6.5.6 additive: 2 + 3 * 4 is 14, not 20.
  expect(at('2 + 3 * 4', 8).value).toBe(14n);
  // All binary operators group from the left (6.5.6 paragraph 1 and the grammar): 10 - 4 - 3 is 3, 64 / 4 / 2 is 8.
  expect(at('10 - 4 - 3', 8).value).toBe(3n);
  expect(at('64 / 4 / 2', 8).value).toBe(8n);
  expect(at('1 << 2 << 3', 16).value).toBe(32n);
  // A unary operator binds tighter than every binary one: -2 * 3 is (-2) * 3 and ~1 + 1 is (~1) + 1.
  expect(at('-2 * 3', 8, true).value).toBe(-6n);
  expect(at('~1 + 1', 8, true).value).toBe(-1n);
});

it('division truncates toward zero and the remainder takes the sign of the dividend', () => {
  // N1570 6.5.5 paragraph 6: the quotient has any fractional part discarded, and (a / b) * b + a % b equals a.
  expect(at('-7 / 2', 32, true).value).toBe(-3n);
  expect(at('7 / -2', 32, true).value).toBe(-3n);
  expect(at('-7 / -2', 32, true).value).toBe(3n);
  expect(at('-7 % 3', 32, true).value).toBe(-1n);
  expect(at('7 % -3', 32, true).value).toBe(1n);
  expect(at('-7 % -3', 32, true).value).toBe(-1n);
  expect(at('7 % 3', 32, true).value).toBe(1n);
  expect(at('7 / 2', 8).value).toBe(3n);
  for (const [a, b] of [
    [-7n, 2n],
    [7n, -2n],
    [-9n, -4n],
    [100n, 7n],
    [-100n, 7n],
  ] as [bigint, bigint][]) {
    const q = at(`${a} / ${b}`, 32, true).value;
    const r = at(`${a} % ${b}`, 32, true).value;
    expect(q * b + r).toBe(a);
  }
  // Nothing is floored: the same quotient and remainder at 256 bits.
  expect(at('-7 / 2', 256, true).value).toBe(-3n);
  expect(at('-7 % 3', 256, true).value).toBe(-1n);
});

it('the smallest value divided by minus one and minus the smallest value wrap to the smallest value and are flagged', () => {
  // N1570 6.5.5 paragraph 6: if the quotient is not representable the behaviour of both operations is undefined; the
  // calculator gives the wrapped value and says so.
  for (const width of EXPRESSION_WIDTHS) {
    const min = `-${(1n << BigInt(width - 1)).toString()}`;
    const division = at(`${min} / -1`, width, true);
    expect(division.value).toBe(-(1n << BigInt(width - 1)));
    expect(division.wrapped).toBe(1);
    expect(division.steps.at(-1)?.note).toBe('undefined-in-c');
    expect(division.notes.some((n) => n.kind === 'undefined-in-c')).toBe(true);
    const negation = at(`-(${min})`, width, true);
    expect(negation.value).toBe(-(1n << BigInt(width - 1)));
    expect(negation.wrapped).toBe(1);
    expect(negation.notes.some((n) => n.kind === 'undefined-in-c')).toBe(true);
  }
  // The remainder is 0 and is flagged for the same reason; nothing wrapped.
  const remainder = at('-128 % -1', 8, true);
  expect(remainder.value).toBe(0n);
  expect(remainder.wrapped).toBe(0);
  expect(remainder.notes.some((n) => n.kind === 'undefined-in-c')).toBe(true);
  // Unsigned values cannot hit this case.
  expect(at('128 / 1', 8).notes).toEqual([]);
});

it('a shift by the width or more gives 0, or minus one for a negative value shifted right, and is noted', () => {
  // N1570 6.5.7 paragraph 3 leaves a count at or above the width undefined; the calculator defines it and notes it.
  const left = at('1 << 8', 8);
  expect(left.value).toBe(0n);
  expect(left.notes.some((n) => n.kind === 'shift')).toBe(true);
  const negative = at('-1 >> 9', 8, true);
  expect(negative.value).toBe(-1n);
  expect(negative.notes.some((n) => n.kind === 'shift')).toBe(true);
  expect(at('127 >> 8', 8, true).value).toBe(0n);
  expect(at('~0 >>> 8', 8).value).toBe(0n);
  expect(at('1 << 256', 256).value).toBe(0n);
  // A shift by the width minus one is ordinary: no note.
  const ordinary = at('1 << 7', 8);
  expect(ordinary.value).toBe(128n);
  expect(ordinary.notes).toEqual([]);
  expect(at('1 << 255', 256).value).toBe(1n << 255n);
  expect(at('1 << 255', 256).notes).toEqual([]);
  // At 8 bits signed the same shift reaches the sign bit and is flagged as wrapped (C leaves it undefined).
  const sign = at('1 << 7', 8, true);
  expect(sign.value).toBe(-128n);
  expect(sign.wrapped).toBe(1);
  // applyBinary says the same thing with a note on the step.
  expect(applyBinary('<<', 1n, 8n, makeType(8, false))).toEqual({
    value: 0n,
    wrapped: false,
    note: 'shift-at-or-over-width',
  });
});

it('the unsigned right shift is logical in both signednesses', () => {
  // Not part of C (it is the operator Java calls unsigned right shift); defined here as a shift of the bit pattern.
  expect(at('~0 >>> 1', 8, false).value).toBe(127n);
  expect(at('~0 >>> 1', 8, true).value).toBe(127n);
  expect(at('-128 >>> 1', 8, true).value).toBe(64n);
  expect(at('0x80 >>> 7', 8, false).value).toBe(1n);
  expect(at('-1 >>> 0', 8, true).value).toBe(-1n);
  expect(at('-1 >>> 31', 32, true).value).toBe(1n);
  // The arithmetic shift of the same values fills with the sign.
  expect(at('-128 >> 1', 8, true).value).toBe(-64n);
  expect(at('0x80 >> 1', 8, false).value).toBe(64n);
});

it('hexadecimal, octal and binary literals are bit patterns of the width and decimal literals must lie in the type range', () => {
  // A bit pattern is read in the chosen signedness: 0xFF is -1 at 8 bits signed and 255 at 8 bits unsigned.
  expect(at('0xFF', 8, true).value).toBe(-1n);
  expect(at('0xFF', 8, false).value).toBe(255n);
  expect(at('0b11111111', 8, true).value).toBe(-1n);
  expect(at('0o377', 8, true).value).toBe(-1n);
  expect(at('0XfF', 8, false).value).toBe(255n);
  expect(at('0B101', 8).value).toBe(5n);
  expect(at('0O17', 8).value).toBe(15n);
  expect(at('0x00000000FF', 8).value).toBe(255n);
  // A pattern wider than the width is refused naming its position.
  expect(refusal('1 + 0x100', 8).position).toBe(5);
  expect(refusal('0b100000000', 8).position).toBe(1);
  expect(refusal('0o400', 8).position).toBe(1);
  // A decimal literal must lie in the range of the type.
  expect(at('127', 8, true).value).toBe(127n);
  expect(at('255', 8, false).value).toBe(255n);
  const signedTooBig = refusal('200', 8, true);
  expect(signedTooBig.position).toBe(1);
  expect(signedTooBig.message).toContain('0xC8');
  expect(refusal('256', 8, false).position).toBe(1);
  expect(refusal('1 + 256', 8, false).position).toBe(5);
  // Digit separators, written between digits.
  expect(at('1_000', 16).value).toBe(1000n);
  expect(at("1'000", 16).value).toBe(1000n);
  expect(at('0xFF_FF', 16).value).toBe(65535n);
  expect(refusal('1__0').position).toBe(1);
  expect(refusal('1_').position).toBe(1);
  expect(refusal('0x_F').position).toBe(1);
  // A leading zero decimal is decimal, with a note (C would read 010 as octal).
  const leading = at('010', 8);
  expect(leading.value).toBe(10n);
  expect(leading.notes.some((n) => n.kind === 'leading-zero')).toBe(true);
  expect(at('0', 8).notes).toEqual([]);
  // No suffix, exponent or fraction.
  expect(refusal('10u').position).toBe(1);
  expect(refusal('1e5').position).toBe(1);
  expect(refusal('3.5').position).toBe(2);
  expect(refusal('0xG1').position).toBe(1);
  expect(refusal('0b102').position).toBe(1);
  expect(refusal('0o78').position).toBe(1);
  expect(refusal('0x').position).toBe(1);
});

it('minus 128 is read at 8 bits signed while 128 is refused, and the largest value plus one wraps and is flagged', () => {
  const minus = at('-128', 8, true);
  expect(minus.value).toBe(-128n);
  expect(minus.wrapped).toBe(0);
  const tooBig = refusal('128', 8, true);
  expect(tooBig.position).toBe(1);
  expect(tooBig.message).toContain('0x80');
  const plusOne = at('127 + 1', 8, true);
  expect(plusOne.value).toBe(-128n);
  expect(plusOne.wrapped).toBe(1);
  expect(plusOne.firstWrapAt).toBe(5);
  expect(at('-128 - 1', 8, true).value).toBe(127n);
  expect(at('255 + 1', 8, false).value).toBe(0n);
  expect(at('255 + 1', 8, false).wrapped).toBe(1);
  // Only a minus sign directly in front of the decimal literal reaches the smallest value.
  expect(refusal('-(128)', 8, true).position).toBe(3);
  expect(at('-(-128)', 8, true).value).toBe(-128n);
  // At every width the type's smallest and largest values are read as literals and one step past either is refused.
  for (const width of EXPRESSION_WIDTHS) {
    const w = BigInt(width);
    const half = 1n << (w - 1n);
    expect(at(`${half - 1n}`, width, true).value).toBe(half - 1n);
    expect(at(`-${half}`, width, true).value).toBe(-half);
    expect(refusal(`${half}`, width, true).position).toBe(1);
    expect(refusal(`-${half + 1n}`, width, true).position).toBe(2);
    expect(at(`${(1n << w) - 1n}`, width, false).value).toBe((1n << w) - 1n);
    expect(refusal(`${1n << w}`, width, false).position).toBe(1);
    // The largest value plus one wraps to the smallest (signed) or to 0 (unsigned) and is flagged.
    const up = at(`${half - 1n} + 1`, width, true);
    expect(up.value).toBe(-half);
    expect(up.wrapped).toBe(1);
    const unsignedUp = at(`${(1n << w) - 1n} + 1`, width, false);
    expect(unsignedUp.value).toBe(0n);
    expect(unsignedUp.wrapped).toBe(1);
    // A shift by width minus one is ordinary.
    expect(at(`1 << ${width - 1}`, width, false).notes).toEqual([]);
  }
});

it('every step wraps to the width and the first wrapped step is named', () => {
  const product = at('200 * 2', 8);
  expect(product.value).toBe(144n);
  expect(product.wrapped).toBe(1);
  expect(product.firstWrapAt).toBe(5);
  // The first wrapped step is named by the position of its operator: 250 + 10 wraps (to 4), the second addition does not.
  const chain = at('250 + 10 + 10', 8);
  expect(chain.value).toBe(14n);
  expect(chain.wrapped).toBe(1);
  expect(chain.firstWrapAt).toBe(5);
  expect(chain.notes.filter((n) => n.kind === 'wrapped').map((n) => n.position)).toEqual([5]);
  expect(at('1 + 2', 8).notes).toEqual([]);
  expect(at('0xFFFFFFFFFFFFFFFF + 1', 64).value).toBe(0n);
  expect(at('-2147483648 - 1', 32, true).value).toBe(2147483647n);
  expect(at('-2147483648 - 1', 32, true).wrapped).toBe(1);
  expect(at('0 - 1', 8).value).toBe(255n);
  // Minus of a non-zero unsigned value wraps; minus zero does not.
  expect(at('-1', 8).value).toBe(255n);
  expect(at('-1', 8).wrapped).toBe(1);
  expect(at('-0', 8).wrapped).toBe(0);
  // ~0 at 256 bits unsigned is 2 to the 256 minus 1, 78 digits ending 639935.
  const ones = at('~0', 256);
  expect(ones.value).toBe(2n ** 256n - 1n);
  expect(ones.value.toString()).toBe('115792089237316195423570985008687907853269984665640564039457584007913129639935');
  expect(ones.wrapped).toBe(0);
  // Every step is listed with the left value, the right value and the wrapped result.
  expect(at('250 + 10', 8).steps).toEqual([
    { step: 1, operation: '+', left: 250n, right: 10n, result: 4n, wrapped: true, position: 5 },
  ]);
});

it('the steps list stops at 200 rows and counts the rest', () => {
  const long = '1' + '+1'.repeat(250);
  const result = at(long, 16);
  expect(result.value).toBe(251n);
  expect(result.steps.length).toBe(MAX_STEPS_SHOWN);
  expect(MAX_STEPS_SHOWN).toBe(200);
  expect(result.stepsOmitted).toBe(50);
  expect(result.steps[0]?.step).toBe(1);
  expect(result.steps.at(-1)?.step).toBe(200);
  const short = at('1+1+1', 16);
  expect(short.stepsOmitted).toBe(0);
});

it('a zero divisor, a negative shift count and an operator C lacks are refused naming their position', () => {
  expect(refusal('1 / 0').position).toBe(3);
  expect(refusal('5 % 0').position).toBe(3);
  expect(refusal('1 + 2 / (3 - 3)').position).toBe(7);
  expect(refusal('1 << -1', 32, true).position).toBe(3);
  expect(refusal('1 >> -2', 32, true).position).toBe(3);
  expect(refusal('1 >>> -1', 32, true).position).toBe(3);
  // Operators and forms the calculator does not have.
  expect(refusal('2 ** 3').position).toBe(3);
  expect(refusal('1 && 0').position).toBe(3);
  expect(refusal('1 || 0').position).toBe(3);
  expect(refusal('!1').position).toBe(1);
  expect(refusal('1 < 2').position).toBe(3);
  expect(refusal('1 > 2').position).toBe(3);
  expect(refusal('1 <= 2').position).toBe(3);
  expect(refusal('1 == 1').position).toBe(3);
  expect(refusal('1 != 1').position).toBe(3);
  expect(refusal('1 ? 2 : 3').position).toBe(3);
  expect(refusal('x = 1').position).toBe(1);
  expect(refusal('1 = 1').position).toBe(3);
  expect(refusal('1 += 1').position).toBe(3);
  expect(refusal('x + 1').position).toBe(1);
  expect(refusal('1 + y').position).toBe(5);
  expect(refusal('foo(1)').position).toBe(1);
  expect(refusal('1, 2').position).toBe(2);
  // Missing and extra pieces.
  expect(refusal('').position).toBe(1);
  expect(refusal('   ').position).toBe(4);
  expect(refusal('1 +').position).toBe(4);
  expect(refusal('(1').position).toBe(1);
  expect(refusal('1)').position).toBe(2);
  expect(refusal('()').position).toBe(2);
  expect(refusal('1 2').position).toBe(3);
  expect(refusal('1 + * 2').position).toBe(5);
  // Words that are keys of every object are variables like any other, never a lookup.
  for (const word of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    expect(refusal(`${word} + 1`).position).toBe(1);
    expect(refusal(`1 + ${word}`).position).toBe(5);
  }
});

it('an expression of 2,000 characters is read and 2,001 is refused, and 64 nested levels are read and 65 refused', () => {
  expect(MAX_EXPRESSION_CHARACTERS).toBe(2000);
  expect(MAX_NESTING).toBe(64);
  const exactly = '1' + '+1'.repeat(999) + ' ';
  expect(exactly.length).toBe(2000);
  expect(at(exactly, 16).value).toBe(1000n);
  const over = exactly + ' ';
  expect(over.length).toBe(2001);
  const refused = refusal(over, 16);
  expect(refused.position).toBe(2001);
  expect(refused.message).toContain('2,000');
  // 64 nested parentheses are read; the 65th is refused naming its position.
  const ok = '('.repeat(64) + '1' + ')'.repeat(64);
  expect(at(ok).value).toBe(1n);
  const deep = '('.repeat(65) + '1' + ')'.repeat(65);
  expect(refusal(deep).position).toBe(65);
  expect(refusal(deep).message).toContain('64 levels');
  // Parentheses that open and close one after another are not nesting.
  expect(at('(1)+'.repeat(100) + '1').value).toBe(101n);
});

it('a shift count of twenty digits is compared with the width before any shift', () => {
  const twenty = '12345678901234567890';
  expect(twenty.length).toBe(20);
  const left = at(`1 << ${twenty}`, 128);
  expect(left.value).toBe(0n);
  expect(left.notes.some((n) => n.kind === 'shift')).toBe(true);
  expect(at(`1 >> ${twenty}`, 128).value).toBe(0n);
  expect(at(`1 >>> ${twenty}`, 128).value).toBe(0n);
  // A signed negative value shifted right by a huge count is minus one.
  expect(at(`-5 >> ${twenty}`, 128, true).value).toBe(-1n);
  // At 256 bits a 76 digit count is still compared first.
  const huge = '9'.repeat(76);
  expect(at(`1 << ${huge}`, 256).value).toBe(0n);
  // The digit run is checked against the width before BigInt reads it: more digits than the width allows is refused.
  expect(refusal(`1 << ${'9'.repeat(40)}`, 64).position).toBe(6);
  expect(refusal('9'.repeat(1990), 256).position).toBe(1);
  const start = performance.now();
  at(`1 << ${huge}`, 256);
  expect(performance.now() - start).toBeLessThan(1000);
});

it('refusals name a position and never repeat the expression', () => {
  const marker = 'ZQXMARKER';
  const lower = marker.toLowerCase();
  const bad = [
    `${marker}`,
    `1 + ${marker}`,
    `(1 + 2) ${marker}`,
    `0x${marker}`,
    `9${marker}`,
    `1 ${marker} 2`,
    `(${marker}`,
    `${marker})`,
    `1 +* ${marker}`,
    `1 / 0 ${marker}`,
    `${marker} = 1`,
    `0b${marker}`,
    `1__${marker}`,
    `${'9'.repeat(30)}${marker}`,
    `1 ${'!'.repeat(5)} ${marker}`,
    ' '.repeat(1990) + marker,
  ];
  for (const text of bad) {
    const error = refusal(text, 8, true);
    expect(error.message).not.toContain(marker);
    expect(error.message.toLowerCase()).not.toContain(lower);
    expect(error.message).toMatch(/\(position [0-9]+\)$/);
    expect(error.position).toBeGreaterThanOrEqual(1);
    expect(error.position).toBeLessThanOrEqual(text.length + 1);
    expect(error.message.length).toBeLessThan(200);
  }
  // A long refused expression is not repeated either.
  const long = refusal('1'.repeat(2500));
  expect(long.message.length).toBeLessThan(200);
  // Notes and steps of a successful read hold numbers and fixed words, never the text typed.
  const fine = at('010 + 250 + 10', 8);
  for (const note of fine.notes) expect(note.message).not.toMatch(/010|250/);
});

it('the evaluator stays linear on hostile input', () => {
  // Hostile shapes sized so the doubled and the quadrupled string both stay under the 2,000 character limit and are read.
  const shapes: Array<[string, (n: number) => string]> = [
    ['tildes', (n) => '~'.repeat(n) + '1'],
    ['open parentheses', (n) => '('.repeat(n)],
    ['pluses', (n) => '1' + '+1'.repeat(Math.floor(n / 2))],
    ['digits', (n) => '9'.repeat(n)],
    ['shifts', (n) => '1' + '<<1'.repeat(Math.floor(n / 3))],
    ['minus signs', (n) => '-'.repeat(n) + '1'],
    ['spaces', (n) => ' '.repeat(n) + '1'],
    ['hexadecimal', (n) => '0x' + 'F'.repeat(n)],
  ];
  const run = (source: string) => evaluateExpression(source, { width: 256, signed: true });
  const median = (values: number[]) => [...values].sort((x, y) => x - y)[1] as number;
  for (const [name, make] of shapes) {
    // The doubling rule (2n against n, over 6 fails) and, because it does not catch quadratic growth by itself, an input
    // four times as long against a limit of 12: the doubling from n to 2n times the doubling from 2n to 4n. Each is the
    // median of three measurements, so one slow moment on a busy machine decides nothing.
    const doublings: number[] = [];
    const fourfold: number[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const first = scalingRatio(run, make, 450);
      const second = scalingRatio(run, make, 900);
      doublings.push(first);
      fourfold.push(first * second);
    }
    expect(Number.isFinite(median(doublings)), name).toBe(true);
    expect(median(doublings), name).toBeLessThanOrEqual(MAX_SCALING_RATIO);
    expect(median(fourfold), name).toBeLessThanOrEqual(12);
  }
  // A refusal at the length limit costs nothing like reading it.
  const refusedAtOnce = scalingRatio(run, (n) => '~'.repeat(n), 4000);
  expect(refusedAtOnce).toBeLessThanOrEqual(MAX_SCALING_RATIO);
});

it('evaluating the same expression twice gives the same result and steps', () => {
  const first = at('(0xFF & ~0x0F) >> 2 | 3 * 5', 16, true);
  const second = at('(0xFF & ~0x0F) >> 2 | 3 * 5', 16, true);
  expect(second).toEqual(first);
  // The result is a fresh value each time: changing one does not change the next call.
  first.steps.length = 0;
  first.notes.push({ kind: 'wrapped', message: 'x', position: 1 });
  const third = at('(0xFF & ~0x0F) >> 2 | 3 * 5', 16, true);
  expect(third).toEqual(second);
  // Different options give different, independent answers.
  expect(at('0xFF', 8, true).value).toBe(-1n);
  expect(at('0xFF', 8, false).value).toBe(255n);
  // The functions are pure.
  const type = makeType(8, true);
  expect(applyBinary('+', 127n, 1n, type)).toEqual(applyBinary('+', 127n, 1n, type));
  expect(applyUnary('-', -128n, type)).toEqual({ value: -128n, wrapped: true, note: 'undefined-in-c' });
});

it('the package prints nothing', () => {
  const spies = (['log', 'warn', 'error'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );
  at('1 + 2 << 3', 8);
  for (const bad of ['(1', 'x', '1 / 0']) {
    try {
      at(bad, 8);
    } catch {
      // Refused on purpose.
    }
  }
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  for (const spy of spies) spy.mockRestore();
});
