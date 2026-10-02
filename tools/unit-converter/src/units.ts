/**
 * The units of the fourteen quantities, each with the exact relation it is defined by.
 *
 * Every factor is built here, at module load, from the defining relation with decimal arithmetic at 50 significant
 * digits: the pound is 0.45359237 kg, the U.S. gallon is 231 cubic inches, the pound-force is the pound times the
 * standard acceleration of free fall, and the pound-force per square inch is that force over the square inch. Nothing is
 * typed as a rounded published figure, and pi is computed (Decimal.acos(-1)), never typed.
 *
 * A factor is stored as a numerator and a denominator, `num / den` (times pi for the angle units written in pi), and a
 * conversion multiplies by the numerators and divides once by the denominators, so a fraction such as 5/9 is divided
 * exactly once and 32 degrees Fahrenheit is exactly 273.15 K.
 *
 * `exact` says the definition is an exact relation that one of the fetched sources states: NIST SP 811 Appendix B.8 (a
 * factor in boldface is exact, and its footnotes), NIST Handbook 44 (2026) Appendix C ("exactly"), the SI Brochure
 * (9th edition, Table 8 and the defining constants). A conversion is shown as exact only when both definitions are exact
 * and the factor is a finite decimal, so the number shown is the whole truth. Where a source prints a factor rounded and
 * states no exact definition, the unit is not marked exact even if its decimal happens to end.
 */
import Decimal from 'decimal.js';

/** Own constructor: the library's global settings (precision 20) stay as they are for any other code. */
export const D = Decimal.clone({
  precision: 50,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -60,
  toExpPos: 60,
});
export type Dec = InstanceType<typeof D>;

export type Quantity =
  | 'length'
  | 'mass'
  | 'temperature'
  | 'volume'
  | 'area'
  | 'speed'
  | 'pressure'
  | 'energy'
  | 'power'
  | 'angle'
  | 'fuel-economy'
  | 'charge'
  | 'frequency'
  | 'time';

export interface UnitDef {
  id: string;
  /** The symbol shown for the unit. */
  symbol: string;
  /** Spelled-out names, lower case, matched in any case. */
  names: string[];
  /** Other spellings of the symbol, matched with their case. */
  aliases: string[];
  /**
   * linear: base = value x factor. affine: base = (value + offset) x factor. reciprocal: base = factor / value (fuel
   * economy: litres per 100 km for one unit of the reciprocal quantity).
   */
  kind: 'linear' | 'affine' | 'reciprocal';
  /** The factor as decimal text at 50 significant digits (`num / den`, times pi for an angle unit written in pi). */
  factor: string;
  /** The numerator and denominator the factor is built from, as exact decimal text. */
  num: string;
  den: string;
  /** True when the factor is `num / den` times pi. */
  pi: boolean;
  offset?: string;
  /** The definition is an exact relation stated by NIST, the SI Brochure or Handbook 44 (see the file comment). */
  exact: boolean;
  /** Whether the factor is a finite decimal, so the text in `factor` is the whole value and not a rounding. */
  finite: boolean;
  definition: string;
}

const d = (text: string | number): Dec => new D(text);
const PI: Dec = D.acos(-1);

/** Whether a quotient of two exact decimals is a finite decimal (the quotient and its check both come out whole). */
export function terminates(num: Dec, den: Dec): boolean {
  const q = num.div(den);
  return q.sd() < 50 && q.times(den).eq(num);
}

interface Spec {
  id: string;
  symbol: string;
  names: string[];
  aliases?: string[];
  num: Dec | string | number;
  den?: Dec | string | number;
  pi?: boolean;
  kind?: UnitDef['kind'];
  offset?: string;
  exact: boolean;
  definition: string;
}

function unit(spec: Spec): UnitDef {
  const num = d(String(spec.num));
  const den = d(spec.den === undefined ? 1 : String(spec.den));
  const quotient = spec.pi ? num.times(PI).div(den) : num.div(den);
  const result: UnitDef = {
    id: spec.id,
    symbol: spec.symbol,
    names: spec.names.map((name) => name.toLowerCase()),
    aliases: spec.aliases ?? [],
    kind: spec.kind ?? 'linear',
    factor: quotient.toString(),
    num: num.toString(),
    den: den.toString(),
    pi: spec.pi === true,
    exact: spec.exact,
    finite: spec.pi === true ? false : terminates(num, den),
    definition: spec.definition,
  };
  if (spec.offset !== undefined) result.offset = spec.offset;
  return result;
}

const MICRO = String.fromCharCode(0xb5);
const GREEK_MU = String.fromCharCode(0x3bc);
const DEGREE = String.fromCharCode(0xb0);
const PRIME = String.fromCharCode(0x2032);
const DOUBLE_PRIME = String.fromCharCode(0x2033);
const SUP2 = String.fromCharCode(0xb2);
const SUP3 = String.fromCharCode(0xb3);

/** A power of ten as an exact decimal. */
const ten = (power: number): Dec => d(1).times(new D(10).pow(power));

// ---------------------------------------------------------------------------------------------------------------------
// The defining relations (all exact decimals; sources in the file comment)

/** 1 inch = 2.54 centimeters exactly (Handbook 44, NIST SP 811 B.8 boldface). */
const INCH = d('0.0254');
/** 1 foot = 12 inches = 0.3048 m exactly. */
const FOOT = INCH.times(12);
/** 1 yard = 3 feet exactly. */
const YARD = FOOT.times(3);
/** 1 mile = 5280 feet exactly. */
const MILE = FOOT.times(5280);
/** 1 pound = 0.45359237 kg exactly (NIST SP 811 footnote: the exact conversion factor is 4.535 923 7 E-01). */
const POUND = d('0.45359237');
/** 1 ounce = 1/16 pound (Handbook 44, avoirdupois units of mass). */
const OUNCE = POUND.div(16);
/** 1 grain = 1/7000 pound (Handbook 44; NIST SP 811 prints 6.479 891 E-05 in boldface). */
const GRAIN = POUND.div(7000);
/** The standard acceleration of free fall, 9.80665 m/s2 exactly (NIST SP 811 B.8, boldface). */
const GN = d('9.80665');
/** 1 pound-force = 1 pound x gn (NIST SP 811 footnote: 4.448 221 615 260 5 E+00 exactly). */
const POUND_FORCE = POUND.times(GN);
/** 1 U.S. gallon = 231 cubic inches exactly (Handbook 44). */
const GALLON = INCH.pow(3).times(231);
/** 1 imperial gallon = 4.54609 litres exactly (NIST SP 811 B.8, boldface). */
const IMPERIAL_GALLON = d('0.00454609');
/** 1 conventional millimeter of mercury = 13 595.1 kg/m3 x gn x 1 mm (ISO 80000-3, not stated exact by NIST). */
const MMHG = d('13595.1').times(GN).times('0.001');

// ---------------------------------------------------------------------------------------------------------------------
// The table

function prefixed(
  base: { id: string; symbol: string; names: string[]; aliases?: string[] },
  prefix: { name: string; symbol: string; power: number; aliases?: string[]; nameAliases?: string[] },
  baseNames: string[],
  exact = true,
): Spec {
  const names = baseNames.flatMap((baseName) => [
    `${prefix.name}${baseName}`,
    ...(prefix.nameAliases ?? []).map((alias) => `${alias}${baseName}`),
  ]);
  return {
    id: `${prefix.symbol === MICRO ? 'u' : prefix.symbol}${base.symbol}`,
    symbol: `${prefix.symbol}${base.symbol}`,
    names,
    aliases: (prefix.aliases ?? []).map((alias) => `${alias}${base.symbol}`),
    num: ten(prefix.power),
    exact,
    definition: `1 ${prefix.symbol}${base.symbol} = 10^${prefix.power} ${base.symbol} (an SI prefix, exact)`,
  };
}

const PREFIX = {
  nano: { name: 'nano', symbol: 'n', power: -9 },
  micro: { name: 'micro', symbol: MICRO, power: -6, aliases: [GREEK_MU, 'u'] },
  milli: { name: 'milli', symbol: 'm', power: -3 },
  centi: { name: 'centi', symbol: 'c', power: -2 },
  hecto: { name: 'hecto', symbol: 'h', power: 2 },
  kilo: { name: 'kilo', symbol: 'k', power: 3 },
  mega: { name: 'mega', symbol: 'M', power: 6 },
  giga: { name: 'giga', symbol: 'G', power: 9 },
};

/** Both spellings of metre and litre are accepted. */
const withBoth = (singular: string, american: string, british: string): string[] => [
  `${singular}${american}`,
  `${singular}${american}s`,
  `${singular}${british}`,
  `${singular}${british}s`,
];

function lengthUnits(): UnitDef[] {
  const m = { id: 'm', symbol: 'm', names: ['meter'] };
  const metre = (prefix: keyof typeof PREFIX, extraNames: string[] = []): Spec => {
    const p = PREFIX[prefix];
    const spec = prefixed(m, p, ['meter', 'meters', 'metre', 'metres']);
    spec.names.push(...extraNames);
    return spec;
  };
  return [
    unit({
      id: 'm',
      symbol: 'm',
      names: ['meter', 'meters', 'metre', 'metres'],
      num: 1,
      exact: true,
      definition: 'The meter is the SI base unit of length.',
    }),
    unit(metre('kilo')),
    unit(metre('centi')),
    unit(metre('milli')),
    unit(metre('micro', ['micron', 'microns'])),
    unit(metre('nano')),
    unit(metre('mega')),
    unit({
      id: 'in',
      symbol: 'in',
      names: ['inch', 'inches'],
      num: INCH,
      exact: true,
      definition: '1 inch = 0.0254 m exactly.',
    }),
    unit({
      id: 'ft',
      symbol: 'ft',
      names: ['foot', 'feet'],
      num: FOOT,
      exact: true,
      definition: '1 foot = 12 inches = 0.3048 m exactly.',
    }),
    unit({
      id: 'yd',
      symbol: 'yd',
      names: ['yard', 'yards'],
      num: YARD,
      exact: true,
      definition: '1 yard = 3 feet = 0.9144 m exactly.',
    }),
    unit({
      id: 'mi',
      symbol: 'mi',
      names: ['mile', 'miles'],
      num: MILE,
      exact: true,
      definition: '1 mile = 5280 feet = 1609.344 m exactly.',
    }),
    unit({
      id: 'nmi',
      symbol: 'nmi',
      names: ['nautical mile', 'nautical miles'],
      aliases: ['NM'],
      num: 1852,
      exact: true,
      definition: '1 nautical mile = 1852 m exactly.',
    }),
  ];
}

function massUnits(): UnitDef[] {
  const g = { id: 'g', symbol: 'g', names: ['gram'] };
  const gram = (prefix: keyof typeof PREFIX | 'none'): Spec => {
    if (prefix === 'none') {
      return {
        id: 'g',
        symbol: 'g',
        names: ['gram', 'grams'],
        num: '0.001',
        exact: true,
        definition: '1 g = 0.001 kg (the kilogram is the SI base unit of mass).',
      };
    }
    const spec = prefixed(g, PREFIX[prefix], ['gram', 'grams']);
    // The kilogram is the base unit, so the prefixes are counted from the gram, which is 0.001 kg.
    spec.num = ten(PREFIX[prefix].power - 3);
    spec.definition = `1 ${spec.symbol} = 10^${PREFIX[prefix].power} g = 10^${PREFIX[prefix].power - 3} kg (an SI prefix, exact).`;
    return spec;
  };
  const kg = unit({
    id: 'kg',
    symbol: 'kg',
    names: ['kilogram', 'kilograms', 'kilo', 'kilos'],
    num: 1,
    exact: true,
    definition: 'The kilogram is the SI base unit of mass.',
  });
  return [
    kg,
    unit(gram('none')),
    unit(gram('milli')),
    unit(gram('micro')),
    unit(gram('mega')),
    unit({
      id: 't',
      symbol: 't',
      names: ['tonne', 'tonnes', 'metric ton', 'metric tons'],
      num: 1000,
      exact: true,
      definition: '1 t = 1 Mg = 1000 kg exactly.',
    }),
    unit({
      id: 'lb',
      symbol: 'lb',
      names: ['pound', 'pounds', 'lbs'],
      aliases: ['lbs'],
      num: POUND,
      exact: true,
      definition: '1 pound (avoirdupois) = 0.45359237 kg exactly.',
    }),
    unit({
      id: 'oz',
      symbol: 'oz',
      names: ['ounce', 'ounces'],
      num: OUNCE,
      exact: true,
      definition: '1 ounce (avoirdupois) = 1/16 pound = 0.028349523125 kg exactly.',
    }),
    unit({
      id: 'gr',
      symbol: 'gr',
      names: ['grain', 'grains'],
      num: GRAIN,
      exact: true,
      definition: '1 grain = 1/7000 pound = 0.00006479891 kg exactly.',
    }),
    unit({
      id: 'short-ton',
      symbol: 'sh tn',
      names: ['short ton', 'short tons', 'us ton', 'us tons'],
      num: POUND.times(2000),
      exact: true,
      definition: '1 short ton = 2000 pounds = 907.18474 kg exactly.',
    }),
    unit({
      id: 'long-ton',
      symbol: 'long tn',
      names: ['long ton', 'long tons', 'imperial ton', 'imperial tons'],
      num: POUND.times(2240),
      exact: true,
      definition: '1 long ton = 2240 pounds = 1016.0469088 kg exactly.',
    }),
  ];
}

function temperatureUnits(): UnitDef[] {
  return [
    unit({
      id: 'K',
      symbol: 'K',
      names: ['kelvin', 'kelvins'],
      num: 1,
      kind: 'affine',
      offset: '0',
      exact: true,
      definition: 'The kelvin is the SI base unit of thermodynamic temperature; 0 K is absolute zero.',
    }),
    unit({
      id: 'C',
      symbol: `${DEGREE}C`,
      names: ['celsius', 'degree celsius', 'degrees celsius'],
      aliases: ['C', 'degC'],
      num: 1,
      kind: 'affine',
      offset: '273.15',
      exact: true,
      definition:
        'T/K = t/degC + 273.15 (NIST SP 811 B.9; the Celsius scale is the kelvin scale shifted by exactly 273.15).',
    }),
    unit({
      id: 'F',
      symbol: `${DEGREE}F`,
      names: ['fahrenheit', 'degree fahrenheit', 'degrees fahrenheit'],
      aliases: ['F', 'degF'],
      num: 5,
      den: 9,
      kind: 'affine',
      offset: '459.67',
      exact: true,
      definition: 'T/K = (t/degF + 459.67) / 1.8 (NIST SP 811 B.9); 5/9 is exact.',
    }),
    unit({
      id: 'R',
      symbol: `${DEGREE}R`,
      names: ['rankine', 'degree rankine', 'degrees rankine'],
      aliases: ['R', 'degR'],
      num: 5,
      den: 9,
      kind: 'affine',
      offset: '0',
      exact: true,
      definition: 'T/K = (T/degR) / 1.8 (NIST SP 811 B.9); 5/9 is exact.',
    }),
  ];
}

function volumeUnits(): UnitDef[] {
  const cubic = (
    symbol: string,
    plain: string,
    factor: Dec,
    names: string[],
    definition: string,
    aliases: string[] = [],
  ): Spec => ({
    id: plain,
    symbol,
    names,
    aliases: [plain, ...aliases],
    num: factor,
    exact: true,
    definition,
  });
  return [
    unit(
      cubic(
        `m${SUP3}`,
        'm3',
        d(1),
        ['cubic meter', 'cubic meters', 'cubic metre', 'cubic metres'],
        '1 m3 is the SI unit of volume.',
      ),
    ),
    unit({
      id: 'L',
      symbol: 'L',
      names: withBoth('lit', 'er', 're'),
      aliases: ['l'],
      num: '0.001',
      exact: true,
      definition: '1 L = 1 dm3 = 0.001 m3 exactly (SI Brochure, Table 8).',
    }),
    unit({
      id: 'mL',
      symbol: 'mL',
      names: withBoth('millilit', 'er', 're'),
      aliases: ['ml'],
      num: '0.000001',
      exact: true,
      definition: '1 mL = 1 cm3 = 0.000001 m3 exactly.',
    }),
    unit(
      cubic(
        `cm${SUP3}`,
        'cm3',
        d('0.000001'),
        ['cubic centimeter', 'cubic centimeters', 'cubic centimetre', 'cubic centimetres'],
        '1 cm3 = 0.000001 m3 exactly.',
      ),
    ),
    unit(
      cubic(
        `in${SUP3}`,
        'in3',
        INCH.pow(3),
        ['cubic inch', 'cubic inches'],
        '1 cubic inch = 16.387064 cm3 exactly (NIST SP 811 footnote: 1.638 706 4 E-05 m3).',
      ),
    ),
    unit(
      cubic(
        `ft${SUP3}`,
        'ft3',
        FOOT.pow(3),
        ['cubic foot', 'cubic feet'],
        '1 cubic foot = 1728 cubic inches exactly (Handbook 44).',
      ),
    ),
    unit({
      id: 'gal',
      symbol: 'gal',
      names: ['us gallon', 'us gallons', 'us liquid gallon', 'us liquid gallons'],
      aliases: ['US gal'],
      num: GALLON,
      exact: true,
      definition: '1 U.S. gallon = 231 cubic inches = 3.785411784 L exactly (Handbook 44).',
    }),
    unit({
      id: 'qt',
      symbol: 'qt',
      names: ['us quart', 'us quarts', 'us liquid quart', 'us liquid quarts'],
      aliases: ['US qt'],
      num: GALLON.div(4),
      exact: true,
      definition: '1 U.S. quart = 1/4 U.S. gallon = 57.75 cubic inches exactly (Handbook 44).',
    }),
    unit({
      id: 'pt',
      symbol: 'pt',
      names: ['us pint', 'us pints', 'us liquid pint', 'us liquid pints'],
      aliases: ['US pt'],
      num: GALLON.div(8),
      exact: true,
      definition: '1 U.S. pint = 1/8 U.S. gallon = 28.875 cubic inches exactly (Handbook 44).',
    }),
    unit({
      id: 'cup',
      symbol: 'cup',
      names: ['us cup', 'us cups'],
      aliases: ['US cup'],
      num: GALLON.div(16),
      exact: true,
      definition: '1 U.S. cup = 8 U.S. fluid ounces = 1/16 U.S. gallon exactly (Handbook 44).',
    }),
    unit({
      id: 'fl-oz',
      symbol: 'fl oz',
      names: ['us fluid ounce', 'us fluid ounces', 'us fl oz'],
      aliases: ['US fl oz'],
      num: GALLON.div(128),
      exact: true,
      definition: '1 U.S. fluid ounce = 1/128 U.S. gallon exactly (Handbook 44).',
    }),
    unit({
      id: 'imp-gal',
      symbol: 'imp gal',
      names: ['imperial gallon', 'imperial gallons', 'uk gallon', 'uk gallons'],
      num: IMPERIAL_GALLON,
      exact: true,
      definition: '1 imperial gallon = 4.54609 L exactly (NIST SP 811 B.8, boldface).',
    }),
  ];
}

function areaUnits(): UnitDef[] {
  const square = (
    symbol: string,
    plain: string,
    factor: Dec,
    names: string[],
    definition: string,
    exact = true,
  ): Spec => ({
    id: plain,
    symbol,
    names,
    aliases: [plain],
    num: factor,
    exact,
    definition,
  });
  return [
    unit(
      square(
        `m${SUP2}`,
        'm2',
        d(1),
        ['square meter', 'square meters', 'square metre', 'square metres'],
        '1 m2 is the SI unit of area.',
      ),
    ),
    unit(
      square(
        `km${SUP2}`,
        'km2',
        ten(6),
        ['square kilometer', 'square kilometers', 'square kilometre', 'square kilometres'],
        '1 km2 = 1 000 000 m2 exactly.',
      ),
    ),
    unit(
      square(
        `cm${SUP2}`,
        'cm2',
        ten(-4),
        ['square centimeter', 'square centimeters', 'square centimetre', 'square centimetres'],
        '1 cm2 = 0.0001 m2 exactly.',
      ),
    ),
    unit(
      square(
        `mm${SUP2}`,
        'mm2',
        ten(-6),
        ['square millimeter', 'square millimeters', 'square millimetre', 'square millimetres'],
        '1 mm2 = 0.000001 m2 exactly.',
      ),
    ),
    unit({
      id: 'ha',
      symbol: 'ha',
      names: ['hectare', 'hectares'],
      num: 10000,
      exact: true,
      definition: '1 ha = 1 hm2 = 10 000 m2 exactly (SI Brochure, Table 8).',
    }),
    unit(
      square(
        `in${SUP2}`,
        'in2',
        INCH.pow(2),
        ['square inch', 'square inches'],
        '1 square inch = 6.4516 cm2 = 0.00064516 m2 exactly.',
      ),
    ),
    unit(
      square(
        `ft${SUP2}`,
        'ft2',
        FOOT.pow(2),
        ['square foot', 'square feet'],
        '1 square foot = 144 square inches = 0.09290304 m2 exactly.',
      ),
    ),
    unit(
      square(
        `yd${SUP2}`,
        'yd2',
        YARD.pow(2),
        ['square yard', 'square yards'],
        '1 square yard = 9 square feet = 0.83612736 m2 exactly.',
      ),
    ),
    unit(
      square(
        `mi${SUP2}`,
        'mi2',
        MILE.pow(2),
        ['square mile', 'square miles'],
        '1 square mile = 640 acres = 2 589 988.110336 m2 exactly.',
      ),
    ),
    unit({
      id: 'ac',
      symbol: 'ac',
      names: ['acre', 'acres'],
      num: FOOT.pow(2).times(43560),
      exact: true,
      definition: '1 acre = 43 560 square feet = 4046.8564224 m2 exactly (international foot, Handbook 44).',
    }),
  ];
}

function speedUnits(): UnitDef[] {
  return [
    unit({
      id: 'm/s',
      symbol: 'm/s',
      names: ['meter per second', 'meters per second', 'metre per second', 'metres per second'],
      aliases: ['mps'],
      num: 1,
      exact: true,
      definition: '1 m/s is the SI unit of speed.',
    }),
    unit({
      id: 'km/h',
      symbol: 'km/h',
      names: ['kilometer per hour', 'kilometers per hour', 'kilometre per hour', 'kilometres per hour'],
      aliases: ['kph', 'kmh'],
      num: 1000,
      den: 3600,
      exact: true,
      definition: '1 km/h = 1000 m per 3600 s = 5/18 m/s exactly; the decimal does not end.',
    }),
    unit({
      id: 'mi/h',
      symbol: 'mi/h',
      names: ['mile per hour', 'miles per hour'],
      aliases: ['mph'],
      num: MILE,
      den: 3600,
      exact: true,
      definition: '1 mi/h = 0.44704 m/s exactly (NIST SP 811 B.8, boldface).',
    }),
    unit({
      id: 'ft/s',
      symbol: 'ft/s',
      names: ['foot per second', 'feet per second'],
      aliases: ['fps'],
      num: FOOT,
      exact: true,
      definition: '1 ft/s = 0.3048 m/s exactly.',
    }),
    unit({
      id: 'kn',
      symbol: 'kn',
      names: ['knot', 'knots'],
      aliases: ['kt'],
      num: 1852,
      den: 3600,
      exact: true,
      definition:
        '1 knot = 1 nautical mile per hour = 1852/3600 m/s exactly (SI Brochure, Table 8); the decimal does not end.',
    }),
  ];
}

function pressureUnits(): UnitDef[] {
  return [
    unit({
      id: 'Pa',
      symbol: 'Pa',
      names: ['pascal', 'pascals'],
      num: 1,
      exact: true,
      definition: '1 Pa = 1 N/m2 is the SI unit of pressure.',
    }),
    unit({
      id: 'hPa',
      symbol: 'hPa',
      names: ['hectopascal', 'hectopascals'],
      num: 100,
      exact: true,
      definition: '1 hPa = 100 Pa exactly (an SI prefix).',
    }),
    unit({
      id: 'kPa',
      symbol: 'kPa',
      names: ['kilopascal', 'kilopascals'],
      num: 1000,
      exact: true,
      definition: '1 kPa = 1000 Pa exactly (an SI prefix).',
    }),
    unit({
      id: 'MPa',
      symbol: 'MPa',
      names: ['megapascal', 'megapascals'],
      num: ten(6),
      exact: true,
      definition: '1 MPa = 1 000 000 Pa exactly (an SI prefix).',
    }),
    unit({
      id: 'bar',
      symbol: 'bar',
      names: ['bar', 'bars'],
      num: ten(5),
      exact: true,
      definition: '1 bar = 100 000 Pa exactly (SI Brochure, Table 8).',
    }),
    unit({
      id: 'atm',
      symbol: 'atm',
      names: ['standard atmosphere', 'standard atmospheres', 'atmosphere', 'atmospheres'],
      num: 101325,
      exact: true,
      definition: '1 standard atmosphere = 101 325 Pa exactly (NIST SP 811 B.3).',
    }),
    unit({
      id: 'psi',
      symbol: 'psi',
      names: ['pound-force per square inch', 'pounds per square inch', 'pound per square inch'],
      num: POUND_FORCE,
      den: INCH.pow(2),
      exact: true,
      definition:
        '1 psi = 1 pound-force per square inch = (0.45359237 kg x 9.80665 m/s2) / (0.0254 m)2; the decimal does not end.',
    }),
    unit({
      id: 'mmHg',
      symbol: 'mmHg',
      names: ['millimeter of mercury', 'millimeters of mercury', 'millimetre of mercury', 'millimetres of mercury'],
      num: MMHG,
      exact: false,
      definition:
        '1 conventional millimeter of mercury = 13 595.1 kg/m3 x 9.80665 m/s2 x 1 mm = 133.322387415 Pa (ISO 80000-3); NIST SP 811 prints it rounded.',
    }),
    unit({
      id: 'inHg',
      symbol: 'inHg',
      names: ['inch of mercury', 'inches of mercury'],
      num: MMHG.times(25.4),
      exact: false,
      definition:
        '1 conventional inch of mercury = 25.4 mmHg = 3386.388640341 Pa (ISO 80000-3); NIST SP 811 prints it rounded.',
    }),
    unit({
      id: 'Torr',
      symbol: 'Torr',
      names: ['torr'],
      aliases: ['torr'],
      num: 101325,
      den: 760,
      exact: false,
      definition: '1 torr = 101 325/760 Pa; NIST SP 811 prints it rounded.',
    }),
  ];
}

function energyUnits(): UnitDef[] {
  const BTU_IT = d('4.1868').times(POUND).times(1000).div(new D(9).div(5));
  return [
    unit({
      id: 'J',
      symbol: 'J',
      names: ['joule', 'joules'],
      num: 1,
      exact: true,
      definition: '1 J = 1 N m is the SI unit of energy.',
    }),
    unit({
      id: 'mJ',
      symbol: 'mJ',
      names: ['millijoule', 'millijoules'],
      num: '0.001',
      exact: true,
      definition: '1 mJ = 0.001 J exactly (an SI prefix).',
    }),
    unit({
      id: 'kJ',
      symbol: 'kJ',
      names: ['kilojoule', 'kilojoules'],
      num: 1000,
      exact: true,
      definition: '1 kJ = 1000 J exactly (an SI prefix).',
    }),
    unit({
      id: 'MJ',
      symbol: 'MJ',
      names: ['megajoule', 'megajoules'],
      num: ten(6),
      exact: true,
      definition: '1 MJ = 1 000 000 J exactly (an SI prefix).',
    }),
    unit({
      id: 'Wh',
      symbol: 'Wh',
      names: ['watt hour', 'watt hours', 'watt-hour', 'watt-hours'],
      num: 3600,
      exact: true,
      definition: '1 Wh = 3600 J exactly (NIST SP 811 B.8, boldface).',
    }),
    unit({
      id: 'kWh',
      symbol: 'kWh',
      names: ['kilowatt hour', 'kilowatt hours', 'kilowatt-hour', 'kilowatt-hours'],
      num: 3600000,
      exact: true,
      definition: '1 kWh = 3 600 000 J exactly (NIST SP 811 B.8, boldface).',
    }),
    unit({
      id: 'cal',
      symbol: 'cal',
      names: ['calorie', 'calories', 'thermochemical calorie', 'thermochemical calories'],
      aliases: ['cal_th'],
      num: '4.184',
      exact: true,
      definition: '1 thermochemical calorie = 4.184 J exactly (NIST SP 811 B.8, boldface).',
    }),
    unit({
      id: 'kcal',
      symbol: 'kcal',
      names: ['kilocalorie', 'kilocalories', 'thermochemical kilocalorie'],
      aliases: ['kcal_th'],
      num: '4184',
      exact: true,
      definition: '1 thermochemical kilocalorie = 4184 J exactly (NIST SP 811 B.8, boldface).',
    }),
    unit({
      id: 'cal-it',
      symbol: 'cal_IT',
      names: ['international table calorie', 'international table calories', 'it calorie', 'it calories'],
      num: '4.1868',
      exact: true,
      definition: '1 International Table calorie = 4.1868 J exactly (NIST SP 811 B.8, boldface).',
    }),
    unit({
      id: 'btu-it',
      symbol: 'Btu_IT',
      names: ['international table btu', 'it btu', 'btu'],
      aliases: ['Btu', 'BTU'],
      num: BTU_IT,
      exact: true,
      definition: '1 International Table Btu = 1055.05585262 J exactly (NIST SP 811 footnote: 1.055 055 852 62 kJ).',
    }),
    unit({
      id: 'eV',
      symbol: 'eV',
      names: ['electronvolt', 'electronvolts', 'electron volt', 'electron volts'],
      num: '1.602176634e-19',
      exact: true,
      definition:
        '1 eV = 1.602 176 634 x 10^-19 J exactly (the elementary charge is exact in the 2019 SI; SI Brochure, Table 8).',
    }),
  ];
}

function powerUnits(): UnitDef[] {
  return [
    unit({
      id: 'W',
      symbol: 'W',
      names: ['watt', 'watts'],
      num: 1,
      exact: true,
      definition: '1 W = 1 J/s is the SI unit of power.',
    }),
    unit({
      id: 'mW',
      symbol: 'mW',
      names: ['milliwatt', 'milliwatts'],
      num: '0.001',
      exact: true,
      definition: '1 mW = 0.001 W exactly (an SI prefix).',
    }),
    unit({
      id: 'kW',
      symbol: 'kW',
      names: ['kilowatt', 'kilowatts'],
      num: 1000,
      exact: true,
      definition: '1 kW = 1000 W exactly (an SI prefix).',
    }),
    unit({
      id: 'MW',
      symbol: 'MW',
      names: ['megawatt', 'megawatts'],
      num: ten(6),
      exact: true,
      definition: '1 MW = 1 000 000 W exactly (an SI prefix).',
    }),
    unit({
      id: 'hp',
      symbol: 'hp',
      names: ['horsepower', 'mechanical horsepower'],
      num: FOOT.times(POUND_FORCE).times(550),
      exact: true,
      definition:
        '1 horsepower = 550 foot-pounds-force per second = 745.69987158227022 W exactly (pound-force from the NIST SP 811 footnote).',
    }),
    unit({
      id: 'ps',
      symbol: 'PS',
      names: ['metric horsepower'],
      aliases: ['hp (metric)', 'CV'],
      num: GN.times(75),
      exact: false,
      definition:
        '1 metric horsepower = 75 kilogram-force meters per second = 735.49875 W; NIST SP 811 prints it rounded.',
    }),
    unit({
      id: 'hp-e',
      symbol: 'hp (electric)',
      names: ['electric horsepower'],
      num: 746,
      exact: true,
      definition: '1 electric horsepower = 746 W exactly (NIST SP 811 B.8, boldface).',
    }),
  ];
}

function angleUnits(): UnitDef[] {
  return [
    unit({
      id: 'rad',
      symbol: 'rad',
      names: ['radian', 'radians'],
      num: 1,
      exact: true,
      definition: '1 rad is the SI unit of plane angle.',
    }),
    unit({
      id: 'deg',
      symbol: DEGREE,
      names: ['degree', 'degrees'],
      aliases: ['deg'],
      num: 1,
      den: 180,
      pi: true,
      exact: true,
      definition: '1 degree = pi/180 rad exactly (SI Brochure, Table 8); pi does not end.',
    }),
    unit({
      id: 'arcmin',
      symbol: PRIME,
      names: ['arcminute', 'arcminutes', 'minute of arc', 'minutes of arc'],
      aliases: ['arcmin'],
      num: 1,
      den: 10800,
      pi: true,
      exact: true,
      definition: '1 arcminute = (1/60) degree = pi/10 800 rad exactly (SI Brochure, Table 8).',
    }),
    unit({
      id: 'arcsec',
      symbol: DOUBLE_PRIME,
      names: ['arcsecond', 'arcseconds', 'second of arc', 'seconds of arc'],
      aliases: ['arcsec'],
      num: 1,
      den: 648000,
      pi: true,
      exact: true,
      definition: '1 arcsecond = (1/60) arcminute = pi/648 000 rad exactly (SI Brochure, Table 8).',
    }),
    unit({
      id: 'gon',
      symbol: 'gon',
      names: ['gon', 'gons', 'gradian', 'gradians', 'grade', 'grades'],
      num: 1,
      den: 200,
      pi: true,
      exact: true,
      definition: '1 gon = 0.9 degree = pi/200 rad exactly (NIST SP 811 B.8, boldface).',
    }),
    unit({
      id: 'rev',
      symbol: 'rev',
      names: ['revolution', 'revolutions', 'turn', 'turns'],
      num: 2,
      pi: true,
      exact: true,
      definition: '1 revolution = 2 pi rad; pi does not end.',
    }),
  ];
}

function fuelEconomyUnits(): UnitDef[] {
  // The base is litres per 100 km. A reciprocal unit measures distance per volume, so its factor is the litres per
  // 100 km that one unit stands for, and base = factor / value.
  const perHundredKm = (volumeLitres: Dec, distanceMetres: Dec): { num: Dec; den: Dec } => ({
    num: volumeLitres.times(100000),
    den: distanceMetres,
  });
  const usMpg = perHundredKm(GALLON.times(1000), MILE);
  const impMpg = perHundredKm(IMPERIAL_GALLON.times(1000), MILE);
  const miPerLitre = perHundredKm(d(1), MILE);
  return [
    unit({
      id: 'L/100km',
      symbol: 'L/100 km',
      names: [
        'liter per 100 kilometers',
        'liters per 100 kilometers',
        'litre per 100 kilometres',
        'litres per 100 kilometres',
      ],
      aliases: ['L/100km', 'l/100km', 'l/100 km'],
      num: 1,
      exact: true,
      definition:
        'Litres of fuel for 100 kilometres; the base unit of this quantity, and a consumption, not a distance per volume.',
    }),
    unit({
      id: 'km/L',
      symbol: 'km/L',
      names: ['kilometer per liter', 'kilometers per liter', 'kilometre per litre', 'kilometres per litre'],
      aliases: ['km/l', 'kmpl'],
      num: 100,
      kind: 'reciprocal',
      exact: true,
      definition: 'Kilometres per litre is the reciprocal of litres per kilometre: L/100 km = 100 / (km/L).',
    }),
    unit({
      id: 'mpg',
      symbol: 'mpg (US)',
      names: ['mile per us gallon', 'miles per us gallon', 'us miles per gallon'],
      aliases: ['mpg', 'mpg US', 'mpgUS'],
      num: usMpg.num,
      den: usMpg.den,
      kind: 'reciprocal',
      exact: true,
      definition:
        '1 mile per U.S. gallon = (100 000 m x 3.785411784 L) / 1609.344 m = 235.2145833... L/100 km divided by the value; the decimal does not end.',
    }),
    unit({
      id: 'mpg-imp',
      symbol: 'mpg (imp)',
      names: ['mile per imperial gallon', 'miles per imperial gallon', 'imperial miles per gallon'],
      aliases: ['mpg imp', 'mpg UK', 'mpgUK'],
      num: impMpg.num,
      den: impMpg.den,
      kind: 'reciprocal',
      exact: true,
      definition:
        '1 mile per imperial gallon = (100 000 m x 4.54609 L) / 1609.344 m = 282.4809363... L/100 km divided by the value; the decimal does not end.',
    }),
    unit({
      id: 'mi/L',
      symbol: 'mi/L',
      names: ['mile per liter', 'miles per liter', 'mile per litre', 'miles per litre'],
      aliases: ['mi/l'],
      num: miPerLitre.num,
      den: miPerLitre.den,
      kind: 'reciprocal',
      exact: true,
      definition:
        '1 mile per litre = 1 L per 1609.344 m = (1 L x 100 000 m) / 1609.344 m = 62.13711922... L/100 km divided by the value; the decimal does not end.',
    }),
  ];
}

function chargeUnits(): UnitDef[] {
  return [
    unit({
      id: 'C',
      symbol: 'C',
      names: ['coulomb', 'coulombs'],
      num: 1,
      exact: true,
      definition: '1 C = 1 A s is the SI unit of electric charge.',
    }),
    unit({
      id: 'mC',
      symbol: 'mC',
      names: ['millicoulomb', 'millicoulombs'],
      num: '0.001',
      exact: true,
      definition: '1 mC = 0.001 C exactly (an SI prefix).',
    }),
    unit({
      id: 'uC',
      symbol: `${MICRO}C`,
      names: ['microcoulomb', 'microcoulombs'],
      aliases: [`${GREEK_MU}C`, 'uC'],
      num: ten(-6),
      exact: true,
      definition: '1 microcoulomb = 0.000001 C exactly (an SI prefix).',
    }),
    unit({
      id: 'kC',
      symbol: 'kC',
      names: ['kilocoulomb', 'kilocoulombs'],
      num: 1000,
      exact: true,
      definition: '1 kC = 1000 C exactly (an SI prefix).',
    }),
    unit({
      id: 'Ah',
      symbol: 'Ah',
      names: ['ampere hour', 'ampere hours', 'ampere-hour', 'ampere-hours', 'amp hour', 'amp hours'],
      num: 3600,
      exact: true,
      definition: '1 Ah = 3600 C exactly (NIST SP 811 B.8, boldface).',
    }),
    unit({
      id: 'mAh',
      symbol: 'mAh',
      names: ['milliampere hour', 'milliampere hours', 'milliampere-hour', 'milliampere-hours'],
      num: '3.6',
      exact: true,
      definition: '1 mAh = 0.001 Ah = 3.6 C exactly.',
    }),
    unit({
      id: 'e',
      symbol: 'e',
      names: ['elementary charge', 'elementary charges'],
      num: '1.602176634e-19',
      exact: true,
      definition: '1 elementary charge = 1.602 176 634 x 10^-19 C exactly (the 2019 SI defining constant).',
    }),
  ];
}

function frequencyUnits(): UnitDef[] {
  return [
    unit({
      id: 'Hz',
      symbol: 'Hz',
      names: ['hertz'],
      num: 1,
      exact: true,
      definition: '1 Hz = 1 per second is the SI unit of frequency.',
    }),
    unit({
      id: 'mHz',
      symbol: 'mHz',
      names: ['millihertz'],
      num: '0.001',
      exact: true,
      definition: '1 mHz = 0.001 Hz exactly (an SI prefix).',
    }),
    unit({
      id: 'kHz',
      symbol: 'kHz',
      names: ['kilohertz'],
      num: 1000,
      exact: true,
      definition: '1 kHz = 1000 Hz exactly (an SI prefix).',
    }),
    unit({
      id: 'MHz',
      symbol: 'MHz',
      names: ['megahertz'],
      num: ten(6),
      exact: true,
      definition: '1 MHz = 1 000 000 Hz exactly (an SI prefix).',
    }),
    unit({
      id: 'GHz',
      symbol: 'GHz',
      names: ['gigahertz'],
      num: ten(9),
      exact: true,
      definition: '1 GHz = 1 000 000 000 Hz exactly (an SI prefix).',
    }),
    unit({
      id: 'rpm',
      symbol: 'rpm',
      names: ['revolution per minute', 'revolutions per minute', 'cycle per minute', 'cycles per minute'],
      aliases: ['r/min'],
      num: 1,
      den: 60,
      exact: true,
      definition: '1 revolution per minute = 1/60 Hz exactly; the decimal does not end.',
    }),
  ];
}

function timeUnits(): UnitDef[] {
  return [
    unit({
      id: 's',
      symbol: 's',
      names: ['second', 'seconds'],
      aliases: ['sec'],
      num: 1,
      exact: true,
      definition: 'The second is the SI base unit of time.',
    }),
    unit({
      id: 'ms',
      symbol: 'ms',
      names: ['millisecond', 'milliseconds'],
      num: '0.001',
      exact: true,
      definition: '1 ms = 0.001 s exactly (an SI prefix).',
    }),
    unit({
      id: 'us',
      symbol: `${MICRO}s`,
      names: ['microsecond', 'microseconds'],
      aliases: [`${GREEK_MU}s`, 'us'],
      num: ten(-6),
      exact: true,
      definition: '1 microsecond = 0.000001 s exactly (an SI prefix).',
    }),
    unit({
      id: 'ns',
      symbol: 'ns',
      names: ['nanosecond', 'nanoseconds'],
      num: ten(-9),
      exact: true,
      definition: '1 ns = 0.000000001 s exactly (an SI prefix).',
    }),
    unit({
      id: 'min',
      symbol: 'min',
      names: ['minute', 'minutes'],
      num: 60,
      exact: true,
      definition: '1 minute = 60 s exactly (NIST SP 811 B.8, boldface).',
    }),
    unit({
      id: 'h',
      symbol: 'h',
      names: ['hour', 'hours'],
      aliases: ['hr'],
      num: 3600,
      exact: true,
      definition: '1 hour = 3600 s exactly (NIST SP 811 B.8, boldface).',
    }),
    unit({
      id: 'd',
      symbol: 'd',
      names: ['day', 'days'],
      num: 86400,
      exact: true,
      definition: '1 day = 86 400 s exactly (NIST SP 811 B.8, boldface).',
    }),
    unit({
      id: 'wk',
      symbol: 'wk',
      names: ['week', 'weeks'],
      num: 604800,
      exact: true,
      definition: '1 week = 7 days = 604 800 s exactly.',
    }),
    unit({
      id: 'yr',
      symbol: 'yr',
      names: ['year', 'years', 'year (365 days)'],
      aliases: ['y'],
      num: 31536000,
      exact: true,
      definition:
        '1 year (365 days) = 31 536 000 s exactly (NIST SP 811 B.8, boldface); not the tropical or sidereal year.',
    }),
  ];
}

export const UNITS: Record<Quantity, UnitDef[]> = {
  length: lengthUnits(),
  mass: massUnits(),
  temperature: temperatureUnits(),
  volume: volumeUnits(),
  area: areaUnits(),
  speed: speedUnits(),
  pressure: pressureUnits(),
  energy: energyUnits(),
  power: powerUnits(),
  angle: angleUnits(),
  'fuel-economy': fuelEconomyUnits(),
  charge: chargeUnits(),
  frequency: frequencyUnits(),
  time: timeUnits(),
};
