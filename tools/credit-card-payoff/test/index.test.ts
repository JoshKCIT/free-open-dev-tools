import { it, expect, describe } from 'vitest';
import {
  calculatePayoff,
  meta,
  parseCards,
  paymentToFinishBy,
  simulatePayoff,
  MAX_CARDS,
  MAX_MONTHS,
  type PayoffOrder,
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

const cards = (text: string, currency = 'USD') => parseCards(text, currency);
const plain = (x: { toFixed(dp: number): string }) => x.toFixed(2);

const TWO_CARDS = 'Card A | 1000 | 24 | 25\nCard B | 500 | 12 | 25';

describe('meta', () => {
  it('id, name, dependency pin and the two required sentences in limits', () => {
    expect(meta.id).toBe('credit-card-payoff');
    expect(meta.name).toBe('Credit Card Payoff Calculator');
    expect(meta.dependencies['decimal.js']).toBe('10.6.0');
    expect(meta.limits.length).toBeGreaterThanOrEqual(3);
    expect(meta.limits.some((l: string) => /half away from zero/i.test(l))).toBe(true);
    expect(meta.limits.some((l: string) => /not financial, tax or legal advice; it ignores /i.test(l))).toBe(true);
  });

  it('the usage example in meta.json shows what the code returns', () => {
    const plan = calculatePayoff({ cards: TWO_CARDS, budget: '200', currency: 'USD' });
    expect(plan).not.toBeNull();
    const orders = plan!.orders;
    expect(orders[0]!.months).toBe(9);
    expect(orders[0]!.totalInterest).toBe('105.49');
    expect(orders[1]!.months).toBe(9);
    expect(orders[1]!.totalInterest).toBe('130.28');
    for (const line of [
      'plan.orders[0].months; // 9 (highest rate first)',
      "plan.orders[0].totalInterest; // '105.49'",
      'plan.orders[1].months; // 9 (smallest balance first)',
      "plan.orders[1].totalInterest; // '130.28'",
    ]) {
      expect(meta.usage).toContain(line);
    }
  });
});

it('12 CFR 1026 Appendix M1 and M2: the monthly rate is the APR divided by 12 and each month interest is rounded to the cent', () => {
  // Appendix M2 sets xperrate = (apr / 365) * days with days = 365 / 12, which is exactly apr / 12, and
  // Appendix M1 (b)(4)(xi) lets the interest charge for each month be rounded to the nearest cent.
  // 1000 at 12 APR: 1000 x 0.12 / 12 = 10 exactly.
  // 1000 at 13 APR: 1000 x 0.13 / 12 = 10.8333... which rounds down to 10.83.
  // 1000 at 14 APR: 1000 x 0.14 / 12 = 11.6666... which rounds up to 11.67.
  // 1000 at 0.006 APR: 1000 x 0.00006 / 12 = 0.005 exactly, a tie, which goes away from zero to 0.01.
  const first = (apr: string) => {
    const run = simulatePayoff(cards(`Card | 1000 | ${apr} | 25`), new D(25), 'highest-rate', 'USD');
    return run.rows[0]!;
  };
  expect(plain(first('12').interest)).toBe('10.00');
  expect(plain(first('13').interest)).toBe('10.83');
  expect(plain(first('14').interest)).toBe('11.67');
  expect(plain(first('0.006').interest)).toBe('0.01');
  // The balance is the old balance plus that interest minus the payment: 1000 + 10.83 - 25.
  expect(plain(first('13').balance)).toBe('985.83');
  // A currency with no minor unit rounds to whole units: 10050 at 12 APR is 100.5 which goes to 101.
  const yen = simulatePayoff(cards('Card | 10050 | 12 | 1000', 'JPY'), new D(1000), 'highest-rate', 'JPY');
  expect(yen.rows[0]!.interest.toFixed(0)).toBe('101');
});

it('one card of 1000 at 12 APR paying 100 a month is clear after 11 months with 58.98 interest', () => {
  // Month 1: interest 1000 x 0.01 = 10.00, owed 1010.00, pay 100.00, left 910.00.
  // Month 2: interest 910.00 x 0.01 = 9.10, owed 919.10, pay 100.00, left 819.10.
  // Month 3: interest 819.10 x 0.01 = 8.191 -> 8.19, owed 827.29, pay 100.00, left 727.29.
  // Months 4 to 9 leave 634.56, 540.91, 446.32, 350.78, 254.29 and 156.83.
  // Month 10: interest 156.83 x 0.01 = 1.5683 -> 1.57, owed 158.40, pay 100.00, left 58.40.
  // Month 11: interest 58.40 x 0.01 = 0.584 -> 0.58, owed 58.98, the final payment is 58.98, left 0.
  // Interest: 10.00 + 9.10 + 8.19 + 7.27 + 6.35 + 5.41 + 4.46 + 3.51 + 2.54 + 1.57 + 0.58 = 58.98.
  const run = simulatePayoff(cards('Card | 1000 | 12 | 25'), new D(100), 'highest-rate', 'USD');
  expect(run.paidOff).toBe(true);
  expect(run.months).toBe(11);
  expect(plain(run.totalInterest)).toBe('58.98');
  expect(plain(run.totalPaid)).toBe('1058.98');
  expect(run.rows.slice(0, 3).map((r) => [plain(r.interest), plain(r.paid), plain(r.balance)])).toEqual([
    ['10.00', '100.00', '910.00'],
    ['9.10', '100.00', '819.10'],
    ['8.19', '100.00', '727.29'],
  ]);
  const last = run.rows[10]!;
  expect([plain(last.interest), plain(last.paid), plain(last.balance)]).toEqual(['0.58', '58.98', '0.00']);
  expect(run.cardPayoffMonth).toEqual([11]);
});

it('two cards compared: highest rate first clears in 9 months with 105.49 interest and smallest balance first in 9 months with 130.28', () => {
  // Card A 1000 at 24 APR (2 percent a month), minimum 25; card B 500 at 12 APR (1 percent), minimum 25; 200 a month.
  // Highest rate first, month 1: interest A 20.00 and B 5.00 = 25.00; both minimums 25 leave A 995.00 and B 480.00;
  //   the other 150 goes to A, leaving 845.00; total left 1325.00.
  // Highest rate first, month 2: interest A 16.90 and B 4.80 = 21.70; total left 1146.70.
  // Smallest balance first, month 1: same interest 25.00, the other 150 goes to B (480 is the smaller),
  //   leaving B 330.00 and A 995.00; total left 1325.00.
  // Smallest balance first, month 2: interest A 19.90 and B 3.30 = 23.20; total left 1148.20.
  // The last month of highest rate first pays 5.49 with 0.05 of interest; of smallest balance first 30.28 with 0.59.
  const parsed = cards(TWO_CARDS);
  const hr = simulatePayoff(parsed, new D(200), 'highest-rate', 'USD');
  const sb = simulatePayoff(parsed, new D(200), 'smallest-balance', 'USD');
  expect([hr.months, plain(hr.totalInterest), plain(hr.totalPaid)]).toEqual([9, '105.49', '1605.49']);
  expect([sb.months, plain(sb.totalInterest), plain(sb.totalPaid)]).toEqual([9, '130.28', '1630.28']);
  expect(hr.rows.slice(0, 2).map((r) => [plain(r.interest), plain(r.balance)])).toEqual([
    ['25.00', '1325.00'],
    ['21.70', '1146.70'],
  ]);
  expect(sb.rows.slice(0, 2).map((r) => [plain(r.interest), plain(r.balance)])).toEqual([
    ['25.00', '1325.00'],
    ['23.20', '1148.20'],
  ]);
  expect([plain(hr.rows[8]!.interest), plain(hr.rows[8]!.paid)]).toEqual(['0.05', '5.49']);
  expect([plain(sb.rows[8]!.interest), plain(sb.rows[8]!.paid)]).toEqual(['0.59', '30.28']);
  // Card A (typed first) is cleared in month 7 and card B in month 9 when the highest rate goes first.
  expect(hr.cardPayoffMonth).toEqual([7, 9]);
  expect(sb.cardPayoffMonth).toEqual([9, 3]);
  // The page entry reports the same two orders, highest rate first and then smallest balance first.
  const plan = calculatePayoff({ cards: TWO_CARDS, budget: '200', currency: 'USD' })!;
  expect(plan.orders.map((o) => o.order)).toEqual(['highest-rate', 'smallest-balance']);
  expect(plan.orders.map((o) => [o.months, o.totalInterest, o.totalPaid])).toEqual([
    [9, '105.49', '1605.49'],
    [9, '130.28', '1630.28'],
  ]);
  expect(plan.orders[0]!.cardPayoff).toEqual([
    { name: 'Card A', month: 7 },
    { name: 'Card B', month: 9 },
  ]);
  // The rows add up exactly to the totals shown.
  for (const o of plan.orders) {
    const interest = o.rows.reduce((sum, r) => sum.plus(r.interest), new D(0));
    const paid = o.rows.reduce((sum, r) => sum.plus(r.paid), new D(0));
    expect(interest.toFixed(2)).toBe(o.totalInterest);
    expect(paid.toFixed(2)).toBe(o.totalPaid);
  }
});

it('12 CFR 1026 Appendix M2 single-rate loop ported as a second opinion agrees month by month for one card', () => {
  // Port of the Appendix M2 repayment loop for one balance and one rate, in whole cents with big integers and no
  // decimal library, written from the fetched algorithm text:
  //   perrate = (apr / 365) * days with days = 365 / 12, so perrate = apr / 12
  //   xxxbal  = round(cbal * (1 + perrate), 0.01)          the balance with the month's interest, to the cent
  //   if pmt > xxxbal then pmt = xxxbal                      the final payment pays the account in full
  //   cbal    = xxxbal - pmt
  // aprHundredths is the APR in percent times 100 (12 percent is 1200, 18.99 percent is 1899), so
  // cbal x (1 + aprHundredths / 120000) is cbal x (120000 + aprHundredths) / 120000, rounded half up.
  const m2 = (balanceCents: bigint, aprHundredths: bigint, paymentCents: bigint) => {
    const months: { balance: bigint; paid: bigint }[] = [];
    let cbal = balanceCents;
    while (cbal > 0n && months.length < 1200) {
      const num = cbal * (120000n + aprHundredths);
      const xxxbal = (2n * num + 120000n) / (2n * 120000n);
      const pmt = paymentCents > xxxbal ? xxxbal : paymentCents;
      cbal = xxxbal - pmt;
      months.push({ balance: cbal, paid: pmt });
    }
    return months;
  };
  const cents = (x: { times(n: number): { toFixed(dp: number): string } }) => BigInt(x.times(100).toFixed(0));
  const sets: [string, string, string, bigint, bigint][] = [
    ['1000', '12', '100', 100000n, 1200n],
    ['2345.67', '18.99', '75', 234567n, 1899n],
    ['500', '0.06', '50', 50000n, 6n],
    ['8000', '29.9', '260.50', 800000n, 2990n],
  ];
  for (const [balance, apr, payment, balanceCents, aprH] of sets) {
    const run = simulatePayoff(cards(`Card | ${balance} | ${apr} | 10`), new D(payment), 'highest-rate', 'USD');
    const expected = m2(balanceCents, aprH, cents(new D(payment)));
    expect(run.months).toBe(expected.length);
    run.rows.forEach((row, i) => {
      expect(cents(row.balance)).toBe(expected[i]!.balance);
      expect(cents(row.paid)).toBe(expected[i]!.paid);
    });
  }
});

it('ties are broken by the other key and then by the order typed', () => {
  // Highest rate first, equal rates: the smaller balance goes first. X 300 and Y 200 both at 20 APR, minimum 10,
  // 100 a month: Y gets the extra money, so Y (typed second) is cleared in month 3 and X in month 6.
  const xy = simulatePayoff(cards('X | 300 | 20 | 10\nY | 200 | 20 | 10'), new D(100), 'highest-rate', 'USD');
  expect(xy.cardPayoffMonth).toEqual([6, 3]);
  // Equal rate and equal balance: the order typed decides, for both orders. P is cleared in month 3, Q in month 4.
  const pq = 'P | 100 | 10 | 10\nQ | 100 | 10 | 10';
  for (const order of ['highest-rate', 'smallest-balance'] as PayoffOrder[]) {
    expect(simulatePayoff(cards(pq), new D(60), order, 'USD').cardPayoffMonth).toEqual([3, 4]);
  }
  // Smallest balance first, equal balances: the higher rate goes first. After month 1's interest R (1010 at 0 APR)
  // and S (1000 at 12 APR, 10.00 of interest) both owe 1010.00, so both are still tied after the minimums of 25;
  // S has the higher rate, so S (typed second) gets the extra 50 and is cleared in month 15, R in month 21.
  const rs = simulatePayoff(cards('R | 1010 | 0 | 25\nS | 1000 | 12 | 25'), new D(100), 'smallest-balance', 'USD');
  expect(rs.cardPayoffMonth).toEqual([21, 15]);
});

it('a budget below the sum of the minimum payments is refused naming both amounts', () => {
  const two = cards('A | 1000 | 24 | 25\nB | 500 | 12 | 25.50');
  // The sum of the minimums is 25 + 25.50 = 50.50. Exactly that is accepted; one cent less is refused.
  expect(simulatePayoff(two, new D('50.50'), 'highest-rate', 'USD').paidOff).toBe(true);
  const error = refused(() => simulatePayoff(two, new D('50.49'), 'highest-rate', 'USD'));
  expect(error.field).toBe('Total monthly payment');
  expect(error.message).toContain('50.49');
  expect(error.message).toContain('50.50');
  // The same through the page entry.
  const viaPage = refused(() =>
    calculatePayoff({ cards: 'A | 1000 | 24 | 25\nB | 500 | 12 | 25.50', budget: '50.49' }),
  );
  expect(viaPage.message).toContain('50.50');
  // A card with no balance has no minimum to pay.
  expect(simulatePayoff(cards('A | 1000 | 24 | 25\nB | 0 | 12 | 40'), new D(25), 'highest-rate', 'USD').paidOff).toBe(
    true,
  );
});

it('a budget that never beats the interest stops at 1200 months with a not paid off message', () => {
  // 10000 at 24 APR owes 200.00 of interest in month 1 and 150 a month does not cover it, so the balance only grows.
  const never = simulatePayoff(cards('Card | 10000 | 24 | 25'), new D(150), 'highest-rate', 'USD');
  expect(MAX_MONTHS).toBe(1200);
  expect(never.paidOff).toBe(false);
  expect(never.months).toBe(1200);
  expect(never.rows).toHaveLength(1200);
  expect(plain(never.totalPaid)).toBe('180000.00');
  expect(never.cardPayoffMonth).toEqual([null]);
  const plan = calculatePayoff({ cards: 'Card | 10000 | 24 | 25', budget: '150' })!;
  expect(plan.orders.every((o) => !o.paidOff && o.months === 1200)).toBe(true);
  expect(plan.warnings.some((w) => /not paid off/i.test(w) && w.includes('1,200'))).toBe(true);
  // Just above the first month's interest the loan does finish.
  expect(simulatePayoff(cards('Card | 10000 | 24 | 25'), new D('200.01'), 'highest-rate', 'USD').paidOff).toBe(true);
});

it('the payment needed to finish by a month is the smallest whole-cent budget that does it, and one cent less does not', () => {
  const parsed = cards(TWO_CARDS);
  // 1000 at 24 APR and 500 at 12 APR: 138.05 a month finishes within 12 months highest rate first and 138.04 does not;
  // 140.59 finishes smallest balance first and 140.58 does not. Checked against a separate whole-cent search.
  const need: [PayoffOrder, string][] = [
    ['highest-rate', '138.05'],
    ['smallest-balance', '140.59'],
  ];
  for (const [order, expected] of need) {
    const budget = paymentToFinishBy(parsed, 12, order, 'USD')!;
    expect(budget.toFixed(2)).toBe(expected);
    expect(simulatePayoff(parsed, budget, order, 'USD').months).toBeLessThanOrEqual(12);
    const lessOne = budget.minus('0.01');
    expect(simulatePayoff(parsed, lessOne, order, 'USD').months).toBeGreaterThan(12);
  }
  // One card of 1000 at 12 APR over 12 months is the ordinary loan payment, 88.85; 88.84 takes a thirteenth month.
  const one = cards('Card | 1000 | 12 | 25');
  const single = paymentToFinishBy(one, 12, 'highest-rate', 'USD')!;
  expect(single.toFixed(2)).toBe('88.85');
  expect(simulatePayoff(one, single, 'highest-rate', 'USD').months).toBe(12);
  expect(simulatePayoff(one, single.minus('0.01'), 'highest-rate', 'USD').months).toBe(13);
  // When the minimums alone already finish in time, the answer is the sum of the minimums.
  const small = cards('Card | 100 | 12 | 60');
  expect(paymentToFinishBy(small, 12, 'highest-rate', 'USD')!.toFixed(2)).toBe('60.00');
  // One month means paying every balance and its interest at once: 1000 + 10.00.
  expect(paymentToFinishBy(one, 1, 'highest-rate', 'USD')!.toFixed(2)).toBe('1010.00');
  // The page entry in target mode reports the payment for each order and the plan that payment gives.
  const plan = calculatePayoff({ cards: TWO_CARDS, mode: 'target', months: '12' })!;
  expect(plan.orders.map((o) => o.payment)).toEqual(['138.05', '140.59']);
  expect(plan.orders.every((o) => o.paidOff && o.months <= 12)).toBe(true);
  // The target is a whole number from 1 to 1200.
  for (const bad of ['0', '1201', '12.5', '-3', '']) {
    expect(refused(() => calculatePayoff({ cards: TWO_CARDS, mode: 'target', months: bad })).field).toBe(
      'Finish within (months)',
    );
  }
});

it('a bad card line is reported with its line and column', () => {
  // `Card | 1,000 | 12 | 25`: the balance cell starts after `Card | `, which is 7 characters, so at column 8.
  const comma = refused(() => cards('Card | 1,000 | 12 | 25'));
  expect(comma.field).toBe('Cards');
  expect([comma.line, comma.column]).toEqual([1, 8]);
  expect(comma.message).toContain('balance');
  // A blank line is skipped but still counted, so the second card is on line 3.
  const third = refused(() => cards('Card A | 1000 | 12 | 25\n\nCard B | 500 | abc | 25'));
  expect([third.line, third.column]).toEqual([3, 16]);
  expect(third.message).toContain('APR');
  // Too few cells, an APR above 100, a minimum of 0 and more decimals than the currency has are all refused.
  expect(refused(() => cards('Card | 1000 | 12')).line).toBe(1);
  expect(refused(() => cards('Card | 1000 | 100.01 | 25')).message).toContain('APR');
  expect(refused(() => cards('Card | 1000 | 12 | 0')).message).toContain('minimum');
  const yen = refused(() => cards('Card | 1000.5 | 12 | 25', 'JPY'));
  expect([yen.line, yen.column]).toEqual([1, 8]);
  // A blank name becomes Card and its line number; a balance of 0 is allowed on its own line.
  const named = cards('\n | 250.5 | 19.99 | 10');
  expect(named[0]!.name).toBe('Card 2');
  expect(named[0]!.line).toBe(2);
  expect(named[0]!.balance.toFixed()).toBe('250.5');
  expect(named[0]!.apr.toFixed()).toBe('19.99');
  expect(named[0]!.minimum.toFixed()).toBe('10');
  // Twenty cards are accepted and a twenty-first is refused naming the cap.
  const line = (n: number) => `Card ${n} | 100 | 10 | 5`;
  const twenty = Array.from({ length: MAX_CARDS }, (_, i) => line(i + 1));
  expect(cards(twenty.join('\n'))).toHaveLength(20);
  const over = refused(() => cards([...twenty, line(21)].join('\n')));
  expect(over.message).toContain('20');
  expect(over.line).toBe(21);
  // All balances 0 and no cards at all are refused with a plain message.
  expect(refused(() => calculatePayoff({ cards: 'A | 0 | 10 | 5', budget: '10' })).field).toBe('Cards');
  expect(refused(() => calculatePayoff({ cards: '\n \n', budget: '10' })).field).toBe('Cards');
  expect(MAX_CARDS).toBe(20);
});

it('a blank form shows nothing and a missing payment or target is named', () => {
  expect(calculatePayoff({ cards: '', budget: '' })).toBeNull();
  expect(calculatePayoff({ cards: '  ', mode: 'target', months: '' })).toBeNull();
  const noBudget = refused(() => calculatePayoff({ cards: TWO_CARDS, budget: '' }));
  expect(noBudget.field).toBe('Total monthly payment');
  expect(noBudget.message).toMatch(/missing/);
  const noCards = refused(() => calculatePayoff({ cards: '', budget: '200' }));
  expect(noCards.field).toBe('Cards');
  expect(noCards.message).toMatch(/missing/);
  const noMonths = refused(() => calculatePayoff({ cards: TWO_CARDS, mode: 'target', months: '' }));
  expect(noMonths.field).toBe('Finish within (months)');
  expect(refused(() => calculatePayoff({ cards: TWO_CARDS, budget: '200', currency: 'XYZ1' })).field).toBe(
    'Currency (ISO 4217 code)',
  );
  expect(refused(() => calculatePayoff({ cards: TWO_CARDS, budget: '0' })).field).toBe('Total monthly payment');
});

it('the working shows the monthly rate, the first month interest with the typed numbers, the sharing rule and the rounding rule', () => {
  const plan = calculatePayoff({ cards: TWO_CARDS, budget: '200', currency: 'USD' })!;
  const text = plan.working;
  expect(text).toContain('12 CFR 1026 Appendix M1');
  expect(text).toContain('Appendix M2');
  expect(text).toContain('APR / 100 / 12');
  expect(text).toContain('Card A: 1000 x 24 / 100 / 12 = 20.00');
  expect(text).toContain('Card B: 500 x 12 / 100 / 12 = 5.00');
  expect(text).toContain('half away from zero');
  expect(text).toContain('highest rate first');
  expect(text).toContain('smallest balance first');
  // The disclosure convention of Appendix M1 (b)(4)(ix) is noted as a convention for disclosures, not an order offered here.
  expect(plan.notes.some((n) => n.includes('(b)(4)(ix)') && /disclosure/i.test(n))).toBe(true);
  // Neither order is called the one to choose.
  const everything = JSON.stringify(plan);
  expect(everything).not.toMatch(/\b(best|recommend|should|cheaper|better|optimal|winner)\w*/i);
});

it('0.1 plus 0.2 is exactly 0.3 through this tool', () => {
  // Floating point gets it wrong, so a tool that summed JavaScript numbers would show 0.30000000000000004.
  expect(0.1 + 0.2).not.toBe(0.3);
  // Cards of 0.1 and 0.2 at 0 APR with minimums 0.1 and 0.2 and a budget of 0.3 clear in one month and pay exactly 0.30.
  const run = simulatePayoff(cards('A | 0.1 | 0 | 0.1\nB | 0.2 | 0 | 0.2'), new D('0.3'), 'highest-rate', 'USD');
  expect(run.months).toBe(1);
  expect(run.totalPaid.toFixed()).toBe('0.3');
  const plan = calculatePayoff({ cards: 'A | 0.1 | 0 | 0.1\nB | 0.2 | 0 | 0.2', budget: '0.3' })!;
  expect(plan.orders[0]!.totalPaid).toBe('0.30');
  expect(plan.orders[0]!.totalInterest).toBe('0.00');
  expect(plan.summary.sumMinimums).toBe('0.30');
});
