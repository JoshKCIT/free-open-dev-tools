/**
 * Check digits for numbers other than card numbers. The Luhn check stays in index.ts untouched; the schemes here are
 * separate and have their own reader, because they accept letters (an ISBN-10 ends in X, a VIN and an IBAN hold letters).
 *
 * An error never repeats what was typed: it says which character, counted in the text as typed, and what is wrong with it.
 */

/** A number the page cannot read or whose length is wrong. `position` is the zero based index into the typed text. */
export class CheckDigitError extends Error {
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'CheckDigitError';
    this.position = position;
  }
}

export type Scheme = 'isbn13';

export interface SchemeInfo {
  label: string;
  /** The length of a whole number of this scheme. */
  length: number | 'registry';
  /** The length of what is typed to compute a check digit. */
  computeLength: number | 'registry';
}

export const SCHEMES: ReadonlyMap<Scheme, SchemeInfo> = new Map<Scheme, SchemeInfo>([
  ['isbn13', { label: 'ISBN-13', length: 13, computeLength: 12 }],
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

/** Refuses the first character in chars[from, to) that fails `ok`, naming where it stands and never what it is. */
function requireEach(n: Normalised, from: number, to: number, ok: (ch: string) => boolean, rule: string): void {
  for (let k = from; k < to; k++) {
    if (!ok(n.chars[k]!)) {
      throw new CheckDigitError(`Character ${n.at[k]! + 1} ${rule}.`, n.at[k]!);
    }
  }
}

function requireLength(n: Normalised, want: number, what: string, unit = 'digits'): void {
  if (n.chars.length !== want) {
    throw new CheckDigitError(`${what} has ${want} ${unit}. This has ${n.chars.length}.`);
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

const NOT_A_DIGIT = 'is not a digit';

function schemeOf(scheme: string): Scheme {
  if (!SCHEMES.has(scheme as Scheme)) throw new CheckDigitError('This scheme is not one of the schemes offered.');
  return scheme as Scheme;
}

export function validateScheme(scheme: string, text: string): ValidateResult {
  const id = schemeOf(scheme);
  const n = normalise(text);
  const label = SCHEMES.get(id)!.label;
  // id is always 'isbn13' in this version; the other schemes are added beside it.
  requireLength(n, 13, `An ${label}`);
  requireEach(n, 0, 13, isDigit, NOT_A_DIGIT);
  const checkDigit = n.chars[12]!;
  const expected = gs1Digit(n.chars.slice(0, 12));
  return {
    valid: checkDigit === expected,
    normalised: n.chars,
    checkDigit,
    expected,
    details: [
      ['Scheme', label],
      ['Length', '13 digits'],
      ['Check digit', checkDigit],
    ],
    notes: [
      'A valid ISBN-13 has the right form and check digit; it does not show that a book with this number was published.',
    ],
  };
}

export function computeScheme(scheme: string, text: string): ComputeResult {
  const id = schemeOf(scheme);
  const n = normalise(text);
  const label = SCHEMES.get(id)!.label;
  requireLength(n, 12, `The start of an ${label}, before its check digit,`);
  requireEach(n, 0, 12, isDigit, NOT_A_DIGIT);
  const checkDigit = gs1Digit(n.chars);
  return {
    full: n.chars + checkDigit,
    checkDigit,
    details: [
      ['Scheme', label],
      ['Digits typed', '12'],
    ],
    notes: [],
  };
}
