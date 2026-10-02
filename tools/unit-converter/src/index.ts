import meta from './meta.json';
import { D, UNITS, factorEnds, type Dec, type Quantity, type UnitDef } from './units';

export { meta, UNITS };
export type { Quantity, UnitDef };

/** A problem with something the visitor typed. `field` is the label of the field, so a page can name it. */
export class UnitConverterError extends Error {
  readonly field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = 'UnitConverterError';
    if (field !== undefined) this.field = field;
  }
}

export interface QuantityInfo {
  id: Quantity;
  label: string;
  /** The symbol of the unit every other unit of the quantity is converted through. */
  base: string;
}

export const QUANTITIES: readonly QuantityInfo[] = [
  { id: 'length', label: 'Length', base: 'm' },
  { id: 'mass', label: 'Mass', base: 'kg' },
  { id: 'temperature', label: 'Temperature', base: 'K' },
  { id: 'volume', label: 'Volume', base: 'm³' },
  { id: 'area', label: 'Area', base: 'm²' },
  { id: 'speed', label: 'Speed', base: 'm/s' },
  { id: 'pressure', label: 'Pressure', base: 'Pa' },
  { id: 'energy', label: 'Energy', base: 'J' },
  { id: 'power', label: 'Power', base: 'W' },
  { id: 'angle', label: 'Angle', base: 'rad' },
  { id: 'fuel-economy', label: 'Fuel economy', base: 'L/100 km' },
  { id: 'charge', label: 'Electric charge', base: 'C' },
  { id: 'frequency', label: 'Frequency', base: 'Hz' },
  { id: 'time', label: 'Time', base: 's' },
];

const FIELD_VALUE = 'Value';
const FIELD_FROM = 'From unit';
const FIELD_TO = 'To unit';
const FIELD_DIGITS = 'Significant digits';

/** The most digits a typed value may carry, so one rounding at the end keeps every digit the visitor typed. */
const MAX_VALUE_DIGITS = 50;
/** The largest value accepted, plus or minus. */
export const MAX_VALUE = '1e100';
const MAX_VALUE_TEXT_LENGTH = 400;
const MAX_EXPONENT = 1000;

function infoOf(quantity: Quantity): QuantityInfo {
  const info = QUANTITIES.find((q) => q.id === quantity);
  if (info === undefined) throw new UnitConverterError(`"${String(quantity)}" is not one of the fourteen quantities.`);
  return info;
}

/** The unit a symbol or a name stands for, or a refusal that lists what the quantity accepts. */
export function findUnit(quantity: Quantity, text: string, field = 'Unit'): UnitDef {
  const units = UNITS[quantity];
  const info = infoOf(quantity);
  const typed = text.trim();
  if (typed === '') {
    throw new UnitConverterError(
      `${field}: enter a unit of ${info.label.toLowerCase()}, such as ${units[0]!.symbol}.`,
      field,
    );
  }
  // A symbol is matched with its case: mm and Mm, mg and Mg are different units. The micro units list the micro sign, the
  // Greek letter mu and the letter u among their spellings.
  const bySymbol = units.find((u) => u.symbol === typed || u.aliases.includes(typed));
  if (bySymbol) return bySymbol;
  // A name is matched in any case, with any run of spaces as one space.
  const name = typed.toLowerCase().replace(/\s+/g, ' ');
  const byName = units.find((u) => u.names.includes(name));
  if (byName) return byName;
  const accepted = units.map((u) => `${u.symbol} (${u.names[0]})`).join(', ');
  throw new UnitConverterError(
    `${field}: "${text.trim()}" is not a unit of ${info.label.toLowerCase()}. Accepted: ${accepted}.`,
    field,
  );
}

function checkDigits(digits: number): void {
  if (!Number.isInteger(digits) || digits < 1 || digits > 30) {
    throw new UnitConverterError(`${FIELD_DIGITS}: enter a whole number from 1 to 30.`, FIELD_DIGITS);
  }
}

const PLAIN_NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/** Reads typed text as an exact decimal; nothing passes through a binary floating point number. */
function parseValue(text: string): Dec {
  const typed = text.trim();
  if (typed === '') throw new UnitConverterError(`${FIELD_VALUE}: enter a number.`, FIELD_VALUE);
  if (typed.length > MAX_VALUE_TEXT_LENGTH || !PLAIN_NUMBER.test(typed)) {
    throw new UnitConverterError(
      `${FIELD_VALUE}: "${typed.slice(0, 40)}${typed.length > 40 ? '...' : ''}" is not a plain decimal number such as 12.5, -40 or 1.2e-3.`,
      FIELD_VALUE,
    );
  }
  const [mantissa = '', exponent = ''] = typed.toLowerCase().replace(/^[+-]/, '').split('e');
  if (exponent !== '' && Math.abs(Number(exponent)) > MAX_EXPONENT) {
    throw new UnitConverterError(
      `${FIELD_VALUE}: the exponent must be between -${MAX_EXPONENT} and ${MAX_EXPONENT}.`,
      FIELD_VALUE,
    );
  }
  const significant = mantissa.replace('.', '').replace(/^0+/, '').length;
  if (significant > MAX_VALUE_DIGITS) {
    throw new UnitConverterError(
      `${FIELD_VALUE}: at most ${MAX_VALUE_DIGITS} digits are carried exactly.`,
      FIELD_VALUE,
    );
  }
  const value = new D(typed);
  if (value.abs().gt(MAX_VALUE)) {
    throw new UnitConverterError(`${FIELD_VALUE}: the value must be between -1e100 and 1e100.`, FIELD_VALUE);
  }
  return value;
}

const PI: Dec = D.acos(-1);

/** The value in the quantity's base unit. */
function toBase(u: UnitDef, v: Dec): Dec {
  const num = new D(u.num);
  const den = new D(u.den);
  if (u.kind === 'reciprocal') return num.div(den.times(v));
  const shifted = u.kind === 'affine' ? v.plus(u.offset ?? '0') : v;
  return shifted.times(num).div(den);
}

/** The value in the unit from a value in the base unit. */
function fromBase(u: UnitDef, base: Dec): Dec {
  const num = new D(u.num);
  const den = new D(u.den);
  if (u.kind === 'reciprocal') return num.div(den.times(base));
  const scaled = base.times(den).div(num);
  return u.kind === 'affine' ? scaled.minus(u.offset ?? '0') : scaled;
}

/**
 * The multiplier from one linear unit to another, as a numerator and a denominator that are divided once, so a
 * fraction is never rounded twice. Two units written in pi cancel it: a gon is exactly 0.9 degree.
 */
function linearRatio(from: UnitDef, to: UnitDef): { num: Dec; den: Dec } {
  let num = new D(from.num).times(to.den);
  let den = new D(from.den).times(to.num);
  if (from.pi && !to.pi) num = num.times(PI);
  if (to.pi && !from.pi) den = den.times(PI);
  return { num, den };
}

/**
 * Whether a conversion factor between two units is a finite decimal, so it can be shown whole. Decided with whole-number
 * fractions: the product of the two numerators and the two denominators is never rounded.
 */
function ratioTerminates(from: UnitDef, to: UnitDef): boolean {
  if (from.pi !== to.pi) return false;
  return factorEnds([from.num, to.den], [from.den, to.num]);
}

/** Shows a number with the chosen significant digits, rounded half to even, in plain notation for exponents -7 to 20. */
function format(value: Dec, digits: number): string {
  const rounded = value.toSignificantDigits(digits, D.ROUND_HALF_EVEN);
  const exponent = rounded.e;
  return exponent >= -7 && exponent <= 20 ? rounded.toFixed() : rounded.toExponential();
}

function checkTemperature(value: Dec, unit: UnitDef, quantity: Quantity, text: string): void {
  if (quantity !== 'temperature') return;
  if (toBase(unit, value).lt(0)) {
    throw new UnitConverterError(
      `${FIELD_VALUE}: ${text.trim()} ${unit.symbol} is below absolute zero, so it is not a temperature. The lowest are 0 K, -273.15 ${String.fromCharCode(0xb0)}C, -459.67 ${String.fromCharCode(0xb0)}F and 0 ${String.fromCharCode(0xb0)}R.`,
      FIELD_VALUE,
    );
  }
}

function checkFuelEconomy(value: Dec, quantity: Quantity, text: string): void {
  if (quantity === 'fuel-economy' && value.lte(0)) {
    throw new UnitConverterError(
      `${FIELD_VALUE}: ${text.trim()} cannot be converted. A fuel economy of zero or less has no reciprocal, and distance per volume and volume per distance are reciprocals of each other.`,
      FIELD_VALUE,
    );
  }
}

/** The result of one conversion as numbers, before it is shown. */
function compute(quantity: Quantity, v: Dec, from: UnitDef, to: UnitDef): Dec {
  if (from.kind === 'linear' && to.kind === 'linear') {
    const { num, den } = linearRatio(from, to);
    return v.times(num).div(den);
  }
  return fromBase(to, toBase(from, v));
}

/** How a unit is turned into the base unit, in words, for the factor line. */
function ruleToBase(u: UnitDef, digits: number): string {
  const factor = format(new D(u.factor), digits);
  if (u.kind === 'reciprocal') return `${factor} / x`;
  if (u.kind === 'affine') {
    const shifted = u.offset === '0' ? 'x' : `(x + ${u.offset})`;
    return factor === '1' ? shifted : `${shifted} × ${factor}`;
  }
  return `x × ${factor}`;
}

export interface Conversion {
  /** The converted value with the chosen significant digits. */
  result: string;
  /** The factor used: the multiplier for a plain conversion, the rule through the base unit for the others. */
  factor: string;
  /** True when the factor is exact: both definitions are exact and the factor is a finite decimal. */
  exact: boolean;
  /** The definitions of the two units. */
  definition: string;
}

/**
 * Converts a typed value from one unit to another of the same quantity. The value is read as exact decimal text, every
 * factor comes from its exact definition, the arithmetic is decimal at 50 digits, and the result is rounded once, half
 * to even, to the chosen significant digits.
 */
export function convertUnit(quantity: Quantity, value: string, from: string, to: string, digits: number): Conversion {
  checkDigits(digits);
  const info = infoOf(quantity);
  const v = parseValue(value);
  const f = findUnit(quantity, from, FIELD_FROM);
  const t = findUnit(quantity, to, FIELD_TO);
  checkFuelEconomy(v, quantity, value);
  checkTemperature(v, f, quantity, value);
  const result = compute(quantity, v, f, t);

  let factor: string;
  let exact: boolean;
  if (f.kind === 'linear' && t.kind === 'linear') {
    const { num, den } = linearRatio(f, t);
    factor = format(num.div(den), digits);
    exact = f.exact && t.exact && ratioTerminates(f, t);
  } else {
    const parts: string[] = [];
    if (f.symbol !== info.base) parts.push(`${f.symbol} to ${info.base}: ${ruleToBase(f, digits)}`);
    if (t.symbol !== info.base) parts.push(`${info.base} to ${t.symbol}: ${ruleFromBase(t, digits)}`);
    factor = parts.length === 0 ? '1' : parts.join('; ');
    exact = f.exact && t.exact && f.finite && t.finite;
  }
  const definition = f.id === t.id ? f.definition : `${f.definition} ${t.definition}`;
  return { result: format(result, digits), factor, exact, definition };
}

/** How the base unit is turned into a unit, in words. */
function ruleFromBase(u: UnitDef, digits: number): string {
  const factor = format(new D(u.factor), digits);
  if (u.kind === 'reciprocal') return `${factor} / x`;
  if (u.kind === 'affine') {
    const scaled = factor === '1' ? 'x' : `x / ${factor}`;
    return u.offset === '0' ? scaled : `${scaled} - ${u.offset}`;
  }
  return `x / ${factor}`;
}

export interface UnitRow {
  id: string;
  symbol: string;
  name: string;
  /** The value of the typed amount in this unit, with the chosen significant digits. */
  value: string;
  /** How the unit relates to the base unit. */
  factor: string;
  exact: boolean;
}

/** The typed value in every unit of the quantity, with how each unit relates to the base unit. */
export function listUnits(quantity: Quantity, value: string, from: string, digits: number): UnitRow[] {
  checkDigits(digits);
  const v = parseValue(value);
  const f = findUnit(quantity, from, FIELD_FROM);
  checkFuelEconomy(v, quantity, value);
  checkTemperature(v, f, quantity, value);
  return UNITS[quantity].map((u) => ({
    id: u.id,
    symbol: u.symbol,
    name: u.names[0] ?? u.symbol,
    value: format(compute(quantity, v, f, u), digits),
    factor: ruleToBase(u, digits),
    exact: u.exact && u.finite,
  }));
}
