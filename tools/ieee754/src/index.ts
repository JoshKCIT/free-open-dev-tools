import meta from './meta.json';

export { meta };

export type FloatFormat = 'binary32' | 'binary64';

/** Which two entry points the visitor's text is read as. */
export type InputMode = 'value' | 'bits';

export class Ieee754Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Ieee754Error';
  }
}

export type SpecialCase =
  | 'zero'
  | 'negative zero'
  | 'positive infinity'
  | 'negative infinity'
  | 'quiet NaN'
  | 'signalling NaN'
  | 'subnormal'
  | 'normal';

export interface FloatReport {
  format: FloatFormat;
  /** The shortest decimal string that round trips back to the same bits. Display only. */
  decodedValue: string;
  label: SpecialCase;
  /** '0' or '1'. */
  signBit: string;
  /** The exponent field as a binary string, zero-padded to the format's width. */
  exponentField: string;
  /** The mantissa field as a binary string, zero-padded to the format's width. */
  mantissaField: string;
  /** The full bit string: signBit + exponentField + mantissaField, no separators. */
  bits: string;
  /** The exponent field read as an unsigned integer, before removing the bias. */
  biasedExponent: number;
  /**
   * The effective exponent: field minus bias for a normal value, the format's
   * minimum for a subnormal. Not meaningful for zero, infinity or NaN, but a
   * number is still reported (field minus bias) so the type stays simple.
   */
  unbiasedExponent: number;
  /** The mantissa field read as an unsigned integer. */
  mantissa: bigint;
  /** True for a normal value, which has an implicit leading one; false otherwise. */
  hasImplicitLeadingOne: boolean;
  /** Only meaningful when `label` is a NaN case. */
  isQuiet: boolean;
  /** The NaN payload: the mantissa bits below the quiet bit. Zero when not a NaN. */
  payload: bigint;
}

interface FormatSpec {
  totalBits: number;
  exponentBits: number;
  mantissaBits: number;
  bias: number;
  /** The effective exponent of a subnormal: 1 - bias. */
  minExponent: number;
  hexDigits: number;
}

const SPECS: Record<FloatFormat, FormatSpec> = {
  binary32: { totalBits: 32, exponentBits: 8, mantissaBits: 23, bias: 127, minExponent: -126, hexDigits: 8 },
  binary64: { totalBits: 64, exponentBits: 11, mantissaBits: 52, bias: 1023, minExponent: -1022, hexDigits: 16 },
};

/**
 * Parses a hexadecimal bit pattern straight into the unsigned integer it
 * represents. Never through `parseInt` or `Number`, both of which round a
 * 64-bit pattern through a double and lose the low bits — a signalling NaN
 * pattern like `7ff0000000000001` would silently become the infinity
 * pattern `7ff0000000000000`. `BigInt` parses the full hexadecimal string
 * exactly, so this is the only route in.
 */
export function bitsFromHex(text: string, format: FloatFormat): bigint {
  const spec = SPECS[format];
  let trimmed = text.trim();
  if (/^0[xX]/.test(trimmed)) trimmed = trimmed.slice(2);

  if (!/^[0-9a-fA-F]+$/.test(trimmed)) {
    throw new Ieee754Error(
      `"${text}" is not a hexadecimal bit pattern. Only the digits 0-9 and a-f are allowed, with an optional 0x prefix.`,
    );
  }
  if (trimmed.length !== spec.hexDigits) {
    throw new Ieee754Error(
      `${format} needs exactly ${spec.hexDigits} hexadecimal digits (${spec.totalBits} bits); got ${trimmed.length}.`,
    );
  }

  return BigInt('0x' + trimmed);
}

/**
 * Turns the exact bit integer into a JavaScript number, for display only.
 * The result feeds nothing else in a `FloatReport` — every field of the
 * report is derived from the bit integer itself.
 *
 * This writes the integer (never the float) and reads the float back, which
 * is the safe direction: an integer write cannot quiet a signalling NaN, and
 * `getFloat32`/`getFloat64` are ordinary reads, not the round trip this tool
 * exists to avoid.
 */
export function fromBits(bits: bigint, format: FloatFormat): number {
  if (format === 'binary32') {
    const view = new DataView(new ArrayBuffer(4));
    view.setUint32(0, Number(bits & 0xffffffffn), false); // big-endian, deliberate
    return view.getFloat32(0, false); // deliberate — display read only
  }
  const view = new DataView(new ArrayBuffer(8));
  const hi = Number((bits >> 32n) & 0xffffffffn);
  const lo = Number(bits & 0xffffffffn);
  view.setUint32(0, hi, false); // high word first, deliberate
  view.setUint32(4, lo, false); // low word second, deliberate
  return view.getFloat64(0, false); // deliberate — display read only
}

/**
 * "The exact value" and what `String(x)` prints are different things only
 * for the sign of zero: `String(-0)` prints `0`, dropping the one bit this
 * tool exists to show. Everywhere else JavaScript's own number-to-string
 * conversion already produces the shortest decimal that round trips back to
 * the same bits, so it is used as-is.
 *
 * `-0` cannot be told from `0` with `===` (`-0 === 0` is `true`), so the
 * check uses `Object.is`, the same-value comparison, instead.
 */
function decodedValueString(value: number): string {
  if (Object.is(value, -0)) return '-0';
  return String(value);
}

/**
 * Derives every field of the report from the bit integer with shifts and
 * masks. Arithmetic on the decoded value is exactly the mistake this tool
 * exists to expose, and a re-encode through a float view is that same
 * mistake wearing a `DataView`; this function does neither.
 */
export function reportFromBits(bits: bigint, format: FloatFormat): FloatReport {
  const spec = SPECS[format];
  const mantissaMask = (1n << BigInt(spec.mantissaBits)) - 1n;
  const exponentMask = (1n << BigInt(spec.exponentBits)) - 1n;

  const signBit = (bits >> BigInt(spec.exponentBits + spec.mantissaBits)) & 1n;
  const expField = (bits >> BigInt(spec.mantissaBits)) & exponentMask;
  const mantissaField = bits & mantissaMask;

  const allOnesExponent = expField === exponentMask;
  const allZeroExponent = expField === 0n;
  const negative = signBit === 1n;

  let label: SpecialCase;
  let hasImplicitLeadingOne: boolean;
  let isQuiet = false;
  let payload = 0n;
  let unbiasedExponent: number;

  if (allOnesExponent && mantissaField === 0n) {
    // Infinity: all-ones exponent field, all-zero mantissa. Signed.
    label = negative ? 'negative infinity' : 'positive infinity';
    hasImplicitLeadingOne = false;
    unbiasedExponent = Number(expField) - spec.bias;
  } else if (allOnesExponent) {
    // NaN: all-ones exponent field, non-zero mantissa. The top mantissa bit
    // (the "quiet bit") says whether it is quiet or signalling; everything
    // below it is the payload.
    const quietBit = 1n << BigInt(spec.mantissaBits - 1);
    isQuiet = (mantissaField & quietBit) !== 0n;
    payload = mantissaField & (quietBit - 1n);
    label = isQuiet ? 'quiet NaN' : 'signalling NaN';
    hasImplicitLeadingOne = false;
    unbiasedExponent = Number(expField) - spec.bias;
  } else if (allZeroExponent && mantissaField === 0n) {
    // Zero: all-zero exponent field, all-zero mantissa. The sign comes from
    // the bit itself, never from comparing the decoded value — comparing
    // would not even distinguish it, since -0 === 0 is true in JS.
    label = negative ? 'negative zero' : 'zero';
    hasImplicitLeadingOne = false;
    unbiasedExponent = Number(expField) - spec.bias;
  } else if (allZeroExponent) {
    // Subnormal: all-zero exponent field, non-zero mantissa. No implicit
    // leading one, and the effective exponent is the format's minimum
    // rather than the field value minus the bias.
    label = 'subnormal';
    hasImplicitLeadingOne = false;
    unbiasedExponent = spec.minExponent;
  } else {
    // Ordinary value: an implicit leading one, exponent is field minus bias.
    label = 'normal';
    hasImplicitLeadingOne = true;
    unbiasedExponent = Number(expField) - spec.bias;
  }

  const value = fromBits(bits, format); // display conversion only

  return {
    format,
    decodedValue: decodedValueString(value),
    label,
    signBit: negative ? '1' : '0',
    exponentField: expField.toString(2).padStart(spec.exponentBits, '0'),
    mantissaField: mantissaField.toString(2).padStart(spec.mantissaBits, '0'),
    bits: bits.toString(2).padStart(spec.totalBits, '0'),
    biasedExponent: Number(expField),
    unbiasedExponent,
    mantissa: mantissaField,
    hasImplicitLeadingOne,
    isQuiet,
    payload,
  };
}

function parseDecimalInput(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') throw new Ieee754Error('Nothing to inspect.');

  if (/^[+-]?Infinity$/.test(trimmed) || trimmed === 'NaN') {
    return Number(trimmed);
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) {
    throw new Ieee754Error(
      `"${text}" is not a decimal number. Expected an optional sign, digits, an optional decimal point and an optional exponent (such as 1.5e10), or the literal Infinity, -Infinity or NaN.`,
    );
  }
  return Number(trimmed);
}

/**
 * Encodes a JavaScript number as the exact bit pattern of the chosen format,
 * via a `DataView`. `DataView` defaults to big-endian only when the
 * `littleEndian` argument is omitted; every call here passes `false`
 * explicitly so a write and a read can never silently disagree about byte
 * order.
 */
function bitsFromNumber(value: number, format: FloatFormat): bigint {
  if (format === 'binary32') {
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, value, false); // big-endian, deliberate
    return BigInt(view.getUint32(0, false)); // deliberate — matches the write above
  }
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, false); // big-endian, deliberate
  const hi = BigInt(view.getUint32(0, false)); // high word first, deliberate
  const lo = BigInt(view.getUint32(4, false)); // low word second, deliberate
  return (hi << 32n) | lo;
}

/**
 * Decomposes a binary32 or binary64 value into its sign, exponent and
 * mantissa bits, with every special case named.
 *
 * The bit pattern is the source of truth. For `mode: 'bits'` the input
 * parses straight to the bit integer (`bitsFromHex`) and every field is
 * derived from that integer (`reportFromBits`) — there is no floating-point
 * write anywhere on this path, so a signalling NaN pattern comes back
 * bit-identical rather than being quieted by the engine. For `mode: 'value'`
 * the input is read as a decimal, encoded through a `DataView` to get the
 * exact bits, and then the same `reportFromBits` derives the report.
 */
export function inspectFloat(input: string, format: FloatFormat, mode: InputMode = 'value'): FloatReport {
  if (mode === 'bits') {
    return reportFromBits(bitsFromHex(input, format), format);
  }
  const value = parseDecimalInput(input);
  return reportFromBits(bitsFromNumber(value, format), format);
}
