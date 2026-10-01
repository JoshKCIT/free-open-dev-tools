import { it, expect, test } from 'vitest';
import { amountToCharge, calculateFees, feeOn, meta, searchCharge, type FeeTexts } from '../src/index';
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

const calc = (texts: FeeTexts) => {
  const result = calculateFees({ currency: 'USD', ...texts });
  expect(result).not.toBeNull();
  return result!;
};
const charge = (amount: string, percentFee = '2.9', fixedFee = '0.30', extra: FeeTexts = {}) =>
  calc({ mode: 'charge', amount, percentFee, fixedFee, ...extra });
const receive = (target: string, percentFee = '2.9', fixedFee = '0.30', extra: FeeTexts = {}) =>
  calc({ mode: 'receive', target, percentFee, fixedFee, ...extra });

it('meta: id, name, dependency pin, the two required sentences in limits and no standards', () => {
  expect(meta.id).toBe('payment-fees');
  expect(meta.name).toBe('Payment Fee Calculator');
  expect(meta.dependencies['decimal.js']).toBe('10.6.0');
  expect(meta.limits.length).toBeGreaterThanOrEqual(3);
  expect(meta.limits.some((l: string) => /half away from zero/i.test(l))).toBe(true);
  expect(meta.limits.some((l: string) => /not financial, tax or legal advice; it ignores /i.test(l))).toBe(true);
  expect(meta.limits.some((l: string) => /own rounding may differ/i.test(l))).toBe(true);
  expect(meta.standards).toEqual([]);
  expect(meta.testNotes).toMatch(/no standards body/i);
});

it('the usage example in meta.json shows what the code returns', () => {
  const { summary } = charge('100');
  expect(summary.fee).toBe('3.20');
  expect(summary.received).toBe('96.80');
  expect(meta.usage).toContain("result.summary.fee; // '3.20'");
  expect(meta.usage).toContain("result.summary.received; // '96.80'");
});

// No standards body defines payment-fee arithmetic. By hand: 100 x 2.9 / 100 = 2.90, plus the fixed 0.30 is 3.20, and
// 100 - 3.20 = 96.80.
it('fee is the percentage of the payment plus the fixed fee: 100 at 2.9 plus 0.30 is 3.20, leaving 96.80', () => {
  expect(feeOn(new D(100), new D('2.9'), new D('0.30'), 'USD').toFixed(2)).toBe('3.20');
  const { summary } = charge('100');
  expect(summary.fee).toBe('3.20');
  expect(summary.received).toBe('96.80');
  expect(summary.charge).toBeNull();
  expect(summary.shortfall).toBeNull();
  // the fee is rounded once, half away from zero: 0.5 x 1 / 100 + 0 = 0.005 gives 0.01
  expect(feeOn(new D('0.5'), new D(1), new D(0), 'USD').toFixed(2)).toBe('0.01');
  // 33.33 x 2.9 / 100 = 0.96657, plus 0.30 = 1.26657, which rounds to 1.27
  expect(feeOn(new D('33.33'), new D('2.9'), new D('0.30'), 'USD').toFixed(2)).toBe('1.27');
  // a 0 percentage and a 0 fixed fee cost nothing
  expect(charge('50', '0', '0').summary.fee).toBe('0.00');
});

// By hand: the exact gross-up of 100 is (100 + 0.30) / (1 - 0.029) = 100.30 / 0.971 = 103.29557..., rounded up to
// 103.30. The fee on 103.30 is 103.30 x 0.029 + 0.30 = 2.9957 + 0.30 = 3.2957, rounded to 3.30, which leaves exactly
// 100.00. The fee on 103.29 is 2.99541 + 0.30 = 3.29541, also 3.30, which leaves 99.99, so 103.30 is the smallest charge.
it('to receive 100 at 2.9 plus 0.30, charge 103.30, and 103.29 would leave 99.99', () => {
  const found = searchCharge(new D(100), new D('2.9'), new D('0.30'), 'USD');
  expect(found.start.toFixed(2)).toBe('103.30');
  expect(found.charge.toFixed(2)).toBe('103.30');
  expect(found.fee.toFixed(2)).toBe('3.30');
  expect(found.received.toFixed(2)).toBe('100.00');
  expect(amountToCharge(new D(100), new D('2.9'), new D('0.30'), 'USD').toFixed(2)).toBe('103.30');
  const below = new D('103.29');
  expect(below.minus(feeOn(below, new D('2.9'), new D('0.30'), 'USD')).toFixed(2)).toBe('99.99');
  const { summary, working } = receive('100');
  expect(summary.charge).toBe('103.30');
  expect(summary.fee).toBe('3.30');
  expect(summary.received).toBe('100.00');
  expect(working).toContain('103.29');
  expect(working).toContain('99.99');
});

// For every target in whole cents from 0.01 to 20.00 at 2.9 percent plus 0.30, the charge leaves at least the target
// and a charge of one cent less does not. 2000 targets, each checked by an independent whole-cent loop (BigInt cents,
// no decimal library): the fee in cents is the half-up rounding of charge x 29 / 1000 + 30.
it('for every target from 0.01 to 20.00 the charge receives at least the target and one cent less does not', () => {
  const feeCents = (chargeCents: bigint): bigint => {
    // fee = chargeCents x 2.9 / 100 + 30, in cents; 29 / 1000 as an exact fraction, round half up
    const numerator = chargeCents * 29n + 30n * 1000n;
    return (numerator * 2n + 1000n) / 2000n;
  };
  let nudgedUp = 0;
  let nudgedDown = 0;
  for (let cents = 1; cents <= 2000; cents++) {
    const target = new D(cents).div(100);
    const found = searchCharge(target, new D('2.9'), new D('0.30'), 'USD');
    const chargeCents = BigInt(found.charge.times(100).toFixed());
    const received = chargeCents - feeCents(chargeCents);
    expect(received >= BigInt(cents)).toBe(true);
    expect(chargeCents - 1n - feeCents(chargeCents - 1n) < BigInt(cents)).toBe(true);
    expect(found.received.times(100).toFixed()).toBe(received.toString());
    if (found.charge.gt(found.start)) nudgedUp++;
    if (found.charge.lt(found.start)) nudgedDown++;
  }
  // the first guess is not always the answer: both adjustments are exercised by this range
  expect(nudgedUp + nudgedDown).toBeGreaterThan(0);
});

// JPY has no minor unit. By hand: 1000 x 3.6 / 100 = 36, with no fixed fee, so the fee is 36 and 964 is received.
it('zero-decimal currencies round the fee to whole units: JPY 1000 at 3.6 is a fee of 36', () => {
  expect(feeOn(new D(1000), new D('3.6'), new D(0), 'JPY').toFixed()).toBe('36');
  const r = charge('1000', '3.6', '0', { currency: 'JPY' });
  expect(r.summary.fee).toBe('36');
  expect(r.summary.received).toBe('964');
  expect(r.summary.currencyDecimals).toBe(0);
  // 1250 x 3.6 / 100 = 45, and 1111 x 3.6 / 100 = 39.996 rounds to 40
  expect(feeOn(new D(1111), new D('3.6'), new D(0), 'JPY').toFixed()).toBe('40');
  // to receive 1000: the first guess 1000 / 0.964 = 1037.34 rounds up to 1038, whose fee 37.368 is 37 and leaves 1001;
  // 1037 has a fee of 37.332, 37, and leaves exactly 1000, and 1036 has a fee of 37 and leaves 999
  const found = searchCharge(new D(1000), new D('3.6'), new D(0), 'JPY');
  expect(found.start.toFixed()).toBe('1038');
  expect(found.charge.toFixed()).toBe('1037');
  expect(found.received.toFixed()).toBe('1000');
  // BHD has three decimals: 10.000 x 1.5 percent + 0.250 = 0.150 + 0.250 = 0.400
  expect(feeOn(new D(10), new D('1.5'), new D('0.25'), 'BHD').toFixed(3)).toBe('0.400');
});

it('a percentage fee of 100 or more and a fee larger than the payment are refused or reported plainly', () => {
  expect(refused(() => charge('100', '100')).field).toBe('Percentage fee (percent)');
  expect(refused(() => charge('100', '150')).field).toBe('Percentage fee (percent)');
  expect(refused(() => receive('100', '100')).field).toBe('Percentage fee (percent)');
  expect(refused(() => charge('100', '1e1')).field).toBe('Percentage fee (percent)');
  expect(refused(() => charge('100', '-1')).field).toBe('Percentage fee (percent)');
  expect(refused(() => charge('0')).field).toBe('Payment amount');
  expect(refused(() => receive('0')).field).toBe('Amount you want to receive');
  expect(refused(() => charge('100.001')).field).toBe('Payment amount');
  expect(refused(() => receive('100.001')).field).toBe('Amount you want to receive');
  expect(refused(() => charge('100', '2.9', '-0.30')).field).toBe('Fixed fee per payment');
  expect(refused(() => charge('100', '2.9', '0.301')).field).toBe('Fixed fee per payment');
  expect(refused(() => charge('100', '2.9', '0.30', { mode: 'sideways' })).field).toBe('Work out');
  expect(refused(() => charge('100', '2.9', '0.30', { currency: 'XYZ1' })).field).toBe('Currency (ISO 4217 code)');
  // a payment of 0.20 with a 0.30 fixed fee: the fee 0.31 is larger than the payment by 0.11
  const small = charge('0.20');
  expect(small.summary.fee).toBe('0.31');
  expect(small.summary.received).toBe('-0.11');
  expect(small.summary.shortfall).toBe('0.11');
  expect(small.summary.notes.join(' ')).toContain('larger than the payment');
  // a percentage just below 100 is accepted
  expect(charge('100', '99.9', '0').summary.fee).toBe('99.90');
});

it('some fields typed and a required one blank names the blank one; nothing typed gives no result', () => {
  expect(calculateFees({})).toBeNull();
  expect(calculateFees({ mode: 'charge', currency: 'USD' })).toBeNull();
  expect(calculateFees({ mode: 'receive', amount: '100' })).toBeNull();
  expect(refused(() => calc({ mode: 'charge', amount: '100' })).field).toBe('Percentage fee (percent)');
  expect(refused(() => calc({ mode: 'charge', amount: '100', percentFee: '2.9' })).field).toBe('Fixed fee per payment');
  expect(refused(() => calc({ mode: 'charge', percentFee: '2.9', fixedFee: '0.30' })).field).toBe('Payment amount');
  expect(refused(() => calc({ mode: 'receive', percentFee: '2.9', fixedFee: '0.30' })).field).toBe(
    'Amount you want to receive',
  );
});

// The float sum 0.1 + 0.2 is 0.30000000000000004. Here 2 x 10 / 100 is exactly 0.2 and the fixed fee 0.1 makes a fee of
// exactly 0.30.
it('0.1 plus 0.2 is exactly 0.3 through this tool', () => {
  expect(0.1 + 0.2).not.toBe(0.3);
  expect(0.1 + 0.2).toBe(0.30000000000000004);
  expect(feeOn(new D(2), new D(10), new D('0.1'), 'USD').toFixed()).toBe('0.3');
  const r = charge('2', '10', '0.1');
  expect(r.summary.fee).toBe('0.30');
  expect(r.summary.received).toBe('1.70');
  expect(r.working).toContain('2 x 10 / 100 = 0.2');
  expect(r.working).toContain('0.2 + 0.1 = 0.3');
});

// Whole-cent check with BigInt and no decimal library: for a percentage fee of `numerator / denominator` of the charge
// (no fixed fee), the fee in cents is the half-up rounding of charge x numerator / denominator, and what is received is
// the charge minus that fee.
function receivedCents(chargeCents: bigint, numerator: bigint, denominator: bigint): bigint {
  const fee = (chargeCents * numerator * 2n + denominator) / (2n * denominator);
  return chargeCents - fee;
}

test('to receive 100 with a percentage fee of 98 percent the charge is found and one cent less does not receive 100', () => {
  const found = searchCharge(new D(100), new D('98'), new D(0), 'USD');
  const chargeCents = BigInt(found.charge.times(100).toFixed());
  expect(receivedCents(chargeCents, 98n, 100n) >= 10000n).toBe(true);
  expect(receivedCents(chargeCents - 1n, 98n, 100n) < 10000n).toBe(true);
  expect(found.received.times(100).toFixed()).toBe(receivedCents(chargeCents, 98n, 100n).toString());
  const { summary } = receive('100', '98', '0');
  expect(summary.charge).toBe(found.charge.toFixed(2));
  expect(summary.received).toBe(found.received.toFixed(2));
});

test('to receive 100 with a percentage fee of 99.9999999999 percent the charge is found and one cent less does not', () => {
  const found = searchCharge(new D(100), new D('99.9999999999'), new D(0), 'USD');
  const chargeCents = BigInt(found.charge.times(100).toFixed());
  const numerator = 999999999999n;
  const denominator = 1000000000000n;
  expect(receivedCents(chargeCents, numerator, denominator) >= 10000n).toBe(true);
  expect(receivedCents(chargeCents - 1n, numerator, denominator) < 10000n).toBe(true);
  // 100 / (1 - 0.999999999999) = 100,000,000,000,000: the charge is about that, and no error is raised.
  expect(found.charge.gt('90000000000000') && found.charge.lt('110000000000000')).toBe(true);
  const { summary, working } = receive('100', '99.9999999999', '0');
  expect(summary.charge).toBe(found.charge.toFixed(2));
  // The working lists a few charges, not a line for every one of the billions of units searched.
  expect(working.split('\n').length).toBeLessThan(40);
});

test('the limits text no longer promises a search that gives up after 20 steps', () => {
  expect(meta.limits.join(' ')).not.toMatch(/20 steps/);
});
