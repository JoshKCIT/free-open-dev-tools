import { it, expect, describe } from 'vitest';
import { annualisedReturn, calculateInvestment, investmentReturn, meta, type InvestmentTexts } from '../src/index';
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

/** Values mode: 1000 growing to 1500 between 2021-01-01 and 2025-12-31 (1825 days, exactly 5 years at days over 365). */
const values: InvestmentTexts = {
  mode: 'values',
  startValue: '1000',
  endValue: '1500',
  startDate: '2021-01-01',
  endDate: '2025-12-31',
  currency: 'USD',
};
/** Prices mode: 10 bought at 100 with a fee of 5 and sold at 150 with a fee of 5. */
const prices: InvestmentTexts = {
  mode: 'prices',
  buyPrice: '100',
  sellPrice: '150',
  quantity: '10',
  buyFees: '5',
  sellFees: '5',
  currency: 'USD',
};
const calc = (base: InvestmentTexts, over: Partial<InvestmentTexts> = {}) => {
  const result = calculateInvestment({ ...base, ...over });
  expect(result).not.toBeNull();
  return result!;
};

describe('meta', () => {
  it('id, name, dependency pin and the two required sentences in limits', () => {
    expect(meta.id).toBe('investment-return');
    expect(meta.name).toBe('Investment Return Calculator');
    expect(meta.dependencies['decimal.js']).toBe('10.6.0');
    expect(meta.limits.length).toBeGreaterThanOrEqual(3);
    expect(meta.limits.some((l: string) => /half away from zero/i.test(l))).toBe(true);
    expect(meta.limits.some((l: string) => /not financial, tax or legal advice; it ignores /i.test(l))).toBe(true);
    expect(meta.standards.some((s: { url: string }) => s.url === 'https://www.sec.gov/files/form-n-1a.pdf')).toBe(true);
  });

  it('the usage example in meta.json shows what the code returns', () => {
    const { summary } = calc(values);
    expect(summary.profit).toBe('500.00');
    expect(summary.roi).toBe('50.00');
    expect(summary.days).toBe(1825);
    expect(summary.annualised).toBe('8.45');
    for (const line of [
      "result.summary.profit; // '500.00'",
      "result.summary.roi; // '50.00'",
      'result.summary.days; // 1825',
      "result.summary.annualised; // '8.45'",
    ]) {
      expect(meta.usage).toContain(line);
    }
  });
});

describe('SEC Form N-1A', () => {
  // Item 26(b)(1): P(1+T)^n = ERV, T the average annual total return, n the number of years, ERV the ending
  // redeemable value. Solving for T: T = (ERV / P)^(1/n) - 1. By hand for P = 1000, ERV = 1500, n = 5:
  // 1.5^(1/5) = 1.0844717712, so T = 0.0844717712, which is 8.45 percent to the hundredth of a percent.
  it('SEC Form N-1A Item 26(b)(1) P(1+T)^n = ERV: 1000 growing to 1500 over 5 years is 8.45 a year', () => {
    const t = annualisedReturn(new D(1000), new D(1500), new D(5));
    expect(t).not.toBeNull();
    expect(t!.toFixed(10)).toBe('0.0844717712');
    expect(toPlain(t!.times(100), 2)).toBe('8.45');
    // Put T back into the form's own equation: 1000 x (1 + T)^5 must give 1500 again.
    expect(new D(1000).times(t!.plus(1).pow(5)).minus(1500).abs().lt('1e-30')).toBe(true);
    // Through the page's own entry point, with dates five years apart.
    expect(calc(values).summary.annualised).toBe('8.45');
  });

  // Instruction 5: "State the average annual total return quotation to the nearest hundredth of one percent."
  // Ties go away from zero: 1000 to 1081.25 over exactly 365 days (2025-01-01 to 2026-01-01) is T = 0.08125 exactly,
  // 8.125 percent, shown as 8.13 and not 8.12; a loss of the same size is -8.13.
  it('SEC Form N-1A Item 26 Instruction 5: the annualised return is quoted to the nearest hundredth of a percent by default', () => {
    expect(calc(values).summary.annualised).toBe('8.45');
    expect(calc(values, { decimals: '4' }).summary.annualised).toBe('8.4472');
    expect(calc(values, { decimals: '0' }).summary.annualised).toBe('8');
    const oneYear = { startDate: '2025-01-01', endDate: '2026-01-01' };
    const gain = calc(values, { ...oneYear, endValue: '1081.25' });
    expect(gain.summary.days).toBe(365);
    expect(gain.summary.annualised).toBe('8.13');
    expect(gain.summary.roi).toBe('8.13');
    expect(calc(values, { ...oneYear, endValue: '918.75' }).summary.annualised).toBe('-8.13');
  });

  // 2^(1/2.5) = 2^0.4 = 1.3195079108, so T = 0.3195079108, 31.95 percent. 2.5 years is not a whole number of days
  // (912.5), so this goes through the function that takes years.
  it('1000 growing to 2000 over 2.5 years is 31.95 a year', () => {
    const t = annualisedReturn(new D(1000), new D(2000), new D('2.5'));
    expect(t!.toFixed(10)).toBe('0.3195079108');
    expect(toPlain(t!.times(100), 2)).toBe('31.95');
    const full = investmentReturn({ cost: new D(1000), proceeds: new D(2000), days: 913 });
    expect(full.annualisedPercent).not.toBeNull();
  });
});

describe('holding period', () => {
  // 2021-01-01 to 2025-12-31: five years less one day, with one leap day (29 February 2024):
  // 5 x 365 + 1 - 1 = 1825 days, and 1825 / 365 = 5 exactly.
  it('dates give the holding period in days over 365: 2021-01-01 to 2025-12-31 is 1825 days, exactly 5 years', () => {
    const { summary, working } = calc(values);
    expect(summary.days).toBe(1825);
    expect(summary.years).toBe('5.0000');
    expect(working).toContain('1825 / 365 = 5');
    // A leap year is 366 days and so a little more than one year at days over 365.
    const leap = calc(values, { startDate: '2024-01-01', endDate: '2025-01-01' });
    expect(leap.summary.days).toBe(366);
    expect(leap.summary.years).toBe('1.0027');
    expect(calc(values, { startDate: '2025-01-01', endDate: '2026-01-01' }).summary.days).toBe(365);
  });
});

describe('profit and fees', () => {
  // Prices mode: cost = 100 x 10 + 5 = 1005, proceeds = 150 x 10 - 5 = 1495, profit = 490,
  // return on investment = 490 / 1005 x 100 = 48.7562..., shown 48.76.
  it('profit and return on investment include fees on both sides', () => {
    const { summary } = calc(prices);
    expect(summary).toMatchObject({ cost: '1005.00', proceeds: '1495.00', profit: '490.00', roi: '48.76' });
    expect(summary.annualised).toBeNull();
    // Values mode with the same fees: 1000 + 5 = 1005 and 1500 - 5 = 1495, the same profit.
    const fromValues = calc(values, { buyFees: '5', sellFees: '5' });
    expect(fromValues.summary).toMatchObject({ cost: '1005.00', proceeds: '1495.00', profit: '490.00', roi: '48.76' });
    // (1495 / 1005)^(1/5) - 1 = 0.0826673157, 8.27 percent.
    expect(fromValues.summary.annualised).toBe('8.27');
    // Fees left blank count as 0.
    expect(calc(prices, { buyFees: '', sellFees: '' }).summary.profit).toBe('500.00');
    // A loss is negative: 100 x 10 bought, 80 x 10 sold, no fees, is -200 and -20 percent.
    const loss = calc(prices, { sellPrice: '80', buyFees: '', sellFees: '' }).summary;
    expect(loss).toMatchObject({ profit: '-200.00', roi: '-20.00' });
  });

  it('prices with more decimal places than the currency show only the rounded amounts but keep every digit inside', () => {
    // 3 shares at 0.3333 cost 0.9999 exactly, shown as 1.00; sold at 0.4 for 1.2 the profit is 0.2001 exactly.
    const { summary } = calc(prices, {
      buyPrice: '0.3333',
      sellPrice: '0.4',
      quantity: '3',
      buyFees: '',
      sellFees: '',
      decimals: '4',
    });
    expect(summary.cost).toBe('1.00');
    expect(summary.proceeds).toBe('1.20');
    expect(summary.profit).toBe('0.20');
    expect(summary.roi).toBe('20.0120');
  });

  it('a currency with no minor unit shows whole amounts', () => {
    const { summary } = calc(prices, { currency: 'JPY' });
    expect(summary).toMatchObject({ cost: '1005', proceeds: '1495', profit: '490', roi: '48.76' });
  });
});

describe('refusals and plain messages', () => {
  it('an end date before the start, a zero cost and fees larger than the sale are refused or reported plainly', () => {
    const early = refused(() => calculateInvestment({ ...values, startDate: '2025-12-31', endDate: '2021-01-01' }));
    expect(early.field).toBe('End date');
    expect(early.message).toContain('before the start date');
    const free = refused(() => calculateInvestment({ ...prices, buyPrice: '0', buyFees: '' }));
    expect(free.field).toBe('Buy price');
    expect(free.message).toContain('more than 0');
    const nothingPaid = refused(() => calculateInvestment({ ...values, startValue: '0' }));
    expect(nothingPaid.field).toBe('Start value');
    // Fees of 200 against a sale of 150 x 1 = 150 leave proceeds below zero.
    const fees = refused(() => calculateInvestment({ ...prices, quantity: '1', sellFees: '200' }));
    expect(fees.field).toBe('Fees when selling (optional)');
    expect(fees.message).toContain('more than the sale');
    // One date alone is not an error: the annualised return says what it needs.
    const oneDate = calc(values, { endDate: '' });
    expect(oneDate.summary.annualised).toBeNull();
    expect(oneDate.summary.annualisedNote).toContain('start date and an end date');
    expect(oneDate.summary.roi).toBe('50.00');
    // A date that is not a date is refused naming its field.
    expect(refused(() => calculateInvestment({ ...values, endDate: '2025-02-30' })).field).toBe(
      'End date (optional, YYYY-MM-DD)',
    );
    // Something missing is named, and a negative or ill-formed number is refused.
    expect(refused(() => calculateInvestment({ ...prices, sellPrice: '' })).field).toBe('Sell price');
    expect(refused(() => calculateInvestment({ ...prices, quantity: '0' })).field).toBe('Quantity');
    expect(refused(() => calculateInvestment({ ...prices, buyFees: '-1' })).field).toBe('Fees when buying (optional)');
    expect(refused(() => calculateInvestment({ ...values, endValue: '1e3' })).field).toBe('End value');
    expect(refused(() => calculateInvestment({ ...values, mode: 'both' })).field).toBe('Mode');
    expect(refused(() => calculateInvestment({ ...values, decimals: '5' })).field).toBe('Decimal places');
    expect(refused(() => calculateInvestment({ ...values, currency: 'DOLLARS' })).field).toBe(
      'Currency (ISO 4217 code)',
    );
    // A price may have 12 digits before the point and 6 after, a quantity the same.
    expect(refused(() => calculateInvestment({ ...prices, buyPrice: '1000000000000' })).field).toBe('Buy price');
    expect(refused(() => calculateInvestment({ ...prices, quantity: '1.0000001' })).field).toBe('Quantity');
    // (10^12 - 10^-6)^2 + 5 = 999999999999998000005.000000000001, kept exactly and shown at 2 places.
    expect(calc(prices, { buyPrice: '999999999999.999999', quantity: '999999999999.999999' }).summary.cost).toBe(
      '999999999999998000005.00',
    );
  });

  // 0 / 1000 gives T = -1: the whole amount is lost. Proceeds of 0 come from a sale price of 0 and no fees.
  it('a sale for nothing is a return of -100 and a same-day holding has no annualised return', () => {
    const none = calc(prices, { sellPrice: '0', buyFees: '', sellFees: '' });
    expect(none.summary).toMatchObject({ proceeds: '0.00', profit: '-1000.00', roi: '-100.00' });
    const noneYears = calc(values, { endValue: '0' });
    expect(noneYears.summary.annualised).toBe('-100.00');
    expect(annualisedReturn(new D(1000), new D(0), new D(5))!.toString()).toBe('-1');
    // Same day: no year count to annualise over, and the reason is stated.
    const sameDay = calc(values, { startDate: '2025-06-30', endDate: '2025-06-30' });
    expect(sameDay.summary.days).toBe(0);
    expect(sameDay.summary.annualised).toBeNull();
    expect(sameDay.summary.annualisedNote).toContain('0 days');
    expect(sameDay.summary.roi).toBe('50.00');
    expect(annualisedReturn(new D(1000), new D(1500), new D(0))).toBeNull();
    expect(investmentReturn({ cost: new D(1000), proceeds: new D(1500), days: 0 }).annualisedPercent).toBeNull();
    // Cost and ending value are checked by the function too.
    expect(refused(() => annualisedReturn(new D(0), new D(1), new D(1))).field).toBe('Total cost');
    expect(refused(() => annualisedReturn(new D(1), new D(-1), new D(1))).field).toBe('Total proceeds');
  });

  it('a gain too large to show annualised is stated, never printed as a long run of digits', () => {
    // 1 growing to 2 in one day is 2^365 - 1, about 7.5e109, annualised.
    const quick = calc(values, { startValue: '1', endValue: '2', startDate: '2025-01-01', endDate: '2025-01-02' });
    expect(quick.summary.days).toBe(1);
    expect(quick.summary.annualised).toBeNull();
    expect(quick.summary.annualisedNote).toContain('too large');
    expect(quick.summary.roi).toBe('100.00');
    // A 1 percent gain in a day is 1.01^365 - 1 = 36.78 times, 3678 percent or so, which is shown.
    const modest = calc(values, { startValue: '100', endValue: '101', startDate: '2025-01-01', endDate: '2025-01-02' });
    expect(modest.summary.annualised).toMatch(/^\d{4}\.\d\d$/);
  });

  it('nothing typed shows nothing, whichever mode is chosen', () => {
    expect(calculateInvestment({ mode: 'prices', currency: 'USD' })).toBeNull();
    expect(calculateInvestment({ mode: 'values', currency: 'USD' })).toBeNull();
    expect(calculateInvestment({})).toBeNull();
    // Numbers typed for the other mode do not count, and are not read.
    expect(calculateInvestment({ mode: 'values', buyPrice: 'abc', sellPrice: '1', quantity: '1' })).toBeNull();
    // Fees and dates alone do not start a calculation either.
    expect(calculateInvestment({ mode: 'prices', buyFees: '5', startDate: '2021-01-01' })).toBeNull();
  });
});

describe('exactness and wording', () => {
  // In JavaScript floating point 0.3 - 0.1 is 0.19999999999999998. Bought at 0.1 and sold at 0.3 (quantity 1),
  // the profit is exactly 0.2, so the cost plus the profit is exactly the 0.3 received, and the return on
  // investment is exactly 200 percent.
  it('0.1 plus 0.2 is exactly 0.3 through this tool', () => {
    expect(0.3 - 0.1).toBe(0.19999999999999998);
    const r = investmentReturn({ cost: new D('0.1'), proceeds: new D('0.3'), days: null });
    expect(r.profit.toString()).toBe('0.2');
    expect(new D('0.1').plus(r.profit).toString()).toBe('0.3');
    expect(r.roiPercent.toString()).toBe('200');
    // And from the page's strings, shown to 3 decimal places of a currency that has them.
    const { summary } = calc(prices, {
      buyPrice: '0.1',
      sellPrice: '0.3',
      quantity: '1',
      buyFees: '',
      sellFees: '',
      currency: 'BHD',
    });
    expect(summary).toMatchObject({ cost: '0.100', proceeds: '0.300', profit: '0.200', roi: '200.00' });
  });

  it('the working shows both formulas with the typed numbers and cites the SEC form', () => {
    const { working } = calc(prices, { startDate: '2021-01-01', endDate: '2025-12-31' });
    for (const part of [
      'cost = buy price x quantity + fees paid when buying',
      'cost = 100 x 10 + 5 = 1005',
      'proceeds = 150 x 10 - 5 = 1495',
      'profit = 1495 - 1005 = 490',
      'return on investment = 490 / 1005 x 100 = 48.7562',
      'SEC Form N-1A Item 26(b)(1)',
      'P(1+T)^n = ERV',
      'n = 1825 / 365 = 5',
      'T = (1495 / 1005)^(1 / 5) - 1',
      'half away from zero',
    ]) {
      expect(working).toContain(part);
    }
    expect(calc(values).working).toContain('cost = start value + fees paid when buying = 1000 + 0 = 1000');
  });

  it('only arithmetic is shown: no wording recommends or rates anything', () => {
    const texts = [
      calc(prices, { startDate: '2021-01-01', endDate: '2025-12-31' }).working,
      calc(values, { startDate: '2025-01-01', endDate: '2025-01-02' }).summary.annualisedNote ?? '',
      calc(values, { endDate: '' }).summary.annualisedNote ?? '',
      calc(values, { startDate: '2025-06-30', endDate: '2025-06-30' }).summary.annualisedNote ?? '',
      meta.about,
      ...meta.supports,
      ...meta.limits,
    ].join('\n');
    expect(texts).not.toMatch(
      /\b(should|recommend\w*|best|better|worse|good|bad|worth|accept|reject|wise|safe|risky)\b/i,
    );
    expect(texts).not.toMatch(/\b(buy|sell|hold) (it|now|more|less)\b/i);
  });
});
