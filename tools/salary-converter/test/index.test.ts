import { it, expect } from 'vitest';
import { PAY_PERIODS, calculatePay, convertPay, meta, yearlyFactor, type PayPeriod, type PayTexts } from '../src/index';
import { D, MoneyInputError, roundTo } from '../src/money';

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

const BASE: PayTexts = {
  amount: '52000',
  period: 'yearly',
  hoursPerWeek: '40',
  daysPerWeek: '5',
  weeksPerYear: '52',
  currency: 'USD',
};
const calc = (texts: PayTexts = {}) => {
  const result = calculatePay({ ...BASE, ...texts });
  expect(result).not.toBeNull();
  return result!;
};
const row = (result: ReturnType<typeof calc>, period: PayPeriod) =>
  result.summary.rows.find((r) => r.period === period)?.amount;

it('meta: id, name, dependency pin, the two required sentences in limits and the cited fact sheet', () => {
  expect(meta.id).toBe('salary-converter');
  expect(meta.name).toBe('Salary & Hourly Pay Converter');
  expect(meta.dependencies['decimal.js']).toBe('10.6.0');
  expect(meta.limits.length).toBeGreaterThanOrEqual(3);
  expect(meta.limits.some((l: string) => /half away from zero/i.test(l))).toBe(true);
  expect(meta.limits.some((l: string) => /not financial, tax or legal advice; it ignores /i.test(l))).toBe(true);
  expect(meta.limits.some((l: string) => /never rounds between steps/i.test(l))).toBe(true);
  expect(meta.standards).toHaveLength(1);
  expect(meta.standards[0]?.url).toBe(
    'https://www.opm.gov/policy-data-oversight/pay-leave/pay-administration/fact-sheets/computing-hourly-rates-of-pay-using-the-2087-hour-divisor/',
  );
});

it('the usage example in meta.json shows what the code returns', () => {
  const rows = calc().summary.rows.map((r) => `${r.period} ${r.amount}`);
  expect(rows).toEqual([
    'yearly 52000.00',
    'monthly 4333.33',
    'fortnightly 2000.00',
    'weekly 1000.00',
    'daily 200.00',
    'hourly 25.00',
  ]);
  expect(meta.usage).toContain(
    "['yearly 52000.00', 'monthly 4333.33', 'fortnightly 2000.00', 'weekly 1000.00', 'daily 200.00', 'hourly 25.00']",
  );
  expect(PAY_PERIODS.map((p) => p.id)).toEqual(['yearly', 'monthly', 'fortnightly', 'weekly', 'daily', 'hourly']);
});

// OPM, Computing Hourly Rates of Pay Using the 2,087-Hour Divisor, Example: "the annual rate of basic pay of a GS-13,
// step 1, employee ... is $89,033. ... The employee's hourly rate of basic pay is $42.66 ($89,033/2,087 hours)."
// 40 hours a week at 52.175 weeks a year is 2,087 hours. 89033 / 2087 = 42.66117..., which shows as 42.66.
it('OPM 2087-hour divisor: 89033 a year at 40 hours a week and 52.175 weeks is 42.66 an hour', () => {
  expect(yearlyFactor('hourly', new D(40), new D(5), new D('52.175')).toFixed()).toBe('2087');
  const r = calc({ amount: '89033', hoursPerWeek: '40', weeksPerYear: '52.175' });
  expect(row(r, 'hourly')).toBe('42.66');
  const hourly = convertPay(new D(89033), 'yearly', new D(40), new D(5), new D('52.175')).rows.find(
    (x) => x.period === 'hourly',
  )!;
  expect(hourly.amount.toFixed(6)).toBe('42.661236');
});

// OPM, same fact sheet: "Rates must be rounded to the nearest cent, counting one-half cent and over as the next higher
// cent (e.g., round $18.845 to $18.85)." Half away from zero is the same rule for positive pay.
it('OPM rounding rule: half a cent and over rounds up, 18.845 is 18.85', () => {
  expect(roundTo(new D('18.845'), 2).toFixed(2)).toBe('18.85');
  expect(roundTo(new D('18.8449'), 2).toFixed(2)).toBe('18.84');
  // through this tool: 18.845 an hour, shown to the cent
  const r = calc({ amount: '18.845', period: 'hourly', currency: 'BHD' });
  expect(row(r, 'hourly')).toBe('18.845');
  expect(calc({ amount: '18.845', period: 'hourly' }).summary.rows.find((x) => x.period === 'hourly')?.amount).toBe(
    '18.85',
  );
});

// By hand: the same sheet multiplies the rounded hourly rate 42.66 by 80 hours to get 3,412.80 every two weeks. Here
// nothing is rounded between steps: 89033 / 26.0875 = 3412.8604..., which shows as 3412.86. 80 hours a fortnight at the
// exact 42.661236... an hour is the same 3412.86.
it('no rounding between steps: the fortnightly figure is 3412.86, not the 3412.80 that a rounded hourly rate times 80 gives', () => {
  const r = calc({ amount: '89033', hoursPerWeek: '40', weeksPerYear: '52.175' });
  expect(row(r, 'fortnightly')).toBe('3412.86');
  const roundedHourly = new D(row(r, 'hourly')!);
  expect(roundedHourly.times(80).toFixed(2)).toBe('3412.80');
  expect(row(r, 'fortnightly')).not.toBe(roundedHourly.times(80).toFixed(2));
  expect(row(r, 'weekly')).toBe('1706.43');
  expect(r.working).toContain('half away from zero');
  expect(r.working).toContain('26.0875');
});

// By hand: 52000 a year at 40 hours, 5 days and 52 weeks. Hourly 52000 / (40 x 52) = 52000 / 2080 = 25. Daily
// 52000 / (5 x 52) = 52000 / 260 = 200. Weekly 52000 / 52 = 1000. Fortnightly 52000 / 26 = 2000. Monthly 52000 / 12 =
// 4333.333..., shown 4333.33.
it('every period converts through the yearly amount: 52000 a year at 40 hours and 52 weeks is 25.00 an hour, 1000.00 a week, 2000.00 a fortnight, 200.00 a day and 4333.33 a month', () => {
  const r = calc();
  expect(row(r, 'yearly')).toBe('52000.00');
  expect(row(r, 'monthly')).toBe('4333.33');
  expect(row(r, 'fortnightly')).toBe('2000.00');
  expect(row(r, 'weekly')).toBe('1000.00');
  expect(row(r, 'daily')).toBe('200.00');
  expect(row(r, 'hourly')).toBe('25.00');
  // the same pay typed in any other period gives the same table, since every figure goes through the yearly amount
  for (const [period, amount] of [
    ['monthly', '4333.333333333333'],
    ['fortnightly', '2000'],
    ['weekly', '1000'],
    ['daily', '200'],
    ['hourly', '25'],
  ] as const) {
    const again = calc({ amount, period });
    expect(row(again, 'yearly')).toBe('52000.00');
    expect(row(again, 'hourly')).toBe('25.00');
  }
  expect(yearlyFactor('yearly', new D(40), new D(5), new D(52)).toFixed()).toBe('1');
  expect(yearlyFactor('monthly', new D(40), new D(5), new D(52)).toFixed()).toBe('12');
  expect(yearlyFactor('fortnightly', new D(40), new D(5), new D(52)).toFixed()).toBe('26');
  expect(yearlyFactor('weekly', new D(40), new D(5), new D(52)).toFixed()).toBe('52');
  expect(yearlyFactor('daily', new D(40), new D(5), new D(52)).toFixed()).toBe('260');
  expect(yearlyFactor('hourly', new D(40), new D(5), new D(52)).toFixed()).toBe('2080');
  // a currency without a minor unit shows whole units
  expect(row(calc({ currency: 'JPY' }), 'monthly')).toBe('4333');
});

it('zero hours, more than 168 hours a week, zero weeks and more than 7 days a week are refused naming the field', () => {
  expect(refused(() => calc({ hoursPerWeek: '0' })).field).toBe('Hours a week');
  expect(refused(() => calc({ hoursPerWeek: '168.5' })).field).toBe('Hours a week');
  expect(refused(() => calc({ weeksPerYear: '0' })).field).toBe('Weeks a year');
  expect(refused(() => calc({ weeksPerYear: '53.5' })).field).toBe('Weeks a year');
  expect(refused(() => calc({ daysPerWeek: '8' })).field).toBe('Days a week');
  expect(refused(() => calc({ daysPerWeek: '0' })).field).toBe('Days a week');
  expect(refused(() => calc({ daysPerWeek: '0.5' })).field).toBe('Days a week');
  expect(refused(() => calc({ hoursPerWeek: '4e1' })).field).toBe('Hours a week');
  expect(refused(() => calc({ amount: '-1' })).field).toBe('Pay');
  expect(refused(() => calc({ amount: '1,000' })).field).toBe('Pay');
  expect(refused(() => calc({ period: 'hourlyish' })).field).toBe('Pay is given per');
  // the edges are accepted: 168 hours, 53 weeks, 1 and 7 days, and a pay of 0
  expect(row(calc({ hoursPerWeek: '168', weeksPerYear: '53', daysPerWeek: '7' }), 'hourly')).toBe('5.84');
  expect(row(calc({ daysPerWeek: '1' }), 'daily')).toBe('1000.00');
  expect(row(calc({ amount: '0' }), 'hourly')).toBe('0.00');
});

it('a blank pay gives no result and a typed pay with a blank working-time field names it', () => {
  expect(calculatePay({})).toBeNull();
  expect(calculatePay({ amount: '  ' })).toBeNull();
  expect(refused(() => calc({ hoursPerWeek: '' })).field).toBe('Hours a week');
  expect(refused(() => calc({ weeksPerYear: '' })).field).toBe('Weeks a year');
  expect(refused(() => calc({ currency: 'XYZ1' })).field).toBe('Currency (ISO 4217 code)');
});

// The float product 0.1 * 3 is 0.30000000000000004. A weekly pay of 0.1 over 3 weeks a year is exactly 0.3 a year.
it('0.1 plus 0.2 is exactly 0.3 through this tool', () => {
  expect(0.1 + 0.2).not.toBe(0.3);
  expect(0.1 * 3).toBe(0.30000000000000004);
  const converted = convertPay(new D('0.1'), 'weekly', new D(1), new D(1), new D(3));
  expect(converted.yearly.toFixed()).toBe('0.3');
  const r = calc({ amount: '0.1', period: 'weekly', hoursPerWeek: '1', daysPerWeek: '1', weeksPerYear: '3' });
  expect(r.summary.yearly).toBe('0.30');
  expect(r.working).toContain('yearly pay = 0.1 x 3 = 0.3');
});
