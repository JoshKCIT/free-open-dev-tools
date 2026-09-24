import meta from './meta.json';

export { meta };

export class NumberToWordsError extends Error {
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'NumberToWordsError';
    this.position = position;
  }
}

export type WordStyle = 'cardinal' | 'ordinal' | 'currency';

/** Ascending short-scale group names. The data itself is the bound: the
 * largest value this tool spells is 999 followed by every name here, in
 * descending order, one more time than there are names -- see
 * `spellInteger` below. */
export const SCALES: string[] = [
  'thousand',
  'million',
  'billion',
  'trillion',
  'quadrillion',
  'quintillion',
  'sextillion',
  'septillion',
  'octillion',
  'nonillion',
  'decillion',
];

export interface WordsOptions {
  style?: WordStyle;
  /** Whether to say "and" before the final small group below one hundred. Default true. */
  connective?: boolean;
  majorUnit?: string;
  minorUnit?: string;
  /** Digits after the point for currency mode. Default 2. */
  minorScale?: number;
}

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** Irregular ordinal forms. Everything else just appends "th" -- fourth,
 * sixth, seventh, tenth, eleventh, thirteenth and so on already work that
 * way, and so do the scale names (thousandth, millionth, ...). */
const ORDINAL_IRREGULAR: Record<string, string> = {
  zero: 'zeroth',
  one: 'first',
  two: 'second',
  three: 'third',
  five: 'fifth',
  eight: 'eighth',
  nine: 'ninth',
  twelve: 'twelfth',
  twenty: 'twentieth',
  thirty: 'thirtieth',
  forty: 'fortieth',
  fifty: 'fiftieth',
  sixty: 'sixtieth',
  seventy: 'seventieth',
  eighty: 'eightieth',
  ninety: 'ninetieth',
  hundred: 'hundredth',
};

/** A pure digit string (0-9 only) to a plain integer, via character codes.
 * Never Number(), parseInt() or parseFloat() -- see the note on
 * `parseDecimal` below for why. */
function digitsToInt(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) n = n * 10 + (s.charCodeAt(i) - 48);
  return n;
}

function stripLeadingZeros(s: string): string {
  let i = 0;
  while (i < s.length - 1 && s[i] === '0') i++;
  return s.slice(i);
}

function isZeroDigits(s: string): boolean {
  return stripLeadingZeros(s === '' ? '0' : s) === '0';
}

function isOneDigits(s: string): boolean {
  return stripLeadingZeros(s === '' ? '0' : s) === '1';
}

interface ParsedDecimal {
  sign: 1 | -1;
  digitsBefore: string;
  digitsAfter: string;
  /**
   * The same value carried as a scaled exact decimal: `unscaled` is every
   * significant digit with no point, as a BigInt, and `scale` is how many
   * of them sit after the point (value = sign * unscaled / 10^scale).
   * `digitsBefore`/`digitsAfter` above are the same information split at
   * the point, which is the more convenient shape for currency's major/
   * minor split; `unscaled` is what makes a value beyond
   * Number.MAX_SAFE_INTEGER exact end to end rather than passing through a
   * JavaScript number anywhere on the way in.
   */
  unscaled: bigint;
  scale: number;
  separatorStripped: boolean;
}

/**
 * Parses a decimal string straight into a sign, the digits before the
 * point and the digits after it, with no intermediate JavaScript number
 * anywhere. This is what lets a value beyond Number.MAX_SAFE_INTEGER, or a
 * currency amount with an exact fractional part, spell correctly --
 * BigInt(+input), BigInt(Number(input)), parseInt and parseFloat would all
 * round-trip the value through a lossy floating-point number first.
 * BigInt(digitString) on a pure digit string, by contrast, is exact.
 */
function parseDecimal(input: string): ParsedDecimal {
  const trimmed = input.trim();
  if (trimmed === '') throw new NumberToWordsError('Nothing to convert.');

  let sign: 1 | -1 = 1;
  let idx = 0;
  if (trimmed[0] === '-' || trimmed[0] === '+') {
    if (trimmed[0] === '-') sign = -1;
    idx = 1;
  }

  let digitsBefore = '';
  let digitsAfter = '';
  let seenPoint = false;
  let separatorStripped = false;

  for (; idx < trimmed.length; idx++) {
    const ch = trimmed[idx]!;
    if (ch >= '0' && ch <= '9') {
      if (seenPoint) digitsAfter += ch;
      else digitsBefore += ch;
      continue;
    }
    if (ch === '.') {
      if (seenPoint) throw new NumberToWordsError('A number cannot have two decimal points.', idx);
      seenPoint = true;
      continue;
    }
    if (ch === '_' || ch === ',' || ch === ' ' || ch === "'") {
      separatorStripped = true;
      continue;
    }
    throw new NumberToWordsError(`"${ch}" is not a digit, a decimal point, or a recognised separator.`, idx);
  }

  if (digitsBefore === '' && digitsAfter === '') {
    throw new NumberToWordsError('There are no digits to spell.');
  }

  const combined = digitsBefore + digitsAfter;
  const unscaled = BigInt(combined === '' ? '0' : combined);

  return { sign, digitsBefore, digitsAfter, unscaled, scale: digitsAfter.length, separatorStripped };
}

/** Spells a value from 0 to 999. */
function spellGroup(n: number, connective: boolean): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) parts.push(`${ONES[hundreds]} hundred`);
  if (rest > 0) {
    if (hundreds > 0 && connective) parts.push('and');
    if (rest < 20) {
      parts.push(ONES[rest]!);
    } else {
      const tens = Math.floor(rest / 10);
      const ones = rest % 10;
      parts.push(ones > 0 ? `${TENS[tens]}-${ONES[ones]}` : TENS[tens]!);
    }
  }
  return parts.join(' ');
}

/**
 * Spells a non-negative integer given as a pure digit string. Splits into
 * groups of three from the right, skipping a zero group entirely rather
 * than emitting an empty phrase, which is what makes a middle zero group
 * (as in 1,000,001) correct by construction rather than by a special case.
 */
function spellInteger(digits: string, connective: boolean): string {
  const stripped = stripLeadingZeros(digits === '' ? '0' : digits);
  if (stripped === '0') return 'zero';

  const padLength = Math.ceil(stripped.length / 3) * 3;
  const padded = stripped.padStart(padLength, '0');
  const groupCount = padLength / 3;
  const groups: string[] = [];

  for (let g = 0; g < groupCount; g++) {
    const chunk = padded.slice(g * 3, g * 3 + 3);
    const chunkValue = digitsToInt(chunk);
    if (chunkValue === 0) continue;
    const unitsFromEnd = groupCount - 1 - g;
    const groupWords = spellGroup(chunkValue, connective);
    if (unitsFromEnd === 0) {
      groups.push(groupWords);
      continue;
    }
    const scaleIndex = unitsFromEnd - 1;
    if (scaleIndex >= SCALES.length) {
      throw new NumberToWordsError(`This value is above the largest supported scale, ${SCALES[SCALES.length - 1]}.`);
    }
    groups.push(`${groupWords} ${SCALES[scaleIndex]}`);
  }

  return groups.join(', ');
}

/** Converts only the final word of a spelled-out phrase to its ordinal form. */
function toOrdinalPhrase(words: string): string {
  const lastSpace = words.lastIndexOf(' ');
  const lastWord = lastSpace === -1 ? words : words.slice(lastSpace + 1);
  const prefix = lastSpace === -1 ? '' : words.slice(0, lastSpace + 1);

  const hyphenIndex = lastWord.lastIndexOf('-');
  const base = hyphenIndex === -1 ? '' : lastWord.slice(0, hyphenIndex + 1);
  const tail = hyphenIndex === -1 ? lastWord : lastWord.slice(hyphenIndex + 1);
  const ordinalTail = ORDINAL_IRREGULAR[tail] ?? `${tail}th`;

  return prefix + base + ordinalTail;
}

export function toWords(input: string, options: WordsOptions = {}): string {
  const style = options.style ?? 'cardinal';
  const connective = options.connective ?? true;
  const parsed = parseDecimal(input);

  if (style === 'currency') {
    const minorScale = options.minorScale ?? 2;
    if (!Number.isInteger(minorScale) || minorScale < 0) {
      throw new NumberToWordsError('The currency scale must be a non-negative whole integer.');
    }
    if (parsed.digitsAfter.length > minorScale) {
      throw new NumberToWordsError(
        `Only ${minorScale} digit${minorScale === 1 ? '' : 's'} after the point are allowed at this scale; ${parsed.digitsAfter.length} were supplied.`,
      );
    }
    const majorDigits = parsed.digitsBefore === '' ? '0' : parsed.digitsBefore;
    const minorDigits = minorScale === 0 ? '' : parsed.digitsAfter.padEnd(minorScale, '0');

    const majorWords = spellInteger(majorDigits, connective);
    const minorWords = minorScale === 0 ? '' : spellInteger(minorDigits === '' ? '0' : minorDigits, connective);

    const majorName = options.majorUnit ?? 'dollar';
    const minorName = options.minorUnit ?? 'cent';
    const majorUnit = majorName + (isOneDigits(majorDigits) ? '' : 's');
    const minorUnit = minorName + (isOneDigits(minorDigits === '' ? '0' : minorDigits) ? '' : 's');

    const isZeroTotal = isZeroDigits(majorDigits) && isZeroDigits(minorDigits === '' ? '0' : minorDigits);
    const sign = parsed.sign === -1 && !isZeroTotal ? 'negative ' : '';

    if (minorScale === 0) return `${sign}${majorWords} ${majorUnit}`;
    return `${sign}${majorWords} ${majorUnit} and ${minorWords} ${minorUnit}`;
  }

  if (parsed.digitsAfter !== '' && !isZeroDigits(parsed.digitsAfter)) {
    throw new NumberToWordsError(
      'Cardinal and ordinal styles expect a whole number; this input has a decimal point with a non-zero fractional part.',
    );
  }

  // The unscaled BigInt (sign carried separately, so always non-negative
  // here), printed back to a digit string, is the exact value with no
  // point and no lossy conversion -- this is the path that keeps a value
  // beyond Number.MAX_SAFE_INTEGER intact end to end.
  const digits = parsed.unscaled.toString();
  let words = spellInteger(digits, connective);
  if (style === 'ordinal') words = toOrdinalPhrase(words);

  const isZero = isZeroDigits(digits);
  return parsed.sign === -1 && !isZero ? `negative ${words}` : words;
}
