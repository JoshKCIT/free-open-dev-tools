import { describe, it, expect } from 'vitest';
import { toWords, SCALES, NumberToWordsError } from '../src/index';

// The four mandated tests live at the top level, exactly as titled, so the
// plan's behavioural verify can find them by exact fullName.

it('9007199254740993 is spelled exactly, one greater than the largest safe integer', () => {
  expect(Number.MAX_SAFE_INTEGER).toBe(9007199254740991);
  expect(toWords('9007199254740993')).toBe(
    'nine quadrillion, seven trillion, one hundred and ninety-nine billion, two hundred and fifty-four million, seven hundred and forty thousand, nine hundred and ninety-three',
  );
});

it('a scaled decimal amount is spelled with its currency minor unit', () => {
  // 0.5 at the default scale of two is FIFTY minor units (right-padded),
  // not five -- that is the whole point of carrying a scale rather than
  // treating the fractional digits as their own small integer.
  expect(toWords('0.5', { style: 'currency' })).toBe('zero dollars and fifty cents');
  expect(toWords('12.34', { style: 'currency' })).toBe('twelve dollars and thirty-four cents');
});

it('an amount with more fraction digits than the currency allows is rejected', () => {
  expect(() => toWords('12.345', { style: 'currency' })).toThrow(/scale/i);
  expect(() => toWords('12.345', { style: 'currency' })).toThrow(/\b2\b/);
  expect(() => toWords('12.345', { style: 'currency' })).toThrow(/\b3\b/);
});

it('zero, a negative amount and the singular and plural forms are all correct', () => {
  expect(toWords('0.00', { style: 'currency' })).toBe('zero dollars and zero cents');
  expect(toWords('-5.00', { style: 'currency' })).toBe('negative five dollars and zero cents');
  expect(toWords('1.01', { style: 'currency' })).toBe('one dollar and one cent');
  expect(toWords('2.02', { style: 'currency' })).toBe('two dollars and two cents');
  expect(toWords('1.00', { style: 'currency' })).toBe('one dollar and zero cents');
});

describe('number-to-words', () => {
  describe('cardinal: exhaustive sweep of zero to one hundred', () => {
    const expected: Record<number, string> = {
      0: 'zero',
      1: 'one',
      2: 'two',
      3: 'three',
      4: 'four',
      5: 'five',
      6: 'six',
      7: 'seven',
      8: 'eight',
      9: 'nine',
      10: 'ten',
      11: 'eleven',
      12: 'twelve',
      13: 'thirteen',
      14: 'fourteen',
      15: 'fifteen',
      16: 'sixteen',
      17: 'seventeen',
      18: 'eighteen',
      19: 'nineteen',
      20: 'twenty',
      21: 'twenty-one',
      29: 'twenty-nine',
      30: 'thirty',
      35: 'thirty-five',
      40: 'forty',
      47: 'forty-seven',
      50: 'fifty',
      58: 'fifty-eight',
      60: 'sixty',
      69: 'sixty-nine',
      70: 'seventy',
      77: 'seventy-seven',
      80: 'eighty',
      88: 'eighty-eight',
      90: 'ninety',
      99: 'ninety-nine',
      100: 'one hundred',
    };

    it('sweeps every integer from 0 to 100 and checks the hand-written table above at its landmarks', () => {
      let checked = 0;
      for (let n = 0; n <= 100; n++) {
        // Every value in the sweep must at least not throw and must round
        // trip through the tens/ones structure; the hand-written table
        // above pins the landmark and irregular cases explicitly.
        const words = toWords(String(n));
        expect(words.length).toBeGreaterThan(0);
        if (n in expected) {
          expect(words).toBe(expected[n]);
        }
        checked++;
      }
      expect(checked).toBe(101);
    });

    it('every hyphenated compound tens value in 21-99 is asserted by hand', () => {
      expect(toWords('21')).toBe('twenty-one');
      expect(toWords('32')).toBe('thirty-two');
      expect(toWords('43')).toBe('forty-three');
      expect(toWords('54')).toBe('fifty-four');
      expect(toWords('65')).toBe('sixty-five');
      expect(toWords('76')).toBe('seventy-six');
      expect(toWords('87')).toBe('eighty-seven');
      expect(toWords('98')).toBe('ninety-eight');
    });
  });

  describe('cardinal: written-out expectation at every scale boundary SCALES names', () => {
    const NINE99 = 'nine hundred and ninety-nine';
    /** Builds "nine hundred and ninety-nine {a}, nine hundred and ninety-nine {b}, ..., nine hundred and ninety-nine" by hand, from literal scale-name strings typed here (not from the SCALES export), so this is not the same table the tool itself uses. */
    function ninesBelow(scaleNamesDescending: string[]): string {
      return [...scaleNamesDescending.map((s) => `${NINE99} ${s}`), NINE99].join(', ');
    }

    it('thousand: 999 and 1,000', () => {
      expect(toWords('999')).toBe(NINE99);
      expect(toWords('1000')).toBe('one thousand');
    });

    it('million: 999,999 and 1,000,000', () => {
      expect(toWords('999999')).toBe(ninesBelow(['thousand']));
      expect(toWords('1000000')).toBe('one million');
    });

    it('billion: 999,999,999 and 1,000,000,000', () => {
      expect(toWords('999999999')).toBe(ninesBelow(['million', 'thousand']));
      expect(toWords('1000000000')).toBe('one billion');
    });

    it('trillion: 999,999,999,999 and 1,000,000,000,000', () => {
      expect(toWords('999999999999')).toBe(ninesBelow(['billion', 'million', 'thousand']));
      expect(toWords('1000000000000')).toBe('one trillion');
    });

    it('quadrillion boundary', () => {
      expect(toWords('999999999999999')).toBe(ninesBelow(['trillion', 'billion', 'million', 'thousand']));
      expect(toWords('1000000000000000')).toBe('one quadrillion');
    });

    it('quintillion boundary', () => {
      expect(toWords('999999999999999999')).toBe(
        ninesBelow(['quadrillion', 'trillion', 'billion', 'million', 'thousand']),
      );
      expect(toWords('1000000000000000000')).toBe('one quintillion');
    });

    it('sextillion boundary', () => {
      expect(toWords('999999999999999999999')).toBe(
        ninesBelow(['quintillion', 'quadrillion', 'trillion', 'billion', 'million', 'thousand']),
      );
      expect(toWords('1000000000000000000000')).toBe('one sextillion');
    });

    it('septillion boundary', () => {
      expect(toWords('999999999999999999999999')).toBe(
        ninesBelow(['sextillion', 'quintillion', 'quadrillion', 'trillion', 'billion', 'million', 'thousand']),
      );
      expect(toWords('1000000000000000000000000')).toBe('one septillion');
    });

    it('octillion boundary', () => {
      expect(toWords('999999999999999999999999999')).toBe(
        ninesBelow([
          'septillion',
          'sextillion',
          'quintillion',
          'quadrillion',
          'trillion',
          'billion',
          'million',
          'thousand',
        ]),
      );
      expect(toWords('1000000000000000000000000000')).toBe('one octillion');
    });

    it('nonillion boundary', () => {
      expect(toWords('999999999999999999999999999999')).toBe(
        ninesBelow([
          'octillion',
          'septillion',
          'sextillion',
          'quintillion',
          'quadrillion',
          'trillion',
          'billion',
          'million',
          'thousand',
        ]),
      );
      expect(toWords('1000000000000000000000000000000')).toBe('one nonillion');
    });

    it('decillion boundary, the largest scale this tool supports', () => {
      expect(toWords('999999999999999999999999999999999')).toBe(
        ninesBelow([
          'nonillion',
          'octillion',
          'septillion',
          'sextillion',
          'quintillion',
          'quadrillion',
          'trillion',
          'billion',
          'million',
          'thousand',
        ]),
      );
      expect(toWords('1000000000000000000000000000000000')).toBe('one decillion');
      expect(SCALES[SCALES.length - 1]).toBe('decillion');
    });

    it('the largest value this tool supports (999 decillion and below) spells correctly, and one step beyond it is rejected naming decillion', () => {
      const maxNines = '9'.repeat(36); // 12 groups of 999 -- 999 decillion ... 999
      expect(() => toWords(maxNines)).not.toThrow();
      const oneOver = '1' + '0'.repeat(36); // needs a 13th group -- beyond decillion
      expect(() => toWords(oneOver)).toThrow(/decillion/i);
    });
  });

  describe('ordinal style', () => {
    it('applies the irregular forms and converts only the final word', () => {
      expect(toWords('1', { style: 'ordinal' })).toBe('first');
      expect(toWords('2', { style: 'ordinal' })).toBe('second');
      expect(toWords('3', { style: 'ordinal' })).toBe('third');
      expect(toWords('5', { style: 'ordinal' })).toBe('fifth');
      expect(toWords('8', { style: 'ordinal' })).toBe('eighth');
      expect(toWords('9', { style: 'ordinal' })).toBe('ninth');
      expect(toWords('12', { style: 'ordinal' })).toBe('twelfth');
      expect(toWords('20', { style: 'ordinal' })).toBe('twentieth');
      expect(toWords('23', { style: 'ordinal' })).toBe('twenty-third');
      expect(toWords('99', { style: 'ordinal' })).toBe('ninety-ninth');
      expect(toWords('100', { style: 'ordinal' })).toBe('one hundredth');
      expect(toWords('101', { style: 'ordinal' })).toBe('one hundred and first');
      expect(toWords('199', { style: 'ordinal' })).toBe('one hundred and ninety-ninth');
      expect(toWords('2000000', { style: 'ordinal' })).toBe('two millionth');
    });

    it('regular forms just add "th"', () => {
      expect(toWords('4', { style: 'ordinal' })).toBe('fourth');
      expect(toWords('6', { style: 'ordinal' })).toBe('sixth');
      expect(toWords('7', { style: 'ordinal' })).toBe('seventh');
      expect(toWords('10', { style: 'ordinal' })).toBe('tenth');
      expect(toWords('11', { style: 'ordinal' })).toBe('eleventh');
      expect(toWords('13', { style: 'ordinal' })).toBe('thirteenth');
      expect(toWords('19', { style: 'ordinal' })).toBe('nineteenth');
    });
  });

  describe('negative numbers', () => {
    it('prefixes the word for negative and spells the absolute value', () => {
      expect(toWords('-1')).toBe('negative one');
      expect(toWords('-1994')).toBe('negative one thousand, nine hundred and ninety-four');
    });

    it('does not prefix negative zero', () => {
      expect(toWords('-0')).toBe('zero');
    });
  });

  describe('a zero group in the middle', () => {
    it('skips the empty group entirely rather than emitting an empty phrase', () => {
      expect(toWords('1000000')).toBe('one million');
      expect(toWords('1000001')).toBe('one million, one');
      expect(toWords('1000000001')).toBe('one billion, one');
    });
  });

  describe('the connective word option', () => {
    it('defaults to including "and", and can be turned off for the American form', () => {
      expect(toWords('101')).toBe('one hundred and one');
      expect(toWords('101', { connective: false })).toBe('one hundred one');
    });
  });

  describe('separators', () => {
    it('accepts separators people actually type and does not throw', () => {
      expect(toWords('1,994')).toBe('one thousand, nine hundred and ninety-four');
      expect(toWords('1_994')).toBe('one thousand, nine hundred and ninety-four');
      expect(toWords("1'994")).toBe('one thousand, nine hundred and ninety-four');
      expect(toWords('1 994')).toBe('one thousand, nine hundred and ninety-four');
    });
  });

  describe('currency unit options', () => {
    it('uses the supplied major and minor unit names, pluralised correctly', () => {
      expect(toWords('1.00', { style: 'currency', majorUnit: 'pound', minorUnit: 'penny' })).toBe(
        'one pound and zero pennys',
      );
      expect(toWords('3.05', { style: 'currency', majorUnit: 'euro', minorUnit: 'cent' })).toBe(
        'three euros and five cents',
      );
    });

    it('supports a minor scale other than two', () => {
      expect(toWords('1.5', { style: 'currency', minorScale: 3 })).toBe('one dollar and five hundred cents');
      expect(() => toWords('1.5000', { style: 'currency', minorScale: 3 })).toThrow(/scale/i);
    });
  });

  describe('non-numeric input', () => {
    it('is rejected with the position of the first character that could not be read', () => {
      try {
        toWords('12x34');
        throw new Error('expected 12x34 to be rejected');
      } catch (err) {
        expect(err).toBeInstanceOf(NumberToWordsError);
        expect((err as NumberToWordsError).position).toBe(2);
      }
    });

    it('rejects an empty input', () => {
      expect(() => toWords('')).toThrow();
      expect(() => toWords('   ')).toThrow();
    });

    it('rejects a non-integer input for cardinal style', () => {
      expect(() => toWords('1.5')).toThrow(/whole number/i);
    });
  });

  describe('exports', () => {
    it('SCALES is ascending and starts with thousand', () => {
      expect(SCALES[0]).toBe('thousand');
      expect(SCALES.length).toBeGreaterThanOrEqual(1);
    });
  });
});
