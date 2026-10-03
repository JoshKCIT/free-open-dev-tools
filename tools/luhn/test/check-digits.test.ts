import { it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import {
  validateScheme,
  computeScheme,
  CheckDigitError,
  SCHEMES,
  MAX_CHECK_INPUT_CHARS,
  IBAN_LENGTHS,
  IBAN_REGISTRY_RELEASE,
} from '../src/index';
import { mod97 } from '../src/check-digits';
import { REGISTRY_RELEASE_ROWS } from './fixtures/registry-release';
import { STDNUM_IBAN_LENGTHS } from './fixtures/stdnum-corpus';

// The package prints nothing: every test runs with the console watched.
let spies: MockInstance[] = [];
beforeEach(() => {
  spies = (['log', 'warn', 'error'] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => {}));
});
afterEach(() => {
  for (const spy of spies) {
    expect(spy.mock.calls).toHaveLength(0);
    spy.mockRestore();
  }
});

// The weights of the GS1 and ISBN-13 check digit (ISBN Users Manual 2012, Appendix 1, A1.1): the first twelve digits are
// multiplied alternately by 1 and 3 from the left, the check digit is 10 minus the remainder of the sum divided by 10, and
// 0 when that gives 10. Hand computation for the manual's own number 978-0-11-000222-4:
//   9*1 + 7*3 + 8*1 + 0*3 + 1*1 + 1*3 + 0*1 + 0*3 + 0*1 + 2*3 + 2*1 + 2*3 = 9+21+8+0+1+3+0+0+0+6+2+6 = 56
//   56 mod 10 = 6, 10 - 6 = 4, so the check digit is 4 and the number is valid.
// The manual's two further test numbers are 9780777777770 (sum 150, remainder 0, check digit 0) and 978-951-23-8888-2.

function refusal(run: () => unknown): CheckDigitError {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(CheckDigitError);
    return err as CheckDigitError;
  }
  throw new Error('expected a CheckDigitError but nothing was thrown');
}

function detail(result: { details: [string, string][] }, name: string): string | undefined {
  return result.details.find(([key]) => key === name)?.[1];
}

/** A small seeded generator so every run draws the same numbers. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

it('ISBN-13 vectors from the ISBN Users Manual are valid and the check digit computes', () => {
  for (const [typed, plain] of [
    ['978-0-11-000222-4', '9780110002224'],
    ['9780777777770', '9780777777770'],
    ['978-951-23-8888-2', '9789512388882'],
  ] as const) {
    const result = validateScheme('isbn13', typed);
    expect(result.valid).toBe(true);
    expect(result.normalised).toBe(plain);
    expect(result.checkDigit).toBe(plain.slice(-1));
    expect(result.expected).toBe(plain.slice(-1));
  }
  const computed = computeScheme('isbn13', '978011000222');
  expect(computed.checkDigit).toBe('4');
  expect(computed.full).toBe('9780110002224');
  // Spaces and hyphens are ignored when computing as well.
  expect(computeScheme('isbn13', '978-0-11-000222').full).toBe('9780110002224');
  expect(computeScheme('isbn13', '978077777777').checkDigit).toBe('0');
});

it('a wrong check digit names the expected digit and a bad character gives only its position', () => {
  const wrong = validateScheme('isbn13', '978-0-11-000222-5');
  expect(wrong.valid).toBe(false);
  expect(wrong.checkDigit).toBe('5');
  expect(wrong.expected).toBe('4');

  // A letter is refused with the place it stands, counted in the text as typed, and the message never repeats it.
  const typed = '978-0-11-000222-z';
  const bad = refusal(() => validateScheme('isbn13', typed));
  expect(bad.position).toBe(typed.indexOf('z'));
  expect(bad.message).toContain('17');
  expect(bad.message).not.toMatch(/z/i);
  const inside = refusal(() => validateScheme('isbn13', '97801z0002224'));
  expect(inside.position).toBe(5);
  expect(inside.message).not.toMatch(/z/i);
  // Computing refuses the same way.
  expect(refusal(() => computeScheme('isbn13', '97801100022z')).position).toBe(11);
});

it('a number of the wrong length is refused naming the expected length', () => {
  for (const typed of ['97801100022244', '978011000222', '', '9780110002224 9']) {
    const error = refusal(() => validateScheme('isbn13', typed));
    expect(error.message).toContain('13');
    expect(error.position).toBeUndefined();
  }
  // Computing wants the first twelve digits.
  for (const typed of ['9780110002224', '97801100022', '']) {
    const error = refusal(() => computeScheme('isbn13', typed));
    expect(error.message).toContain('12');
    expect(error.position).toBeUndefined();
  }
});

it('ISBN-10 vectors are valid, X is the check value 10 and ISBN-10 converts to ISBN-13', () => {
  // ISBN-10 weights run 10 down to 1 over the ten characters and the sum must divide by 11 (X stands for 10). Hand sums:
  //   0-306-40615-2: 0*10+3*9+0*8+6*7+4*6+0*5+6*4+1*3+5*2+2*1 = 0+27+0+42+24+0+24+3+10+2 = 132 = 11 * 12
  //   080442957X:    0*10+8*9+0*8+4*7+4*6+2*5+9*4+5*3+7*2+10*1 = 0+72+0+28+24+10+36+15+14+10 = 209 = 11 * 19
  const dashed = validateScheme('isbn10', '0-306-40615-2');
  expect(dashed.valid).toBe(true);
  expect(dashed.normalised).toBe('0306406152');
  // 978 plus the first nine digits and a new check digit; python-stdnum 2.2 to_isbn13 gave 978-0-306-40615-7.
  expect(detail(dashed, 'ISBN-13 form')).toBe('9780306406157');

  const ending = validateScheme('isbn10', '080442957X');
  expect(ending.valid).toBe(true);
  expect(ending.checkDigit).toBe('X');
  expect(validateScheme('isbn10', '080442957x').normalised).toBe('080442957X');
  expect(validateScheme('isbn10', '0804429571').expected).toBe('X');
  expect(validateScheme('isbn10', '0804429571').valid).toBe(false);

  // X is only the last character; anywhere else it is a bad character, reported by its place.
  expect(refusal(() => validateScheme('isbn10', '08044295X7')).position).toBe(8);

  const computed = computeScheme('isbn10', '080442957');
  expect(computed.checkDigit).toBe('X');
  expect(computed.full).toBe('080442957X');
  expect(computeScheme('isbn10', '0-306-40615').full).toBe('0306406152');
  expect(detail(computeScheme('isbn10', '0-306-40615'), 'ISBN-13 form')).toBe('9780306406157');

  // An ISBN-13 that begins 978 converts back; one that begins 979 has no ISBN-10 form.
  expect(detail(validateScheme('isbn13', '978-0-306-40615-7'), 'ISBN-10 form')).toBe('0306406152');
  const later = validateScheme('isbn13', '979-10-90636-07-1');
  expect(later.valid).toBe(true);
  expect(detail(later, 'ISBN-10 form')).toBeUndefined();
  expect(later.notes.join(' ')).toContain('979');
});

it('EAN-8, EAN-13 and UPC-A vectors are valid and UPC-A shows its EAN-13 form', () => {
  // EAN-13 4006381333931: digits 4 0 0 6 3 8 1 3 3 3 9 3 weighted 1 and 3 from the left give
  //   4+0+0+18+3+24+1+9+3+9+9+9 = 89, 89 mod 10 = 9 and 10 - 9 = 1, the last digit.
  // EAN-8 73513537: the seven digits weighted 3 and 1 from the left give 21+3+15+1+9+5+9 = 63, so the check digit is 7.
  // UPC-A 036000291452: the eleven digits weighted 3 and 1 from the left give 0+3+18+0+0+0+6+9+3+4+15 = 58, so it is 2.
  const ean13 = validateScheme('ean13', '4006381333931');
  expect(ean13.valid).toBe(true);
  expect(ean13.notes.join(' ')).not.toContain('also an ISBN-13');
  expect(validateScheme('ean13', '978-0-11-000222-4').notes).toContain('This EAN-13 is also an ISBN-13.');
  expect(validateScheme('ean13', '979-10-90636-07-1').notes).toContain('This EAN-13 is also an ISBN-13.');
  expect(validateScheme('ean13', '4006381333932').valid).toBe(false);
  expect(validateScheme('ean13', '4006381333932').expected).toBe('1');

  const ean8 = validateScheme('ean8', '73513537');
  expect(ean8.valid).toBe(true);
  expect(ean8.checkDigit).toBe('7');
  expect(validateScheme('ean8', '73513538').expected).toBe('7');

  const upc = validateScheme('upca', '0-36000-29145-2');
  expect(upc.valid).toBe(true);
  expect(upc.normalised).toBe('036000291452');
  expect(detail(upc, 'EAN-13 form')).toBe('0036000291452');
  expect(validateScheme('ean13', '0036000291452').valid).toBe(true);

  expect(computeScheme('ean13', '400638133393').checkDigit).toBe('1');
  expect(computeScheme('ean8', '7351353').full).toBe('73513537');
  const upcComputed = computeScheme('upca', '03600029145');
  expect(upcComputed.full).toBe('036000291452');
  expect(detail(upcComputed, 'EAN-13 form')).toBe('0036000291452');
});

it('IBAN examples are valid, check digits compute with a leading zero kept, and a wrong length is refused before mod 97', () => {
  const gb = validateScheme('iban', 'GB82 WEST 1234 5698 7654 32');
  expect(gb.valid).toBe(true);
  expect(gb.normalised).toBe('GB82WEST12345698765432');
  expect(gb.checkDigit).toBe('82');
  expect(detail(gb, 'Print format')).toBe('GB82 WEST 1234 5698 7654 32');
  expect(detail(gb, 'Registry release')).toBe(IBAN_REGISTRY_RELEASE);
  expect(gb.notes).toContain(
    'A valid IBAN only has the right form and check digits; it does not show that the account exists.',
  );
  expect(validateScheme('iban', 'de89 3704 0044 0532 0130 00').valid).toBe(true);

  // Right length, wrong check digits: not valid, and the digits that would be right are named.
  const wrong = validateScheme('iban', 'GB83 WEST 1234 5698 7654 32');
  expect(wrong.valid).toBe(false);
  expect(wrong.checkDigit).toBe('83');
  expect(wrong.expected).toBe('82');

  const computed = computeScheme('iban', 'GB WEST 1234 5698 7654 32');
  expect(computed.checkDigit).toBe('82');
  expect(computed.full).toBe('GB82WEST12345698765432');
  expect(computeScheme('iban', 'GBWEST12345698765432').full).toBe('GB82WEST12345698765432');
  // The check digits are always two digits: the registry's own AE example has 07 and keeps its zero.
  const leading = computeScheme('iban', 'AE0331234567890123456');
  expect(leading.checkDigit).toBe('07');
  expect(leading.full).toBe('AE070331234567890123456');
  // The same for every registry example whose check digits start with 0.
  const zeros = REGISTRY_RELEASE_ROWS.filter(([, , example]) => example[2] === '0');
  expect(zeros.length).toBeGreaterThan(3);
  for (const [country, , example] of zeros) {
    expect(computeScheme('iban', country + example.slice(4)).checkDigit).toBe(example.slice(2, 4));
  }

  // One character short or long is a length error that names the registry length, whatever the digits would give.
  for (const typed of ['GB82WEST1234569876543', 'GB82WEST123456987654322', 'GB82']) {
    const error = refusal(() => validateScheme('iban', typed));
    expect(error.message).toContain('22');
    expect(error.position).toBeUndefined();
  }
  expect(refusal(() => computeScheme('iban', 'GBWEST1234569876543')).message).toContain('20');
  expect(refusal(() => computeScheme('iban', 'GBWEST123456987654322')).message).toContain('20');
  // The two check digits must be digits and the country letters.
  expect(refusal(() => validateScheme('iban', 'GB8zWEST12345698765432')).position).toBe(3);
  expect(refusal(() => validateScheme('iban', '1B82WEST12345698765432')).position).toBe(0);
  expect(refusal(() => validateScheme('iban', 'GB82WEST1234569876543!')).position).toBe(21);
  expect(refusal(() => validateScheme('iban', 'GB8')).message).toContain('country code');
});

it('IBAN lengths equal the registry release for all 89 countries and unknown countries are refused', () => {
  expect(IBAN_REGISTRY_RELEASE).toContain('103');
  expect(IBAN_LENGTHS.size).toBe(89);
  expect(REGISTRY_RELEASE_ROWS).toHaveLength(89);
  // Each row of the release: the length, and the electronic example the registry prints (same length, valid, computable).
  for (const [country, length, example] of REGISTRY_RELEASE_ROWS) {
    expect(IBAN_LENGTHS.get(country), country).toBe(length);
    expect(example.length, country).toBe(length);
    const result = validateScheme('iban', example);
    expect(result.valid, country).toBe(true);
    expect(computeScheme('iban', country + example.slice(4)).full, country).toBe(example);
  }
  // python-stdnum 2.2 holds the same 89 countries and lengths.
  expect(Object.keys(STDNUM_IBAN_LENGTHS).sort()).toEqual([...IBAN_LENGTHS.keys()].sort());
  for (const [country, length] of IBAN_LENGTHS) expect(STDNUM_IBAN_LENGTHS[country], country).toBe(length);
  // Boundary: the shortest IBAN has 15 characters (Norway) and the longest 33 (Russia).
  expect(Math.min(...IBAN_LENGTHS.values())).toBe(15);
  expect(Math.max(...IBAN_LENGTHS.values())).toBe(33);

  // A code that is not in the release is refused by its place and never repeated. A territory code is not an IBAN
  // country (the registry says an IBAN for French Guiana begins FR), and neither are countries without an IBAN format.
  for (const unknown of ['XX', 'ZZ', 'US', 'CA', 'GF', 'AX', 'IM', 'JE', 'GG', 'CO']) {
    const error = refusal(() => validateScheme('iban', unknown + '82WEST12345698765432'));
    expect(error.position, unknown).toBe(0);
    expect(error.message).toContain('registry');
    expect(error.message).not.toContain(unknown);
    expect(refusal(() => computeScheme('iban', unknown + 'WEST12345698765432')).position).toBe(0);
  }
});

it('VIN vectors from 49 CFR 565.15 are valid and I, O and Q are refused with their position', () => {
  // 49 CFR 565.15 Table VI: the VIN 1G4AH59H_5G118341 (position 9 left out) has the products
  //   8+49+24+5+32+15+18+80+0+45+56+7+6+40+12+12+2 = 411, and 411 / 11 = 37 4/11, so the check digit is 4.
  // 1M8GDM9AXKP042788: 8+28+48+35+16+12+18+10+0+18+56+0+24+10+28+24+16 = 351 = 11 * 31 + 10, so the check character is X.
  // 11111111111111111: the weights without position 9 add to 89, and 89 mod 11 = 1.
  for (const vin of ['1G4AH59H45G118341', '1M8GDM9AXKP042788', '11111111111111111']) {
    const result = validateScheme('vin', vin);
    expect(result.valid, vin).toBe(true);
    expect(result.checkDigit).toBe(vin[8]);
  }
  expect(validateScheme('vin', '1m8gdm9axkp042788').valid).toBe(true);
  expect(validateScheme('vin', '1M8GDM9AXKP042788').notes).toContain(
    'Position 9 is a check digit only for vehicles made for North America; elsewhere it may be any character.',
  );
  const wrong = validateScheme('vin', '1M8GDM9A1KP042788');
  expect(wrong.valid).toBe(false);
  expect(wrong.expected).toBe('X');
  // A letter other than X in position 9 can never be a check character.
  expect(validateScheme('vin', '1M8GDM9AAKP042788').valid).toBe(false);

  // Computing: the 17 character form takes any character at position 9, the 16 character form leaves it out.
  expect(computeScheme('vin', '1G4AH59H05G118341').checkDigit).toBe('4');
  expect(computeScheme('vin', '1G4AH59H05G118341').full).toBe('1G4AH59H45G118341');
  expect(computeScheme('vin', '1G4AH59H5G118341').full).toBe('1G4AH59H45G118341');
  expect(computeScheme('vin', '1G4AH59H-5G118341').full).toBe('1G4AH59H45G118341');
  expect(computeScheme('vin', '1M8GDM9A*KP042788').full).toBe('1M8GDM9AXKP042788');
  expect(computeScheme('vin', '1M8GDM9A_KP042788').checkDigit).toBe('X');

  // I, O and Q are never used in a VIN: refused by position, in either case, anywhere.
  const typed = '1M8GDM9AXKP04278O';
  const bad = refusal(() => validateScheme('vin', typed));
  expect(bad.position).toBe(16);
  expect(bad.message).toContain('17');
  expect(bad.message).not.toContain(typed);
  for (const [letter, at] of [
    ['I', 0],
    ['q', 5],
    ['O', 12],
    ['i', 15],
  ] as const) {
    const vin = '1M8GDM9AXKP042788'.slice(0, at) + letter + '1M8GDM9AXKP042788'.slice(at + 1);
    expect(refusal(() => validateScheme('vin', vin)).position, vin).toBe(at);
    expect(refusal(() => computeScheme('vin', vin)).position, vin).toBe(at);
  }
  // Table III values, typed here once more from the regulation: with one letter in position 1 (weight 8) and zeros
  // elsewhere, the check value is the letter's value times 8 modulo 11.
  const TABLE_III: [string, number][] = [
    ['A', 1],
    ['B', 2],
    ['C', 3],
    ['D', 4],
    ['E', 5],
    ['F', 6],
    ['G', 7],
    ['H', 8],
    ['J', 1],
    ['K', 2],
    ['L', 3],
    ['M', 4],
    ['N', 5],
    ['P', 7],
    ['R', 9],
    ['S', 2],
    ['T', 3],
    ['U', 4],
    ['V', 5],
    ['W', 6],
    ['X', 7],
    ['Y', 8],
    ['Z', 9],
  ];
  for (const [letter, value] of TABLE_III) {
    const check = (value * 8) % 11;
    expect(computeScheme('vin', letter + '0'.repeat(15)).checkDigit, letter).toBe(check === 10 ? 'X' : String(check));
  }
});

it('ISIN vectors are valid', () => {
  // US0378331005: the letters become 30 and 28, so the digits are 3028037833100 followed by the check digit. Doubling
  // every second digit from the right of those thirteen and adding every digit gives 45, and 10 - 5 = 5, the last digit.
  for (const isin of ['US0378331005', 'GB0002634946', 'AU0000XVGZA3']) {
    const result = validateScheme('isin', isin);
    expect(result.valid, isin).toBe(true);
    expect(result.checkDigit).toBe(isin[11]);
  }
  expect(validateScheme('isin', 'us 0378 33100 5').valid).toBe(true);
  expect(validateScheme('isin', 'US0378331005').notes.join(' ')).toContain('does not show that the security exists');
  const wrong = validateScheme('isin', 'US0378331006');
  expect(wrong.valid).toBe(false);
  expect(wrong.expected).toBe('5');
  expect(computeScheme('isin', 'US037833100').full).toBe('US0378331005');
  expect(computeScheme('isin', 'AU0000XVGZA').checkDigit).toBe('3');
  // The first two characters are letters, the last is a digit.
  expect(refusal(() => validateScheme('isin', '10378331005X')).position).toBe(0);
  expect(refusal(() => validateScheme('isin', 'US037833100X')).position).toBe(11);
  expect(refusal(() => computeScheme('isin', 'U1037833100')).position).toBe(1);
});

it('each scheme refuses one character more and one fewer than its length and input over 256 characters', () => {
  // The whole number: a valid example of every scheme, with the length the scheme must have.
  const whole: [string, string, number][] = [
    ['isbn10', '0306406152', 10],
    ['isbn13', '9780110002224', 13],
    ['ean8', '73513537', 8],
    ['ean13', '4006381333931', 13],
    ['upca', '036000291452', 12],
    ['vin', '1M8GDM9AXKP042788', 17],
    ['isin', 'US0378331005', 12],
  ];
  expect([...SCHEMES.keys()]).toEqual(['isbn10', 'isbn13', 'ean8', 'ean13', 'upca', 'iban', 'vin', 'isin']);
  for (const [scheme, valid, length] of whole) {
    expect(SCHEMES.get(scheme as 'vin')?.length).toBe(length);
    expect(validateScheme(scheme, valid).valid, scheme).toBe(true);
    for (const typed of [valid + '1', valid.slice(0, -1)]) {
      const error = refusal(() => validateScheme(scheme, typed));
      expect(error.message, scheme).toContain(String(length));
      expect(error.position).toBeUndefined();
    }
  }
  expect(SCHEMES.get('iban')?.length).toBe('registry');
  for (const [country, length, example] of REGISTRY_RELEASE_ROWS) {
    for (const typed of [example + '1', example.slice(0, -1)]) {
      expect(refusal(() => validateScheme('iban', typed)).message, country).toContain(String(length));
    }
  }

  // Computing: the number without its check digit.
  const body: [string, string, number][] = [
    ['isbn10', '030640615', 9],
    ['isbn13', '978011000222', 12],
    ['ean8', '7351353', 7],
    ['ean13', '400638133393', 12],
    ['upca', '03600029145', 11],
    ['isin', 'US037833100', 11],
  ];
  for (const [scheme, start, length] of body) {
    expect(SCHEMES.get(scheme as 'isin')?.computeLength).toBe(length);
    expect(computeScheme(scheme, start).full, scheme).toHaveLength(length + 1);
    for (const typed of [start + '1', start.slice(0, -1)]) {
      expect(refusal(() => computeScheme(scheme, typed)).message, scheme).toContain(String(length));
    }
  }
  expect(SCHEMES.get('iban')?.computeLength).toBe('registry');
  for (const [country, length, example] of REGISTRY_RELEASE_ROWS) {
    const start = country + example.slice(4);
    expect(computeScheme('iban', start).full).toBe(example);
    for (const typed of [start + '1', start.slice(0, -1)]) {
      expect(refusal(() => computeScheme('iban', typed)).message, country).toContain(String(length - 2));
    }
  }
  // A VIN is computed from 16 characters (position 9 left out) or 17 (any character at position 9).
  expect(SCHEMES.get('vin')?.computeLength).toBe(16);
  for (const typed of ['1G4AH59H5G11834', '1G4AH59H05G1183411', '']) {
    expect(refusal(() => computeScheme('vin', typed)).message).toContain('16');
  }

  // Input over 256 characters is refused before anything is read, even when it holds characters no scheme accepts.
  for (const scheme of SCHEMES.keys()) {
    for (const long of [
      '1'.repeat(MAX_CHECK_INPUT_CHARS + 1),
      '!'.repeat(MAX_CHECK_INPUT_CHARS + 1),
      ' '.repeat(300),
    ]) {
      for (const run of [() => validateScheme(scheme, long), () => computeScheme(scheme, long)]) {
        const error = refusal(run);
        expect(error.message).toContain('256');
        expect(error.message).toContain('limit');
        expect(error.position).toBeUndefined();
      }
    }
    // 256 characters are read: the refusal is about the length of the number, not the limit.
    const edge = refusal(() => validateScheme(scheme, '1'.repeat(MAX_CHECK_INPUT_CHARS)));
    expect(edge.message).not.toContain('limit');
    // Typed text never comes back in a message.
    for (const run of [() => validateScheme(scheme, 'zebra!'), () => computeScheme(scheme, 'zebra!')]) {
      expect(refusal(run).message).not.toMatch(/zebra/i);
    }
  }
  expect(MAX_CHECK_INPUT_CHARS).toBe(256);
});

it('the IBAN remainder of a 34-character IBAN equals BigInt arithmetic', () => {
  // Letters stand for 10 to 35; the remainder of the whole digit string by 97 must equal exact BigInt arithmetic. The BigInt
  // is in this test only; the package carries the remainder over short chunks of whole numbers.
  const exact = (text: string): number => {
    let digits = '';
    for (const ch of text) digits += ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    return Number(BigInt(digits) % 97n);
  };
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const random = mulberry32(14080);
  const cases = [
    '9'.repeat(34),
    'Z'.repeat(34),
    '0'.repeat(34),
    'A'.repeat(34),
    'GB82WEST12345698765432',
    'RU' + '9'.repeat(31),
  ];
  for (let i = 0; i < 300; i++) {
    let text = '';
    for (let k = 0; k < 34; k++) text += alphabet[Math.floor(random() * alphabet.length)];
    cases.push(text);
  }
  for (const text of cases) expect(mod97(text), text).toBe(exact(text));
  // Every length from 1 to 34 characters.
  for (let n = 1; n <= 34; n++) expect(mod97('Z9'.repeat(20).slice(0, n))).toBe(exact('Z9'.repeat(20).slice(0, n)));
  // The remainder of a valid IBAN, rearranged, is 1.
  expect(mod97('WEST12345698765432' + 'GB82')).toBe(1);
});

it('prototype names are unknown IBAN countries', () => {
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    expect(IBAN_LENGTHS.has(name)).toBe(false);
    expect(IBAN_LENGTHS.get(name)).toBeUndefined();
    // As a typed IBAN the first two characters are the country: the underscores are not letters, the others are not in the release.
    expect(() => validateScheme('iban', name)).toThrow(CheckDigitError);
    expect(() => validateScheme('iban', name + '82WEST12345698765432')).toThrow(CheckDigitError);
    expect(() => computeScheme('iban', name + 'WEST12345698765432')).toThrow(CheckDigitError);
    // The same names as a scheme.
    expect(() => validateScheme(name, '0306406152')).toThrow(CheckDigitError);
    expect(() => computeScheme(name, '030640615')).toThrow(CheckDigitError);
    expect(SCHEMES.has(name as 'vin')).toBe(false);
  }
  expect(refusal(() => validateScheme('constructor', '1')).message).toContain('scheme');
});
