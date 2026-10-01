import { it, expect, test } from 'vitest';
import {
  billableHours,
  calculateFreelance,
  freelanceRates,
  meta,
  requiredRevenue,
  type FreelanceTexts,
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

const BASE: FreelanceTexts = {
  income: '60000',
  expenses: '6000',
  taxRate: '25',
  workingDays: '260',
  daysOff: '25',
  hoursPerDay: '8',
  billable: '75',
  currency: 'USD',
};
const calc = (texts: FreelanceTexts = {}) => {
  const result = calculateFreelance({ ...BASE, ...texts });
  expect(result).not.toBeNull();
  return result!;
};

it('meta: id, name, dependency pin, the two required sentences in limits and no standards', () => {
  expect(meta.id).toBe('freelance-rate');
  expect(meta.name).toBe('Freelance Rate Calculator');
  expect(meta.dependencies['decimal.js']).toBe('10.6.0');
  expect(meta.limits.length).toBeGreaterThanOrEqual(3);
  expect(meta.limits.some((l: string) => /half away from zero/i.test(l))).toBe(true);
  expect(meta.limits.some((l: string) => /not financial, tax or legal advice; it ignores /i.test(l))).toBe(true);
  expect(meta.limits.some((l: string) => /tax share is applied to profit/i.test(l))).toBe(true);
  expect(meta.ambiguities.some((a: string) => /fixed tax-free amount/i.test(a))).toBe(true);
  expect(meta.standards).toEqual([]);
  expect(meta.testNotes).toMatch(/no standards body/i);
});

it('the usage example in meta.json shows what the code returns', () => {
  const { summary } = calc();
  expect(summary.hourly).toBe('60.99');
  expect(summary.daily).toBe('487.94');
  expect(meta.usage).toContain("result.summary.hourly; // '60.99'");
  expect(meta.usage).toContain("result.summary.daily; // '487.94'");
});

// No standards body publishes a freelance rate formula. By hand: the income you keep is the profit less its tax, so with
// a tax share t of the profit, profit x (1 - t) = income and profit = income / (1 - t). Revenue covers the expenses and
// that profit: 6000 + 60000 / 0.75 = 6000 + 80000 = 86000. The tax set aside is 80000 - 60000 = 20000, which is 25
// percent of the profit of 80000.
it('required revenue covers expenses plus the income grossed up for tax: 60000 income, 6000 expenses and 25 tax need 86000', () => {
  expect(requiredRevenue(new D(60000), new D(6000), new D(25)).toFixed()).toBe('86000');
  // no tax and no expenses: the revenue is the income itself
  expect(requiredRevenue(new D(60000), new D(0), new D(0)).toFixed()).toBe('60000');
  // the tax applies to the profit, not to the expenses: expenses of 10000 add exactly 10000, not 10000 / 0.75
  expect(requiredRevenue(new D(60000), new D(10000), new D(25)).toFixed()).toBe('90000');
  const r = calc();
  expect(r.summary.revenue).toBe('86000.00');
  expect(r.summary.tax).toBe('20000.00');
});

// By hand: 260 working days less 25 days off is 235 days worked, times 8 hours is 1880 hours, times 75 percent
// billable is 1410 hours.
it('billable hours are working days minus days off, times hours a day, times the billable share: 260 minus 25 at 8 hours and 75 is 1410', () => {
  expect(billableHours(260, 25, new D(8), new D(75)).toFixed()).toBe('1410');
  expect(billableHours(260, 0, new D(8), new D(100)).toFixed()).toBe('2080');
  expect(billableHours(5, 1, new D('7.5'), new D(50)).toFixed()).toBe('15');
  expect(calc().summary.hours).toBe('1410');
});

// By hand: 86000 / 1410 = 60.992907801418..., shown 60.99. The day rate is that exact hourly rate times 8 hours:
// 487.943262411347..., shown 487.94.
it('hourly and day rates: 86000 over 1410 hours is 60.99 an hour and 487.94 a day', () => {
  const rates = freelanceRates(new D(60000), new D(6000), new D(25), 260, 25, new D(8), new D(75));
  expect(rates.revenue.toFixed()).toBe('86000');
  expect(rates.hours.toFixed()).toBe('1410');
  expect(rates.hourly.toFixed(6)).toBe('60.992908');
  expect(rates.daily.toFixed(6)).toBe('487.943262');
  const { summary } = calc();
  expect(summary.hourly).toBe('60.99');
  expect(summary.daily).toBe('487.94');
  expect(summary.lines.map((l) => l.label)).toEqual([
    'Hourly rate',
    'Day rate',
    'Required yearly revenue',
    'Billable hours a year',
  ]);
});

// By hand: the rounded hourly rate 60.99 times 8 is 487.92, which is not the day rate. The exact hourly rate 86000 / 1410
// times 8 is 487.9432..., which shows as 487.94.
it('no rounding between steps: the day rate comes from the exact hourly rate, not the rounded one', () => {
  const { summary } = calc();
  expect(summary.daily).toBe('487.94');
  expect(summary.daily).not.toBe(new D(summary.hourly).times(8).toFixed(2));
  expect(new D(summary.hourly).times(8).toFixed(2)).toBe('487.92');
  // the working carries the unrounded figures to ten places
  const { working } = calc();
  expect(working).toContain('60.9929078014');
  expect(working).toContain('487.9432624113');
});

it('a tax share of 100 or more, a billable share of 0 and days off that use up the year are refused naming the field', () => {
  expect(refused(() => calc({ taxRate: '100' })).field).toBe('Share of profit set aside for tax (percent)');
  expect(refused(() => calc({ taxRate: '150' })).field).toBe('Share of profit set aside for tax (percent)');
  expect(refused(() => calc({ billable: '0' })).field).toBe('Share of working time you can bill (percent)');
  expect(refused(() => calc({ billable: '100.5' })).field).toBe('Share of working time you can bill (percent)');
  expect(refused(() => calc({ hoursPerDay: '24.5' })).field).toBe('Hours in a working day');
  expect(refused(() => calc({ hoursPerDay: '0' })).field).toBe('Hours in a working day');
  expect(refused(() => calc({ daysOff: '260' })).field).toBe('Days off (holidays, sickness, training)');
  expect(refused(() => calc({ daysOff: '300' })).field).toBe('Days off (holidays, sickness, training)');
  expect(refused(() => calc({ workingDays: '0' })).field).toBe('Working days in a year');
  expect(refused(() => calc({ workingDays: '367' })).field).toBe('Working days in a year');
  expect(refused(() => calc({ income: '0' })).field).toBe('Target yearly income after tax');
  expect(refused(() => calc({ taxRate: '1e2' })).field).toBe('Share of profit set aside for tax (percent)');
  expect(refused(() => calc({ taxRate: '-5' })).field).toBe('Share of profit set aside for tax (percent)');
  // a tax share just below 100 is accepted
  expect(calc({ taxRate: '99.9' }).summary.revenue).toBe('60006000.00');
  // 24 hours and a billable share of 100 are accepted
  expect(calc({ hoursPerDay: '24', billable: '100' }).summary.hours).toBe('5640');
});

it('some fields typed and a required one blank names the blank one; nothing typed gives no result', () => {
  expect(calculateFreelance({})).toBeNull();
  expect(calculateFreelance({ currency: 'USD' })).toBeNull();
  expect(refused(() => calc({ expenses: '' })).field).toBe('Yearly business expenses');
  expect(refused(() => calc({ taxRate: '' })).field).toBe('Share of profit set aside for tax (percent)');
  expect(refused(() => calc({ currency: 'XYZ1' })).field).toBe('Currency (ISO 4217 code)');
});

it('a zero decimal currency shows whole units and the working names the rounding', () => {
  const r = calc({ currency: 'JPY', income: '6000000', expenses: '600000' });
  expect(r.summary.currencyDecimals).toBe(0);
  expect(r.summary.hourly).toBe('6099');
  expect(r.working).toContain('half away from zero');
  expect(r.working).toContain('tax applies to the profit');
});

it('the assumptions table lists every figure used, in the order typed', () => {
  const { assumptions } = calc();
  expect(assumptions.map(([label]) => label)).toEqual([
    'Target yearly income after tax',
    'Yearly business expenses',
    'Share of profit set aside for tax',
    'Profit before tax',
    'Tax set aside',
    'Required yearly revenue',
    'Working days in a year',
    'Days off',
    'Days worked',
    'Hours in a working day',
    'Share of working time you can bill',
    'Billable hours a year',
  ]);
  expect(assumptions.find(([label]) => label === 'Profit before tax')?.[1]).toBe('$80,000.00');
  expect(assumptions.find(([label]) => label === 'Days worked')?.[1]).toBe('235');
});

// The float sum 0.1 + 0.2 is 0.30000000000000004. Income 0.1 and expenses 0.2 with no tax need a revenue of exactly 0.3.
it('0.1 plus 0.2 is exactly 0.3 through this tool', () => {
  expect(0.1 + 0.2).not.toBe(0.3);
  expect(0.1 + 0.2).toBe(0.30000000000000004);
  expect(requiredRevenue(new D('0.1'), new D('0.2'), new D(0)).toFixed()).toBe('0.3');
  const r = calc({
    income: '0.1',
    expenses: '0.2',
    taxRate: '0',
    workingDays: '1',
    daysOff: '0',
    hoursPerDay: '1',
    billable: '100',
  });
  expect(r.working).toContain('= 0.3');
  expect(r.summary.hourly).toBe('0.30');
});

test('hours in a working day below a quarter hour and a billable share below 1 percent are refused naming the field', () => {
  const HOURS = 'Hours in a working day';
  const BILLABLE = 'Share of working time you can bill (percent)';
  // 0.000000000001 hours a day and a 0.000000000001 percent billable share used to give a 43-digit hourly rate.
  expect(refused(() => calc({ hoursPerDay: '0.000000000001' })).field).toBe(HOURS);
  expect(refused(() => calc({ hoursPerDay: '0.24' })).field).toBe(HOURS);
  expect(refused(() => calc({ hoursPerDay: '0.24' })).message).toMatch(/at least 0\.25/);
  expect(calc({ hoursPerDay: '0.25' }).summary.hours).toBe('44.06');
  expect(refused(() => calc({ billable: '0.000000000001' })).field).toBe(BILLABLE);
  expect(refused(() => calc({ billable: '0.99' })).field).toBe(BILLABLE);
  expect(refused(() => calc({ billable: '0.99' })).message).toMatch(/at least 1 percent/);
  expect(calc({ billable: '1' }).summary.hours).toBe('18.8');
});

test('a rate of 1,000,000,000,000,000,000 or more is refused as too large to show exactly', () => {
  const err = refused(() =>
    calc({
      income: '999999999999999',
      expenses: '999999999999999',
      taxRate: '99.9',
      hoursPerDay: '0.25',
      billable: '1',
    }),
  );
  expect(err.message).toMatch(/too large to show exactly/);
  // The ordinary example is untouched.
  expect(calc().summary.hourly).toBe('60.99');
});
