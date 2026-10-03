import { it, expect } from 'vitest';
import { validateScheme, computeScheme, IBAN_LENGTHS } from '../src/index';
import {
  STDNUM_ISBN10,
  STDNUM_ISBN13,
  STDNUM_EAN13,
  STDNUM_EAN8,
  STDNUM_UPCA,
  STDNUM_ISIN,
  STDNUM_IBAN,
} from './fixtures/stdnum-corpus';

// The numbers in fixtures/stdnum-corpus.ts were made and accepted by python-stdnum 2.2, an independent maintained
// implementation, from a fixed seed (see fixtures/README.md). The tests read the committed file and never run Python.

const SETS: [string, string[], number][] = [
  ['isbn10', STDNUM_ISBN10, 400],
  ['isbn13', STDNUM_ISBN13, 400],
  ['ean13', STDNUM_EAN13, 400],
  ['ean8', STDNUM_EAN8, 400],
  ['upca', STDNUM_UPCA, 400],
  ['isin', STDNUM_ISIN, 400],
  ['iban', STDNUM_IBAN, 89],
];

it('every number recorded from python-stdnum 2.2 is valid', () => {
  let total = 0;
  for (const [scheme, numbers, count] of SETS) {
    expect(numbers, scheme).toHaveLength(count);
    expect(new Set(numbers).size, scheme + ' numbers differ').toBeGreaterThan(count - 5);
    for (const number of numbers) {
      const result = validateScheme(scheme, number);
      expect(result.valid, scheme + ' ' + number).toBe(true);
      // Computing from the number without its check digit gives back the same number.
      const body = scheme === 'iban' ? number.slice(0, 2) + number.slice(4) : number.slice(0, -1);
      expect(computeScheme(scheme, body).full, scheme + ' ' + number).toBe(number);
      total++;
    }
  }
  expect(total).toBe(2489);
  // One IBAN per registry country, each with the registry length.
  expect(new Set(STDNUM_IBAN.map((iban) => iban.slice(0, 2))).size).toBe(89);
  for (const iban of STDNUM_IBAN) expect(iban.length, iban).toBe(IBAN_LENGTHS.get(iban.slice(0, 2)));
});

it('every single-digit substitution in 200 EAN-13 numbers is detected', () => {
  // Weights 1 and 3 are both coprime with 10, so changing one digit always changes the sum modulo 10 (D-189).
  let tried = 0;
  for (const number of STDNUM_EAN13.slice(0, 200)) {
    for (let at = 0; at < 13; at++) {
      for (const replacement of '0123456789') {
        if (replacement === number[at]) continue;
        const changed = number.slice(0, at) + replacement + number.slice(at + 1);
        expect(validateScheme('ean13', changed).valid, `${number} with digit ${at + 1} changed`).toBe(false);
        tried++;
      }
    }
  }
  expect(tried).toBe(200 * 13 * 9);
});

it('an adjacent swap of two digits that differ by 5 is not caught by the EAN-13 check digit, as the limits say', () => {
  // The weights 1 and 3 differ by 2, so swapping neighbours a and b changes the sum by 2 * (a - b), which is a multiple
  // of 10 exactly when a and b differ by 5. The page says so in its limits; this test is the proof of that sentence.
  let missed = 0;
  let missedOther = 0;
  for (const number of STDNUM_EAN13) {
    for (let at = 0; at < 12; at++) {
      const a = number[at]!;
      const b = number[at + 1]!;
      if (a === b) continue;
      const swapped = number.slice(0, at) + b + a + number.slice(at + 2);
      if (!validateScheme('ean13', swapped).valid) continue;
      if (Math.abs(Number(a) - Number(b)) === 5) missed++;
      else missedOther++;
    }
  }
  expect(missed).toBeGreaterThan(0);
  expect(missedOther).toBe(0);
});
