import { it, expect } from 'vitest';
import {
  calculateStock,
  dividendYield,
  earningsPerShare,
  marginCallPrice,
  meta,
  payoutRatio,
  priceToEarnings,
  type StockTexts,
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

const calc = (texts: StockTexts) => {
  const result = calculateStock({ currency: 'USD', ...texts });
  expect(result).not.toBeNull();
  return result!;
};
const margin = (buyPrice: string, initialMargin: string, maintenanceMargin: string) =>
  calc({ mode: 'margin', buyPrice, initialMargin, maintenanceMargin });

it('meta: id, name, dependency pin and the two required sentences in limits', () => {
  expect(meta.id).toBe('stock-metrics');
  expect(meta.name).toBe('Stock Ratios & Margin Calculator');
  expect(meta.dependencies['decimal.js']).toBe('10.6.0');
  expect(meta.limits.length).toBeGreaterThanOrEqual(3);
  expect(meta.limits.some((l: string) => /half away from zero/i.test(l))).toBe(true);
  expect(meta.limits.some((l: string) => /not financial, tax or legal advice; it ignores /i.test(l))).toBe(true);
  const urls = meta.standards.map((s: { url: string }) => s.url);
  expect(urls).toContain('https://www.ecfr.gov/current/title-12/chapter-II/subchapter-A/part-220');
  expect(urls).toContain('https://www.finra.org/rules-guidance/rulebooks/finra-rules/4210');
});

it('the usage example in meta.json shows what the code returns', () => {
  const { summary } = margin('100', '50', '25');
  expect(summary.result).toBe('66.67');
  expect(summary.lines.map((line) => line.label)).toEqual([
    'Buy price',
    'Initial margin',
    'Maintenance margin',
    'Loan per share',
    'Equity per share at purchase',
    'Margin call price',
    'Fall from the buy price to the call',
  ]);
  expect(meta.usage).toContain("result.summary.result; // '66.67'");
  expect(meta.usage).toContain(
    "['Buy price', 'Initial margin', 'Maintenance margin', 'Loan per share', 'Equity per share at purchase', 'Margin call price', 'Fall from the buy price to the call']",
  );
});

// SEC Investor.gov glossary, Earnings Per Share: "A public company's net profit divided by the number of its common
// shares." By hand: 5,000,000 / 2,000,000 = 2.5, shown 2.50. Negative earnings give a negative figure.
it('earnings per share is earnings divided by shares: 5000000 over 2000000 shares is 2.50', () => {
  expect(earningsPerShare(new D(5000000), new D(2000000)).toString()).toBe('2.5');
  const { summary, working } = calc({ mode: 'eps', earnings: '5000000', shares: '2000000' });
  expect(summary.result).toBe('2.50');
  expect(working).toContain('earnings per share = earnings / shares outstanding');
  expect(working).toContain('5000000 / 2000000 = 2.5');
  expect(calc({ mode: 'eps', earnings: '-1000', shares: '400' }).summary.result).toBe('-2.50');
});

// By hand: 50 / 2.5 = 20, shown 20.00 (and 20.0000 at 4 places). 50 / 3 = 16.666..., 16.6667 at 4 places. Earnings per
// share of 0 or below makes the ratio not meaningful, so none is shown and the page says why.
it('price to earnings is price divided by earnings per share: 50 over 2.50 is 20.00, and zero or negative earnings give no ratio', () => {
  expect(priceToEarnings(new D(50), new D('2.5'))!.toString()).toBe('20');
  expect(calc({ mode: 'pe', price: '50', eps: '2.50' }).summary.result).toBe('20.00');
  expect(calc({ mode: 'pe', price: '50', eps: '3', decimals: '4' }).summary.result).toBe('16.6667');
  expect(priceToEarnings(new D(50), new D(0))).toBeNull();
  expect(priceToEarnings(new D(50), new D(-2))).toBeNull();
  for (const eps of ['0', '-2']) {
    const none = calc({ mode: 'pe', price: '50', eps });
    expect(none.summary.result).toBeNull();
    expect(none.summary.notes.join(' ')).toContain('not meaningful');
  }
});

// By hand: 2 / 50 = 0.04, 4.00 percent. A dividend of 0 is a yield of 0.00.
it('dividend yield is the annual dividend per share over the price: 2 on 50 is 4.00', () => {
  expect(dividendYield(new D(2), new D(50)).toString()).toBe('4');
  expect(calc({ mode: 'yield', dividend: '2', price: '50' }).summary.result).toBe('4.00');
  expect(calc({ mode: 'yield', dividend: '0', price: '50' }).summary.result).toBe('0.00');
});

// By hand: 1,000,000 / 4,000,000 = 0.25, 25.00 percent. Dividends above earnings give a payout above 100 percent.
it('payout ratio is dividends over earnings: 1000000 of 4000000 is 25.00', () => {
  expect(payoutRatio(new D(1000000), new D(4000000)).toString()).toBe('25');
  expect(calc({ mode: 'payout', dividends: '1000000', earnings: '4000000' }).summary.result).toBe('25.00');
  expect(calc({ mode: 'payout', dividends: '5', earnings: '4' }).summary.result).toBe('125.00');
  expect(refused(() => calculateStock({ mode: 'payout', dividends: '5', earnings: '0' })).field).toBe('Earnings');
  expect(refused(() => calculateStock({ mode: 'payout', dividends: '5', earnings: '-4' })).field).toBe('Earnings');
});

// 12 CFR 220.12(a) (Regulation T), fetched from the eCFR renderer: "Margin equity security, except for an exempted
// security, ...: 50 percent of the current market value of the security or the percentage set by the regulatory
// authority where the trade occurs, whichever is greater." FINRA Rule 4210(c)(1), fetched: "25 percent of the current
// market value of all margin securities, as defined in Section 220.2 of Regulation T, except for security futures
// contracts, "long" in the account." Neither gives a margin call formula, so by hand: bought at P0 = 100 with 50
// percent initial margin the loan is L = 100 x (1 - 0.5) = 50. At price P the equity is P - 50, and the maintenance
// requirement is 25 percent of the market value, 0.25 x P. Equity stays enough while P - 50 >= 0.25 x P, that is
// 0.75 x P >= 50, P >= 66.666..., so the call comes below 66.67 (66.666667 to 6 places).
it('12 CFR 220 Regulation T 50 initial margin and FINRA Rule 4210 25 maintenance margin: a stock bought at 100 gets a margin call below 66.67', () => {
  const p = marginCallPrice(new D(100), new D(50), new D(25));
  expect(p).not.toBeNull();
  expect(p!.toFixed(6)).toBe('66.666667');
  // At that price the equity is exactly 25 percent of the market value.
  expect(p!.minus(50).div(p!).minus('0.25').abs().lt('1e-30')).toBe(true);
  const { summary, working } = margin('100', '50', '25');
  expect(summary.result).toBe('66.67');
  const line = (label: string) => summary.lines.find((l) => l.label === label)!.value;
  expect(line('Loan per share')).toBe('50.00');
  expect(line('Equity per share at purchase')).toBe('50.00');
  expect(line('Fall from the buy price to the call')).toBe('33.33');
  expect(working).toContain('12 CFR 220.12(a)');
  expect(working).toContain('FINRA Rule 4210(c)(1)');
  expect(working).toContain('100 x (1 - 50 / 100) / (1 - 25 / 100)');
  // Other hand figures: 100 with 40 and 25 gives 100 x 0.6 / 0.75 = 80; 100 with 50 and 30 gives 71.428571... = 71.43.
  expect(margin('100', '40', '25').summary.result).toBe('80.00');
  expect(margin('100', '50', '30').summary.result).toBe('71.43');
  // A maintenance margin of 0 leaves only the loan: the call comes when the price is below the loan.
  expect(margin('100', '50', '0').summary.result).toBe('50.00');
});

it('a maintenance margin of 100 or more, zero shares and a zero price are refused naming the field', () => {
  expect(refused(() => margin('100', '50', '100')).field).toBe('Maintenance margin (percent)');
  expect(refused(() => margin('100', '50', '150')).field).toBe('Maintenance margin (percent)');
  expect(refused(() => margin('100', '0', '25')).field).toBe('Initial margin (percent)');
  expect(refused(() => margin('100', '101', '25')).field).toBe('Initial margin (percent)');
  expect(refused(() => margin('0', '50', '25')).field).toBe('Buy price');
  expect(refused(() => calculateStock({ mode: 'eps', earnings: '100', shares: '0' })).field).toBe('Shares outstanding');
  expect(refused(() => calculateStock({ mode: 'pe', price: '0', eps: '2' })).field).toBe('Share price');
  expect(refused(() => calculateStock({ mode: 'yield', price: '0', dividend: '2' })).field).toBe('Share price');
  // Something missing is named; a bad number or an unknown mode is refused.
  expect(refused(() => calculateStock({ mode: 'margin', buyPrice: '100', initialMargin: '50' })).field).toBe(
    'Maintenance margin (percent)',
  );
  expect(refused(() => calculateStock({ mode: 'eps', earnings: '1e6', shares: '5' })).field).toBe('Earnings');
  expect(refused(() => calculateStock({ mode: 'beta' })).field).toBe('Mode');
  expect(refused(() => calculateStock({ mode: 'eps', earnings: '1', shares: '1', decimals: '5' })).field).toBe(
    'Decimal places',
  );
  expect(refused(() => calculateStock({ mode: 'eps', earnings: '1', shares: '1', currency: 'DOLLARS' })).field).toBe(
    'Currency (ISO 4217 code)',
  );
  // Nothing typed for the chosen mode shows nothing, whatever else is filled in.
  expect(calculateStock({ mode: 'margin', currency: 'USD' })).toBeNull();
  expect(calculateStock({ mode: 'eps', buyPrice: '100', price: '5' })).toBeNull();
  expect(calculateStock({})).toBeNull();
});

it('an initial margin of 100 means no loan and no margin call', () => {
  expect(marginCallPrice(new D(100), new D(100), new D(25))).toBeNull();
  const { summary } = margin('100', '100', '25');
  expect(summary.result).toBeNull();
  expect(summary.notes.join(' ')).toContain('no loan');
  expect(summary.notes.join(' ')).toContain('no margin call');
  expect(summary.lines.find((l) => l.label === 'Loan per share')!.value).toBe('0.00');
  // An initial margin below the maintenance margin starts below the requirement: the call price is above the buy price.
  const low = margin('100', '20', '25');
  expect(low.summary.result).toBe('106.67');
  expect(low.summary.notes.join(' ')).toContain('already below');
});

// In JavaScript floating point 0.3 / 3 is 0.09999999999999999. Earnings of 0.3, the sum of 0.1 and 0.2, over 3 shares
// give earnings per share of exactly 0.1.
it('0.1 plus 0.2 is exactly 0.3 through this tool', () => {
  expect(0.3 / 3).toBe(0.09999999999999999);
  expect(earningsPerShare(new D('0.1').plus('0.2'), new D(3)).toString()).toBe('0.1');
  expect(earningsPerShare(new D('0.3'), new D(3)).times(3).toString()).toBe('0.3');
  expect(calc({ mode: 'eps', earnings: '0.3', shares: '3', currency: 'BHD' }).summary.result).toBe('0.100');
});

it('only arithmetic is shown: no wording recommends or rates anything', () => {
  const texts = [
    calc({ mode: 'pe', price: '50', eps: '2.5' }).working,
    calc({ mode: 'pe', price: '50', eps: '0' }).summary.notes.join(' '),
    margin('100', '100', '25').summary.notes.join(' '),
    margin('100', '20', '25').summary.notes.join(' '),
    margin('100', '50', '25').working,
    meta.about,
    ...meta.supports,
    ...meta.limits,
  ].join('\n');
  expect(texts).not.toMatch(/\b(should|recommend\w*|best|better|worse|good|bad|worth|cheap|expensive|safe|risky)\b/i);
  expect(texts).not.toMatch(/\b(buy|sell|hold) (it|now|more|less)\b/i);
});
