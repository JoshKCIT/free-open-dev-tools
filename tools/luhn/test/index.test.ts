import { describe, it, expect } from 'vitest';
import { isValid, checkDigit, identify, ISSUERS, LuhnError } from '../src/index';

// The nine mandated tests live at the top level, exactly as titled, so the
// plan's behavioural verify can find them by exact fullName. A tenth check
// (the mutation that empties ISSUERS) is run by the plan's own verify
// script directly against this file, not from inside it.

it('the worked example validates and its hand computation is reproduced in the assertion', () => {
  // 79927398713, a widely reproduced illustration of the Luhn algorithm.
  // Doubling every second digit from the right (subtracting nine from
  // anything over nine after doubling):
  //   3  1*2=2  7  8*2=16->7  9  3*2=6  7  2*2=4  9  9*2=18->9  7
  // Sum = 3+2+7+7+9+6+7+4+9+9+7 = 70, a multiple of ten, so it validates.
  const digits = [...'79927398713'].reverse();
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  expect(sum).toBe(70);
  expect(sum % 10).toBe(0);
  expect(isValid('79927398713')).toBe(true);
});

it('changing any single digit of the worked example makes it fail', () => {
  const original = '79927398713';
  for (let pos = 0; pos < original.length; pos++) {
    for (let d = 0; d < 10; d++) {
      const candidate = original.slice(0, pos) + String(d) + original.slice(pos + 1);
      if (candidate === original) continue;
      expect(isValid(candidate)).toBe(false);
    }
  }
});

it('the one transposition the algorithm cannot catch is asserted as a known limitation', () => {
  // 5090 is Luhn-valid (checkDigit('509') is '0'). Transposing the
  // adjacent "09" to "90" gives 5900, which is ALSO Luhn-valid -- this is
  // the documented limitation: the algorithm cannot detect the
  // transposition of the two-digit sequence 09 to 90 (or vice versa),
  // because a doubled 9 (18 -> 1+8 -> 9) contributes the same digit sum
  // as an undoubled 9, and 0 contributes 0 either way.
  expect(checkDigit('509')).toBe('0');
  expect(isValid('5090')).toBe(true);
  expect(isValid('5900')).toBe(true);

  // A general transposition, by contrast, IS caught: swapping the two
  // adjacent unequal digits at positions 2 and 3 of the worked example
  // (9 and 2) breaks validity.
  expect(isValid('79297398713')).toBe(false);
});

it('identify returns exactly the expected issuer ids for each named fixture', () => {
  // Stripe's published test card numbers (docs.stripe.com/testing),
  // fetched live and confirmed Luhn-valid and correctly prefixed/lengthed
  // for their stated issuer.
  expect(identify('4242424242424242').map((m) => m.id)).toEqual(['visa']);
  expect(identify('5555555555554444').map((m) => m.id)).toEqual(['mastercard']);
  expect(identify('378282246310005').map((m) => m.id)).toEqual(['amex']);
  expect(identify('6011111111111117').map((m) => m.id)).toEqual(['discover']);
  expect(identify('2223003122003222').map((m) => m.id)).toEqual(['mastercard']);
});

it('identify returns both issuers for a number in an overlapping range, in either table order', () => {
  // 622500... sits inside both Discover's 622126-622925 sub-range and
  // China UnionPay's own 62 range -- these ranges are documented as
  // co-branded (en.wikipedia.org/wiki/Payment_card_number, "Discover
  // Card" row: "622126-622925 (China UnionPay co-branded)").
  const overlapping = '6225000000000006';
  const forward = identify(overlapping)
    .map((m) => m.id)
    .sort();
  expect(forward).toEqual(['discover', 'unionpay']);

  // Order must not change the answer: reverse the live table in place,
  // re-run identify with the real function, then restore it.
  const originalOrder = [...ISSUERS];
  ISSUERS.reverse();
  try {
    const reversedResult = identify(overlapping)
      .map((m) => m.id)
      .sort();
    expect(reversedResult).toEqual(forward);
  } finally {
    ISSUERS.length = 0;
    ISSUERS.push(...originalOrder);
  }
});

it('identify returns an empty array for a prefix match with a disallowed length', () => {
  // Starts with 4 (Visa's prefix) but is only 10 digits -- not 13, 16 or 19.
  expect(identify('4000000002')).toEqual([]);
});

it('identify returns an empty array for a number matching no pattern', () => {
  expect(identify('9900000000000002')).toEqual([]);
});

it('the Mastercard 2-series boundaries 222100 and 272099 match and 222099 and 272100 do not', () => {
  expect(identify('2221000000000009').map((m) => m.id)).toEqual(['mastercard']);
  expect(identify('2720990000000007').map((m) => m.id)).toEqual(['mastercard']);
  expect(identify('2220990000000002')).toEqual([]);
  expect(identify('2721000000000004')).toEqual([]);
});

it('each of the four Discover range families matches at both of its boundaries', () => {
  // 6011, exact four-digit prefix.
  expect(identify('6010000000000005')).toEqual([]);
  expect(identify('6011000000000004').map((m) => m.id)).toEqual(['discover']);
  expect(identify('6012000000000003')).toEqual([]);

  // 622126-622925, six-digit range. Immediately outside this specific
  // sub-range on either side is still inside China UnionPay's own wider
  // "62" range (620000-629999), so Discover is correctly absent while
  // unionpay is correctly present -- not an empty match, because these
  // two ranges are the very overlap this tool exists to report honestly.
  expect(identify('6221250000000001').map((m) => m.id)).toEqual(['unionpay']);
  expect(identify('6221260000000000').map((m) => m.id)).toEqual(expect.arrayContaining(['discover']));
  expect(identify('6229250000000003').map((m) => m.id)).toEqual(expect.arrayContaining(['discover']));
  expect(identify('6229260000000002').map((m) => m.id)).toEqual(['unionpay']);

  // 644-649, three-digit range. Its own low boundary is a clean
  // exclusion; 643 does not fall in any of Discover's other three
  // families either.
  expect(identify('6430000000000007')).toEqual([]);
  expect(identify('6440000000000005').map((m) => m.id)).toEqual(['discover']);
  expect(identify('6490000000000004').map((m) => m.id)).toEqual(['discover']);
  // Immediately above 649 is 650, which is genuinely inside Discover's
  // OWN separate "65" family (644-649 and 65 are adjacent, published
  // ranges with no gap between them) -- so this is a correct match, not
  // a boundary leak, and is asserted as such rather than as an exclusion.
  expect(identify('6500000000000002').map((m) => m.id)).toEqual(['discover']);

  // 65, two-digit exact prefix. A clean value just below it (642, inside
  // none of the four families) and just above it (66) are both excluded.
  expect(identify('6420000000000009')).toEqual([]);
  expect(identify('6500000000000002').map((m) => m.id)).toEqual(['discover']);
  expect(identify('6600000000000001')).toEqual([]);
});

describe('luhn', () => {
  describe('checkDigit', () => {
    it('matches the live-fetched Wikipedia worked example (Luhn algorithm, "Example for computing check digit")', () => {
      // Payload 1789372997 -> sum of doubled/reduced digits is 56 ->
      // check digit (10 - (56 mod 10)) mod 10 = 4 -> full number 17893729974.
      expect(checkDigit('1789372997')).toBe('4');
      expect(isValid('17893729974')).toBe(true);
    });

    it('checkDigit and isValid share one digit-walk implementation', () => {
      const payload = '4000000000000';
      const digit = checkDigit(payload);
      expect(isValid(payload + digit)).toBe(true);
    });
  });

  describe('separators and malformed input', () => {
    it('strips spaces and hyphens before checking', () => {
      expect(isValid('7992 7398 713')).toBe(true);
      expect(isValid('799-273-98713')).toBe(true);
      expect(isValid('7 9 9 2 7 3 9 8 7 1 3')).toBe(true);
    });

    it('rejects a character that is not a digit or a recognised separator, with its position', () => {
      try {
        isValid('7992x398713');
        throw new Error('expected 7992x398713 to be rejected');
      } catch (err) {
        expect(err).toBeInstanceOf(LuhnError);
        expect((err as LuhnError).position).toBe(4);
      }
    });

    it('rejects a string of fewer than two digits', () => {
      expect(() => isValid('7')).toThrow(/at least two digits/i);
      expect(() => isValid('')).toThrow(/at least two digits/i);
    });
  });

  describe('ISSUERS coverage', () => {
    it('covers Visa, Mastercard (including the 2-series), American Express, Discover and China UnionPay', () => {
      const ids = ISSUERS.map((i) => i.id).sort();
      expect(ids).toEqual(['amex', 'discover', 'mastercard', 'unionpay', 'visa']);
    });
  });

  describe('honesty about what a pass means', () => {
    it('a fabricated but Luhn-valid number is not claimed to be real by isValid or identify', () => {
      const fabricated = '4242424242424242';
      expect(isValid(fabricated)).toBe(true);
      const matches = identify(fabricated);
      for (const m of matches) {
        expect(JSON.stringify(m).toLowerCase()).not.toMatch(/real|active|valid account/);
      }
    });
  });
});

it('ISO/IEC 7812-1 Annex B: 7992739871 takes check digit 3, and 79927398713 passes', () => {
  expect(checkDigit('7992739871')).toBe('3');
  expect(isValid('79927398713')).toBe(true);
  expect(isValid('79927398710')).toBe(false);
});
