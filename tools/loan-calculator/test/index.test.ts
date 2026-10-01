import { it, expect, describe } from 'vitest';
import { calculateLoan, paymentPerPeriod, meta } from '../src/index';
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

describe('meta', () => {
  it('id, name, summary, dependency pin and the two required sentences in limits', () => {
    expect(meta.id).toBe('loan-calculator');
    expect(meta.name).toBe('Loan & Mortgage Calculator');
    expect(meta.dependencies['decimal.js']).toBe('10.6.0');
    expect(meta.limits.length).toBeGreaterThanOrEqual(3);
    expect(meta.limits.some((l: string) => /half away from zero/i.test(l))).toBe(true);
    expect(meta.limits.some((l: string) => /not financial, tax or legal advice; it ignores /i.test(l))).toBe(true);
  });
});

it('OpenFormula 26300 6.12.36 PMT: CFPB H-24(B) sample 162000 at 3.875 for 30 years pays 761.78 a month', () => {
  // Source: CFPB sample Loan Estimate H-24(B) "Fixed Rate Loan Sample" (12 CFR 1026 Appendix H model form),
  // https://files.consumerfinance.gov/f/201403_cfpb_loan-estimate_fixed-rate-loan-sample-H24B.pdf, fetched
  // 2026-10-01: loan amount 162,000, 30 year term, 3.875 percent fixed, "Monthly Principal & Interest $761.78".
  // Formula: OpenFormula 6.12.36 PMT with Fv = 0 and PayType = 0, Rate nonzero:
  //   payment = P * r / (1 - (1 + r)^-n),  r = 3.875 / 100 / 12,  n = 360
  // Hand check of the leading digits: r = 3.875 / 100 / 12 = 0.0032291667 (to 10 places), (1 + r)^360 = 3.191934,
  // so 1 - 1/3.191934 = 0.686710, 162000 * r = 523.1250 and 523.1250 / 0.686710 = 761.78.
  const exact = paymentPerPeriod(new D('162000'), new D('3.875'), 360, 12);
  expect(exact.toFixed(12).startsWith('761.784075')).toBe(true);
  const loan = calculateLoan({ amount: '162000', rate: '3.875', years: '30', currency: 'USD' });
  expect(loan.summary.payment).toBe('761.78');
  expect(loan.summary.payments).toBe('360');
  expect(loan.summary.paymentExact.startsWith('761.784075')).toBe(true);
});

it('OpenFormula 6.12.36 Rate 0 equation: a zero rate pays the amount divided by the number of payments', () => {
  // OpenFormula 6.12.36 gives a separate equation for Rate = 0: payment = -(Pv + Fv) / Nper, so 1200 over 12 payments
  // is 100 a month. The general formula would divide by zero here.
  const exact = paymentPerPeriod(new D('1200'), new D('0'), 12, 12);
  expect(exact.toFixed()).toBe('100');
  const loan = calculateLoan({ amount: '1200', rate: '0', years: '1', currency: 'USD' });
  expect(loan.summary.payment).toBe('100.00');
  expect(loan.summary.payments).toBe('12');
});

it('the working shows the PMT formula with the typed numbers substituted', () => {
  const loan = calculateLoan({ amount: '162000', rate: '3.875', years: '30', currency: 'USD' });
  const text = loan.working;
  expect(text).toContain('PMT');
  expect(text).toContain('6.12.36');
  expect(text).toContain('162000');
  expect(text).toContain('3.875');
  expect(text).toContain('360');
  expect(text).toContain('761.78');
  expect(text).toContain('half away from zero');
  // The exact payment is shown before the rounded one.
  expect(text).toContain('761.784075863470');
  // The substituted numbers are plain decimals, never exponent notation.
  expect(text).not.toMatch(/\de[+-]?\d/i);
});

it('0.1 plus 0.2 is exactly 0.3 through this tool', () => {
  // The float really is wrong...
  expect(0.1 + 0.2).not.toBe(0.3);
  expect(String(0.1 + 0.2)).toBe('0.30000000000000004');
  // ...and this tool's own path is exact: 0.3 over 3 monthly payments (0.25 years) is exactly 0.1 each,
  // and that payment plus the 0.2 still owing after it is exactly 0.3.
  const loan = calculateLoan({ amount: '0.3', rate: '0', years: '0.25', currency: 'USD' });
  expect(loan.summary.payments).toBe('3');
  expect(loan.summary.paymentExact).toBe('0.1');
  expect(loan.summary.payment).toBe('0.10');
  const payment = paymentPerPeriod(new D('0.3'), new D('0'), 3, 12);
  expect(payment.plus(new D('0.2')).toFixed()).toBe('0.3');
  expect(payment.times(3).toFixed()).toBe('0.3');
});

it('a missing or malformed amount, rate or term is reported naming the field', () => {
  const ok = { amount: '1000', rate: '5', years: '1', currency: 'USD' };
  const cases: [Partial<typeof ok>, string, RegExp?][] = [
    [{ amount: '' }, 'Loan amount', /^missing, type a value such as /],
    [{ amount: '   ' }, 'Loan amount', /^missing/],
    [{ amount: '1,000' }, 'Loan amount'],
    [{ amount: '1e3' }, 'Loan amount'],
    [{ amount: '0' }, 'Loan amount', /more than 0/],
    [{ amount: '-50' }, 'Loan amount'],
    [{ rate: '' }, 'Annual interest rate (percent)', /^missing/],
    [{ rate: '5%' }, 'Annual interest rate (percent)'],
    [{ rate: '-1' }, 'Annual interest rate (percent)'],
    [{ years: '' }, 'Term (years)', /^missing/],
    [{ years: 'thirty' }, 'Term (years)'],
    [{ years: '0.37' }, 'Term (years)', /whole number of monthly payments/],
    [{ years: '0' }, 'Term (years)'],
    [{ currency: 'US' }, 'Currency (ISO 4217 code)'],
    [{ currency: '' }, 'Currency (ISO 4217 code)', /^missing/],
  ];
  for (const [patch, field, message] of cases) {
    const err = refused(() => calculateLoan({ ...ok, ...patch }));
    expect(err.field, JSON.stringify(patch)).toBe(field);
    if (message) expect(err.message, JSON.stringify(patch)).toMatch(message);
  }
  // The unmodified input still works.
  expect(calculateLoan(ok).summary.payments).toBe('12');
});
