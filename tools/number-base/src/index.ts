import meta from './meta.json';

export { meta };

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

export class BaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BaseError';
  }
}

export interface ParseResult {
  value: bigint;
  negative: boolean;
  /** Digits actually used, after separators and a prefix are removed. */
  digits: string;
  /** Set when a prefix such as 0x implied a base different from the one given. */
  prefixBase?: number;
}

const PREFIXES: [RegExp, number][] = [
  [/^0[xX]/, 16],
  [/^0[oO]/, 8],
  [/^0[bB]/, 2],
];

/**
 * Parses an integer in any base from 2 to 36, with arbitrary precision.
 *
 * Everything here is `bigint`, so a 256-bit hash converts to decimal exactly
 * rather than turning into 1.157920892373162e+77 the way parseInt would.
 */
export function parseInBase(text: string, base: number): ParseResult {
  if (!Number.isInteger(base) || base < 2 || base > 36) {
    throw new BaseError(`Base must be a whole number from 2 to 36. Got ${base}.`);
  }

  let input = text.trim();
  if (input === '') throw new BaseError('Nothing to convert.');

  let negative = false;
  if (input.startsWith('-')) {
    negative = true;
    input = input.slice(1);
  } else if (input.startsWith('+')) {
    input = input.slice(1);
  }

  // Separators people actually use: underscore, space, comma, apostrophe.
  input = input.replace(/[_ ,']/g, '');

  let prefixBase: number | undefined;
  for (const [pattern, implied] of PREFIXES) {
    if (pattern.test(input)) {
      prefixBase = implied;
      input = input.replace(pattern, '');
      break;
    }
  }

  if (input === '') throw new BaseError('There are no digits after the prefix.');

  const allowed = DIGITS.slice(0, base);
  let value = 0n;
  const bigBase = BigInt(base);

  for (const ch of input.toLowerCase()) {
    const digit = allowed.indexOf(ch);
    if (digit === -1) {
      const anywhere = DIGITS.indexOf(ch);
      throw new BaseError(
        anywhere === -1
          ? `"${ch}" is not a digit in any base up to 36.`
          : `"${ch}" has the value ${anywhere}, which base ${base} does not have. The highest digit in base ${base} is "${allowed[base - 1]}".`,
      );
    }
    value = value * bigBase + BigInt(digit);
  }

  return { value, negative, digits: input, ...(prefixBase !== undefined ? { prefixBase } : {}) };
}

export function toBase(value: bigint, base: number, uppercase = false): string {
  if (!Number.isInteger(base) || base < 2 || base > 36) {
    throw new BaseError(`Base must be a whole number from 2 to 36. Got ${base}.`);
  }
  const negative = value < 0n;
  let n = negative ? -value : value;
  if (n === 0n) return '0';

  const bigBase = BigInt(base);
  let out = '';
  while (n > 0n) {
    out = DIGITS[Number(n % bigBase)] + out;
    n /= bigBase;
  }
  return (negative ? '-' : '') + (uppercase ? out.toUpperCase() : out);
}

export interface Conversion {
  base: number;
  label: string;
  value: string;
  prefixed: string;
}

const NAMED: Record<number, string> = {
  2: 'Binary',
  8: 'Octal',
  10: 'Decimal',
  16: 'Hexadecimal',
  32: 'Base 32',
  36: 'Base 36',
};

export function convertAll(value: bigint, uppercase = false, bases = [2, 8, 10, 16, 36]): Conversion[] {
  return bases.map((base) => {
    const rendered = toBase(value, base, uppercase);
    const prefix = base === 16 ? '0x' : base === 8 ? '0o' : base === 2 ? '0b' : '';
    return {
      base,
      label: NAMED[base] ?? `Base ${base}`,
      value: rendered,
      prefixed: prefix
        ? rendered.startsWith('-')
          ? `-${prefix}${rendered.slice(1)}`
          : `${prefix}${rendered}`
        : rendered,
    };
  });
}

/** Groups digits for readability: bytes in binary, four at a time in hex. */
export function group(rendered: string, base: number): string {
  const size = base === 2 ? 8 : base === 16 ? 4 : 3;
  const negative = rendered.startsWith('-');
  const body = negative ? rendered.slice(1) : rendered;
  const padded = body.padStart(Math.ceil(body.length / size) * size, '0');
  const chunks = padded.match(new RegExp(`.{${size}}`, 'g')) ?? [body];
  return (negative ? '-' : '') + chunks.join(' ');
}

export interface WidthReport {
  bits: number;
  bytes: number;
  /** The smallest common fixed width that holds this value unsigned. */
  fitsUnsigned: number | null;
  /** The smallest common fixed width that holds it as two's complement. */
  fitsSigned: number | null;
  /** Two's complement representation at each width that can hold it. */
  twosComplement: { width: number; hex: string; binary: string }[];
}

const WIDTHS = [8, 16, 32, 64, 128, 256];

/** Reports how the value sits in the fixed-width integers hardware actually has. */
export function widthReport(value: bigint): WidthReport {
  const magnitude = value < 0n ? -value : value;
  const bits = magnitude === 0n ? 1 : magnitude.toString(2).length;

  const fitsUnsigned = value < 0n ? null : (WIDTHS.find((w) => magnitude < 1n << BigInt(w)) ?? null);
  const fitsSigned = WIDTHS.find((w) => value >= -(1n << BigInt(w - 1)) && value < 1n << BigInt(w - 1)) ?? null;

  const twosComplement: WidthReport['twosComplement'] = [];
  for (const width of WIDTHS) {
    const limit = 1n << BigInt(width);
    if (value >= 0n ? value >= limit : -value > limit / 2n) continue;
    const encoded = value < 0n ? limit + value : value;
    twosComplement.push({
      width,
      hex: encoded.toString(16).padStart(width / 4, '0'),
      binary: encoded.toString(2).padStart(width, '0'),
    });
  }

  return { bits, bytes: Math.ceil(bits / 8), fitsUnsigned, fitsSigned, twosComplement };
}

export type Operation =
  'add' | 'subtract' | 'multiply' | 'divide' | 'modulo' | 'power' | 'and' | 'or' | 'xor' | 'shiftLeft' | 'shiftRight';

/** Arithmetic and bitwise operations in the chosen base, all at arbitrary precision. */
export function calculate(a: bigint, b: bigint, operation: Operation): bigint {
  switch (operation) {
    case 'add':
      return a + b;
    case 'subtract':
      return a - b;
    case 'multiply':
      return a * b;
    case 'divide':
      if (b === 0n) throw new BaseError('Division by zero.');
      // Integer division truncates towards zero, as it does in C, Java and Go.
      return a / b;
    case 'modulo':
      if (b === 0n) throw new BaseError('Modulo by zero.');
      return a % b;
    case 'power':
      if (b < 0n) throw new BaseError('A negative exponent does not give a whole number.');
      if (b > 100000n) throw new BaseError('That exponent would produce a number too large to display.');
      return a ** b;
    case 'and':
      return a & b;
    case 'or':
      return a | b;
    case 'xor':
      return a ^ b;
    case 'shiftLeft':
      if (b < 0n || b > 4096n) throw new BaseError('Shift amount must be between 0 and 4096.');
      return a << b;
    case 'shiftRight':
      if (b < 0n || b > 4096n) throw new BaseError('Shift amount must be between 0 and 4096.');
      return a >> b;
  }
}
