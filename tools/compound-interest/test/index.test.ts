import { it, expect, describe } from 'vitest';
import {
  annualPercentageYield,
  calculateSavings,
  effectiveAnnualYield,
  futureValue,
  meta,
  yearlyTable,
  type SavingsTexts,
} from '../src/index';
import { D, MoneyInputError, toPlain } from '../src/money';

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

const base: SavingsTexts = {
  start: '0',
  deposit: '100',
  timing: 'end',
  rate: '12',
  compounding: '12',
  years: '1',
  currency: 'USD',
};
const savings = (over: Partial<SavingsTexts> = {}) => {
  const result = calculateSavings({ ...base, ...over });
  expect(result).not.toBeNull();
  return result!;
};

describe('meta', () => {
  it('id, name, dependency pin and the two required sentences in limits', () => {
    expect(meta.id).toBe('compound-interest');
    expect(meta.name).toBe('Compound Interest & Savings Calculator');
    expect(meta.dependencies['decimal.js']).toBe('10.6.0');
    expect(meta.limits.length).toBeGreaterThanOrEqual(3);
    expect(meta.limits.some((l: string) => /half away from zero/i.test(l))).toBe(true);
    expect(meta.limits.some((l: string) => /not financial, tax or legal advice; it ignores /i.test(l))).toBe(true);
  });

  it('the usage example in meta.json shows what the code returns', () => {
    const plan = savings();
    expect(plan.summary.finalBalance).toBe('1268.25');
    expect(plan.summary.totalDeposits).toBe('1200.00');
    expect(plan.summary.totalInterest).toBe('68.25');
    expect(plan.summary.effectiveYield).toBe('12.6825');
    expect(plan.rows[0]).toEqual({ year: 1, deposits: '1200.00', interest: '68.25', balance: '1268.25' });
    for (const line of [
      "plan.summary.finalBalance; // '1268.25'",
      "plan.summary.totalDeposits; // '1200.00'",
      "plan.summary.totalInterest; // '68.25'",
      "plan.summary.effectiveYield; // '12.6825'",
      "plan.rows[0]; // { year: 1, deposits: '1200.00', interest: '68.25', balance: '1268.25' }",
    ]) {
      expect(meta.usage).toContain(line);
    }
  });
});

it('OpenFormula 26300 6.12.20 FV with PayType 0: 100 a month at 12 for 12 months ends at 1268.25', () => {
  // OpenFormula 6.12.20 FV says "See PV 6.12.41 for the equation this solves":
  //   0 = Pv x (1 + Rate)^Nper + Payment x (1 + Rate x PayType) x ((1 + Rate)^Nper - 1) / Rate + Fv
  // with money paid out counted negative. With positive amounts the balance is
  //   FV = Pv x (1 + r)^n + Pmt x (1 + r x PayType) x ((1 + r)^n - 1) / r.
  // r = 12 / 100 / 12 = 0.01 and n = 12. (1.01)^12 = 1.126825030131969..., so
  // FV = 100 x (1 - 0 + 0) x 0.126825030131969... / 0.01 = 1268.25030131969..., which rounds to 1268.25.
  const fv = futureValue(new D(0), new D(100), new D(12), 12, 12, 0);
  expect(fv.toFixed(2)).toBe('1268.25');
  expect(fv.toFixed(8)).toBe('1268.25030132');
});

it('OpenFormula 6.12.20 FV with PayType 1: deposits at the start of each month end at 1280.93', () => {
  // PayType 1 multiplies the deposits' growth by (1 + r x 1) = 1.01, so each deposit earns one more period of
  // interest: 1268.25030131969... x 1.01 = 1280.93280433...
  const atEnd = futureValue(new D(0), new D(100), new D(12), 12, 12, 0);
  const atStart = futureValue(new D(0), new D(100), new D(12), 12, 12, 1);
  expect(atStart.toFixed(2)).toBe('1280.93');
  expect(atStart.toFixed(8)).toBe('1280.93280433');
  // The two differ only by one period of interest on each deposit: exactly a factor of 1 + r.
  expect(atStart.eq(atEnd.times('1.01'))).toBe(true);
  // The same through the page entry, with the starting amount 0.
  expect(savings({ timing: 'start' }).summary.finalBalance).toBe('1280.93');
  expect(savings({ timing: 'end' }).summary.finalBalance).toBe('1268.25');
});

it('OpenFormula 6.12.41 PV equation: 1000 at 5 compounded monthly for 10 years grows to 1647.01', () => {
  // No deposits, so only the Pv x (1 + r)^n term remains: r = 5 / 100 / 12 = 0.0041666..., n = 120.
  // (1.0041666...)^120 = 1.647009497690..., so 1000 grows to 1647.009497690..., which rounds to 1647.01.
  const fv = futureValue(new D(1000), new D(0), new D(5), 12, 120, 0);
  expect(fv.toFixed(2)).toBe('1647.01');
  expect(fv.toFixed(8)).toBe('1647.00949769');
  // Quarterly for 5 years: (1 + 0.05 / 4)^20 = 1.28203723..., so 1000 grows to 1282.04.
  expect(futureValue(new D(1000), new D(0), new D(5), 4, 20, 0).toFixed(2)).toBe('1282.04');
});

it('Regulation DD Appendix A: 61.68 interest on 1000 for a 365-day year is an annual percentage yield of 6.17', () => {
  // 12 CFR 1030 Appendix A, example (1): APY = 100 [(1 + 61.68 / 1,000) (365/365) - 1] = 6.17%.
  // 1 + 0.06168 = 1.06168; to the power 1 it is unchanged; minus 1 is 0.06168; times 100 is 6.168 -> 6.17.
  const apy = annualPercentageYield(new D('61.68'), new D(1000), 365);
  expect(apy.toFixed(3)).toBe('6.168');
  expect(toPlain(apy, 2)).toBe('6.17');
});

it('Regulation DD Appendix A: 30.37 interest on 1000 for 182 days is an annual percentage yield of 6.18', () => {
  // 12 CFR 1030 Appendix A, example (2): APY = 100 [(1 + 30.37 / 1,000) (365/182) - 1] = 6.18%.
  // 1.03037 raised to 365 / 182 = 2.005494505... is 1.0618369..., so the APY is 6.18369..., which rounds to 6.18.
  const apy = annualPercentageYield(new D('30.37'), new D(1000), 182);
  expect(apy.toFixed(5)).toBe('6.18369');
  expect(toPlain(apy, 2)).toBe('6.18');
});

it('12 CFR 1030 Appendix A: a 365-day term gives the simple formula 100 times interest over principal and bad input is refused', () => {
  // "When the days in term is 365 ... APY = 100 (Interest/Principal)": 100 x 61.68 / 1000 = 6.168.
  expect(annualPercentageYield(new D('61.68'), new D(1000), 365).eq('6.168')).toBe(true);
  expect(refused(() => annualPercentageYield(new D(1), new D(0), 365)).field).toBe('Principal');
  expect(refused(() => annualPercentageYield(new D(1), new D(100), 0)).field).toBe('Days in term');
});

it('daily compounding uses a 365-day year: 5000 at 6 for one year ends at 5309.16 with an effective yield of 6.1831', () => {
  // r = 6 / 100 / 365 and n = 365 for one year. (1 + r)^365 = 1.0618313106..., so 5000 grows to 5309.1565...,
  // which rounds to 5309.16. The effective annual yield is (1 + r)^365 - 1 = 0.061831310... = 6.1831 percent.
  const fv = futureValue(new D(5000), new D(0), new D(6), 365, 365, 0);
  expect(fv.toFixed(2)).toBe('5309.16');
  expect(toPlain(effectiveAnnualYield(new D(6), 365), 4)).toBe('6.1831');
  const plan = savings({ start: '5000', deposit: '', rate: '6', compounding: '365', years: '1' });
  expect(plan.summary.finalBalance).toBe('5309.16');
  expect(plan.summary.effectiveYield).toBe('6.1831');
  // Monthly compounding of 12 percent: (1.01)^12 - 1 = 12.6825 percent.
  expect(toPlain(effectiveAnnualYield(new D(12), 12), 4)).toBe('12.6825');
  expect(effectiveAnnualYield(new D(0), 12).isZero()).toBe(true);
});

it('a zero rate uses Pv plus Pmt times n instead of dividing by zero', () => {
  // OpenFormula 6.12.41 gives a separate equation for Rate 0: no interest, so FV = Pv + Pmt x n.
  // 100 + 50 x 12 = 700, whether the deposits come at the end or at the start of each period.
  for (const payType of [0, 1] as const) {
    const fv = futureValue(new D(100), new D(50), new D(0), 12, 12, payType);
    expect(fv.isFinite()).toBe(true);
    expect(fv.toFixed()).toBe('700');
  }
  const plan = savings({ start: '100', deposit: '50', rate: '0', years: '1' });
  expect(plan.summary.finalBalance).toBe('700.00');
  expect(plan.summary.totalInterest).toBe('0.00');
  expect(plan.summary.effectiveYield).toBe('0.0000');
  expect(plan.rows[0]).toEqual({ year: 1, deposits: '600.00', interest: '0.00', balance: '700.00' });
  expect(plan.working).toContain('FV = P + D x n');
});

it('the year-by-year rows add up exactly to the final balance, total deposits and total interest', () => {
  // 100 a month at 12 percent compounded monthly, deposits at the end. Exact year-end balances:
  //   year 1: 100 x (1.01^12 - 1) / 0.01 = 1268.2503... -> 1268.25
  //   year 2: 100 x (1.01^24 - 1) / 0.01 = 2697.3464... -> 2697.35  (1.01^24 = 1.269734648532)
  //   year 3: 100 x (1.01^36 - 1) / 0.01 = 4307.6878... -> 4307.69
  // Interest of a year = rounded end - rounded previous end - the year's deposits of 1200:
  //   year 1: 1268.25 - 0 - 1200 = 68.25; year 2: 2697.35 - 1268.25 - 1200 = 229.10; year 3: 4307.69 - 2697.35 - 1200 = 410.34.
  const three = savings({ years: '3' });
  expect(three.rows).toEqual([
    { year: 1, deposits: '1200.00', interest: '68.25', balance: '1268.25' },
    { year: 2, deposits: '1200.00', interest: '229.10', balance: '2697.35' },
    { year: 3, deposits: '1200.00', interest: '410.34', balance: '4307.69' },
  ]);
  expect(three.summary.totalInterest).toBe('707.69');

  // For several shapes of input the columns sum to the totals, in exact decimal arithmetic.
  const shapes: Partial<SavingsTexts>[] = [
    { start: '1000', deposit: '100', rate: '5', years: '10' },
    { start: '2500.55', deposit: '33.33', rate: '3.375', compounding: '365', years: '17', timing: 'start' },
    { start: '0.01', deposit: '0.07', rate: '99.99', compounding: '52', years: '9' },
    { start: '10000', deposit: '', rate: '4.2', compounding: '4', years: '40' },
    { start: '', deposit: '250', rate: '0', compounding: '1', years: '25' },
    { start: '5', deposit: '5', rate: '7.77', compounding: '2', years: '100', timing: 'start' },
  ];
  for (const shape of shapes) {
    const plan = savings(shape);
    const sum = (key: 'deposits' | 'interest') => plan.rows.reduce((total, row) => total.plus(row[key]), new D(0));
    const start = new D(plan.summary.start);
    const final = new D(plan.summary.finalBalance);
    expect(sum('deposits').toFixed(2)).toBe(plan.summary.totalDeposits);
    expect(sum('interest').toFixed(2)).toBe(plan.summary.totalInterest);
    expect(start.plus(sum('deposits')).plus(sum('interest')).eq(final)).toBe(true);
    expect(new D(plan.rows[plan.rows.length - 1]!.balance).eq(final)).toBe(true);
    // The years run 1 to N in order, and each year's balance is the previous balance plus its deposits and interest.
    expect(plan.rows.map((row) => row.year)).toEqual(Array.from({ length: plan.rows.length }, (_, i) => i + 1));
    let previous = start;
    for (const row of plan.rows) {
      expect(previous.plus(row.deposits).plus(row.interest).eq(row.balance)).toBe(true);
      previous = new D(row.balance);
    }
  }
  // The table function on its own: three years, decimals 2.
  const table = yearlyTable(new D(0), new D(100), new D(12), 12, 3, 0, 2);
  expect(table.map((r) => r.balance.toFixed(2))).toEqual(['1268.25', '2697.35', '4307.69']);
});

it('blank start or deposit counts as zero, a blank rate or years is named as missing, and all blank shows nothing', () => {
  expect(calculateSavings({ start: '', deposit: '', rate: '', years: '' })).toBeNull();
  expect(calculateSavings({ start: ' ', deposit: '', rate: '  ', years: '', compounding: '12' })).toBeNull();
  // A blank start counts as 0 and a blank deposit counts as 0.
  const noStart = savings({ start: '', deposit: '100', rate: '12', years: '1' });
  expect(noStart.summary.start).toBe('0.00');
  expect(noStart.summary.finalBalance).toBe('1268.25');
  const noDeposit = savings({ start: '1000', deposit: '', rate: '5', years: '10' });
  expect(noDeposit.summary.totalDeposits).toBe('0.00');
  expect(noDeposit.summary.finalBalance).toBe('1647.01');
  // A blank rate or years is reported as missing with its field named.
  const noRate = refused(() => savings({ rate: '' }));
  expect(noRate.field).toBe('Annual interest rate (percent)');
  expect(noRate.message).toMatch(/missing/);
  const noYears = refused(() => savings({ years: '' }));
  expect(noYears.field).toBe('Years (1 to 100)');
  expect(noYears.message).toMatch(/missing/);
  // Something typed in one field and the others blank asks for the others.
  expect(refused(() => calculateSavings({ start: '1000' })).field).toBe('Annual interest rate (percent)');
  // Nothing to grow: a start and a deposit that are both 0.
  expect(refused(() => savings({ start: '', deposit: '0' })).field).toBe('Starting amount');
});

it('years from 1 to 100 are accepted and 0 or 101 refused, and only the six compounding frequencies are offered', () => {
  expect(savings({ years: '1' }).rows).toHaveLength(1);
  expect(savings({ years: '100', rate: '1', compounding: '1' }).rows).toHaveLength(100);
  for (const bad of ['0', '101', '2.5', '-1', '1e1', '1,0']) {
    expect(refused(() => savings({ years: bad })).field).toBe('Years (1 to 100)');
  }
  for (const times of ['1', '2', '4', '12', '52', '365']) {
    expect(savings({ compounding: times }).summary.perYear).toBe(Number(times));
  }
  // Blank compounding is monthly; anything else is refused naming the field.
  expect(savings({ compounding: '' }).summary.perYear).toBe(12);
  for (const bad of ['7', '24', '0', 'daily', '365.0']) {
    expect(refused(() => savings({ compounding: bad })).field).toBe('Compounding');
  }
  expect(refused(() => savings({ timing: 'middle' })).field).toBe('Deposit timing');
});

it('rates, amounts and the size of the answer are checked and named', () => {
  expect(refused(() => savings({ rate: '100.01' })).field).toBe('Annual interest rate (percent)');
  expect(refused(() => savings({ rate: '-1' })).field).toBe('Annual interest rate (percent)');
  expect(refused(() => savings({ rate: '5%' })).field).toBe('Annual interest rate (percent)');
  expect(savings({ rate: '100' }).summary.rate).toBe('100');
  expect(refused(() => savings({ start: '1,000' })).field).toBe('Starting amount');
  expect(refused(() => savings({ deposit: '-5' })).field).toBe('Regular deposit each period');
  // Amounts have no more places than the currency's smallest unit: USD 2, JPY 0.
  expect(refused(() => savings({ start: '1.005' })).field).toBe('Starting amount');
  expect(refused(() => savings({ deposit: '10.5', currency: 'JPY' })).field).toBe('Regular deposit each period');
  expect(savings({ deposit: '1000', currency: 'JPY', rate: '1' }).summary.decimals).toBe(0);
  // A balance of 10^18 or more is too large to show exactly and is refused naming the rate and years.
  const big = refused(() =>
    savings({ start: '999999999999999', deposit: '', rate: '100', compounding: '365', years: '100' }),
  );
  expect(big.field).toBe('Annual interest rate (percent)');
  expect(big.message).toMatch(/too large/);
  expect(refused(() => savings({ currency: 'ZZZ9' })).field).toBe('Currency (ISO 4217 code)');
});

it('the working shows the formula with the typed numbers, PayType, both roundings and the yield', () => {
  const text = savings({ timing: 'start' }).working;
  expect(text).toContain('OpenFormula 6.12.20 FV');
  expect(text).toContain('6.12.41 PV');
  expect(text).toContain('FV = P x (1 + r)^n + D x (1 + r x PayType) x ((1 + r)^n - 1) / r');
  expect(text).toContain('PayType = 1');
  expect(text).toContain('r = 12 / 100 / 12 = 0.010000000000');
  expect(text).toContain('n = 1 x 12 = 12');
  expect(text).toContain('exact FV = 1280.932804332');
  expect(text).toContain('half away from zero');
  expect(text).toContain('Regulation DD');
  expect(text).toContain('12.6825');
  expect(savings({ timing: 'end' }).working).toContain('PayType = 0');
});

it('0.1 plus 0.2 is exactly 0.3 through this tool', () => {
  // Floating point gets it wrong, so a tool that summed JavaScript numbers would show 0.30000000000000004.
  expect(0.1 + 0.2).not.toBe(0.3);
  // A start of 0.1 and one yearly deposit of 0.2 at a rate of 0 for 1 year: Pv + Pmt x n = 0.1 + 0.2 x 1.
  const fv = futureValue(new D('0.1'), new D('0.2'), new D(0), 1, 1, 0);
  expect(fv.toFixed()).toBe('0.3');
  const plan = savings({ start: '0.1', deposit: '0.2', timing: 'end', rate: '0', compounding: '1', years: '1' });
  expect(plan.summary.finalBalance).toBe('0.30');
  expect(plan.summary.totalDeposits).toBe('0.20');
  expect(plan.summary.totalInterest).toBe('0.00');
});
