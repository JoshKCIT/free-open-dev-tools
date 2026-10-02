import Decimal from 'decimal.js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QUANTITIES, UNITS, UnitConverterError, convertUnit, findUnit, listUnits, type Quantity } from '../src/index';
import { EXACT_NOTES, NIST_ROWS, TEMPERATURE_FORMULAS } from './fixtures/nist-sp811-b8/rows';

/*
 * Grounding (D-179, P13-08, P13-10).
 *
 * Nothing here treats this folder's own output as the expected value. The expected values come from four places, all
 * fetched on 2026-10-02:
 *
 *  - NIST SP 811 Appendix B.8 (https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors/nist-guide-si-appendix-b8):
 *    the printed factors and whether NIST prints them in boldface. Appendix B.2 says "A factor in boldface is exact. All
 *    other factors have been rounded to the significant digits given". The rows are copied into
 *    test/fixtures/nist-sp811-b8/rows.ts by a script (see UPSTREAM.md). Appendix B.9 gives the temperature formulas
 *    (T/K = t/degC + 273.15, t/degC = (t/degF - 32)/1.8, T/K = (t/degF + 459.67)/1.8, T/K = (T/degR)/1.8), and
 *    Appendix B.7.1 gives the rounding rules and their examples: 6.974 951 5 rounded to 7 digits is 6.974 952 and
 *    6.974 950 5 rounded to 7 digits is 6.974 950 (a 5 followed by nothing but zeros rounds to the even digit).
 *  - The NIST SP 811 footnotes: the exact conversion factor of the pound is 4.535 923 7 E-01 and of the cubic inch
 *    1.638 706 4 E-05; the pound-force is 4.448 221 615 260 5 N; the International Table Btu is 1.055 055 852 62 kJ.
 *  - NIST Handbook 44 (2026) Appendix C: 1 U.S. gallon is 231 cubic inches (exactly), 128 U.S. fluid ounces (exactly);
 *    1 cup is 8 fluid ounces (exactly); 1 foot is 12 inches, 1 mile 5280 feet, 1 yard 3 feet, 1 acre 43 560 square feet.
 *  - The SI Brochure (9th edition): Table 8 (1 degree = pi/180 rad, 1 L = 10^-3 m3, 1 ha = 10^4 m2, 1 nautical mile =
 *    1852 m, 1 knot = 1852/3600 m/s, 1 eV = 1.602 176 634 x 10^-19 J) and the 2019 defining constants (the elementary
 *    charge is exactly 1.602 176 634 x 10^-19 C).
 *  - Python 3.14.3 (fractions.Fraction and decimal, no floating point) as a second opinion for every definition chain,
 *    written to 50 significant digits (round half even). Its output is quoted as literals in PYTHON below.
 */

const logs = {
  log: vi.spyOn(console, 'log'),
  warn: vi.spyOn(console, 'warn'),
  error: vi.spyOn(console, 'error'),
};

beforeEach(() => {
  for (const spy of Object.values(logs)) spy.mockClear();
});

afterEach(() => {
  // The package prints nothing.
  for (const spy of Object.values(logs)) expect(spy).not.toHaveBeenCalled();
});

/**
 * Python 3.14.3 (fractions.Fraction and decimal, no floating point), written to 50 significant digits, round half even.
 * Each definition is the one in the sources above: inch = 0.0254 m, foot = 12 in, yard = 3 ft, mile = 5280 ft, pound =
 * 0.45359237 kg, ounce = pound / 16, grain = pound / 7000, short ton = 2000 lb, long ton = 2240 lb, U.S. gallon = 231
 * cubic inches (quart, pint, cup and fluid ounce are 1/4, 1/8, 1/16 and 1/128 of it), imperial gallon = 0.00454609 m3,
 * pound-force = pound x 9.80665 m/s2, psi = pound-force / inch2, torr = 101325/760 Pa, knot = 1852/3600 m/s,
 * horsepower = 550 ft x pound-force per second, metric horsepower = 75 x 9.80665 W, Btu_IT = 4.1868 J/g x pound x 5/9,
 * mpg = 100 000 m x 3.785411784 L / 1609.344 m, mpg imperial the same with 4.54609 L. Every line is a number worked
 * out by the script literals.py, which prints them as JSON; none was typed.
 */
const PYTHON: Record<string, string> = {
  inch: '0.0254',
  foot: '0.3048',
  yard: '0.9144',
  mile: '1609.344',
  pound: '0.45359237',
  ounce: '0.028349523125',
  grain: '0.00006479891',
  'short ton': '907.18474',
  'long ton': '1016.0469088',
  'us gallon': '0.003785411784',
  'us quart': '0.000946352946',
  'us pint': '0.000473176473',
  'us cup': '0.0002365882365',
  'us fluid ounce': '0.0000295735295625',
  'imperial gallon': '0.00454609',
  'cubic inch': '0.000016387064',
  'cubic foot': '0.028316846592',
  'square yard': '0.83612736',
  'square mile': '2589988.110336',
  acre: '4046.8564224',
  atmosphere: '101325',
  psi: '6894.7572931683613367226734453468906937813875627751',
  torr: '133.32236842105263157894736842105263157894736842105',
  knot: '0.51444444444444444444444444444444444444444444444444',
  'km/h': '0.27777777777777777777777777777777777777777777777778',
  mph: '0.44704',
  hp: '745.69987158227022',
  'hp metric': '735.49875',
  'btu it': '1055.05585262',
  rpm: '0.016666666666666666666666666666666666666666666666667',
  'mpg us in L/100km': '235.21458333333333333333333333333333333333333333333',
  'mpg imp in L/100km': '282.48093633182215859381213711922373339696174341844',
  '30 mpg us in L/100km': '7.8404861111111111111111111111111111111111111111111',
  '1 mpg us in km/L': '0.42514370743027200340114965944217602720919727553741',
  '7.8 L/100km in mpg us': '30.155715811965811965811965811965811965811965811966',
};

const MICRO = String.fromCharCode(0xb5);
const GREEK_MU = String.fromCharCode(0x3bc);
const DEGREE = String.fromCharCode(0xb0);

function error(run: () => unknown): UnitConverterError {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(UnitConverterError);
    return err as UnitConverterError;
  }
  throw new Error('expected a UnitConverterError, but nothing was thrown');
}

it('exact definitions give exact factors for the inch, foot, yard, mile, pound, ounce, US gallon, atmosphere and psi', () => {
  const cases: [Quantity, string, string][] = [
    ['length', 'in', PYTHON['inch']!],
    ['length', 'ft', PYTHON['foot']!],
    ['length', 'yd', PYTHON['yard']!],
    ['length', 'mi', PYTHON['mile']!],
    ['mass', 'lb', PYTHON['pound']!],
    ['mass', 'oz', PYTHON['ounce']!],
    ['mass', 'gr', PYTHON['grain']!],
    ['mass', 'sh tn', PYTHON['short ton']!],
    ['mass', 'long tn', PYTHON['long ton']!],
    ['volume', 'gal', PYTHON['us gallon']!],
    ['volume', 'qt', PYTHON['us quart']!],
    ['volume', 'pt', PYTHON['us pint']!],
    ['volume', 'cup', PYTHON['us cup']!],
    ['volume', 'fl oz', PYTHON['us fluid ounce']!],
    ['volume', 'imp gal', PYTHON['imperial gallon']!],
    ['volume', 'in3', PYTHON['cubic inch']!],
    ['volume', 'ft3', PYTHON['cubic foot']!],
    ['area', 'yd2', PYTHON['square yard']!],
    ['area', 'mi2', PYTHON['square mile']!],
    ['area', 'ac', PYTHON['acre']!],
    ['pressure', 'atm', PYTHON['atmosphere']!],
    ['pressure', 'psi', PYTHON['psi']!],
    ['pressure', 'Torr', PYTHON['torr']!],
    ['speed', 'kn', PYTHON['knot']!],
    ['speed', 'km/h', PYTHON['km/h']!],
    ['speed', 'mi/h', PYTHON['mph']!],
    ['power', 'hp', PYTHON['hp']!],
    ['power', 'PS', PYTHON['hp metric']!],
    ['energy', 'Btu_IT', PYTHON['btu it']!],
    ['frequency', 'rpm', PYTHON['rpm']!],
  ];
  for (const [quantity, symbol, expected] of cases) {
    const unit = findUnit(quantity, symbol);
    // The factor is the exact value of the definition (to 50 significant digits where its decimal does not end).
    expect(unit.factor, `${quantity} ${symbol}`).toBe(expected);
    // A factor whose decimal ends has fewer than 50 digits, and one that does not end has all 50.
    const digits = expected.replace('.', '').replace(/^0+/, '').length;
    expect(unit.finite, `${quantity} ${symbol}`).toBe(digits < 50);
  }

  // The values the definitions are written in, as the sources state them: nothing here is a rounded published figure.
  expect(convertUnit('length', '1', 'in', 'm', 30).result).toBe('0.0254');
  expect(convertUnit('length', '1', 'ft', 'in', 30).result).toBe('12');
  expect(convertUnit('length', '1', 'mi', 'ft', 30).result).toBe('5280');
  expect(convertUnit('length', '1', 'yd', 'ft', 30).result).toBe('3');
  expect(convertUnit('mass', '1', 'lb', 'kg', 30).result).toBe('0.45359237');
  expect(convertUnit('mass', '1', 'lb', 'oz', 30).result).toBe('16');
  expect(convertUnit('mass', '1', 'lb', 'gr', 30).result).toBe('7000');
  expect(convertUnit('volume', '1', 'gal', 'in3', 30).result).toBe('231');
  expect(convertUnit('volume', '1', 'gal', 'fl oz', 30).result).toBe('128');
  expect(convertUnit('volume', '1', 'gal', 'cup', 30).result).toBe('16');
  expect(convertUnit('area', '1', 'ac', 'ft2', 30).result).toBe('43560');
  expect(convertUnit('area', '1', 'mi2', 'ac', 30).result).toBe('640');
  expect(convertUnit('pressure', '1', 'atm', 'Pa', 30).result).toBe('101325');
  // The psi comes from the pound-force over the square inch, so it is never a typed figure: 8 896 443 230 521 over
  // 1 290 320 000 pascal, and 6894.757293168361... to the digits asked for.
  expect(convertUnit('pressure', '1', 'psi', 'Pa', 30).result).toBe('6894.75729316836133672267344535');
  expect(convertUnit('pressure', '1', 'psi', 'Pa', 15).result).toBe('6894.75729316836');

  // The exact flag: the inch, pound and U.S. gallon are exact; the psi, the knot and a degree are exact definitions
  // whose decimals do not end, so the factor is shown rounded and marked so.
  for (const [quantity, from, to, exact] of [
    ['length', 'in', 'm', true],
    ['mass', 'lb', 'kg', true],
    ['volume', 'gal', 'L', true],
    ['pressure', 'atm', 'Pa', true],
    ['pressure', 'psi', 'Pa', false],
    ['speed', 'kn', 'm/s', false],
    ['speed', 'km/h', 'm/s', false],
    ['angle', DEGREE, 'rad', false],
    ['frequency', 'rpm', 'Hz', false],
    ['pressure', 'mmHg', 'Pa', false],
    ['power', 'PS', 'W', false],
  ] as const) {
    expect(convertUnit(quantity, '1', from, to, 10).exact, `${from} to ${to}`).toBe(exact);
  }
  // Both ends exact and the quotient finite: a kilometre per hour is a mile per hour divided by 1.609344.
  expect(convertUnit('speed', '1', 'mi/h', 'km/h', 30)).toMatchObject({ result: '1.609344', exact: true });
  // A knot is 1852/3600 m/s and a kilometre per hour 1000/3600 m/s, so one knot is exactly 1.852 km/h, a finite decimal.
  expect(convertUnit('speed', '1', 'kn', 'km/h', 30)).toMatchObject({ result: '1.852', exact: true });
  // The elementary charge and the electronvolt are exact in the 2019 SI (SI Brochure).
  expect(convertUnit('charge', '1', 'e', 'C', 30)).toMatchObject({ result: '1.602176634e-19', exact: true });
  expect(convertUnit('energy', '1', 'eV', 'J', 30)).toMatchObject({ result: '1.602176634e-19', exact: true });
  expect(convertUnit('charge', '1', 'Ah', 'C', 30)).toMatchObject({ result: '3600', exact: true });
  expect(convertUnit('charge', '1', 'mAh', 'C', 30)).toMatchObject({ result: '3.6', exact: true });
  // The survey foot is not offered: it is no longer used (NIST, from 2023-01-01).
  const survey = error(() => convertUnit('length', '1', 'survey foot', 'm', 10));
  expect(survey.field).toBe('From unit');
});

it('every factor rounded to the digits NIST SP 811 Appendix B.8 prints equals the printed value and every exact factor is bold there', () => {
  expect(NIST_ROWS.length).toBeGreaterThan(60);
  const notes = new Map(EXACT_NOTES.map((note) => [note.unit, note]));
  const usedNotes = new Set<string>();
  for (const row of NIST_ROWS) {
    const label = `${row.nistFrom} to ${row.nistTo}`;
    const digits = row.printed.replace(/ /g, '');
    const printed = new Decimal(`${digits}${row.exponent.replace('E', 'e')}`);
    const significant = digits.replace('.', '').length;
    const quantity = row.quantity as Quantity;
    const conversion = convertUnit(quantity, '1', row.from, row.to, 30);
    // The tool's factor, rounded half to even to the digits NIST printed, is the printed value.
    const rounded = new Decimal(conversion.result).toSignificantDigits(significant, Decimal.ROUND_HALF_EVEN);
    expect(rounded.toString(), `${label}: tool ${conversion.result}, printed ${row.printed} ${row.exponent}`).toBe(
      printed.toString(),
    );
    if (row.bold) {
      // NIST says a boldface factor is exact, and the tool says so too, with every digit NIST printed.
      expect(conversion.exact, `${label} is bold, so exact`).toBe(true);
      expect(new Decimal(conversion.result).eq(printed), `${label} equals the bold value`).toBe(true);
    } else if (conversion.exact) {
      // NIST prints the row rounded, so the exactness must come from a statement of NIST's own that is quoted here.
      const id = findUnit(quantity, row.from).id;
      const note = notes.get(`${quantity}:${id}`);
      expect(
        note,
        `${label} is exact in the tool but not bold: needs an exact note for ${quantity}:${id}`,
      ).toBeDefined();
      usedNotes.add(`${quantity}:${id}`);
    }
  }
  // Every note is used by at least one row, so none is left over.
  expect([...notes.keys()].filter((key) => !usedNotes.has(key))).toEqual([]);

  // Rows that carry the bold flag cover the definitions the plan names.
  const bold = NIST_ROWS.filter((row) => row.bold).map((row) => `${row.nistFrom} to ${row.nistTo}`);
  for (const expected of [
    'inch (in) to meter (m)',
    'foot (ft) to meter (m)',
    'yard (yd) to meter (m)',
    'mile (mi) to meter (m)',
  ]) {
    expect(bold).toContain(expected);
  }
  // The rows NIST prints without boldface are rounded in the tool too, unless NIST states the exact factor elsewhere.
  const rounded = NIST_ROWS.filter((row) => !row.bold).map((row) => row.nistFrom);
  expect(rounded.some((name) => name.startsWith('pound (avoirdupois)'))).toBe(true);
  expect(rounded.some((name) => name.startsWith('gallon (U.S.)'))).toBe(true);
  expect(rounded.some((name) => name.startsWith('pound-force per square inch'))).toBe(true);
});

it('32 F is 273.15 K and 212 F is 373.15 K exactly, absolute zero converts in four scales and below it is refused', () => {
  // The formulas of NIST SP 811 Appendix B.9, as the page prints them.
  expect(TEMPERATURE_FORMULAS).toEqual([
    `T /K = t /${DEGREE}C + 273.15`,
    `t /${DEGREE}C = ( t /${DEGREE}F - 32 )/ 1.8`,
    `T /K = ( t /${DEGREE}F + 459.67 )/ 1.8`,
    `T /K = ( T /${DEGREE}R)/ 1.8`,
    `t /${DEGREE}C = T /K - 273.15`,
  ]);
  // Python fractions: (32 + 459.67) x 5/9 = 5463/20 = 273.15 and (212 + 459.67) x 5/9 = 7463/20 = 373.15, exactly.
  expect(convertUnit('temperature', '32', 'F', 'K', 30).result).toBe('273.15');
  expect(convertUnit('temperature', '212', 'F', 'K', 30).result).toBe('373.15');
  expect(convertUnit('temperature', '32', 'F', 'C', 30).result).toBe('0');
  expect(convertUnit('temperature', '212', 'F', DEGREE + 'C', 30).result).toBe('100');
  expect(convertUnit('temperature', '0', 'C', 'K', 30).result).toBe('273.15');
  expect(convertUnit('temperature', '100', 'C', 'F', 30).result).toBe('212');
  expect(convertUnit('temperature', '-40', 'C', 'F', 30).result).toBe('-40');
  expect(convertUnit('temperature', '491.67', 'R', 'F', 30).result).toBe('32');
  expect(convertUnit('temperature', '37', 'C', 'K', 30).result).toBe('310.15');

  // The formulas applied one by one in this test, on a spread of readings, against the tool.
  const D = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_EVEN });
  for (const t of ['-40', '-17.7777', '0', '36.6', '98.6', '212', '451', '1000.5']) {
    const kelvinFromF = new D(t).plus('459.67').div('1.8');
    expect(convertUnit('temperature', t, 'F', 'K', 20).result).toBe(kelvinFromF.toSignificantDigits(20).toFixed());
    const celsiusFromF = new D(t).minus(32).div('1.8');
    expect(convertUnit('temperature', t, 'F', 'C', 20).result).toBe(
      celsiusFromF.isZero() ? '0' : celsiusFromF.toSignificantDigits(20).toFixed(),
    );
    const kelvinFromC = new D(t).plus('273.15');
    expect(convertUnit('temperature', t, 'C', 'K', 20).result).toBe(kelvinFromC.toSignificantDigits(20).toFixed());
  }
  for (const t of ['0', '36.6', '98.6', '212', '451', '1000.5']) {
    const kelvinFromR = new D(t).div('1.8');
    expect(convertUnit('temperature', t, 'R', 'K', 20).result).toBe(
      kelvinFromR.isZero() ? '0' : kelvinFromR.toSignificantDigits(20).toFixed(),
    );
  }

  // Absolute zero is 0 K, -273.15 C, -459.67 F and 0 R, and converts to each of the others.
  const zero: [string, string][] = [
    ['K', '0'],
    ['C', '-273.15'],
    ['F', '-459.67'],
    ['R', '0'],
  ];
  for (const [fromUnit, value] of zero) {
    for (const [toUnit, expected] of zero) {
      expect(convertUnit('temperature', value, fromUnit, toUnit, 30).result, `${value} ${fromUnit} to ${toUnit}`).toBe(
        expected,
      );
    }
  }
  // Below absolute zero is refused, naming the quantity and the field.
  for (const [fromUnit, value] of [
    ['K', '-0.001'],
    ['C', '-273.16'],
    ['F', '-459.68'],
    ['R', '-0.5'],
    ['K', '-1e50'],
  ]) {
    const refused = error(() => convertUnit('temperature', value!, fromUnit!, 'K', 10));
    expect(refused.field).toBe('Value');
    expect(refused.message).toContain('absolute zero');
    expect(refused.message).toContain('temperature');
  }
  // A list for a value below absolute zero is refused too.
  expect(error(() => listUnits('temperature', '-300', 'C', 10)).message).toContain('absolute zero');
  // The first values above zero are accepted, and a very large one converts.
  expect(convertUnit('temperature', '-273.14', 'C', 'K', 10).result).toBe('0.01');
  expect(convertUnit('temperature', '1e50', 'K', 'C', 10).result).toBe('1e+50');
});

it('fuel economy converts as a reciprocal, 1 mpg US is 235.2145833 L per 100 km and zero is refused', () => {
  // Python fractions: 100 000 m x 3.785411784 L / 1609.344 m = 112903/480 = 235.2145833... L per 100 km.
  expect(convertUnit('fuel-economy', '1', 'mpg', 'L/100km', 10).result).toBe('235.2145833');
  expect(convertUnit('fuel-economy', '1', 'mpg', 'L/100km', 30).result).toBe(PYTHON['mpg us in L/100km']!.slice(0, 31));
  expect(convertUnit('fuel-economy', '1', 'mpg (US)', 'L/100 km', 10).result).toBe('235.2145833');
  expect(convertUnit('fuel-economy', '30', 'mpg', 'L/100km', 10).result).toBe('7.840486111');
  expect(convertUnit('fuel-economy', '1', 'mpg imp', 'L/100km', 10).result).toBe('282.4809363');
  // The reverse is a reciprocal too: 7.8 L per 100 km is 30.1557158 miles per U.S. gallon.
  expect(convertUnit('fuel-economy', '7.8', 'L/100km', 'mpg', 10).result).toBe('30.15571581');
  // Kilometres per litre and litres per 100 km: L/100 km = 100 / (km/L), exactly.
  expect(convertUnit('fuel-economy', '10', 'km/L', 'L/100km', 30)).toMatchObject({ result: '10', exact: true });
  expect(convertUnit('fuel-economy', '8', 'L/100km', 'km/L', 30)).toMatchObject({ result: '12.5', exact: true });
  expect(convertUnit('fuel-economy', '5', 'L/100km', 'km/L', 30).result).toBe('20');
  // The NIST row: 1 mile per gallon (U.S.) is 4.251 437 E-01 kilometer per liter.
  expect(convertUnit('fuel-economy', '1', 'mpg', 'km/L', 10).result).toBe('0.4251437074');
  expect(convertUnit('fuel-economy', '1', 'mpg', 'km/L', 10).exact).toBe(false);
  // Round trip through the reciprocal.
  expect(convertUnit('fuel-economy', '235.2145833333333333333333333333', 'L/100km', 'mpg', 10).result).toBe('1');

  // Zero and below are refused, for the reciprocal units and the base unit alike, naming the field.
  for (const [value, fromUnit, toUnit] of [
    ['0', 'mpg', 'L/100km'],
    ['0', 'L/100km', 'mpg'],
    ['0', 'km/L', 'L/100km'],
    ['0', 'L/100km', 'L/100km'],
    ['-5', 'mpg', 'L/100km'],
    ['-0.0', 'mpg', 'km/L'],
  ]) {
    const refused = error(() => convertUnit('fuel-economy', value!, fromUnit!, toUnit!, 10));
    expect(refused.field).toBe('Value');
    expect(refused.message).toContain('reciprocal');
  }
  expect(error(() => listUnits('fuel-economy', '0', 'mpg', 10)).message).toContain('reciprocal');
});

it('results round half to even at the chosen significant digits', () => {
  // NIST SP 811 B.7.1: a 5 followed by nothing but zeros leaves an even digit, and increases an odd one by 1.
  const round = (value: string, digits: number): string => convertUnit('length', value, 'm', 'm', digits).result;
  expect(round('6.9749515', 7)).toBe('6.974952');
  expect(round('6.9749505', 7)).toBe('6.97495');
  // Rule 1 and 2 (digits to discard begin with less than 5, or with a 5 and a nonzero digit after it).
  expect(round('6.9749515', 2)).toBe('7');
  expect(round('6.9749515', 5)).toBe('6.975');
  expect(round('6.9749514', 7)).toBe('6.974951');
  expect(round('6.97495151', 7)).toBe('6.974952');
  // Python's decimal module with ROUND_HALF_EVEN gives 2, 4, 0.2, 0.4, -2, 1.2 and 1.4: half up would give 3 and 0.3.
  expect(round('2.5', 1)).toBe('2');
  expect(round('3.5', 1)).toBe('4');
  expect(round('0.25', 1)).toBe('0.2');
  expect(round('0.35', 1)).toBe('0.4');
  expect(round('-2.5', 1)).toBe('-2');
  expect(round('1.25', 2)).toBe('1.2');
  expect(round('1.35', 2)).toBe('1.4');
  // Python ROUND_HALF_EVEN with one digit: 25 is 2E+1 and 35 is 4E+1, which is 20 and 40 written out.
  expect(round('25', 1)).toBe('20');
  expect(round('35', 1)).toBe('40');
  // The digits asked for are the significant digits, whatever the size of the number.
  expect(round('1234567', 3)).toBe('1230000');
  expect(round('0.000123456', 3)).toBe('0.000123');
  expect(round('123456', 6)).toBe('123456');
  expect(round('123456', 30)).toBe('123456');
  // Plain notation from 1e-7 up to just under 1e21, and an exponent outside that.
  expect(round('0.0000001', 10)).toBe('0.0000001');
  expect(round('0.00000001', 10)).toBe('1e-8');
  expect(round('100000000000000000000', 10)).toBe('100000000000000000000');
  expect(round('1000000000000000000000', 10)).toBe('1e+21');
  expect(convertUnit('length', '1', 'nm', 'Mm', 10).result).toBe('1e-15');

  // No binary floating point artefact appears: JavaScript gives 0.1 * 100 = 10.000000000000002 and 0.07 * 1609.344 =
  // 112.65408000000001, and neither shows here.
  expect(convertUnit('length', '0.1', 'm', 'cm', 20).result).toBe('10');
  expect(convertUnit('length', '0.07', 'mi', 'm', 20).result).toBe('112.65408');
  expect(convertUnit('length', '1.1', 'in', 'cm', 20).result).toBe('2.794');
  expect(convertUnit('mass', '0.3', 'lb', 'kg', 20).result).toBe('0.136077711');
  expect(convertUnit('time', '0.1', 'h', 's', 20).result).toBe('360');
  // A value is read as typed, with every digit: a number over 2^53 or with 17 digits is not rounded to a double.
  expect(convertUnit('length', '9007199254740993', 'm', 'm', 30).result).toBe('9007199254740993');
  expect(convertUnit('length', '0.30000000000000004', 'm', 'm', 30).result).toBe('0.30000000000000004');
  expect(convertUnit('length', '1.234567890123456789012345678912345', 'm', 'm', 30).result).toBe(
    '1.23456789012345678901234567891',
  );
  expect(convertUnit('length', '+5', 'm', 'm', 10).result).toBe('5');
  expect(convertUnit('length', '.5', 'm', 'm', 10).result).toBe('0.5');
  expect(convertUnit('length', '5.', 'm', 'm', 10).result).toBe('5');
  expect(convertUnit('length', '1.5e3', 'm', 'km', 10).result).toBe('1.5');
  expect(convertUnit('length', '-0', 'm', 'ft', 10).result).toBe('0');
  expect(convertUnit('length', '  12  ', 'm', 'm', 10).result).toBe('12');
  // A rounded published figure is never used in place of the definition: a pound is not 0.453592 kg.
  expect(convertUnit('mass', '1', 'lb', 'kg', 30).result).not.toBe('0.453592');
  expect(convertUnit('mass', '1000000', 'lb', 'kg', 30).result).toBe('453592.37');
  expect(convertUnit('volume', '1000', 'gal', 'L', 30).result).toBe('3785.411784');

  // What is refused: not a plain decimal, too many digits, too large an exponent or value, and nothing at all.
  for (const bad of ['abc', '1,5', '1 000', '0x10', 'Infinity', 'NaN', '1e', '--1', '1.2.3', '١٢', '1e5000']) {
    const refused = error(() => convertUnit('length', bad, 'm', 'm', 10));
    expect(refused.field, bad).toBe('Value');
  }
  expect(error(() => convertUnit('length', '', 'm', 'm', 10)).field).toBe('Value');
  expect(error(() => convertUnit('length', '   ', 'm', 'm', 10)).field).toBe('Value');
  expect(error(() => convertUnit('length', '1'.repeat(51), 'm', 'm', 10)).message).toContain('50 digits');
  expect(convertUnit('length', '1'.repeat(50), 'm', 'm', 30).result).toBe(`1.${'1'.repeat(29)}e+49`);
  expect(error(() => convertUnit('length', '1e101', 'm', 'm', 10)).message).toContain('1e100');
  expect(error(() => convertUnit('length', '-1e101', 'm', 'm', 10)).field).toBe('Value');
  expect(error(() => convertUnit('length', '9'.repeat(400) + '1', 'm', 'm', 10)).field).toBe('Value');
  expect(convertUnit('length', '1e100', 'm', 'm', 10).result).toBe('1e+100');
  expect(convertUnit('length', '-1e100', 'm', 'm', 10).result).toBe('-1e+100');
  expect(convertUnit('length', '1e-100', 'm', 'm', 10).result).toBe('1e-100');
  // A quantity that is not one of the fourteen is refused.
  expect(error(() => convertUnit('currency' as Quantity, '1', 'usd', 'eur', 10)).message).toContain('fourteen');
});

it('symbols match with their case, names match in any case and micro accepts three spellings', () => {
  // mm and Mm, mg and Mg, mW and MW, mHz and MHz differ.
  expect(findUnit('length', 'mm').factor).toBe('0.001');
  expect(findUnit('length', 'Mm').factor).toBe('1000000');
  expect(findUnit('mass', 'mg').factor).toBe('0.000001');
  expect(findUnit('mass', 'Mg').factor).toBe('1000');
  expect(findUnit('power', 'mW').factor).toBe('0.001');
  expect(findUnit('power', 'MW').factor).toBe('1000000');
  expect(findUnit('frequency', 'mHz').factor).toBe('0.001');
  expect(findUnit('frequency', 'MHz').factor).toBe('1000000');
  expect(findUnit('energy', 'mJ').factor).toBe('0.001');
  expect(findUnit('energy', 'MJ').factor).toBe('1000000');
  expect(convertUnit('length', '1', 'Mm', 'mm', 20).result).toBe('1000000000');
  expect(convertUnit('mass', '1', 'Mg', 'kg', 20).result).toBe('1000');
  // A symbol in the wrong case is refused, not guessed.
  for (const wrong of ['MM', 'mM', 'KM', 'Km', 'M', 'FT', 'Kg']) {
    expect(error(() => findUnit('length', wrong)).message, wrong).toContain('Accepted:');
  }
  expect(error(() => findUnit('mass', 'KG')).field).toBe('Unit');
  expect(error(() => findUnit('temperature', 'k')).field).toBe('Unit');
  expect(error(() => findUnit('temperature', 'c')).field).toBe('Unit');
  // Names match in any case, with any run of spaces as one.
  for (const name of ['meter', 'Meter', 'METERS', 'metre', 'Metres'])
    expect(findUnit('length', name).id, name).toBe('m');
  for (const name of ['nautical mile', 'Nautical Mile', 'NAUTICAL   MILES'])
    expect(findUnit('length', name).id, name).toBe('nmi');
  for (const name of ['Pound', 'POUNDS', 'lbs']) expect(findUnit('mass', name).id, name).toBe('lb');
  for (const name of ['Celsius', 'degree celsius', 'DEGREES CELSIUS', 'C', 'degC', `${DEGREE}C`]) {
    expect(findUnit('temperature', name).id, name).toBe('C');
  }
  expect(findUnit('length', '  km  ').id).toBe('km');
  expect(findUnit('pressure', 'torr').id).toBe('Torr');
  expect(findUnit('pressure', 'Torr').id).toBe('Torr');
  expect(findUnit('pressure', 'TORR').id).toBe('Torr');
  // Micro is accepted as the micro sign (U+00B5), the Greek letter mu (U+03BC) and the letter u, and by name.
  for (const [quantity, symbol, id] of [
    ['length', 'm', 'um'],
    ['mass', 'g', 'ug'],
    ['time', 's', 'us'],
    ['charge', 'C', 'uC'],
  ] as const) {
    const spellings = [`${MICRO}${symbol}`, `${GREEK_MU}${symbol}`, `u${symbol}`];
    for (const spelling of spellings) expect(findUnit(quantity, spelling).id, `${quantity} ${spelling}`).toBe(id);
  }
  expect(convertUnit('length', '1', `${GREEK_MU}m`, 'm', 10).result).toBe('0.000001');
  expect(convertUnit('length', '1', 'um', 'nm', 10).result).toBe('1000');
  expect(convertUnit('length', '1', `${MICRO}m`, 'micron', 10).result).toBe('1');
  expect(findUnit('length', 'Micrometer').id).toBe('um');
  expect(findUnit('length', 'micrometres').id).toBe('um');
  // The letter u alone is not a unit, and u before a symbol that has no micro form is refused.
  expect(error(() => findUnit('length', 'u')).message).toContain('Accepted:');
  expect(error(() => findUnit('length', 'uft')).message).toContain('Accepted:');
  // Litre and millilitre are accepted in both cases of l, and a bare gallon or ton is refused: it is ambiguous.
  expect(findUnit('volume', 'l').id).toBe('L');
  expect(findUnit('volume', 'ml').id).toBe('mL');
  expect(findUnit('volume', 'Litres').id).toBe('L');
  for (const [quantity, bare] of [
    ['volume', 'gallon'],
    ['volume', 'pint'],
    ['volume', 'quart'],
    ['mass', 'ton'],
  ] as const) {
    expect(error(() => findUnit(quantity, bare)).message, bare).toContain('Accepted:');
  }
  expect(findUnit('volume', 'US Gallon').id).toBe('gal');
  expect(findUnit('mass', 'Short Ton').id).toBe('short-ton');
  expect(findUnit('mass', 'long ton').id).toBe('long-ton');
});

it('an unknown unit is refused with the accepted names and a blank To lists every unit of the quantity', () => {
  const unknownFrom = error(() => convertUnit('length', '1', 'parsec', 'm', 10));
  expect(unknownFrom.field).toBe('From unit');
  expect(unknownFrom.message).toContain('"parsec"');
  expect(unknownFrom.message).toContain('length');
  // The accepted units of the quantity are listed with their symbols and a name.
  expect(unknownFrom.message).toContain('km (kilometer)');
  expect(unknownFrom.message).toContain('mi (mile)');
  const unknownTo = error(() => convertUnit('mass', '1', 'kg', 'stone', 10));
  expect(unknownTo.field).toBe('To unit');
  expect(unknownTo.message).toContain('lb (pound)');
  expect(unknownTo.message).not.toContain('km (kilometer)');
  // A unit of another quantity is refused for this one.
  expect(error(() => convertUnit('length', '1', 'kg', 'm', 10)).field).toBe('From unit');
  expect(error(() => convertUnit('mass', '1', 'kg', 'm', 10)).field).toBe('To unit');
  // A blank unit is asked for, not guessed.
  expect(error(() => convertUnit('length', '1', '', 'm', 10)).field).toBe('From unit');
  expect(error(() => convertUnit('length', '1', 'm', '  ', 10)).field).toBe('To unit');
  expect(error(() => listUnits('length', '1', '', 10)).field).toBe('From unit');

  // A blank To lists every unit of the quantity: the value in each, how the unit relates to the base, and whether exact.
  const rows = listUnits('length', '1', 'mi', 10);
  expect(rows.map((row) => row.symbol)).toEqual(UNITS.length.map((unit) => unit.symbol));
  const byId = new Map(rows.map((row) => [row.id, row]));
  expect(byId.get('mi')).toMatchObject({ value: '1', exact: true });
  expect(byId.get('m')).toMatchObject({ value: '1609.344', exact: true });
  expect(byId.get('km')).toMatchObject({ value: '1.609344', exact: true });
  expect(byId.get('ft')).toMatchObject({ value: '5280', exact: true });
  expect(byId.get('in')).toMatchObject({ value: '63360', exact: true });
  expect(byId.get('yd')).toMatchObject({ value: '1760', exact: true });
  expect(byId.get('nmi')?.value).toBe('0.8689762419');
  expect(byId.get('in')?.factor).toBe(`x ${String.fromCharCode(0xd7)} 0.0254`);
  expect(byId.get('m')?.name).toBe('meter');
  // Temperature and fuel economy list too, and the rows with a factor that does not end say so.
  const temperatures = new Map(listUnits('temperature', '32', 'F', 10).map((row) => [row.id, row]));
  expect(temperatures.get('K')?.value).toBe('273.15');
  expect(temperatures.get('C')?.value).toBe('0');
  expect(temperatures.get('F')?.value).toBe('32');
  expect(temperatures.get('R')?.value).toBe('491.67');
  expect(temperatures.get('F')?.exact).toBe(false);
  expect(temperatures.get('C')?.exact).toBe(true);
  const fuel = new Map(listUnits('fuel-economy', '30', 'mpg', 10).map((row) => [row.id, row]));
  expect(fuel.get('L/100km')?.value).toBe('7.840486111');
  expect(fuel.get('mpg')?.value).toBe('30');
  expect(fuel.get('mpg')?.exact).toBe(false);
  const angles = new Map(listUnits('angle', '1', 'rad', 10).map((row) => [row.id, row]));
  expect(angles.get('deg')?.value).toBe('57.29577951');
  expect(angles.get('gon')?.value).toBe('63.66197724');
  expect(angles.get('deg')?.exact).toBe(false);
  expect(angles.get('rad')?.exact).toBe(true);
  expect(angles.get('rev')?.value).toBe('0.1591549431');
  // A gon is exactly 0.9 degree because pi cancels (NIST SP 811 B.8, boldface 9.0 E-01).
  expect(convertUnit('angle', '1', 'gon', DEGREE, 30)).toMatchObject({ result: '0.9', exact: true });
  // The other way the factor is 10/9, whose decimal does not end, so it is marked rounded although the 90 degrees are 100 gon exactly.
  expect(convertUnit('angle', '90', DEGREE, 'gon', 30)).toMatchObject({ result: '100', exact: false });
  expect(convertUnit('angle', '180', DEGREE, 'rev', 30).result).toBe('0.5');
  expect(convertUnit('angle', '1', 'arcmin', 'arcsec', 30).result).toBe('60');
  expect(convertUnit('angle', '60', 'arcmin', DEGREE, 30).result).toBe('1');
  // pi to 50 digits comes from the library, not a typed constant: 180 degrees is pi radians.
  expect(convertUnit('angle', '180', DEGREE, 'rad', 30).result).toBe('3.14159265358979323846264338328');
});

it('all fourteen quantities have at least two units and every unit round-trips through the base unit', () => {
  const expected = [
    'length',
    'mass',
    'temperature',
    'volume',
    'area',
    'speed',
    'pressure',
    'energy',
    'power',
    'angle',
    'fuel-economy',
    'charge',
    'frequency',
    'time',
  ];
  expect(QUANTITIES.map((q) => q.id)).toEqual(expected);
  expect(Object.keys(UNITS).sort()).toEqual([...expected].sort());
  const seenSymbols = new Set<string>();
  for (const quantity of QUANTITIES) {
    const units = UNITS[quantity.id];
    expect(units.length, quantity.id).toBeGreaterThanOrEqual(2);
    const base = units.find((unit) => unit.symbol === quantity.base);
    expect(base, `${quantity.id} has its base unit ${quantity.base}`).toBeDefined();
    expect(base!.factor, `${quantity.id} base factor`).toBe('1');
    expect(quantity.label.length).toBeGreaterThan(2);

    // No two units share an id, a symbol or alias (case matters), or a name.
    const ids = new Set<string>();
    const symbols = new Set<string>();
    const names = new Set<string>();
    for (const unit of units) {
      expect(ids.has(unit.id), `${quantity.id}: duplicate id ${unit.id}`).toBe(false);
      ids.add(unit.id);
      for (const symbol of [unit.symbol, ...unit.aliases]) {
        expect(symbols.has(symbol), `${quantity.id}: duplicate symbol ${symbol}`).toBe(false);
        symbols.add(symbol);
      }
      expect(unit.names.length, `${quantity.id} ${unit.id} has a name`).toBeGreaterThan(0);
      for (const name of unit.names) {
        expect(name, `${unit.id} name is lower case`).toBe(name.toLowerCase());
        expect(names.has(name), `${quantity.id}: duplicate name ${name}`).toBe(false);
        names.add(name);
      }
      expect(unit.definition.length, `${unit.id} has a definition`).toBeGreaterThan(10);
      seenSymbols.add(`${quantity.id}:${unit.symbol}`);
    }

    // Every unit finds itself by its symbol, by each alias and by each name, and goes to the base unit and back.
    for (const unit of units) {
      expect(findUnit(quantity.id, unit.symbol).id).toBe(unit.id);
      for (const alias of unit.aliases)
        expect(findUnit(quantity.id, alias).id, `${unit.id} alias ${alias}`).toBe(unit.id);
      for (const name of unit.names) expect(findUnit(quantity.id, name).id, `${unit.id} name ${name}`).toBe(unit.id);
      const there = convertUnit(quantity.id, '123.456', unit.symbol, base!.symbol, 30);
      const back = convertUnit(quantity.id, there.result, base!.symbol, unit.symbol, 20);
      expect(back.result, `${quantity.id} ${unit.symbol} through ${base!.symbol}`).toBe('123.456');
      // The same through any other unit, to be sure the base is not special.
      const other = units[(units.indexOf(unit) + 1) % units.length]!;
      const viaOther = convertUnit(quantity.id, '123.456', unit.symbol, other.symbol, 30);
      const home = convertUnit(quantity.id, viaOther.result, other.symbol, unit.symbol, 15);
      expect(home.result, `${quantity.id} ${unit.symbol} through ${other.symbol}`).toBe('123.456');
    }
  }
  expect(seenSymbols.size).toBeGreaterThan(100);
  // A value converted to its own unit is itself, with the factor 1.
  expect(convertUnit('length', '12.5', 'ft', 'ft', 10)).toMatchObject({ result: '12.5', factor: '1', exact: true });
  expect(convertUnit('temperature', '12.5', 'C', 'C', 10).result).toBe('12.5');
  expect(convertUnit('fuel-economy', '12.5', 'mpg', 'mpg', 10).result).toBe('12.5');
  // The factor line says what was multiplied, and the definition line carries both definitions.
  const mile = convertUnit('length', '1', 'mi', 'km', 10);
  expect(mile.factor).toBe('1.609344');
  expect(mile.definition).toContain('5280 feet');
  expect(mile.definition).toContain('SI prefix');
  expect(convertUnit('temperature', '1', 'F', 'C', 10).factor).toContain('459.67');
});

it('digits outside 1 to 30 is refused naming the field', () => {
  for (const digits of [0, 31, 1.5, -5, Number.NaN, 1e12, Number.POSITIVE_INFINITY, -1e12, 30.0000001]) {
    const refused = error(() => convertUnit('length', '1', 'm', 'ft', digits));
    expect(refused.field, String(digits)).toBe('Significant digits');
    expect(refused.message, String(digits)).toContain('Significant digits');
    expect(error(() => listUnits('length', '1', 'm', digits)).field).toBe('Significant digits');
  }
  // 1 and 30 are accepted, and every whole number between them.
  for (let digits = 1; digits <= 30; digits++) {
    expect(convertUnit('length', '1', 'ft', 'm', digits).result).toBe(
      new Decimal('0.3048').toSignificantDigits(digits).toFixed(),
    );
  }
  expect(convertUnit('length', '1', 'ft', 'm', 1).result).toBe('0.3');
  expect(convertUnit('length', '1', 'ft', 'm', 30).result).toBe('0.3048');
  // The digits are checked before anything else, so a refusal names the digits even when the value is wrong too.
  expect(error(() => convertUnit('length', 'abc', 'm', 'ft', 0)).field).toBe('Significant digits');
});
