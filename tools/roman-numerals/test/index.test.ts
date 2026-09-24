import { describe, it, expect } from 'vitest';
import { toRoman, fromRoman, RomanNumeralError } from '../src/index';

// The five mandated tests live at the top level, exactly as titled, so the
// plan's behavioural verify can find them by exact fullName.

it('all 3999 valid values re-encode to themselves and the count of values exercised is 3999', () => {
  let exercised = 0;
  for (let n = 1; n <= 3999; n++) {
    const numeral = toRoman(n);
    expect(fromRoman(numeral)).toBe(n);
    exercised++;
  }
  expect(exercised).toBe(3999);
});

it('IXI totals ten under the subtractive rule and is rejected in favour of X', () => {
  // I=1, X=10, I=1. Walking left to right: I before X is a permitted
  // subtractive pair (9), then +1 for the trailing I, totals 10. Local
  // rules alone accept this (no four-in-a-row, no repeated pair, no
  // out-of-order symbols outside the one permitted pair) -- only the
  // canonical re-encoding comparison catches that ten's standard spelling
  // is X, not IXI.
  expect(() => fromRoman('IXI')).toThrow(/is not the canonical spelling of 10/);
  expect(() => fromRoman('IXI')).toThrow(/\bX\b/);
  expect(toRoman(10)).toBe('X');
});

it('MCMXCIV is accepted and IL is rejected naming XLIX', () => {
  expect(fromRoman('MCMXCIV')).toBe(1994);
  expect(toRoman(1994)).toBe('MCMXCIV');
  expect(() => fromRoman('IL')).toThrow(/XLIX/);
});

it('zero, a negative number and 4000 are all rejected naming the valid range', () => {
  expect(() => toRoman(0)).toThrow(/1 to 3999/);
  expect(() => toRoman(-5)).toThrow(/1 to 3999/);
  expect(() => toRoman(4000)).toThrow(/1 to 3999/);
});

it('a character that is not a Roman symbol is rejected with its position', () => {
  try {
    fromRoman('MMA');
    throw new Error('expected MMA to be rejected');
  } catch (err) {
    expect(err).toBeInstanceOf(RomanNumeralError);
    expect((err as RomanNumeralError).message).toMatch(/not a Roman numeral symbol/i);
    expect((err as RomanNumeralError).position).toBe(2);
  }
});

describe('roman-numerals', () => {
  describe('rejection of non-standard forms', () => {
    it('a four-identical-symbol form is rejected naming the standard form', () => {
      expect(() => fromRoman('IIII')).toThrow(/more than three/i);
      expect(() => fromRoman('IIII')).toThrow(/IV/);
      // Nine hundred written the additive way is also rejected the same way.
      expect(() => fromRoman('DCCCC')).toThrow(/more than three|canonical/i);
    });

    it('a repeated subtractive pair is rejected', () => {
      // IX IX: 9 then 9 again = 18, canonical spelling XVIII. The repeated
      // pair is caught by the local rule before the re-encoding check ever runs.
      expect(() => fromRoman('IXIX')).toThrow(/subtractive pair/i);
    });

    it('a subtraction standard notation does not permit is rejected', () => {
      // I may only precede V or X, never L. VL is not a standard pair.
      expect(() => fromRoman('VL')).toThrow(/not one of the six standard subtractive pairs/i);
    });

    it('V, L and D each reject a second occurrence', () => {
      expect(() => fromRoman('VV')).toThrow(/does not repeat/i);
      expect(() => fromRoman('LL')).toThrow(/does not repeat/i);
      expect(() => fromRoman('DD')).toThrow(/does not repeat/i);
    });

    it('symbols written out of descending order are rejected with the position of the first symbol that broke the order', () => {
      // L(50) to I(1) is descending (fine); I(1) to C(100) is ascending and
      // not a permitted pair (I only precedes V or X), so the break is at
      // the I, position 1.
      try {
        fromRoman('LIC');
        throw new Error('expected LIC to be rejected');
      } catch (err) {
        expect(err).toBeInstanceOf(RomanNumeralError);
        expect((err as RomanNumeralError).position).toBe(1);
      }
    });
  });

  describe('case and whitespace', () => {
    it('accepts lower-case input and always produces upper-case output', () => {
      expect(fromRoman('mcmxciv')).toBe(1994);
      expect(fromRoman('xl')).toBe(40);
      expect(toRoman(1994)).toBe('MCMXCIV');
    });

    it('ignores leading and trailing whitespace', () => {
      expect(fromRoman('  MCMXCIV  ')).toBe(1994);
      expect(fromRoman('\tXL\n')).toBe(40);
    });

    it('rejects empty input', () => {
      expect(() => fromRoman('')).toThrow(/nothing to convert/i);
      expect(() => fromRoman('   ')).toThrow(/nothing to convert/i);
    });
  });

  describe('the four subtractive pairs appear where they should and nowhere else', () => {
    it('four, nine, forty, ninety, four hundred and nine hundred use their subtractive forms', () => {
      expect(toRoman(4)).toBe('IV');
      expect(toRoman(9)).toBe('IX');
      expect(toRoman(40)).toBe('XL');
      expect(toRoman(90)).toBe('XC');
      expect(toRoman(400)).toBe('CD');
      expect(toRoman(900)).toBe('CM');
    });

    it('3999, the top of the range, uses three of every repeatable symbol', () => {
      expect(toRoman(3999)).toBe('MMMCMXCIX');
    });
  });
});
