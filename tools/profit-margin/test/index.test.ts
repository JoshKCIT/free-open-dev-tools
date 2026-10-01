import { it, expect } from 'vitest';
import {
  breakEvenUnits,
  calculateProfit,
  meta,
  priceForMargin,
  priceForMarkup,
  profitMarginMarkup,
  type ProfitTexts,
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

const calc = (texts: ProfitTexts) => {
  const result = calculateProfit({ currency: 'USD', ...texts });
  expect(result).not.toBeNull();
  return result!;
};
const line = (result: ReturnType<typeof calc>, label: string) =>
  result.summary.lines.find((l) => l.label === label)?.value;
const margin = (cost: string, price: string, extra: ProfitTexts = {}) =>
  calc({ mode: 'margin', cost, price, ...extra });
const breakEven = (fixedCosts: string, unitPrice: string, unitCost: string) =>
  calc({ mode: 'break-even', fixedCosts, unitPrice, unitCost });

it('meta: id, name, dependency pin, the two required sentences in limits and no standards', () => {
  expect(meta.id).toBe('profit-margin');
  expect(meta.name).toBe('Profit Margin, Markup & Break-even');
  expect(meta.dependencies['decimal.js']).toBe('10.6.0');
  expect(meta.limits.length).toBeGreaterThanOrEqual(3);
  expect(meta.limits.some((l: string) => /half away from zero/i.test(l))).toBe(true);
  expect(meta.limits.some((l: string) => /not financial, tax or legal advice; it ignores /i.test(l))).toBe(true);
  expect(meta.standards).toEqual([]);
  expect(meta.testNotes).toMatch(/no standards body/i);
});

it('the usage example in meta.json shows what the code returns', () => {
  const { summary } = margin('60', '100');
  expect(summary.result).toBe('40.00');
  expect(summary.lines.map((l) => l.label)).toEqual(['Cost', 'Price', 'Profit', 'Margin', 'Markup']);
  expect(meta.usage).toContain("result.summary.result; // '40.00'");
  expect(meta.usage).toContain("['Cost', 'Price', 'Profit', 'Margin', 'Markup']");
});

// No standards body publishes these definitions. By hand: cost 60 and price 100 give a profit of 100 - 60 = 40. The
// margin divides the profit by the price: 40 / 100 = 0.4, 40.00 percent. The markup divides it by the cost:
// 40 / 60 = 0.666..., 66.67 percent at 2 places (66.6667 at 4, 67 at 0).
it('profit, margin and markup: cost 60 and price 100 give profit 40, margin 40.00 and markup 66.67', () => {
  const r = profitMarginMarkup(new D(60), new D(100));
  expect(r.profit.toString()).toBe('40');
  expect(r.margin!.toString()).toBe('40');
  expect(r.markup!.toFixed(4)).toBe('66.6667');
  const result = margin('60', '100');
  expect(line(result, 'Profit')).toBe('40.00');
  expect(line(result, 'Margin')).toBe('40.00');
  expect(line(result, 'Markup')).toBe('66.67');
  expect(result.working).toContain('profit = price - cost');
  expect(result.working).toContain('margin = profit / price x 100');
  expect(result.working).toContain('markup = profit / cost x 100');
  expect(result.working).toContain('100 - 60 = 40');
  expect(result.working).toContain('40 / 100 x 100 = 40');
  expect(result.working).toContain('40 / 60 x 100 = 66.6666666667');
  expect(margin('60', '100', { decimals: '4' }).summary.lines.find((l) => l.label === 'Markup')!.value).toBe('66.6667');
  expect(margin('60', '100', { decimals: '0' }).summary.lines.find((l) => l.label === 'Markup')!.value).toBe('67');
});

// By hand: the price p that gives a margin m on a cost c satisfies (p - c) / p = m, so p = c / (1 - m). With c = 60 and
// m = 0.4, p = 60 / 0.6 = 100. Putting 100 back: (100 - 60) / 100 = 0.4.
it('price for a target margin is cost over one minus the margin: cost 60 at 40 margin is 100.00', () => {
  expect(priceForMargin(new D(60), new D(40)).toString()).toBe('100');
  const result = calc({ mode: 'target-margin', cost: '60', targetMargin: '40' });
  expect(result.summary.result).toBe('100.00');
  expect(line(result, 'Price')).toBe('100.00');
  expect(line(result, 'Profit')).toBe('40.00');
  expect(line(result, 'Markup')).toBe('66.67');
  expect(result.working).toContain('price = cost / (1 - target margin / 100)');
  expect(result.working).toContain('60 / (1 - 40 / 100)');
  // 60 at 25 percent: 60 / 0.75 = 80. A margin of 0 is the cost itself.
  expect(calc({ mode: 'target-margin', cost: '60', targetMargin: '25' }).summary.result).toBe('80.00');
  expect(calc({ mode: 'target-margin', cost: '60', targetMargin: '0' }).summary.result).toBe('60.00');
});

// By hand: a markup k on a cost c gives p = c x (1 + k), so 60 x (1 + 0.5) = 90. The margin of that price is
// (90 - 60) / 90 = 1/3, 33.33 percent.
it('price for a target markup is cost times one plus the markup: cost 60 at 50 markup is 90.00', () => {
  expect(priceForMarkup(new D(60), new D(50)).toString()).toBe('90');
  const result = calc({ mode: 'target-markup', cost: '60', targetMarkup: '50' });
  expect(result.summary.result).toBe('90.00');
  expect(line(result, 'Price')).toBe('90.00');
  expect(line(result, 'Profit')).toBe('30.00');
  expect(line(result, 'Margin')).toBe('33.33');
  expect(result.working).toContain('price = cost x (1 + target markup / 100)');
  expect(result.working).toContain('60 x (1 + 50 / 100) = 90');
  // A markup of 100 doubles the cost.
  expect(calc({ mode: 'target-markup', cost: '60', targetMarkup: '100' }).summary.result).toBe('120.00');
});

// By hand: each unit adds its price minus its variable cost, 25 - 15 = 10, to cover the fixed costs. 1000 / 10 = 100
// units exactly. 1001 / 10 = 100.1, and since 100 units leave 1 uncovered, 101 whole units are needed.
it('break-even units are fixed costs over the unit contribution, rounded up to whole units: 1000 over 25 minus 15 is 100, and 1001 needs 101', () => {
  const exact = breakEvenUnits(new D(1000), new D(25), new D(15))!;
  expect(exact.exact.toString()).toBe('100');
  expect(exact.units.toString()).toBe('100');
  const over = breakEvenUnits(new D(1001), new D(25), new D(15))!;
  expect(over.exact.toString()).toBe('100.1');
  expect(over.units.toString()).toBe('101');
  const result = breakEven('1000', '25', '15');
  expect(result.summary.result).toBe('100');
  expect(line(result, 'Contribution per unit')).toBe('10.00');
  expect(line(result, 'Whole units needed (rounded up)')).toBe('100');
  expect(result.working).toContain('break-even units = fixed costs / (unit price - unit cost)');
  expect(result.working).toContain('1000 / (25 - 15) = 100');
  const next = breakEven('1001', '25', '15');
  expect(next.summary.result).toBe('101');
  expect(line(next, 'Units before rounding up')).toBe('100.10');
  expect(next.working).toContain('rounded up to the next whole unit');
  // No fixed costs needs no units; one unit of contribution per cent works to the whole unit.
  expect(breakEven('0', '25', '15').summary.result).toBe('0');
  expect(breakEven('0.01', '1', '0.99').summary.result).toBe('1');
});

it('a target margin of 100 or more, a price at or below the unit cost and a zero price are refused or reported plainly', () => {
  expect(refused(() => calc({ mode: 'target-margin', cost: '60', targetMargin: '100' })).field).toBe(
    'Target margin (percent)',
  );
  expect(refused(() => calc({ mode: 'target-margin', cost: '60', targetMargin: '150' })).field).toBe(
    'Target margin (percent)',
  );
  expect(() => priceForMargin(new D(60), new D(100))).toThrow(MoneyInputError);
  expect(refused(() => calc({ mode: 'target-markup', cost: '60', targetMarkup: '-101' })).field).toBe(
    'Target markup (percent)',
  );
  // A unit price at or below the unit cost never reaches break-even.
  expect(breakEvenUnits(new D(1000), new D(15), new D(15))).toBeNull();
  expect(breakEvenUnits(new D(1000), new D(10), new D(15))).toBeNull();
  for (const unitPrice of ['15', '10']) {
    const never = breakEven('1000', unitPrice, '15');
    expect(never.summary.result).toBeNull();
    expect(never.summary.notes.join(' ')).toContain('never reached');
    expect(never.working).toContain('never reached');
  }
  // A price of 0 gives no margin and a cost of 0 gives no markup, each with the reason.
  expect(profitMarginMarkup(new D(60), new D(0)).margin).toBeNull();
  const noPrice = margin('60', '0');
  expect(line(noPrice, 'Profit')).toBe('-60.00');
  expect(line(noPrice, 'Margin')).toBeUndefined();
  expect(line(noPrice, 'Markup')).toBe('-100.00');
  expect(noPrice.summary.result).toBeNull();
  expect(noPrice.summary.notes.join(' ')).toContain('price of 0 gives no margin');
  expect(profitMarginMarkup(new D(0), new D(50)).markup).toBeNull();
  const noCost = margin('0', '50');
  expect(line(noCost, 'Margin')).toBe('100.00');
  expect(line(noCost, 'Markup')).toBeUndefined();
  expect(noCost.summary.result).toBe('100.00');
  expect(noCost.summary.notes.join(' ')).toContain('cost of 0 gives no markup');
  // Missing numbers are named, a bad number is refused, an unknown mode too, and nothing typed shows nothing.
  expect(refused(() => calculateProfit({ mode: 'margin', cost: '60' })).field).toBe('Price');
  expect(refused(() => calculateProfit({ mode: 'margin', cost: '6e1', price: '100' })).field).toBe('Cost');
  expect(refused(() => calculateProfit({ mode: 'margin', cost: '-60', price: '100' })).field).toBe('Cost');
  expect(refused(() => calculateProfit({ mode: 'break-even', fixedCosts: '1', unitPrice: '2' })).field).toBe(
    'Unit variable cost',
  );
  expect(refused(() => calculateProfit({ mode: 'sales', cost: '1' })).field).toBe('Mode');
  expect(refused(() => calculateProfit({ mode: 'margin', cost: '1', price: '2', decimals: '5' })).field).toBe(
    'Decimal places',
  );
  expect(calculateProfit({ mode: 'margin', currency: 'USD' })).toBeNull();
  expect(calculateProfit({ mode: 'break-even', cost: '60', price: '100' })).toBeNull();
  expect(calculateProfit({})).toBeNull();
});

// By hand: cost 100 and price 80 lose 20. Margin = -20 / 80 = -25 percent; markup = -20 / 100 = -20 percent.
it('a loss gives a negative margin and markup', () => {
  const r = profitMarginMarkup(new D(100), new D(80));
  expect(r.profit.toString()).toBe('-20');
  expect(r.margin!.toString()).toBe('-25');
  expect(r.markup!.toString()).toBe('-20');
  const result = margin('100', '80');
  expect(line(result, 'Profit')).toBe('-20.00');
  expect(line(result, 'Margin')).toBe('-25.00');
  expect(line(result, 'Markup')).toBe('-20.00');
  // A loss that rounds to nothing prints without a minus sign.
  expect(line(margin('100', '99.999', { decimals: '1' }), 'Markup')).toBe('0.0');
});

// Results are rounded half away from zero only when shown. 1 / 8 = 0.125, so a margin of 12.5 percent is 12.5 at one
// place and a tie at none; 0.5 of a currency unit ties too.
it('results are rounded half away from zero only when shown, to the chosen places', () => {
  // price 8 and cost 7: profit 1, margin 1 / 8 x 100 = 12.5 exactly, markup 1 / 7 x 100 = 14.2857...
  expect(line(margin('7', '8', { decimals: '0' }), 'Margin')).toBe('13');
  expect(line(margin('7', '8', { decimals: '1' }), 'Margin')).toBe('12.5');
  expect(line(margin('7', '8', { decimals: '4' }), 'Markup')).toBe('14.2857');
  // 0.005 of profit at the cent: cost 1 and price 1.005 give 0.005, shown 0.01 (away from zero), and -0.005 shown -0.01.
  expect(line(margin('1', '1.005'), 'Profit')).toBe('0.01');
  expect(line(margin('1.005', '1'), 'Profit')).toBe('-0.01');
  // The working keeps the unrounded figure and says how it was rounded.
  expect(margin('7', '8', { decimals: '0' }).working).toContain('rounded half away from zero to 0 decimal places');
  // A currency with no minor unit shows whole amounts: JPY.
  expect(line(margin('60', '100', { currency: 'JPY' }), 'Profit')).toBe('40');
});

// In JavaScript floating point 0.3 - 0.1 is 0.19999999999999998. A cost of 0.1 and a price of 0.3 (0.1 plus 0.2) give a
// profit of exactly 0.2, a markup of exactly 200 and a margin of exactly two thirds, 66.67 at 2 places.
it('0.1 plus 0.2 is exactly 0.3 through this tool', () => {
  expect(0.3 - 0.1).toBe(0.19999999999999998);
  const r = profitMarginMarkup(new D('0.1'), new D('0.1').plus('0.2'));
  expect(r.profit.toString()).toBe('0.2');
  expect(r.markup!.toString()).toBe('200');
  expect(r.margin!.toFixed(2)).toBe('66.67');
  const result = margin('0.1', '0.3');
  expect(line(result, 'Profit')).toBe('0.20');
  expect(line(result, 'Margin')).toBe('66.67');
  expect(line(result, 'Markup')).toBe('200.00');
  expect(result.working).toContain('0.3 - 0.1 = 0.2');
});

it('only arithmetic is shown: no wording recommends or rates anything', () => {
  const texts = [
    margin('60', '100').working,
    margin('60', '0').summary.notes.join(' '),
    margin('0', '50').summary.notes.join(' '),
    breakEven('1000', '10', '15').summary.notes.join(' '),
    breakEven('1001', '25', '15').working,
    calc({ mode: 'target-margin', cost: '60', targetMargin: '40' }).working,
    calc({ mode: 'target-markup', cost: '60', targetMarkup: '50' }).working,
    meta.about,
    ...meta.supports,
    ...meta.limits,
  ].join('\n');
  expect(texts).not.toMatch(/\b(should|recommend\w*|best|better|worse|good|bad|worth|cheap|expensive|safe|risky)\b/i);
  expect(texts).not.toMatch(/\b(raise|lower|increase|reduce) (the|your) (price|cost)\b/i);
});
