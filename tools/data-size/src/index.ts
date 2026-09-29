import meta from './meta.json';
import { type Rational, fromBigInt, mulR, divR, subR, isZero, DataSizeError, parseAmount } from './rational';
import { formatRational, type FormatResult } from './format';
import { UNITS, TIME_UNITS, findUnit, findTimeUnit, type UnitId, type TimeUnitId } from './units';

export { meta, DataSizeError, parseAmount, formatRational, UNITS, TIME_UNITS };
export type { Rational, FormatResult, UnitId, TimeUnitId };

export interface ConvertOptions {
  significantDigits?: number;
}

export interface ConversionRow {
  unit: string;
  symbol: string;
  name: string;
  system: 'SI' | 'IEC' | 'none';
  kind: 'bit' | 'byte';
  text: string;
  rounded: boolean;
}

function defaultDigits(opts: ConvertOptions): number {
  return opts.significantDigits ?? 6;
}

function bitsToRows(totalBits: Rational, digits: number, speedSuffix: boolean): ConversionRow[] {
  return UNITS.map((u) => {
    const valueInU = divR(totalBits, fromBigInt(u.bits));
    const { text, rounded } = formatRational(valueInU, digits);
    return {
      unit: u.id,
      symbol: speedSuffix ? `${u.symbol}/s` : u.symbol,
      name: speedSuffix ? `${u.name} per second` : u.name,
      system: u.system,
      kind: u.kind,
      text,
      rounded,
    };
  });
}

export function convertSize(amount: Rational, unit: UnitId, opts: ConvertOptions = {}): ConversionRow[] {
  const totalBits = mulR(amount, fromBigInt(findUnit(unit).bits));
  return bitsToRows(totalBits, defaultDigits(opts), false);
}

export function convertSpeed(amount: Rational, unit: UnitId, opts: ConvertOptions = {}): ConversionRow[] {
  const totalBitsPerSecond = mulR(amount, fromBigInt(findUnit(unit).bits));
  return bitsToRows(totalBitsPerSecond, defaultDigits(opts), true);
}

export interface TransferTimeResult {
  totalSeconds: FormatResult;
  days: bigint;
  hours: bigint;
  minutes: bigint;
  seconds: FormatResult;
  /** d h m s, omitting leading zero parts but keeping inner zeros, e.g. "1 m 20 s", "1 h 0 m 0 s", "0 s". */
  text: string;
}

function splitDuration(totalSeconds: Rational, digits: number): TransferTimeResult {
  const days = totalSeconds.num / (totalSeconds.den * 86_400n);
  let remainder = subR(totalSeconds, fromBigInt(days * 86_400n));
  const hours = remainder.num / (remainder.den * 3_600n);
  remainder = subR(remainder, fromBigInt(hours * 3_600n));
  const minutes = remainder.num / (remainder.den * 60n);
  remainder = subR(remainder, fromBigInt(minutes * 60n));

  const secondsFormatted = formatRational(remainder, digits);
  const totalSecondsFormatted = formatRational(totalSeconds, digits);

  const parts: string[] = [];
  if (days > 0n) parts.push(`${days} d`);
  if (parts.length > 0 || hours > 0n) parts.push(`${hours} h`);
  if (parts.length > 0 || minutes > 0n) parts.push(`${minutes} m`);
  parts.push(`${secondsFormatted.text} s`);

  return {
    totalSeconds: totalSecondsFormatted,
    days,
    hours,
    minutes,
    seconds: secondsFormatted,
    text: parts.join(' '),
  };
}

export function transferTime(
  size: Rational,
  sizeUnit: UnitId,
  speed: Rational,
  speedUnit: UnitId,
  opts: ConvertOptions = {},
): TransferTimeResult {
  if (isZero(speed)) {
    throw new DataSizeError('speed', 'a speed of zero never finishes');
  }
  const sizeBits = mulR(size, fromBigInt(findUnit(sizeUnit).bits));
  const speedBitsPerSecond = mulR(speed, fromBigInt(findUnit(speedUnit).bits));
  const totalSeconds = divR(sizeBits, speedBitsPerSecond);
  return splitDuration(totalSeconds, defaultDigits(opts));
}

export function speedNeeded(
  size: Rational,
  sizeUnit: UnitId,
  time: Rational,
  timeUnit: TimeUnitId,
  opts: ConvertOptions = {},
): ConversionRow[] {
  if (isZero(time)) {
    throw new DataSizeError('time', 'Enter a time greater than zero');
  }
  const sizeBits = mulR(size, fromBigInt(findUnit(sizeUnit).bits));
  const timeSeconds = mulR(time, fromBigInt(findTimeUnit(timeUnit).seconds));
  const bitsPerSecond = divR(sizeBits, timeSeconds);
  return bitsToRows(bitsPerSecond, defaultDigits(opts), true);
}
