/**
 * How docker's command line reads the numbers it is given, which is how the Go flag library reads them:
 *  - a whole number follows strconv.ParseInt with base 0: an optional sign, then decimal digits, or a prefix of 0x (hex),
 *    0b (binary), 0o or a plain leading 0 (octal), with single underscores allowed between digits (1_000);
 *  - --cpus follows big.Rat's SetString: a decimal number with an optional exponent (1.5, .5, 5., 1e1), or a fraction of two
 *    whole numbers (1/2).
 * Both give back a JavaScript number, or null when docker would refuse the text.
 */

function digitValue(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 97 && code <= 102) return code - 87;
  if (code >= 65 && code <= 70) return code - 55;
  return 99;
}

/** A whole number as Go's strconv.ParseInt(text, 0, 64) reads it, or null. Values beyond 2^53 are refused. */
export function parseGoInteger(text: string): number | null {
  const unsigned = text[0] === '+' || text[0] === '-' ? text.slice(1) : text;
  if (unsigned === '0') return 0;
  let i = 0;
  let negative = false;
  if (text[0] === '+' || text[0] === '-') {
    negative = text[0] === '-';
    i = 1;
  }
  let base = 10;
  let prefixed = false;
  if (text[i] === '0' && i + 1 < text.length) {
    const marker = (text[i + 1] ?? '').toLowerCase();
    if (marker === 'x') {
      base = 16;
      i += 2;
      prefixed = true;
    } else if (marker === 'b') {
      base = 2;
      i += 2;
      prefixed = true;
    } else if (marker === 'o') {
      base = 8;
      i += 2;
      prefixed = true;
    } else {
      base = 8;
      i += 1;
      prefixed = true;
    }
  }
  let value = 0;
  let digits = 0;
  // An underscore must sit between two digits, or straight after a base prefix.
  let lastWasDigit = prefixed;
  for (; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '_') {
      if (!lastWasDigit) return null;
      lastWasDigit = false;
      continue;
    }
    const digit = digitValue(ch);
    if (digit >= base) return null;
    value = value * base + digit;
    if (!Number.isSafeInteger(value)) return null;
    digits += 1;
    lastWasDigit = true;
  }
  // A trailing underscore, or a prefix with no digit after it (0x), is not a number.
  if (digits === 0 || !lastWasDigit) return null;
  return negative ? -value : value;
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

/** A decimal number with an optional exponent: 1.5, .5, 5., 1e1, +2, -1. */
function isDecimalFloat(text: string): boolean {
  let i = text[0] === '+' || text[0] === '-' ? 1 : 0;
  let digits = 0;
  while (isDigit(text[i])) {
    i++;
    digits++;
  }
  if (text[i] === '.') {
    i++;
    while (isDigit(text[i])) {
      i++;
      digits++;
    }
  }
  if (digits === 0) return false;
  if (text[i] === 'e' || text[i] === 'E') {
    i++;
    if (text[i] === '+' || text[i] === '-') i++;
    let exponent = 0;
    while (isDigit(text[i])) {
      i++;
      exponent++;
    }
    if (exponent === 0) return false;
  }
  return i === text.length;
}

/** The number of CPUs a --cpus value means, or null when docker would refuse it. */
export function parseCpuCount(text: string): number | null {
  const slash = text.indexOf('/');
  if (slash >= 0) {
    const top = parseGoInteger(text.slice(0, slash));
    const bottom = parseGoInteger(text.slice(slash + 1));
    return top === null || bottom === null || bottom === 0 ? null : top / bottom;
  }
  // A whole number with a base prefix (0x10, 0b11, 0o7) is read as a whole number; a plain leading 0 is still decimal here.
  const body = text[0] === '+' || text[0] === '-' ? text.slice(1) : text;
  if (body.length > 1 && body[0] === '0' && 'xXbBoO'.includes(body[1] ?? '')) return parseGoInteger(text);
  if (!isDecimalFloat(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}
