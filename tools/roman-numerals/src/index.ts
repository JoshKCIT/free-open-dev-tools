import meta from './meta.json';

export { meta };

export class RomanNumeralError extends Error {
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'RomanNumeralError';
    this.position = position;
  }
}

export interface RomanSymbol {
  symbol: string;
  value: number;
}

/**
 * Descending order, subtractive pairs interleaved with the single symbols
 * they belong next to. The ordinary greedy walk over this table produces
 * subtractive forms without any special case, because CM/XC/etc. sit above
 * the single symbols they would otherwise combine into.
 */
export const ROMAN_SYMBOLS: RomanSymbol[] = [
  { symbol: 'M', value: 1000 },
  { symbol: 'CM', value: 900 },
  { symbol: 'D', value: 500 },
  { symbol: 'CD', value: 400 },
  { symbol: 'C', value: 100 },
  { symbol: 'XC', value: 90 },
  { symbol: 'L', value: 50 },
  { symbol: 'XL', value: 40 },
  { symbol: 'X', value: 10 },
  { symbol: 'IX', value: 9 },
  { symbol: 'V', value: 5 },
  { symbol: 'IV', value: 4 },
  { symbol: 'I', value: 1 },
];

const SYMBOL_VALUES: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

/** Standard notation permits exactly these six ascending pairs. */
const PERMITTED_PAIRS = new Set(['IV', 'IX', 'XL', 'XC', 'CD', 'CM']);

/** Standard notation never repeats these three symbols. */
const NO_REPEAT_SYMBOLS = new Set(['V', 'L', 'D']);

const MIN_VALUE = 1;
const MAX_VALUE = 3999;

export function toRoman(value: number): string {
  if (!Number.isInteger(value) || value < MIN_VALUE || value > MAX_VALUE) {
    throw new RomanNumeralError(`Roman numerals here only cover the valid range, 1 to 3999. Got ${value}.`);
  }
  let remaining = value;
  let out = '';
  for (const { symbol, value: symbolValue } of ROMAN_SYMBOLS) {
    while (remaining >= symbolValue) {
      out += symbol;
      remaining -= symbolValue;
    }
  }
  return out;
}

/**
 * The classic left-to-right subtractive summation: add a symbol's value
 * unless the symbol immediately to its right is worth more, in which case
 * subtract it instead. This is the same arithmetic a permitted subtractive
 * pair produces, so no special two-symbol consumption step is needed -- it
 * also computes a sensible "intended value" for a numeral that breaks a
 * local rule, which is what the error messages below quote.
 */
function naiveValue(values: number[]): number {
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    const current = values[i]!;
    const next = values[i + 1];
    total += next !== undefined && current < next ? -current : current;
  }
  return total;
}

/** " The standard form for N is X." when N is in range, else nothing. */
function canonicalHint(naive: number): string {
  if (naive < MIN_VALUE || naive > MAX_VALUE) return '';
  return ` The standard form for ${naive} is ${toRoman(naive)}.`;
}

/** A fast reject with a useful, specific position for a symbol nobody wrote. */
function validateCharacters(upper: string): void {
  for (let i = 0; i < upper.length; i++) {
    if (!(upper[i]! in SYMBOL_VALUES)) {
      throw new RomanNumeralError(
        `"${upper[i]}" is not a Roman numeral symbol. Only I, V, X, L, C, D and M are valid.`,
        i,
      );
    }
  }
}

/**
 * The local well-formedness rules: at most three of the same symbol in a
 * row, V/L/D never repeat, an ascending pair must be one of the six
 * permitted ones, and no permitted pair may appear twice. Each is a fast
 * reject with a useful position -- but, as the comment on `fromRoman` below
 * explains, these rules alone are not a complete description of canonical
 * notation.
 */
function validateLocalRules(chars: string[], values: number[]): void {
  let consecutiveCount = 1;
  const seenNoRepeat = new Set<string>();
  const usedPairs = new Set<string>();

  for (let i = 0; i < chars.length; i++) {
    const cur = chars[i]!;
    const curVal = values[i]!;

    consecutiveCount = i > 0 && chars[i - 1] === cur ? consecutiveCount + 1 : 1;
    if (consecutiveCount > 3) {
      throw new RomanNumeralError(
        `${cur} cannot appear more than three times in a row in standard notation.${canonicalHint(naiveValue(values))}`,
        i,
      );
    }

    if (NO_REPEAT_SYMBOLS.has(cur)) {
      if (seenNoRepeat.has(cur)) {
        throw new RomanNumeralError(
          `${cur} does not repeat in standard notation.${canonicalHint(naiveValue(values))}`,
          i,
        );
      }
      seenNoRepeat.add(cur);
    }

    const nextVal = values[i + 1];
    if (nextVal !== undefined && curVal < nextVal) {
      const pairKey = cur + chars[i + 1];
      if (!PERMITTED_PAIRS.has(pairKey)) {
        throw new RomanNumeralError(
          `${pairKey} is not one of the six standard subtractive pairs.${canonicalHint(naiveValue(values))}`,
          i,
        );
      }
      if (usedPairs.has(pairKey)) {
        throw new RomanNumeralError(
          `The subtractive pair ${pairKey} appears more than once, which standard notation does not allow.${canonicalHint(naiveValue(values))}`,
          i,
        );
      }
      usedPairs.add(pairKey);
    }
  }
}

/**
 * Local rules alone accept spellings like IXI (nine plus one, totalling
 * ten) that nobody would actually write -- see the re-encoding comparison
 * below, which is what actually is complete.
 */
export function fromRoman(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') throw new RomanNumeralError('Nothing to convert.');
  const upper = trimmed.toUpperCase();

  validateCharacters(upper);
  const chars = upper.split('');
  const values = chars.map((c) => SYMBOL_VALUES[c]!);
  validateLocalRules(chars, values);

  const value = naiveValue(values);
  if (value < MIN_VALUE || value > MAX_VALUE) {
    throw new RomanNumeralError('Roman numerals here only cover the valid range, 1 to 3999.');
  }

  // The check that makes this airtight: re-encode the parsed value and
  // require an exact match against the input.
  const canonical = toRoman(value);
  if (canonical !== upper) {
    throw new RomanNumeralError(
      `${upper} is not the canonical spelling of ${value}. Standard notation writes ${value} as ${canonical}.`,
    );
  }

  return value;
}
