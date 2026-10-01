import { it, expect } from 'vitest';
import {
  calculateDepreciation,
  decliningBalance,
  decliningRows,
  meta,
  straightLine,
  sumOfYearsDigits,
  unitsOfProduction,
  type DepreciationRow,
  type DepreciationTexts,
} from '../src/index';
import { D, MoneyInputError } from '../src/money';

/** Runs `fn` and returns the MoneyInputError it throws, failing the test if it throws anything else or nothing. */
function refused(fn: () => unknown): MoneyInputError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(MoneyInputError);
    return err as MoneyInputError;
  }
  throw new Error('expected a MoneyInputError but nothing was thrown');
}

const dec = (values: string[]) => values.map((v) => new D(v));
const amounts = (rows: DepreciationRow[]) => rows.map((row) => row.depreciation);
const closings = (rows: DepreciationRow[]) => rows.map((row) => row.closing);
const sum = (values: string[]) => values.reduce((total, v) => total.plus(v), new D(0)).toFixed();

/** Runs the whole page path and fails if the result is null. */
function calc(texts: DepreciationTexts) {
  const result = calculateDepreciation({ currency: 'USD', ...texts });
  if (result === null) throw new Error('expected a result');
  return result;
}

const declining = (cost: string, salvage: string, life: number, factor: string, switchToStraightLine: boolean) =>
  decliningBalance({
    cost: new D(cost),
    salvage: new D(salvage),
    life,
    factor: new D(factor),
    switchToStraightLine,
  });

it('IRS Publication 946 straight line: a 5100 patent over 17 years with no salvage is 300 a year', () => {
  // IRS Publication 946 (2025), "Straight Line Method": "In April, you bought a patent for $5,100 ... You depreciate the
  // patent under the straight line method, using a 17-year useful life and no salvage value. You divide the $5,100
  // basis by 17 years to get your $300 yearly depreciation deduction." (The publication then prorates the first year for
  // nine months of use, a partial-year rule this tool does not offer.) 5100 / 17 = 300 exactly.
  const rows = straightLine(new D('5100'), new D('0'), 17);
  expect(rows).toHaveLength(17);
  expect(amounts(rows).every((amount) => amount === '300.00')).toBe(true);
  expect(rows[0]).toEqual({
    year: 1,
    opening: '5100.00',
    depreciation: '300.00',
    accumulated: '300.00',
    closing: '4800.00',
  });
  expect(rows[16]!.closing).toBe('0.00');
  const page = calc({ method: 'straight', cost: '5100', salvage: '0', life: '17' });
  expect(page.rows[0]!.depreciation).toBe('300.00');
  expect(page.summary.totalDepreciation).toBe('5100.00');
});

it('OpenFormula 26300 6.12.45 SLN: the last year carries the rounding residue, 1000 over 3 years is 333.33, 333.33 and 333.34', () => {
  // ISO/IEC 26300-2:2015 6.12.45 SLN: (Cost - Salvage) / LifeTime = 1000 / 3 = 333.333... a year. Rounded each year that
  // is 333.33 twice, so the last year takes 1000 - 666.66 = 333.34 and the column adds up to exactly 1000.
  const rows = straightLine(new D('1000'), new D('0'), 3);
  expect(amounts(rows)).toEqual(['333.33', '333.33', '333.34']);
  expect(rows.map((row) => row.accumulated)).toEqual(['333.33', '666.66', '1000.00']);
  expect(closings(rows)).toEqual(['666.67', '333.34', '0.00']);
  // With a salvage the same rule holds: (1000 - 100) / 3 = 300 exactly.
  expect(amounts(straightLine(new D('1000'), new D('100'), 3))).toEqual(['300.00', '300.00', '300.00']);
  // A currency with no minor unit rounds to whole units: 1000 / 3 gives 333, 333 and 334.
  const yen = calc({ method: 'straight', cost: '1000', salvage: '0', life: '3', currency: 'JPY' });
  expect(amounts(yen.rows)).toEqual(['333', '333', '334']);
});

it('OpenFormula 6.12.50 VDB with the switch: 10000 over 5 years at factor 2 gives 4000, 2400, 1440, 1080 and 1080', () => {
  // VDB (6.12.50) with noSwitch FALSE switches to straight line when that is greater. Rate = 2 / 5 = 0.4.
  // Year 1: 10000 x 0.4 = 4000 (straight line 10000 / 5 = 2000). Year 2: 6000 x 0.4 = 2400 (SL 6000 / 4 = 1500).
  // Year 3: 3600 x 0.4 = 1440 (SL 3600 / 3 = 1200). Year 4: 2160 x 0.4 = 864 but SL 2160 / 2 = 1080 is greater, so 1080.
  // Year 5: 1080 left, SL 1080 / 1 = 1080. The years add up to 10000.
  const rows = declining('10000', '0', 5, '2', true);
  expect(amounts(rows)).toEqual(['4000.00', '2400.00', '1440.00', '1080.00', '1080.00']);
  expect(closings(rows)).toEqual(['6000.00', '3600.00', '2160.00', '1080.00', '0.00']);
  expect(sum(amounts(rows))).toBe('10000');
  const page = calc({ method: 'declining', cost: '10000', salvage: '0', life: '5', factor: '2' });
  expect(amounts(page.rows)).toEqual(amounts(rows));
});

it('IRS Publication 946: the switch to straight line happens in the first year it gives an equal or greater deduction', () => {
  // IRS Publication 946, chapter 4 Example 1: "When the SL method results in an equal or larger deduction, you switch to
  // the SL method." In the 10000 over 5 years example the declining amount beats straight line in years 1 to 3 and
  // loses in year 4 (864 against 1080), so the switch year is 4.
  const page = calc({ method: 'declining', cost: '10000', salvage: '0', life: '5', factor: '2' });
  expect(page.summary.switchYear).toBe(4);
  expect(page.working).toMatch(/switch(es)? to straight line in year 4/i);
  // An equal amount also switches: at factor 1 the declining rate is 1 / 5 and the book value over the remaining life
  // is the same 2000 every year, so year 1 is already equal and every year is 2000.
  const tie = calc({ method: 'declining', cost: '10000', salvage: '0', life: '5', factor: '1' });
  expect(tie.summary.switchYear).toBe(1);
  expect(amounts(tie.rows)).toEqual(['2000.00', '2000.00', '2000.00', '2000.00', '2000.00']);
  // Once the schedule has switched it stays on straight line: no year after the switch is smaller than the switch year.
  const rows = declining('25000', '1000', 8, '2', true);
  const switched = calc({ method: 'declining', cost: '25000', salvage: '1000', life: '8', factor: '2' });
  const from = switched.summary.switchYear!;
  const later = rows.slice(from - 1).map((row) => new D(row.depreciation));
  expect(later.every((amount, i) => i === 0 || amount.minus(later[0]!).abs().lte('0.02'))).toBe(true);
});

it('OpenFormula 6.12.14 DDB without the switch leaves 777.60 undepreciated after 4000, 2400, 1440, 864 and 518.40', () => {
  // DDB (6.12.14): depreciation = MIN(book value at the start x rate, book value at the start - salvage), with no switch.
  // Year 4: 2160 x 0.4 = 864. Year 5: 1296 x 0.4 = 518.40, leaving 1296 - 518.40 = 777.60.
  const rows = declining('10000', '0', 5, '2', false);
  expect(amounts(rows)).toEqual(['4000.00', '2400.00', '1440.00', '864.00', '518.40']);
  expect(rows[4]!.closing).toBe('777.60');
  // The page shows the same years beside the switched ones, for comparison.
  const page = calc({ method: 'declining', cost: '10000', salvage: '0', life: '5', factor: '2' });
  expect(page.working).toContain('777.60');
  expect(page.working).toContain('6.12.14');
});

it('salvage caps declining balance: 10000 with 1000 salvage over 5 years ends 864 then 296', () => {
  // Year 4 starts at 2160: 2160 x 0.4 = 864 (SL (2160 - 1000) / 2 = 580 is smaller). Year 5 starts at 1296:
  // 1296 x 0.4 = 518.40 would go below the 1000 salvage, so it is capped at 1296 - 1000 = 296. Either rule gives
  // 4000, 2400, 1440, 864, 296 (the straight line amount in year 5 is also 296).
  for (const switchToStraightLine of [true, false]) {
    const rows = declining('10000', '1000', 5, '2', switchToStraightLine);
    expect(amounts(rows)).toEqual(['4000.00', '2400.00', '1440.00', '864.00', '296.00']);
    expect(rows[4]!.closing).toBe('1000.00');
  }
});

it('OpenFormula 6.12.46 SYD: 10000 with 1000 salvage over 5 years is 3000, 2400, 1800, 1200 and 600', () => {
  // SYD = (Cost - Salvage) x (LifeTime + 1 - Period) x 2 / ((LifeTime + 1) x LifeTime). Here 9000 x (6 - period) x 2 / 30:
  // 9000 x 5 x 2 / 30 = 3000, 9000 x 4 x 2 / 30 = 2400, 1800, 1200 and 600, which add up to 9000.
  const rows = sumOfYearsDigits(new D('10000'), new D('1000'), 5);
  expect(amounts(rows)).toEqual(['3000.00', '2400.00', '1800.00', '1200.00', '600.00']);
  expect(rows[4]!.closing).toBe('1000.00');
  const page = calc({ method: 'syd', cost: '10000', salvage: '1000', life: '5' });
  expect(amounts(page.rows)).toEqual(amounts(rows));
  expect(page.working).toContain('6.12.46');
});

it('IRS Publication 946 chapter 4 Example 1 years 2 to 6 follow 200 percent declining balance with the switch: 320, 192, 115.20, 115.20 and 57.60', () => {
  // IRS Publication 946 (2025), chapter 4, "Example 1--200% DB method and half-year convention": 5-year property with a basis
  // of $1,000, "Figures are rounded for purposes of the examples": 200, 320, 192, 115, 115 and 58. The exact values are
  // 200, 320, 192, 115.20, 115.20 and 57.60. The first year is half of 1000 x 0.40 = 200 (a half-year convention this
  // tool does not offer), leaving 800 and a remaining life of 4.5 years. From there the engine takes the rate 0.40 and
  // the fractional life: year 2 800 x 0.4 = 320 (SL 800 / 4.5 = 177.78), year 3 480 x 0.4 = 192 (SL 480 / 3.5 = 137.14),
  // year 4 288 x 0.4 = 115.20 and SL 288 / 2.5 = 115.20, equal, so it switches, year 5 SL 172.80 / 1.5 = 115.20, and
  // year 6 holds 57.60 with a remaining life of 0.5, so it takes all of it.
  const rows = decliningRows(new D('800'), new D('0'), new D('0.4'), new D('4.5'), 5, true);
  expect(amounts(rows)).toEqual(['320.00', '192.00', '115.20', '115.20', '57.60']);
  expect(closings(rows)).toEqual(['480.00', '288.00', '172.80', '57.60', '0.00']);
  expect(sum(amounts(rows))).toBe('800');
});

it('OpenFormula 6.12.14: a factor at or above the life depreciates everything down to salvage in the first year', () => {
  // The specification's algorithm: "if rate >= 1 then rate = 1", so the first year takes the whole book value above
  // salvage: rate = 5 / 5 = 1 and 10000 x 1 capped at 10000 - 500 = 9500, then nothing is left.
  for (const factor of ['5', '10']) {
    for (const switchToStraightLine of [true, false]) {
      const rows = declining('10000', '500', 5, factor, switchToStraightLine);
      expect(amounts(rows)).toEqual(['9500.00', '0.00', '0.00', '0.00', '0.00']);
      expect(closings(rows)).toEqual(['500.00', '500.00', '500.00', '500.00', '500.00']);
    }
  }
  const page = calc({ method: 'declining', cost: '10000', salvage: '500', life: '5', factor: '10' });
  expect(page.rows[0]!.depreciation).toBe('9500.00');
  expect(page.summary.totalDepreciation).toBe('9500.00');
});

it('units of production depreciates cost minus salvage in proportion to the units used each year', () => {
  // (Cost - Salvage) x units in the year / total units: 9000 x 1000 / 6000 = 1500, 9000 x 2000 / 6000 = 3000,
  // 9000 x 3000 / 6000 = 4500, which add up to 9000.
  const rows = unitsOfProduction(new D('10000'), new D('1000'), new D('6000'), dec(['1000', '2000', '3000']));
  expect(amounts(rows)).toEqual(['1500.00', '3000.00', '4500.00']);
  expect(rows[2]!.closing).toBe('1000.00');
  // Units that do not divide evenly: 1000 over 3 units used one at a time is 333.33, 333.33 and a last year of 333.34.
  expect(amounts(unitsOfProduction(new D('1000'), new D('0'), new D('3'), dec(['1', '1', '1'])))).toEqual([
    '333.33',
    '333.33',
    '333.34',
  ]);
  // Fewer units than the total leave the asset above its salvage; more than the total stop at cost minus salvage.
  const short = unitsOfProduction(new D('10000'), new D('1000'), new D('6000'), dec(['1000', '1000']));
  expect(amounts(short)).toEqual(['1500.00', '1500.00']);
  expect(short[1]!.closing).toBe('7000.00');
  const over = unitsOfProduction(new D('10000'), new D('1000'), new D('6000'), dec(['5000', '5000', '5000']));
  expect(amounts(over)).toEqual(['7500.00', '1500.00', '0.00']);
  expect(over[2]!.closing).toBe('1000.00');
  const page = calc({
    method: 'units',
    cost: '10000',
    salvage: '1000',
    units: '1000\n2000\n3000',
    totalUnits: '6000',
  });
  expect(amounts(page.rows)).toEqual(['1500.00', '3000.00', '4500.00']);
  expect(page.summary.totalDepreciation).toBe('9000.00');
});

it('salvage above cost, a zero life and a bad units line are refused naming the field or line', () => {
  const salvage = refused(() =>
    calculateDepreciation({ method: 'straight', cost: '1000', salvage: '1001', life: '5' }),
  );
  expect(salvage.field).toBe('Salvage value');
  expect(salvage.message).toMatch(/more than the cost/);
  expect(
    refused(() => calculateDepreciation({ method: 'straight', cost: '1000', salvage: '0', life: '0' })).field,
  ).toBe('Useful life (years)');
  expect(
    refused(() => calculateDepreciation({ method: 'straight', cost: '1000', salvage: '0', life: '101' })).field,
  ).toBe('Useful life (years)');
  const units = refused(() =>
    calculateDepreciation({ method: 'units', cost: '1000', salvage: '0', units: '10\nabc\n5', totalUnits: '100' }),
  );
  expect(units.field).toBe('Units each year');
  expect(units.line).toBe(2);
  expect(units.column).toBe(1);
  expect(
    refused(() =>
      calculateDepreciation({ method: 'units', cost: '1000', salvage: '0', units: '10\n-5', totalUnits: '100' }),
    ).line,
  ).toBe(2);
  // More lines than a century of years.
  const many = Array.from({ length: 101 }, () => '1').join('\n');
  expect(
    refused(() =>
      calculateDepreciation({ method: 'units', cost: '1000', salvage: '0', units: many, totalUnits: '1000' }),
    ).message,
  ).toContain('100');
  expect(refused(() => calculateDepreciation({ method: 'straight', cost: '0', salvage: '0', life: '5' })).field).toBe(
    'Cost',
  );
  expect(refused(() => calculateDepreciation({ method: 'straight', cost: '', salvage: '0', life: '5' })).field).toBe(
    'Cost',
  );
  expect(refused(() => calculateDepreciation({ method: 'straight', cost: '100', salvage: '0', life: '' })).field).toBe(
    'Useful life (years)',
  );
  expect(
    refused(() => calculateDepreciation({ method: 'declining', cost: '100', salvage: '0', life: '5', factor: '0' }))
      .field,
  ).toBe('Declining balance factor');
  expect(
    refused(() => calculateDepreciation({ method: 'declining', cost: '100', salvage: '0', life: '5', factor: '11' }))
      .field,
  ).toBe('Declining balance factor');
  expect(
    refused(() => calculateDepreciation({ method: 'units', cost: '100', salvage: '0', units: '5', totalUnits: '0' }))
      .field,
  ).toBe('Total units over the asset life');
  expect(
    refused(() => calculateDepreciation({ method: 'units', cost: '100', salvage: '0', units: '', totalUnits: '10' }))
      .field,
  ).toBe('Units each year');
  expect(
    refused(() => calculateDepreciation({ method: 'straight', cost: '100.005', salvage: '0', life: '5' })).message,
  ).toMatch(/at most 2 decimal places/);
  expect(refused(() => calculateDepreciation({ method: 'bogus', cost: '100', salvage: '0', life: '5' })).field).toBe(
    'Method',
  );
  expect(
    refused(() => calculateDepreciation({ method: 'straight', cost: '100', salvage: '0', life: '5', currency: 'XX' }))
      .field,
  ).toBe('Currency (ISO 4217 code)');
  expect(calculateDepreciation({ method: 'straight', cost: '', salvage: '', life: '' })).toBeNull();
  expect(calculateDepreciation({ method: 'units', cost: '', salvage: '', units: '', totalUnits: '' })).toBeNull();
});

it('0.1 plus 0.2 is exactly 0.3 through this tool', () => {
  // Floating point gets it wrong, so a tool that summed JavaScript numbers would show 0.30000000000000004.
  expect(0.1 + 0.2).not.toBe(0.3);
  // Straight line on a cost of 0.3 with no salvage over 3 years is 0.1 a year, and the running total is exact.
  const rows = straightLine(new D('0.3'), new D('0'), 3);
  expect(amounts(rows)).toEqual(['0.10', '0.10', '0.10']);
  expect(rows.map((row) => row.accumulated)).toEqual(['0.10', '0.20', '0.30']);
  expect(rows[2]!.closing).toBe('0.00');
  const page = calc({ method: 'straight', cost: '0.3', salvage: '0', life: '3' });
  expect(page.rows[1]!.accumulated).toBe('0.20');
  expect(page.summary.totalDepreciation).toBe('0.30');
});

it('every method that fully depreciates adds up exactly to cost minus salvage, and no year is negative or below the salvage', () => {
  const cases: { cost: string; salvage: string }[] = [
    { cost: '10000', salvage: '0' },
    { cost: '12345.67', salvage: '234.56' },
    { cost: '0.02', salvage: '0' },
    { cost: '999999999.99', salvage: '0.01' },
    { cost: '5000', salvage: '5000' },
  ];
  for (const { cost, salvage } of cases) {
    const room = new D(cost).minus(salvage).toFixed();
    for (const life of [1, 2, 3, 4, 7, 30, 100]) {
      const all: DepreciationRow[][] = [
        straightLine(new D(cost), new D(salvage), life),
        sumOfYearsDigits(new D(cost), new D(salvage), life),
        declining(cost, salvage, life, '2', true),
        declining(cost, salvage, life, '1.5', true),
        declining(cost, salvage, life, '10', true),
      ];
      for (const rows of all) {
        expect(rows).toHaveLength(life);
        expect(sum(amounts(rows))).toBe(room);
        expect(rows.every((row) => !new D(row.depreciation).isNeg())).toBe(true);
        expect(rows.every((row) => new D(row.closing).gte(salvage))).toBe(true);
        expect(rows[life - 1]!.closing).toBe(new D(salvage).toFixed(2));
      }
    }
  }
  // Declining without the switch is allowed to stop above salvage but never goes below it.
  for (const rows of [declining('10000', '1000', 5, '2', false), declining('0.02', '0', 4, '2', false)]) {
    expect(rows.every((row) => !new D(row.depreciation).isNeg())).toBe(true);
  }
});

it('the page text names the standards, shows the working and never tells the visitor what to do', () => {
  const text = JSON.stringify(meta.about) + JSON.stringify(meta.supports) + JSON.stringify(meta.limits);
  expect(text).not.toMatch(/\b(should|recommend|you must|best method|choose this)\b/i);
  const labels = meta.standards.map((s) => s.label).join(' ');
  for (const needle of ['946', '6.12.45', '6.12.14', '6.12.50', '6.12.46']) expect(labels).toContain(needle);
  const straight = calc({ method: 'straight', cost: '5100', salvage: '0', life: '17' });
  expect(straight.working).toContain('6.12.45');
  expect(straight.working).toContain('300');
  const declined = calc({ method: 'declining', cost: '10000', salvage: '0', life: '5', factor: '2' });
  expect(declined.working).toContain('6.12.50');
  expect(declined.working).toContain('946');
  const everything = [straight.working, declined.working].join('\n');
  expect(everything).not.toMatch(/\b(should|recommend|best|better|worth)\b/i);
  expect(declined.summary.method).toBe('declining');
  expect(declined.summary.life).toBe(5);
  expect(declined.summary.finalBookValue).toBe('0.00');
});
