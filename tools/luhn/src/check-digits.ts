/**
 * Check digits for numbers other than card numbers: ISBN-10, ISBN-13, EAN-8, EAN-13, UPC-A, IBAN, VIN and ISIN. The Luhn
 * check stays in index.ts untouched; the schemes here are separate and have their own reader, because they accept letters
 * (an ISBN-10 ends in X; a VIN, an ISIN and an IBAN hold letters).
 *
 * An error never repeats what was typed: it says which character, counted in the text as typed, and what is wrong with it.
 * A valid check digit shows only that a number is well formed; the notes say that it does not show that the book, product,
 * account, vehicle or security exists.
 *
 * Sources: the ISBN Users' Manual (2012), Appendix 1, for the ISBN-13 and ISBN-10 rules; the GS1 rule for EAN-8, EAN-13 and
 * UPC-A (the same weights as ISBN-13); ISO 13616 and ISO 7064 MOD 97-10 for the IBAN (lengths in iban-registry.ts); 49 CFR
 * 565.15 for the VIN transliteration and weights; ISO 6166 for the ISIN, whose check digit is the Luhn step applied to the
 * digits that the letters expand to. python-stdnum 2.2 is the second opinion (test/fixtures/README.md).
 */
import { IBAN_LENGTHS, IBAN_REGISTRY_RELEASE } from './iban-registry';

/** A number the page cannot read or whose length is wrong. `position` is the zero based index into the typed text. */
export class CheckDigitError extends Error {
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'CheckDigitError';
    this.position = position;
  }
}

export type Scheme = 'isbn10' | 'isbn13' | 'ean8' | 'ean13' | 'upca' | 'iban' | 'vin' | 'isin';

export interface SchemeInfo {
  label: string;
  /** The length of a whole number of this scheme; an IBAN has the length its country has in the registry. */
  length: number | 'registry';
  /** The length of what is typed to compute a check digit (a VIN may also carry any character at position 9). */
  computeLength: number | 'registry';
}

export const SCHEMES: ReadonlyMap<Scheme, SchemeInfo> = new Map<Scheme, SchemeInfo>([
  ['isbn10', { label: 'ISBN-10', length: 10, computeLength: 9 }],
  ['isbn13', { label: 'ISBN-13', length: 13, computeLength: 12 }],
  ['ean8', { label: 'EAN-8', length: 8, computeLength: 7 }],
  ['ean13', { label: 'EAN-13', length: 13, computeLength: 12 }],
  ['upca', { label: 'UPC-A', length: 12, computeLength: 11 }],
  ['iban', { label: 'IBAN', length: 'registry', computeLength: 'registry' }],
  ['vin', { label: 'VIN', length: 17, computeLength: 16 }],
  ['isin', { label: 'ISIN', length: 12, computeLength: 11 }],
]);

/** No number checked here is longer than 34 characters (an IBAN); more than this is refused before anything is read. */
export const MAX_CHECK_INPUT_CHARS = 256;

export interface ValidateResult {
  valid: boolean;
  /** The number with spaces and hyphens removed and letters in upper case. */
  normalised: string;
  /** The check digit (or characters) the number carries. */
  checkDigit: string;
  /** The check digit (or characters) the number should carry. */
  expected?: string;
  details: [string, string][];
  notes: string[];
}

export interface ComputeResult {
  full: string;
  checkDigit: string;
  details: [string, string][];
  notes: string[];
}

interface Normalised {
  /** The kept characters: separators removed, ASCII letters in upper case. */
  chars: string;
  /** For each kept character, its index in the typed text. */
  at: number[];
}

/**
 * Removes spaces and hyphens and upper-cases ASCII letters. Leading and trailing white space of any kind is dropped.
 * Positions stay indexes into the text as typed, so a page can point at the character.
 */
function normalise(text: string): Normalised {
  if (text.length > MAX_CHECK_INPUT_CHARS) {
    throw new CheckDigitError(
      `This input is ${text.length} characters. The limit is ${MAX_CHECK_INPUT_CHARS}, because every number checked here is at most 34 characters long.`,
    );
  }
  let start = 0;
  let end = text.length;
  while (start < end && /\s/.test(text[start]!)) start++;
  while (end > start && /\s/.test(text[end - 1]!)) end--;
  let chars = '';
  const at: number[] = [];
  for (let i = start; i < end; i++) {
    const ch = text[i]!;
    if (ch === ' ' || ch === '-') continue;
    chars += ch >= 'a' && ch <= 'z' ? String.fromCharCode(ch.charCodeAt(0) - 32) : ch;
    at.push(i);
  }
  return { chars, at };
}

const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';
const isLetter = (ch: string): boolean => ch >= 'A' && ch <= 'Z';
const isLetterOrDigit = (ch: string): boolean => isLetter(ch) || isDigit(ch);

const NOT_A_DIGIT = 'is not a digit';
const NOT_A_LETTER = 'is not a letter';
const NOT_A_LETTER_OR_DIGIT = 'is not a letter or a digit';

/** Refuses the first character in chars[from, to) that fails `ok`, naming where it stands and never what it is. */
function requireEach(n: Normalised, from: number, to: number, ok: (ch: string) => boolean, rule: string): void {
  for (let k = from; k < to; k++) {
    if (!ok(n.chars[k]!)) {
      throw new CheckDigitError(`Character ${n.at[k]! + 1} ${rule}.`, n.at[k]!);
    }
  }
}

function article(label: string): string {
  return /^[AEIO]/.test(label) ? 'An' : 'A';
}

function requireLength(n: Normalised, want: number, label: string, unit: string): void {
  if (n.chars.length !== want) {
    throw new CheckDigitError(`${article(label)} ${label} has ${want} ${unit}. This has ${n.chars.length}.`);
  }
}

function requireStartLength(n: Normalised, want: number, label: string, unit: string): void {
  if (n.chars.length !== want) {
    throw new CheckDigitError(
      `The start of ${article(label).toLowerCase()} ${label}, without its check digit, has ${want} ${unit}. This has ${n.chars.length}.`,
    );
  }
}

/**
 * The check digit of the GS1 family (ISBN-13, EAN-13, EAN-8, UPC-A): the digits before it are multiplied by 3 and 1 in turn
 * starting from the digit next to the check digit, and the check digit is what brings the sum to a multiple of ten.
 */
function gs1Digit(body: string): string {
  let sum = 0;
  for (let i = body.length - 1, weight = 3; i >= 0; i--, weight = 4 - weight) {
    sum += (body.charCodeAt(i) - 48) * weight;
  }
  return String((10 - (sum % 10)) % 10);
}

/** The ISBN-10 check character: weights 10 down to 2 over nine digits, the sum plus the check value divides by 11; 10 is X. */
function isbn10Digit(body: string): string {
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (10 - i) * (body.charCodeAt(i) - 48);
  const value = (11 - (sum % 11)) % 11;
  return value === 10 ? 'X' : String(value);
}

/**
 * The remainder by 97 of the digits an IBAN-style text stands for, letters being 10 to 35 (ISO 7064 MOD 97-10). The digits
 * are carried over in chunks of at most nine, each step a whole number far below 2 to the 53, so the remainder is exact for
 * any length with no BigInt and no rounding.
 */
export function mod97(text: string): number {
  let digits = '';
  for (const ch of text) {
    if (isDigit(ch)) digits += ch;
    else if (isLetter(ch)) digits += String(ch.charCodeAt(0) - 55);
    else throw new RangeError('mod97 reads only the letters A to Z and the digits 0 to 9.');
  }
  let remainder = 0;
  for (let i = 0; i < digits.length; i += 9) {
    const chunk = digits.slice(i, i + 9);
    remainder = (remainder * 10 ** chunk.length + Number(chunk)) % 97;
  }
  return remainder;
}

/** The two IBAN check digits for a country code and account part: 98 minus the remainder with 00 in their place. */
function ibanCheckDigits(country: string, account: string): string {
  return String(98 - mod97(account + country + '00')).padStart(2, '0');
}

// 49 CFR 565.15 (c): Table III gives each letter a value (I, O and Q are not used) and Table IV the weight of each position.
const VIN_VALUES: ReadonlyMap<string, number> = new Map<string, number>([
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
]);
const VIN_WEIGHTS: readonly number[] = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/** The check character of 17 VIN characters (whatever stands at position 9 has weight 0): the sum modulo 11, 10 being X. */
function vinCheck(vin17: string): string {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = vin17[i]!;
    const value = isDigit(ch) ? ch.charCodeAt(0) - 48 : (VIN_VALUES.get(ch) ?? 0);
    sum += value * VIN_WEIGHTS[i]!;
  }
  const remainder = sum % 11;
  return remainder === 10 ? 'X' : String(remainder);
}

/** A VIN character must be a letter other than I, O and Q, or a digit; the first one that is not is refused by place. */
function requireVinCharacter(n: Normalised, k: number): void {
  const ch = n.chars[k]!;
  if (ch === 'I' || ch === 'O' || ch === 'Q') {
    throw new CheckDigitError(
      `Character ${n.at[k]! + 1} is one of the letters I, O and Q, which a VIN never uses.`,
      n.at[k]!,
    );
  }
  requireEach(n, k, k + 1, isLetterOrDigit, NOT_A_LETTER_OR_DIGIT);
}

/** ISO 6166: the letters become 10 to 35, then the Luhn step is applied to the digit string, the check digit being last. */
function isinCheck(body11: string): string {
  let digits = '';
  for (const ch of body11) digits += isLetter(ch) ? String(ch.charCodeAt(0) - 55) : ch;
  let sum = 0;
  let double = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return String((10 - (sum % 10)) % 10);
}

function schemeOf(scheme: string): Scheme {
  if (!SCHEMES.has(scheme as Scheme)) throw new CheckDigitError('This scheme is not one of the schemes offered.');
  return scheme as Scheme;
}

/** The sentence that keeps a valid result from being read as more than it is (P14-04). */
function existenceNote(label: string, claim: string): string {
  return `A valid ${label} has the right form and check digit; it does not show that ${claim}.`;
}

const VIN_NORTH_AMERICA_NOTE =
  'Position 9 is a check digit only for vehicles made for North America; elsewhere it may be any character.';

function printFormat(iban: string): string {
  return iban.replace(/(.{4})(?=.)/g, '$1 ');
}

/** The IBAN country and its registry length, refusing a code the registry release does not list. */
function ibanCountry(n: Normalised): { country: string; length: number } {
  requireEach(n, 0, 2, isLetter, NOT_A_LETTER);
  const country = n.chars.slice(0, 2);
  const length = IBAN_LENGTHS.get(country);
  if (length === undefined) {
    throw new CheckDigitError(
      `The country code is not in the IBAN registry release this page uses (${IBAN_REGISTRY_RELEASE}).`,
      n.at[0],
    );
  }
  return { country, length };
}

export function validateScheme(scheme: string, text: string): ValidateResult {
  const id = schemeOf(scheme);
  const n = normalise(text);
  const label = SCHEMES.get(id)!.label;
  const chars = n.chars;
  switch (id) {
    case 'isbn13':
    case 'ean13':
    case 'ean8':
    case 'upca': {
      const length = SCHEMES.get(id)!.length as number;
      requireLength(n, length, label, 'digits');
      requireEach(n, 0, length, isDigit, NOT_A_DIGIT);
      const checkDigit = chars[length - 1]!;
      const expected = gs1Digit(chars.slice(0, length - 1));
      const details: [string, string][] = [
        ['Scheme', label],
        ['Length', `${length} digits`],
        ['Check digit', checkDigit],
      ];
      const notes: string[] = [];
      if (id === 'isbn13') {
        const nine = chars.slice(3, 12);
        if (chars.startsWith('978')) details.push(['ISBN-10 form', nine + isbn10Digit(nine)]);
        else notes.push('An ISBN-13 that begins 979 has no ISBN-10 form.');
        notes.push(existenceNote(label, 'a book with this number was published'));
      } else if (id === 'ean13') {
        if (chars.startsWith('978') || chars.startsWith('979')) notes.push('This EAN-13 is also an ISBN-13.');
        notes.push(existenceNote(label, 'a product with this number exists'));
      } else {
        if (id === 'upca') details.push(['EAN-13 form', '0' + chars]);
        notes.push(existenceNote(label, 'a product with this number exists'));
      }
      return { valid: checkDigit === expected, normalised: chars, checkDigit, expected, details, notes };
    }
    case 'isbn10': {
      requireLength(n, 10, label, 'characters');
      requireEach(n, 0, 9, isDigit, NOT_A_DIGIT);
      requireEach(n, 9, 10, (ch) => isDigit(ch) || ch === 'X', 'is not a digit or X');
      const checkDigit = chars[9]!;
      const expected = isbn10Digit(chars.slice(0, 9));
      return {
        valid: checkDigit === expected,
        normalised: chars,
        checkDigit,
        expected,
        details: [
          ['Scheme', label],
          ['Length', '10 characters'],
          ['Check digit', checkDigit],
          ['ISBN-13 form', '978' + chars.slice(0, 9) + gs1Digit('978' + chars.slice(0, 9))],
        ],
        notes: [existenceNote(label, 'a book with this number was published')],
      };
    }
    case 'iban': {
      requireEach(n, 0, chars.length, isLetterOrDigit, NOT_A_LETTER_OR_DIGIT);
      if (chars.length < 4) {
        throw new CheckDigitError('An IBAN starts with a two letter country code and two check digits.');
      }
      const { length } = ibanCountry(n);
      requireEach(n, 2, 4, isDigit, NOT_A_DIGIT);
      if (chars.length !== length) {
        throw new CheckDigitError(`An IBAN from this country has ${length} characters. This has ${chars.length}.`);
      }
      const checkDigit = chars.slice(2, 4);
      const expected = ibanCheckDigits(chars.slice(0, 2), chars.slice(4));
      return {
        valid: mod97(chars.slice(4) + chars.slice(0, 4)) === 1,
        normalised: chars,
        checkDigit,
        expected,
        details: [
          ['Scheme', label],
          ['Country code', chars.slice(0, 2)],
          ['Length', `${length} characters`],
          ['Check digits', checkDigit],
          ['Print format', printFormat(chars)],
          ['Registry release', IBAN_REGISTRY_RELEASE],
        ],
        notes: ['A valid IBAN only has the right form and check digits; it does not show that the account exists.'],
      };
    }
    case 'vin': {
      requireLength(n, 17, label, 'characters');
      for (let k = 0; k < 17; k++) requireVinCharacter(n, k);
      const checkDigit = chars[8]!;
      const expected = vinCheck(chars);
      return {
        valid: checkDigit === expected,
        normalised: chars,
        checkDigit,
        expected,
        details: [
          ['Scheme', label],
          ['Length', '17 characters'],
          ['Check character (position 9)', checkDigit],
        ],
        notes: [VIN_NORTH_AMERICA_NOTE, 'A valid VIN check character does not show that the vehicle exists.'],
      };
    }
    case 'isin': {
      requireLength(n, 12, label, 'characters');
      requireEach(n, 0, 2, isLetter, NOT_A_LETTER);
      requireEach(n, 2, 11, isLetterOrDigit, NOT_A_LETTER_OR_DIGIT);
      requireEach(n, 11, 12, isDigit, NOT_A_DIGIT);
      const checkDigit = chars[11]!;
      const expected = isinCheck(chars.slice(0, 11));
      return {
        valid: checkDigit === expected,
        normalised: chars,
        checkDigit,
        expected,
        details: [
          ['Scheme', label],
          ['Length', '12 characters'],
          ['Check digit', checkDigit],
        ],
        notes: [existenceNote(label, 'the security exists')],
      };
    }
  }
}

export function computeScheme(scheme: string, text: string): ComputeResult {
  const id = schemeOf(scheme);
  const n = normalise(text);
  const label = SCHEMES.get(id)!.label;
  const chars = n.chars;
  switch (id) {
    case 'isbn13':
    case 'ean13':
    case 'ean8':
    case 'upca': {
      const length = SCHEMES.get(id)!.computeLength as number;
      requireStartLength(n, length, label, 'digits');
      requireEach(n, 0, length, isDigit, NOT_A_DIGIT);
      const checkDigit = gs1Digit(chars);
      const full = chars + checkDigit;
      const details: [string, string][] = [
        ['Scheme', label],
        ['Digits typed', String(length)],
      ];
      if (id === 'upca') details.push(['EAN-13 form', '0' + full]);
      return { full, checkDigit, details, notes: [] };
    }
    case 'isbn10': {
      requireStartLength(n, 9, label, 'digits');
      requireEach(n, 0, 9, isDigit, NOT_A_DIGIT);
      const checkDigit = isbn10Digit(chars);
      return {
        full: chars + checkDigit,
        checkDigit,
        details: [
          ['Scheme', label],
          ['Digits typed', '9'],
          ['ISBN-13 form', '978' + chars + gs1Digit('978' + chars)],
        ],
        notes: [],
      };
    }
    case 'iban': {
      requireEach(n, 0, chars.length, isLetterOrDigit, NOT_A_LETTER_OR_DIGIT);
      if (chars.length < 2) {
        throw new CheckDigitError(
          'Start with the two letter country code, then the account part without its check digits.',
        );
      }
      const { country, length } = ibanCountry(n);
      if (chars.length !== length - 2) {
        throw new CheckDigitError(
          `The start of an IBAN from this country, the country code and the account part without the check digits, has ${length - 2} characters. This has ${chars.length}.`,
        );
      }
      const account = chars.slice(2);
      const checkDigit = ibanCheckDigits(country, account);
      const full = country + checkDigit + account;
      return {
        full,
        checkDigit,
        details: [
          ['Scheme', label],
          ['Country code', country],
          ['Length', `${length} characters`],
          ['Print format', printFormat(full)],
          ['Registry release', IBAN_REGISTRY_RELEASE],
        ],
        notes: ['A computed IBAN only has the right form and check digits; it does not show that the account exists.'],
      };
    }
    case 'vin': {
      // 16 characters leave position 9 out; 17 may hold any character there, which is ignored and replaced.
      if (chars.length !== 16 && chars.length !== 17) {
        throw new CheckDigitError(
          `The start of a VIN, without its check character, has 16 characters, or 17 with any character at position 9. This has ${chars.length}.`,
        );
      }
      for (let k = 0; k < chars.length; k++) {
        if (chars.length === 17 && k === 8) continue;
        requireVinCharacter(n, k);
      }
      const sixteen = chars.length === 17 ? chars.slice(0, 8) + chars.slice(9) : chars;
      const checkDigit = vinCheck(sixteen.slice(0, 8) + '0' + sixteen.slice(8));
      return {
        full: sixteen.slice(0, 8) + checkDigit + sixteen.slice(8),
        checkDigit,
        details: [
          ['Scheme', label],
          ['Characters typed', String(chars.length)],
        ],
        notes: [VIN_NORTH_AMERICA_NOTE],
      };
    }
    case 'isin': {
      requireStartLength(n, 11, label, 'characters');
      requireEach(n, 0, 2, isLetter, NOT_A_LETTER);
      requireEach(n, 2, 11, isLetterOrDigit, NOT_A_LETTER_OR_DIGIT);
      const checkDigit = isinCheck(chars);
      return {
        full: chars + checkDigit,
        checkDigit,
        details: [
          ['Scheme', label],
          ['Characters typed', '11'],
        ],
        notes: [],
      };
    }
  }
}
