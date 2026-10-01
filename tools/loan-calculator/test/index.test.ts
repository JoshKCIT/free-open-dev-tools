import { it, expect, describe, test } from 'vitest';
import { calculateLoan, paymentPerPeriod, periodsPerYear, scheduleCsv, MAX_TERM_YEARS, meta } from '../src/index';
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

  it('the usage example in meta.json shows what the code returns', () => {
    const loan = calculateLoan({
      amount: '162000',
      rate: '3.875',
      years: '30',
      currency: 'USD',
      firstPayment: '2026-01-31',
    });
    expect(loan.summary.payment).toBe('761.78');
    expect(loan.summary.totalInterest).toBe('112243.70');
    expect(loan.summary.payoffDate).toBe('2055-12-31');
    expect(loan.rows[0]).toEqual({
      number: 1,
      date: '2026-01-31',
      payment: '761.78',
      interest: '523.13',
      principal: '238.65',
      balance: '161761.35',
    });
    for (const line of [
      "loan.summary.payment; // '761.78'",
      "loan.summary.totalInterest; // '112243.70'",
      "loan.summary.payoffDate; // '2055-12-31'",
      "loan.rows[0]; // { number: 1, date: '2026-01-31', payment: '761.78', interest: '523.13', principal: '238.65', balance: '161761.35' }",
    ]) {
      expect(meta.usage).toContain(line);
    }
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

/** Adds up a column of plain decimal strings exactly. */
function sum(values: string[]): string {
  return values.reduce((total, v) => total.plus(v), new D(0)).toFixed(2);
}

const THOUSAND = { amount: '1000', rate: '12', years: '1', currency: 'USD' };

it('12 CFR 1026 Appendix J (b)(5): monthly, fortnightly and weekly payments use 12, 26 and 52 periods a year', () => {
  // 12 CFR 1026 Appendix J (b)(5)(ii) "If the unit-period is a month, there are 12 unit-periods per year" and
  // (b)(5)(iv) "If the unit-period is a week or a multiple of a week, the number of unit-periods per year shall be
  // 52 divided by the number of weeks per unit-period", so a fortnight is 26. Fetched 2026-10-01 from
  // https://www.consumerfinance.gov/rules-policy/regulations/1026/j/
  expect(MAX_TERM_YEARS).toBe(50);
  expect(periodsPerYear('monthly')).toBe(12);
  expect(periodsPerYear('fortnightly')).toBe(26);
  expect(periodsPerYear('weekly')).toBe(52);
  // At no interest the payment is the amount over the payments: 1000 / 12 = 83.33, 1000 / 26 = 38.46, 1000 / 52 = 19.23.
  const flat = { amount: '1000', rate: '0', years: '1', currency: 'USD' };
  expect(calculateLoan({ ...flat, frequency: 'monthly' }).summary).toMatchObject({ payments: '12', payment: '83.33' });
  expect(calculateLoan({ ...flat, frequency: 'fortnightly' }).summary).toMatchObject({
    payments: '26',
    payment: '38.46',
  });
  expect(calculateLoan({ ...flat, frequency: 'weekly' }).summary).toMatchObject({ payments: '52', payment: '19.23' });
  // The yearly rate is divided by that count: 5.2 percent a year is 0.001 a week.
  expect(calculateLoan({ ...flat, rate: '5.2', frequency: 'weekly' }).working).toContain(
    '5.2 / 100 / 52 = 0.001000000000',
  );
  expect(calculateLoan({ ...flat, rate: '5.2', frequency: 'fortnightly' }).working).toContain('5.2 / 100 / 26');
  // Half a year is 13 fortnightly payments; a quarter year is not a whole number of them.
  expect(calculateLoan({ ...flat, years: '0.5', frequency: 'fortnightly' }).summary.payments).toBe('13');
  const err = refused(() => calculateLoan({ ...flat, years: '0.25', frequency: 'fortnightly' }));
  expect(err.field).toBe('Term (years)');
  expect(err.message).toMatch(/whole number of fortnightly payments/);
});

it('OpenFormula 6.12.23 IPMT and 6.12.37 PPMT: row 1 of 1000 at 12 for one year monthly is 10.00 interest and 78.85 principal', () => {
  // Hand derivation (OpenFormula 6.12.36 PMT, 6.12.23 IPMT "the interest rate multiplied by the balance at the
  // beginning of the period", 6.12.37 PPMT):
  //   r = 12 / 100 / 12 = 0.01 a month, n = 12
  //   (1 + r)^12 = 1.126825, 1 - 1/1.126825 = 0.112551, payment = 1000 * 0.01 / 0.112551 = 88.8488, so 88.85 rounded
  //   row 1 interest  = 1000 * 0.01 = 10.00
  //   row 1 principal = 88.85 - 10.00 = 78.85
  //   row 1 balance   = 1000 - 78.85 = 921.15
  const loan = calculateLoan(THOUSAND);
  expect(loan.summary.payment).toBe('88.85');
  expect(loan.rows[0]).toEqual({
    number: 1,
    payment: '88.85',
    interest: '10.00',
    principal: '78.85',
    balance: '921.15',
  });
  // Row 2: interest = 921.15 * 0.01 = 9.2115 -> 9.21, principal = 88.85 - 9.21 = 79.64, balance = 921.15 - 79.64 = 841.51.
  expect(loan.rows[1]).toEqual({
    number: 2,
    payment: '88.85',
    interest: '9.21',
    principal: '79.64',
    balance: '841.51',
  });
  expect(loan.working).toContain('6.12.23');
  expect(loan.working).toContain('6.12.37');
});

it('the last row carries the rounding residue so the rows sum exactly to the total paid and the total interest', () => {
  // 1000 at 12 for one year: the payment 88.85 was rounded up, so the last row pays less. Hand derivation of row 12:
  // the balance owing before it is 87.96 (the principal of the last row), interest = 87.96 * 0.01 = 0.8796 -> 0.88,
  // payment = 87.96 + 0.88 = 88.84. Total interest 66.19 was recomputed independently in integer cents.
  const small = calculateLoan(THOUSAND);
  const last = small.rows[small.rows.length - 1]!;
  expect(small.rows).toHaveLength(12);
  expect(last).toEqual({ number: 12, payment: '88.84', interest: '0.88', principal: '87.96', balance: '0.00' });
  expect(small.summary.totalInterest).toBe('66.19');
  expect(small.summary.totalPaid).toBe('1066.19');
  expect(sum(small.rows.map((r) => r.payment))).toBe(small.summary.totalPaid);
  expect(sum(small.rows.map((r) => r.interest))).toBe(small.summary.totalInterest);
  expect(sum(small.rows.map((r) => r.principal))).toBe('1000.00');

  // The CFPB loan: payment 761.78 rounded down, so the last of 360 rows pays 764.68 (recomputed independently in
  // integer cents: total interest 112243.70, total paid 274243.70).
  const cfpb = calculateLoan({ amount: '162000', rate: '3.875', years: '30', currency: 'USD' });
  expect(cfpb.rows).toHaveLength(360);
  expect(cfpb.rows[359]).toMatchObject({ number: 360, payment: '764.68', balance: '0.00' });
  expect(cfpb.summary.totalInterest).toBe('112243.70');
  expect(cfpb.summary.totalPaid).toBe('274243.70');
  expect(sum(cfpb.rows.map((r) => r.payment))).toBe('274243.70');
  expect(sum(cfpb.rows.map((r) => r.interest))).toBe('112243.70');
  expect(sum(cfpb.rows.map((r) => r.principal))).toBe('162000.00');
  // Every row is internally consistent: principal = payment - interest, and the balance falls by the principal.
  let balance = new D('162000');
  for (const row of cfpb.rows) {
    expect(new D(row.payment).minus(row.interest).toFixed(2), String(row.number)).toBe(new D(row.principal).toFixed(2));
    balance = balance.minus(row.principal);
    expect(balance.toFixed(2), String(row.number)).toBe(row.balance);
  }
});

it('CFPB H-24(B) principal paid after 60 payments rounds to 15773', () => {
  // CFPB sample Loan Estimate H-24(B): "In 5 Years ... $15,773 Principal you will have paid off". Five years is 60
  // payments. With each row's interest rounded to the cent the balance after row 60 is 146,227.42, so the principal
  // paid is 162000 - 146227.42 = 15772.58, which is 15773 to the dollar (unrounded rows give 15,772.86, also 15773).
  const cfpb = calculateLoan({ amount: '162000', rate: '3.875', years: '30', currency: 'USD' });
  const after60 = cfpb.rows[59]!;
  expect(after60.number).toBe(60);
  expect(after60.balance).toBe('146227.42');
  const paid = new D('162000').minus(after60.balance);
  expect(paid.toFixed(2)).toBe('15772.58');
  expect(paid.toDecimalPlaces(0, D.ROUND_HALF_UP).toFixed(0)).toBe('15773');
});

it('an extra payment each period shortens the loan: 1000 at 12 for one year with 20 extra ends after 10 payments with 54.31 interest', () => {
  // Each period pays 88.85 + 20 = 108.85 and the extra goes to principal. Row 1: interest 10.00, principal
  // 108.85 - 10.00 = 98.85, balance 901.15. The last row (10) owes 73.92 before it: interest 73.92 * 0.01 = 0.7392
  // -> 0.74, payment 73.92 + 0.74 = 74.66. Total interest 54.31 was recomputed independently in integer cents.
  const loan = calculateLoan({ ...THOUSAND, extra: '20' });
  expect(loan.rows).toHaveLength(10);
  expect(loan.summary.payments).toBe('10');
  expect(loan.summary.scheduledPayments).toBe('12');
  expect(loan.rows[0]).toEqual({
    number: 1,
    payment: '108.85',
    interest: '10.00',
    principal: '98.85',
    balance: '901.15',
  });
  expect(loan.rows[9]).toEqual({ number: 10, payment: '74.66', interest: '0.74', principal: '73.92', balance: '0.00' });
  expect(loan.summary.totalInterest).toBe('54.31');
  expect(sum(loan.rows.map((r) => r.principal))).toBe('1000.00');
  expect(sum(loan.rows.map((r) => r.payment))).toBe(loan.summary.totalPaid);
  expect(new D(loan.summary.totalInterest).lt(calculateLoan(THOUSAND).summary.totalInterest)).toBe(true);
  // An extra payment bigger than the whole balance ends the schedule on the first row, paying just what is owed.
  const huge = calculateLoan({ ...THOUSAND, extra: '5000' });
  expect(huge.rows).toHaveLength(1);
  expect(huge.rows[0]).toEqual({
    number: 1,
    payment: '1010.00',
    interest: '10.00',
    principal: '1000.00',
    balance: '0.00',
  });
});

it('12 CFR 1026 Appendix J (b)(3)(iv): payments due on the 31st fall on the last day of shorter months and the payoff date is the last payment date', () => {
  // Appendix J (b)(3)(iv): "If payments (or advances) are scheduled for the 29th or 30th of each month, the last day
  // of February shall be used when applicable." Months are counted from the first date, not chained.
  const monthly = calculateLoan({ ...THOUSAND, firstPayment: '2024-01-31' });
  expect(monthly.rows.slice(0, 4).map((r) => r.date)).toEqual(['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30']);
  expect(monthly.rows[11]!.date).toBe('2024-12-31');
  expect(monthly.summary.payoffDate).toBe('2024-12-31');
  expect(monthly.summary.payoffText).toBe('2024-12-31');
  // A fortnight adds 14 days and a week adds 7.
  const fortnightly = calculateLoan({ ...THOUSAND, frequency: 'fortnightly', firstPayment: '2024-01-31' });
  expect(fortnightly.rows.slice(0, 3).map((r) => r.date)).toEqual(['2024-01-31', '2024-02-14', '2024-02-28']);
  expect(fortnightly.summary.payoffDate).toBe(fortnightly.rows[fortnightly.rows.length - 1]!.date);
  const weekly = calculateLoan({ ...THOUSAND, frequency: 'weekly', firstPayment: '2024-01-31' });
  expect(weekly.rows.slice(0, 3).map((r) => r.date)).toEqual(['2024-01-31', '2024-02-07', '2024-02-14']);
  expect(weekly.rows).toHaveLength(52);
  // 51 weeks of 7 days after 31 January 2024 is 2025-01-22.
  expect(weekly.summary.payoffDate).toBe('2025-01-22');
  // Without a first date there are no dates and the payoff reads as a count and a length of time.
  const undated = calculateLoan(THOUSAND);
  expect(undated.rows[0]).not.toHaveProperty('date');
  expect(undated.summary.payoffDate).toBeUndefined();
  expect(undated.summary.payoffText).toBe('after 12 payments (about 1 year)');
  expect(calculateLoan({ amount: '162000', rate: '3.875', years: '30' }).summary.payoffText).toBe(
    'after 360 payments (about 30 years)',
  );
  expect(calculateLoan({ amount: '1000', rate: '0', years: '0.25' }).summary.payoffText).toBe(
    'after 3 payments (about 3 months)',
  );
});

it('a term that is not a whole number of payments, a term over 50 years and a negative extra payment are refused naming the field', () => {
  const ok = { amount: '1000', rate: '5', years: '1', currency: 'USD' };
  const cases: [Record<string, string>, string, RegExp?][] = [
    [{ years: '0.37' }, 'Term (years)', /whole number of monthly payments/],
    [{ years: '1.1' }, 'Term (years)', /whole number of monthly payments/],
    [{ years: '51' }, 'Term (years)', /50/],
    [{ years: '50.25' }, 'Term (years)', /50/],
    [{ years: '1000' }, 'Term (years)', /50/],
    [{ years: '-98765' }, 'Term (years)'],
    [{ extra: '-5' }, 'Extra payment each period (optional)'],
    [{ extra: '5,5' }, 'Extra payment each period (optional)'],
    [{ firstPayment: '2024-02-30' }, 'First payment date (optional, YYYY-MM-DD)'],
    [{ firstPayment: '31/01/2024' }, 'First payment date (optional, YYYY-MM-DD)'],
    [{ frequency: 'daily' }, 'Payment frequency'],
    // A loan so small that its payment rounds to nothing cannot be shown as a schedule.
    [{ amount: '1', years: '50' }, 'Loan amount', /smallest unit/],
  ];
  for (const [patch, field, message] of cases) {
    const err = refused(() => calculateLoan({ ...ok, ...patch }));
    expect(err.field, JSON.stringify(patch)).toBe(field);
    if (message) expect(err.message, JSON.stringify(patch)).toMatch(message);
  }
  // The longest accepted term stays inside 2,600 rows and ends with a zero balance. (A payment rounded up to the
  // cent can clear a loan a few payments early, so the count is checked as a range, not exactly.)
  const longest = calculateLoan({ ...ok, amount: '1000000', years: '50', frequency: 'weekly', extra: '' });
  expect(longest.rows.length).toBeLessThanOrEqual(2600);
  expect(longest.rows.length).toBeGreaterThan(2590);
  expect(longest.rows[longest.rows.length - 1]!.balance).toBe('0.00');
  expect(longest.summary.scheduledPayments).toBe('2600');
  expect(calculateLoan({ ...ok, years: '50' }).rows).toHaveLength(600);
  // Blank optional fields mean none.
  expect(calculateLoan({ ...ok, extra: '  ', firstPayment: '' }).rows).toHaveLength(12);
});

it('the schedule CSV lists every row with the same rounded figures as the table', () => {
  const loan = calculateLoan({ ...THOUSAND, firstPayment: '2024-01-31' });
  const lines = loan.csv.split('\r\n');
  expect(lines[0]).toBe('Payment,Date,Payment amount,Interest,Principal,Balance');
  expect(lines.pop()).toBe('');
  expect(lines).toHaveLength(13);
  expect(lines[1]).toBe('1,2024-01-31,88.85,10.00,78.85,921.15');
  expect(lines[12]).toBe('12,2024-12-31,88.84,0.88,87.96,0.00');
  loan.rows.forEach((row, i) => {
    expect(lines[i + 1]).toBe([row.number, row.date, row.payment, row.interest, row.principal, row.balance].join(','));
  });
  expect(scheduleCsv(loan.rows)).toBe(loan.csv);
  // Without dates the Date column is left out.
  const undated = calculateLoan(THOUSAND);
  expect(undated.csv.split('\r\n')[0]).toBe('Payment,Payment amount,Interest,Principal,Balance');
  expect(undated.csv.split('\r\n')[1]).toBe('1,88.85,10.00,78.85,921.15');
  // Only digits, dots, dashes and commas: nothing a spreadsheet could read as a formula.
  expect(loan.csv).not.toMatch(/["=@+]/);
});

test('a last payment far above the regular one comes with a note that explains why', () => {
  // 1,919.42 over 47 years of fortnightly payments: the payment is rounded once to 3.22 and the rounding error
  // compounds over 1,222 payments, so the last payment is 16.84 (more than five times the regular one).
  const long = calculateLoan({ amount: '1919.42', rate: '3.539', years: '47', frequency: 'fortnightly' });
  expect(long.summary.payment).toBe('3.22');
  expect(long.rows[long.rows.length - 1]!.payment).toBe('16.84');
  expect(long.notes).toHaveLength(1);
  expect(long.notes[0]).toContain('16.84');
  expect(long.notes[0]).toContain('3.22');
  expect(long.notes[0]).toMatch(/rounding/i);
  // An ordinary mortgage (200,000 at 7 percent over 30 years: 1,330.60, last 1,336.54) gets no note.
  const mortgage = calculateLoan({ amount: '200000', rate: '7', years: '30' });
  expect(mortgage.summary.payment).toBe('1330.60');
  expect(mortgage.notes).toEqual([]);
  // A loan cleared early by an extra payment has a short last row and gets no note.
  expect(calculateLoan({ amount: '1000', rate: '12', years: '1', extra: '20' }).notes).toEqual([]);
});

test('the limits text no longer says the last payment differs only by a few coins', () => {
  expect(meta.limits.join(' ')).not.toMatch(/few units of the smallest coin/i);
  expect(meta.limits.some((l: string) => /final payment can be several times the regular one/i.test(l))).toBe(true);
});
