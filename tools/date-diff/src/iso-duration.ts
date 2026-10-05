/**
 * ISO 8601 durations: read and write `PnYnMnWnDTnHnMnS`, with the digits kept as text.
 *
 * Every part is exact decimal text, never a floating point number, so no digit is rounded: the value is shown with its
 * leading and trailing zeros dropped and a dot for a comma (`P007Y` is `P7Y`, `P0,5D` is `P0.5D`). Weeks may be combined
 * with other parts, and the smallest part present may carry a decimal fraction written with a dot or a comma. A sign is
 * not accepted. Years, months, weeks and days are calendar units whose length depends on the date they start from, so
 * nothing here turns them into an exact number of seconds; only the time part (hours, minutes, seconds) has an exact
 * total. This is separate from the older `parseDuration`, which keeps its own stricter grammar.
 */

/** A problem with a duration. The messages are fixed sentences and never repeat the text that was read. */
export class IsoDurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IsoDurationError';
  }
}

/** The seven parts as decimal text: digits, and a dot with fraction digits when there is a fraction. `'0'` when absent. */
export interface IsoDuration {
  years: string;
  months: string;
  weeks: string;
  days: string;
  hours: string;
  minutes: string;
  seconds: string;
}

export const MAX_DURATION_LENGTH = 256;
export const MAX_INTEGER_DIGITS = 15;
export const MAX_FRACTION_DIGITS = 9;

const MESSAGE_TOO_LONG = `A duration is at most ${MAX_DURATION_LENGTH} characters.`;
const MESSAGE_SIGN = 'A sign is not accepted: an ISO 8601 duration here has no minus or plus sign.';
const MESSAGE_START = 'An ISO 8601 duration starts with P, such as P1Y2M3W4DT5H6M7.5S.';
const MESSAGE_EMPTY = 'A duration needs at least one part after the P, such as P1D or PT0S.';
const MESSAGE_FORMAT =
  'Each part is a number and its capital letter: Y, M, W and D, then T and H, M and S, in that order and each once.';
const MESSAGE_TIME_EMPTY = 'A T must be followed by at least one of hours (H), minutes (M) or seconds (S).';
const MESSAGE_FRACTION = 'Only the smallest part present can have a decimal fraction.';
const MESSAGE_DIGITS = `A part has at most ${MAX_INTEGER_DIGITS} digits before the decimal point and ${MAX_FRACTION_DIGITS} after it.`;

const KEYS = ['years', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds'] as const;
type Key = (typeof KEYS)[number];
const LETTERS: Record<Key, string> = {
  years: 'Y',
  months: 'M',
  weeks: 'W',
  days: 'D',
  hours: 'H',
  minutes: 'M',
  seconds: 'S',
};

interface Decimal {
  integer: string;
  fraction: string;
  end: number;
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

/** Reads digits, then an optional dot or comma with digits, from `at`. Returns null when no digit is there. */
function readDecimal(text: string, at: number): Decimal | null {
  let i = at;
  while (i < text.length && isDigit(text.charCodeAt(i))) i++;
  if (i === at) return null;
  const integer = text.slice(at, i);
  let fraction = '';
  if (i < text.length && (text.charAt(i) === '.' || text.charAt(i) === ',')) {
    const from = i + 1;
    let j = from;
    while (j < text.length && isDigit(text.charCodeAt(j))) j++;
    if (j === from) throw new IsoDurationError(MESSAGE_FORMAT);
    fraction = text.slice(from, j);
    i = j;
  }
  // The limit counts the digits of the value, so zeros written in front of it do not use it up.
  let zeros = 0;
  while (zeros < integer.length - 1 && integer.charCodeAt(zeros) === 48) zeros++;
  if (integer.length - zeros > MAX_INTEGER_DIGITS || fraction.length > MAX_FRACTION_DIGITS) {
    throw new IsoDurationError(MESSAGE_DIGITS);
  }
  return { integer, fraction, end: i };
}

/** Leading zeros of the whole part and trailing zeros of the fraction carry no value and are dropped. */
function decimalText(integer: string, fraction: string): string {
  let start = 0;
  while (start < integer.length - 1 && integer.charCodeAt(start) === 48) start++;
  let end = fraction.length;
  while (end > 0 && fraction.charCodeAt(end - 1) === 48) end--;
  const whole = integer.slice(start);
  return end > 0 ? `${whole}.${fraction.slice(0, end)}` : whole;
}

function emptyParts(): IsoDuration {
  return { years: '0', months: '0', weeks: '0', days: '0', hours: '0', minutes: '0', seconds: '0' };
}

/** Order of the designators: Y, M, W, D before the T; H, M, S after it. */
function keyFor(letter: string, inTime: boolean): Key | null {
  if (!inTime) {
    if (letter === 'Y') return 'years';
    if (letter === 'M') return 'months';
    if (letter === 'W') return 'weeks';
    if (letter === 'D') return 'days';
    return null;
  }
  if (letter === 'H') return 'hours';
  if (letter === 'M') return 'minutes';
  if (letter === 'S') return 'seconds';
  return null;
}

/**
 * Reads an ISO 8601 duration in one pass: `P`, then years, months, weeks and days, then `T` and hours, minutes and
 * seconds, each written as digits and its capital letter, in that order and each at most once. The smallest part present
 * may have a decimal fraction (dot or comma, at most 9 digits); a fraction on any other part is refused. At most 15
 * digits before the point. Surrounding white space is allowed; a sign, a lower case letter, an empty duration (`P`) and a
 * `T` with nothing after it are refused. Weeks may be combined with other parts.
 */
export function parseIsoDuration(text: string): IsoDuration {
  if (text.length > MAX_DURATION_LENGTH) throw new IsoDurationError(MESSAGE_TOO_LONG);
  const source = text.trim();
  if (source.length > MAX_DURATION_LENGTH) throw new IsoDurationError(MESSAGE_TOO_LONG);
  const first = source.charAt(0);
  if (first === '-' || first === '+') throw new IsoDurationError(MESSAGE_SIGN);
  if (first !== 'P') throw new IsoDurationError(MESSAGE_START);

  const parts = emptyParts();
  let at = 1;
  let inTime = false;
  let lastIndex = -1;
  let count = 0;
  let timeCount = 0;
  let fractionSeen = false;
  while (at < source.length) {
    if (source.charAt(at) === 'T') {
      if (inTime) throw new IsoDurationError(MESSAGE_FORMAT);
      inTime = true;
      at++;
      continue;
    }
    const decimal = readDecimal(source, at);
    if (decimal === null) throw new IsoDurationError(MESSAGE_FORMAT);
    const key = keyFor(source.charAt(decimal.end), inTime);
    if (key === null) throw new IsoDurationError(MESSAGE_FORMAT);
    const index = KEYS.indexOf(key);
    if (index <= lastIndex) throw new IsoDurationError(MESSAGE_FORMAT);
    if (fractionSeen) throw new IsoDurationError(MESSAGE_FRACTION);
    if (decimal.fraction !== '') fractionSeen = true;
    parts[key] = decimalText(decimal.integer, decimal.fraction);
    lastIndex = index;
    count++;
    if (inTime) timeCount++;
    at = decimal.end + 1;
  }
  if (inTime && timeCount === 0) throw new IsoDurationError(MESSAGE_TIME_EMPTY);
  if (count === 0) throw new IsoDurationError(MESSAGE_EMPTY);
  return parts;
}

function isZero(value: string): boolean {
  return value === '0';
}

/**
 * Writes the canonical text of a duration: parts in the order Y, M, W, D, T, H, M, S with every zero part left out,
 * a dot as the decimal separator, no leading or trailing zeros, and `PT0S` when every part is zero. Each part is
 * decimal text (missing parts are zero); the same limits as reading apply, and only the smallest part that is not zero
 * can carry a fraction.
 */
export function buildIsoDuration(parts: Partial<IsoDuration>): string {
  const clean = emptyParts();
  for (const key of KEYS) {
    const given = parts[key];
    if (given === undefined) continue;
    let decimal: Decimal | null = null;
    try {
      decimal = given === '' ? null : readDecimal(given, 0);
    } catch (error) {
      // Too many digits keeps its own sentence, with the part named; any other reading problem is "not a number".
      if (error instanceof IsoDurationError && error.message === MESSAGE_DIGITS) {
        throw new IsoDurationError(
          `The ${key} value has at most ${MAX_INTEGER_DIGITS} digits before the decimal point and ${MAX_FRACTION_DIGITS} after it.`,
        );
      }
    }
    if (decimal === null || decimal.end !== given.length) {
      throw new IsoDurationError(`The ${key} value must be a number such as 7 or 7.5.`);
    }
    clean[key] = decimalText(decimal.integer, decimal.fraction);
  }
  let smallest = -1;
  KEYS.forEach((key, index) => {
    if (!isZero(clean[key])) smallest = index;
  });
  KEYS.forEach((key, index) => {
    if (index < smallest && clean[key].includes('.')) throw new IsoDurationError(MESSAGE_FRACTION);
  });

  let date = '';
  for (const key of ['years', 'months', 'weeks', 'days'] as const) {
    if (!isZero(clean[key])) date += clean[key] + LETTERS[key];
  }
  let time = '';
  for (const key of ['hours', 'minutes', 'seconds'] as const) {
    if (!isZero(clean[key])) time += clean[key] + LETTERS[key];
  }
  if (date === '' && time === '') return 'PT0S';
  return `P${date}${time === '' ? '' : `T${time}`}`;
}

const NANO = 1_000_000_000n;

function scaled(value: string): bigint {
  const dot = value.indexOf('.');
  const integer = dot < 0 ? value : value.slice(0, dot);
  const fraction = dot < 0 ? '' : value.slice(dot + 1);
  return BigInt(integer + fraction.padEnd(MAX_FRACTION_DIGITS, '0'));
}

/**
 * The exact length of the time part (hours, minutes and seconds) in seconds, as decimal text. Years, months, weeks and
 * days are left out on purpose: their length in seconds depends on the date they start from.
 */
export function timePartSeconds(duration: IsoDuration): string {
  const total = scaled(duration.hours) * 3600n + scaled(duration.minutes) * 60n + scaled(duration.seconds);
  const whole = total / NANO;
  const rest = total % NANO;
  if (rest === 0n) return whole.toString();
  const digits = rest.toString().padStart(MAX_FRACTION_DIGITS, '0');
  let end = digits.length;
  while (end > 0 && digits.charCodeAt(end - 1) === 48) end--;
  return `${whole}.${digits.slice(0, end)}`;
}
