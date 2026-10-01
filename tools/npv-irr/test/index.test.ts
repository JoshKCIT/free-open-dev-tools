import { it, expect } from 'vitest';
import {
  MAX_FLOWS,
  calculateCashFlows,
  discountedPayback,
  irr,
  meta,
  npv,
  openFormulaNpv,
  parseFlows,
  payback,
  signChanges,
  type CashFlowTexts,
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

const dec = (values: string[]) => values.map((v) => new D(v));

/** Runs the whole page path and fails if the result is null. */
function calc(texts: CashFlowTexts) {
  const result = calculateCashFlows({ currency: 'USD', ...texts });
  if (result === null) throw new Error('expected a result');
  return result;
}

/** A rate as a fraction to a percent with 4 places, the way the page shows it. */
const percent = (r: InstanceType<typeof D>) => toPlain(r.times(100), 4);

// OMB Circular A-94 (revised November 2023) Appendix B, section 1, "Sample Format for Discounting Deferred Costs and
// Benefits": ten years at a 3.1 percent discount rate, "The discount factor is calculated as 1/(1 + discount rate)t
// where t is the year." Costs 10, 20, 30, 30, 20, 10, 5, 5, 5, 5 and benefits 0, 0, 5, 10, 30, 40, 40, 40, 40, 25 for
// years 1 to 10. Published totals: present value of costs 123.37, of benefits 184.92, "Discounted net benefits are
// $61.55". Period 0 holds nothing, so the first flow is 0.
const OMB_COSTS = ['0', '10', '20', '30', '30', '20', '10', '5', '5', '5', '5'];
const OMB_BENEFITS = ['0', '0', '0', '5', '10', '30', '40', '40', '40', '40', '25'];
const OMB_NET = ['0', '-10', '-20', '-25', '-20', '10', '30', '35', '35', '35', '20'];

it('OMB Circular A-94 Appendix B: net flows at 3.1 discount have a net present value of 61.55', () => {
  // The net flows are benefits minus costs, year by year: 0 - 10, 0 - 20, 5 - 30, 10 - 30, 30 - 20, 40 - 10,
  // 40 - 5, 40 - 5, 40 - 5, 25 - 5, with 0 in period 0. Exact arithmetic gives 61.546082..., which rounds to 61.55.
  const net = dec(OMB_NET);
  expect(toPlain(npv(new D('3.1'), net), 2)).toBe('61.55');
  const result = calc({ flows: OMB_NET.join('\n'), rate: '3.1' });
  expect(result.summary.npv).toBe('61.55');
  expect(result.rows).toHaveLength(11);
});

it('OMB Circular A-94 Appendix B: costs discount to 123.37 and benefits to 184.92', () => {
  // Exact arithmetic gives 123.373130... and 184.919212..., the published totals to the cent. The document's own
  // table rounds every year to cents with four-digit factors, which is why only its totals are quoted here.
  expect(toPlain(npv(new D('3.1'), dec(OMB_COSTS)), 2)).toBe('123.37');
  expect(toPlain(npv(new D('3.1'), dec(OMB_BENEFITS)), 2)).toBe('184.92');
  expect(calc({ flows: OMB_COSTS.join('\n'), rate: '3.1' }).summary.npv).toBe('123.37');
  expect(calc({ flows: OMB_BENEFITS.join('\n'), rate: '3.1' }).summary.npv).toBe('184.92');
});

it('OpenFormula 26300 6.12.30 NPV: this tool NPV equals the first flow plus NPV of the rest', () => {
  // ISO/IEC 26300-2:2015 6.12.30: NPV = sum over i = 1..N of Values_i / (1 + Rate)^i, so the first value is
  // discounted one period. This tool leaves the first flow at period 0, so its NPV is CF0 + NPV(rest).
  const flows = dec(OMB_NET);
  const rate = new D('3.1');
  const viaSpec = flows[0]!.plus(openFormulaNpv(rate, flows.slice(1)));
  expect(npv(rate, flows).toFixed(30)).toBe(viaSpec.toFixed(30));
  // Hand derivation at 10 percent: NPV(0.1; 110) = 110 / 1.1 = 100, so the flows -100 and 110 net to 0.
  expect(openFormulaNpv(new D('10'), dec(['110'])).toFixed()).toBe('100');
  expect(npv(new D('10'), dec(['-100', '110'])).toFixed()).toBe('0');
  // NPV(0.1; 400, 400, 400) = 400 x (1 - 1.1^-3) / 0.1 = 994.7407965..., and -1000 + 994.7407965... = -5.2592...
  expect(toPlain(openFormulaNpv(new D('10'), dec(['400', '400', '400'])), 2)).toBe('994.74');
  expect(toPlain(npv(new D('10'), dec(['-1000', '400', '400', '400'])), 2)).toBe('-5.26');
});

it('OpenFormula 6.12.24 IRR: -100 then 110 gives 10.0000 per period', () => {
  // The IRR is the rate at which NPV is zero: -100 + 110 / (1 + r) = 0 gives 1 + r = 1.1, so r = 10 percent.
  const result = irr(dec(['-100', '110']));
  expect(result.status).toBe('one');
  expect(result.signChanges).toBe(1);
  expect(result.rates).toHaveLength(1);
  expect(percent(result.rates[0]!)).toBe('10.0000');
  const page = calc({ flows: '-100\n110', rate: '5' });
  expect(page.summary.irr.rates).toEqual(['10.0000']);
  expect(page.summary.irr.status).toBe('one');
});

it('two sign changes, -1, 3, -2, give two rates, 0 and 100, and the result says more than one rate satisfies the flows', () => {
  // With x = 1 / (1 + r) the flows give -1 + 3x - 2x^2 = 0, so x = 1 or x = 0.5, that is r = 0 and r = 1 (100 percent).
  const result = irr(dec(['-1', '3', '-2']));
  expect(result.status).toBe('several');
  expect(result.signChanges).toBe(2);
  expect(result.rates.map(percent)).toEqual(['0.0000', '100.0000']);
  const page = calc({ flows: '-1\n3\n-2', rate: '10' });
  expect(page.summary.irr.rates).toEqual(['0.0000', '100.0000']);
  expect(page.summary.irr.message).toMatch(/more than one rate satisfies/i);
  expect(page.warnings.join(' ')).toMatch(/more than one rate satisfies/i);
});

it('flows that never change sign have no IRR and say so', () => {
  for (const text of ['100\n110', '-100\n-110\n-5']) {
    const flows = text.split('\n');
    const result = irr(dec(flows));
    expect(result.status).toBe('none');
    expect(result.signChanges).toBe(0);
    expect(result.rates).toHaveLength(0);
    const page = calc({ flows: text, rate: '5' });
    expect(page.summary.irr.status).toBe('none');
    expect(page.summary.irr.rates).toEqual([]);
    expect(page.summary.irr.message).toMatch(/never change sign/i);
  }
  // Zeros between the flows do not count as a change of sign.
  expect(signChanges(dec(['-5', '0', '0', '7', '0', '-1']))).toBe(2);
  expect(signChanges(dec(['0', '0', '3']))).toBe(0);
});

it('a root below -99, -100 then 0.5, and a root above 1000, -1 then 20, are both found', () => {
  // -100 + 0.5 x = 0 gives x = 200, so 1 + r = 1 / 200 = 0.005 and r = -0.995, that is -99.5 percent.
  const low = irr(dec(['-100', '0.5']));
  expect(low.status).toBe('one');
  expect(percent(low.rates[0]!)).toBe('-99.5000');
  // -1 + 20 x = 0 gives x = 1 / 20, so 1 + r = 20 and r = 19, that is 1900 percent.
  const high = irr(dec(['-1', '20']));
  expect(high.status).toBe('one');
  expect(percent(high.rates[0]!)).toBe('1900.0000');
});

it('all-zero flows, a rate at or below -100 and more than 200 lines are refused or reported plainly', () => {
  const zero = calc({ flows: '0\n0\n0', rate: '5' });
  expect(zero.summary.irr.status).toBe('all-zero');
  expect(zero.summary.irr.rates).toEqual([]);
  expect(zero.summary.irr.message).toMatch(/every cash flow is 0/i);
  expect(zero.summary.npv).toBe('0.00');
  expect(irr(dec(['0', '0'])).status).toBe('all-zero');

  const atLimit = refused(() => calculateCashFlows({ flows: '-100\n110', rate: '-100', currency: 'USD' }));
  expect(atLimit.field).toBe('Discount rate per period (percent)');
  expect(atLimit.message).toMatch(/above -100/);
  expect(refused(() => calculateCashFlows({ flows: '-100\n110', rate: '-150', currency: 'USD' })).field).toBe(
    'Discount rate per period (percent)',
  );
  expect(calc({ flows: '-100\n110', rate: '-99.9' }).summary.npv).toBe('109900.00');
  expect(() => npv(new D('-100'), dec(['1', '2']))).toThrow(MoneyInputError);

  expect(MAX_FLOWS).toBe(200);
  const line = (n: number) => (n % 2 === 0 ? '-10' : '12');
  const lines = (count: number) => Array.from({ length: count }, (_, i) => line(i)).join('\n');
  expect(parseFlows(lines(200))).toHaveLength(200);
  const over = refused(() => parseFlows(lines(201)));
  expect(over.message).toContain('200');
  expect(over.line).toBe(201);
  expect(over.column).toBe(1);
  expect(refused(() => calculateCashFlows({ flows: lines(201), rate: '5', currency: 'USD' })).message).toContain('200');
  expect(calc({ flows: lines(200), rate: '5' }).rows).toHaveLength(200);
});

it('payback of -1000 then 400, 400, 400 is 2.5 periods and at 10 the discounted payback is not reached', () => {
  const flows = dec(['-1000', '400', '400', '400']);
  // Running totals -1000, -600, -200, 200. The total turns non-negative in period 3, so the payback is
  // (3 - 1) + 200 / 400 = 2.5 periods, linear inside the period.
  expect(payback(flows)!.toFixed()).toBe('2.5');
  // At 10 percent the present values are -1000, 363.6363..., 330.5785..., 300.5259... and the discounted running
  // totals are -636.36, -305.79 and -5.26, so the discounted payback is not reached within three periods.
  expect(discountedPayback(new D('10'), flows)).toBeNull();
  // The same flows with a fourth 400 reach it in period 4: the shortfall before it is 1000 - 400 x (1/1.1 + 1/1.21 + 1/1.331),
  // which over 400 / 1.4641 is exactly 7.7 / 400 = 0.01925, so the payback is 3.01925 periods, a tie that rounds half away
  // from zero to 3.0193.
  const longer = dec(['-1000', '400', '400', '400', '400']);
  expect(toPlain(discountedPayback(new D('10'), longer)!, 4)).toBe('3.0193');
  const page = calc({ flows: '-1000\n400\n400\n400', rate: '10' });
  expect(page.summary.payback).toBe('2.50');
  expect(page.summary.discountedPayback).toBeNull();
  expect(page.rows.map((r) => r.discountedRunningTotal)).toEqual(['-1000.00', '-636.36', '-305.79', '-5.26']);
  expect(page.rows.map((r) => r.runningTotal)).toEqual(['-1000.00', '-600.00', '-200.00', '200.00']);
  // A flow that is not negative at the start pays back in no time.
  expect(payback(dec(['5', '-2', '1']))!.toFixed()).toBe('0');
});

it('the IRR is reported to 4 decimal places of a percent within the stated tolerance of 1e-12', () => {
  // -1000 then 300, 400, 500, 600 has one sign change; its rate is 24.88833566... percent.
  const flows = dec(['-1000', '300', '400', '500', '600']);
  const result = irr(flows);
  expect(result.status).toBe('one');
  const r = result.rates[0]!;
  expect(percent(r)).toBe('24.8883');
  expect(calc({ flows: '-1000\n300\n400\n500\n600', rate: '8' }).summary.irr.rates).toEqual(['24.8883']);
  // The bracket was narrower than 1e-12 in the rate, so the NPV changes sign between r - 1e-12 and r + 1e-12
  // (written in percent for the function that takes a percent).
  const tolerance = new D('1e-12');
  const below = npv(r.minus(tolerance).times(100), flows);
  const above = npv(r.plus(tolerance).times(100), flows);
  expect(below.isPos()).toBe(true);
  expect(above.isNeg()).toBe(true);
  expect(npv(r.times(100), flows).abs().lt('1e-8')).toBe(true);
});

it('0.1 plus 0.2 is exactly 0.3 through this tool', () => {
  // Floating point gets it wrong, so a tool that summed JavaScript numbers would show 0.30000000000000004.
  expect(0.1 + 0.2).not.toBe(0.3);
  // At a rate of 0 nothing is discounted, so the net present value of 0.1 and 0.2 is their plain sum.
  expect(npv(new D('0'), dec(['0.1', '0.2'])).toFixed()).toBe('0.3');
  const page = calc({ flows: '0.1\n0.2', rate: '0' });
  expect(page.summary.npv).toBe('0.30');
  expect(page.rows.map((r) => r.runningTotal)).toEqual(['0.10', '0.30']);
});

it('a bad line is refused naming the line and column, and a missing rate or too few flows is named', () => {
  const bad = refused(() => parseFlows('-100\nabc\n50'));
  expect(bad.field).toBe('Cash flows');
  expect(bad.line).toBe(2);
  expect(bad.column).toBe(1);
  const labelled = refused(() => parseFlows('Year 0 | -100\nYear 1 | 1,000'));
  expect(labelled.line).toBe(2);
  expect(labelled.column).toBe(10);
  expect(refused(() => parseFlows('a | b | 3')).line).toBe(1);
  expect(refused(() => calculateCashFlows({ flows: '-100\n110', rate: '', currency: 'USD' })).field).toBe(
    'Discount rate per period (percent)',
  );
  expect(refused(() => calculateCashFlows({ flows: '', rate: '5', currency: 'USD' })).field).toBe('Cash flows');
  expect(refused(() => calculateCashFlows({ flows: '-100', rate: '5', currency: 'USD' })).message).toMatch(
    /at least two/,
  );
  expect(calculateCashFlows({ flows: '', rate: '', currency: 'USD' })).toBeNull();
  expect(refused(() => calculateCashFlows({ flows: '-1\n2', rate: '5', currency: 'XX' })).field).toBe(
    'Currency (ISO 4217 code)',
  );
});

it('labels are kept, three or more sign changes say up to that many rates are possible, and a huge present value is refused', () => {
  const rows = parseFlows('Outlay | -100\n110\n  | 5');
  expect(rows.map((r) => r.label)).toEqual(['Outlay', '', '']);
  expect(rows.map((r) => r.amount.toFixed())).toEqual(['-100', '110', '5']);
  // -1 + 3x - 3x^2 + x^3 = -(1 - x)^3 has one root, x = 1 (r = 0), where the curve flattens as it crosses zero.
  const triple = calc({ flows: '-1\n3\n-3\n1', rate: '10' });
  expect(triple.summary.irr.status).toBe('one');
  expect(triple.summary.irr.signChanges).toBe(3);
  expect(triple.summary.irr.message).toMatch(/up to 3 rates are possible/i);
  expect(triple.warnings.join(' ')).toMatch(/up to 3 rates are possible/i);
  // A rate just above -100 percent multiplies the later flows by 1.001^-t inverted, 1000^t, which is far too large to show.
  expect(
    refused(() => calculateCashFlows({ flows: '-1\n1\n1\n1\n1\n1\n1', rate: '-99.9', currency: 'USD' })).message,
  ).toMatch(/too large to show exactly/);
  // Flows that change sign twice but have no real rate are reported as none found, not as no sign change.
  const none = calc({ flows: '1\n-1\n1', rate: '5' });
  expect(none.summary.irr.status).toBe('none');
  expect(none.summary.irr.signChanges).toBe(2);
  expect(none.summary.irr.message).toMatch(/no rate was found/i);
});

it('the page text names the standards and never tells the visitor what to do', () => {
  const text = JSON.stringify(meta.about) + JSON.stringify(meta.supports) + JSON.stringify(meta.limits);
  expect(text).not.toMatch(/\b(should|recommend|you must|accept the project|reject the project)\b/i);
  const page = calc({ flows: '-1000\n400\n400\n400', rate: '10' });
  const everything = [page.working, ...page.warnings, page.summary.irr.message].join('\n');
  expect(everything).not.toMatch(/\b(should|recommend|worth|good|bad|accept|reject)\b/i);
  expect(page.working).toContain('6.12.30');
  expect(page.working).toContain('6.12.24');
  expect(page.working).toContain('A-94');
  expect(meta.standards.map((s) => s.label).join(' ')).toContain('A-94');
});
