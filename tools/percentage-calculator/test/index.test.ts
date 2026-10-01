import { it, expect } from 'vitest';
import {
  calculatePercentage,
  discountedPrice,
  meta,
  percentChange,
  percentOf,
  stackedDiscount,
  whatPercent,
  type PercentTexts,
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

const calc = (texts: PercentTexts) => {
  const result = calculatePercentage(texts);
  expect(result).not.toBeNull();
  return result!;
};
const line = (result: ReturnType<typeof calc>, label: string) =>
  result.summary.lines.find((l) => l.label === label)?.value;
const change = (from: string, to: string, extra: PercentTexts = {}) => calc({ mode: 'change', from, to, ...extra });
const stacked = (discounts: string, price?: string) => calc({ mode: 'stacked', discounts, price });

it('meta: id, name, dependency pin, the two required sentences in limits and the NIST citation', () => {
  expect(meta.id).toBe('percentage-calculator');
  expect(meta.name).toBe('Percentage & Discount Calculator');
  expect(meta.dependencies['decimal.js']).toBe('10.6.0');
  expect(meta.limits.length).toBeGreaterThanOrEqual(3);
  expect(meta.limits.some((l: string) => /half away from zero/i.test(l))).toBe(true);
  expect(meta.limits.some((l: string) => /not financial, tax or legal advice; it ignores /i.test(l))).toBe(true);
  expect(meta.standards.map((s: { url: string }) => s.url)).toContain(
    'https://www.nist.gov/pml/special-publication-811/nist-guide-si-chapter-7-rules-and-style-conventions-expressing-values',
  );
});

it('the usage example in meta.json shows what the code returns', () => {
  const { summary } = stacked('20\n10', '100');
  expect(summary.result).toBe('28.00');
  expect(summary.lines.map((l) => l.label)).toEqual(['Single discount', 'Price after the discounts', 'Saving']);
  expect(meta.usage).toContain("result.summary.result; // '28.00'");
  expect(meta.usage).toContain("['Single discount', 'Price after the discounts', 'Saving']");
});

// NIST Special Publication 811, section 7.10.2 "%, percentage by, fraction", fetched from
// https://www.nist.gov/pml/special-publication-811/nist-guide-si-chapter-7-rules-and-style-conventions-expressing-values :
// "In keeping with Ref. [4: ISO 31-0], this Guide takes the position that it is acceptable to use the internationally
// recognized symbol % (percent) for the number 0.01 with the SI and thus to express the values of quantities of
// dimension one (see Sec. 7.14) with its aid." and "because the symbol % represents simply the number 0.01".
// So 15 percent is 15 x 0.01 = 0.15, and 15 percent of 80 is 0.15 x 80 = 12. NIST's own example: 0.0025 = 0.25 %.
it('NIST SP 811: percent means the number 0.01, so 15 percent of 80 is 12', () => {
  expect(percentOf(new D(15), new D(80)).toString()).toBe('12');
  // NIST's example: the number 0.0025 is 0.25 percent, so 0.25 percent of 1 is exactly 0.0025.
  expect(percentOf(new D('0.25'), new D(1)).toString()).toBe('0.0025');
  const result = calc({ mode: 'of', percent: '15', value: '80' });
  expect(result.summary.result).toBe('12.00');
  expect(line(result, 'Result')).toBe('12.00');
  expect(result.working).toContain('NIST Special Publication 811');
  expect(result.working).toContain('15 percent = 15 x 0.01 = 0.15');
  expect(result.working).toContain('0.15 x 80 = 12');
  // A percent above 100 and a negative value are fine here: 250 percent of -4 is -10.
  expect(calc({ mode: 'of', percent: '250', value: '-4' }).summary.result).toBe('-10.00');
});

// By hand: 12 / 80 = 0.15, times 100 is 15 percent.
it('what percent X is of Y: 12 of 80 is 15.00', () => {
  expect(whatPercent(new D(12), new D(80))!.toString()).toBe('15');
  const result = calc({ mode: 'what', part: '12', whole: '80' });
  expect(result.summary.result).toBe('15.00');
  expect(line(result, 'Percent')).toBe('15.00');
  expect(result.working).toContain('percent = part / whole x 100');
  expect(result.working).toContain('12 / 80 x 100 = 15');
  // 1 of 3 is 33.33 percent at 2 places and 33.3333 at 4; 5 of 4 is 125; a negative part is a negative percent.
  expect(calc({ mode: 'what', part: '1', whole: '3' }).summary.result).toBe('33.33');
  expect(calc({ mode: 'what', part: '1', whole: '3', decimals: '4' }).summary.result).toBe('33.3333');
  expect(calc({ mode: 'what', part: '5', whole: '4' }).summary.result).toBe('125.00');
  expect(calc({ mode: 'what', part: '-1', whole: '4' }).summary.result).toBe('-25.00');
});

// By hand, percent change = (to - from) / |from| x 100. 80 to 100: 20 / 80 = 0.25, 25 percent. 100 to 80: -20 / 100 =
// -0.2, -20 percent. -50 to -25: (-25 - -50) / |-50| = 25 / 50 = 0.5, an increase of 50 percent (dividing by the signed
// -50 would give -50 percent, calling an increase a decrease).
it('percent change uses the absolute starting value: 80 to 100 is 25.00, 100 to 80 is -20.00 and -50 to -25 is 50.00', () => {
  expect(percentChange(new D(80), new D(100))!.toString()).toBe('25');
  expect(percentChange(new D(100), new D(80))!.toString()).toBe('-20');
  expect(percentChange(new D(-50), new D(-25))!.toString()).toBe('50');
  expect(change('80', '100').summary.result).toBe('25.00');
  expect(change('100', '80').summary.result).toBe('-20.00');
  const negative = change('-50', '-25');
  expect(negative.summary.result).toBe('50.00');
  expect(line(negative, 'Change')).toBe('25.00');
  expect(negative.working).toContain(
    'percent change = (ending value - starting value) / absolute starting value x 100',
  );
  expect(negative.working).toContain('(-25 - -50) / 50 x 100 = 50');
  // From a negative value to a positive one: -50 to 25 is 75 / 50 = 150 percent.
  expect(change('-50', '25').summary.result).toBe('150.00');
  // No change is 0.00, never -0.00.
  expect(change('7', '7').summary.result).toBe('0.00');
});

// By hand: 15 percent off 80 saves 80 x 0.15 = 12 and leaves 80 x (1 - 0.15) = 80 x 0.85 = 68.
it('a discounted price: 80 with 15 off is 68.00, a saving of 12.00', () => {
  const d = discountedPrice(new D(80), new D(15));
  expect(d.price.toString()).toBe('68');
  expect(d.saving.toString()).toBe('12');
  const result = calc({ mode: 'discount', price: '80', discount: '15' });
  expect(result.summary.result).toBe('68.00');
  expect(line(result, 'Price after the discount')).toBe('68.00');
  expect(line(result, 'Saving')).toBe('12.00');
  expect(result.working).toContain('price after the discount = price x (1 - discount / 100)');
  expect(result.working).toContain('80 x (1 - 15 / 100) = 68');
  // 0 off leaves the price; 100 off leaves nothing.
  expect(calc({ mode: 'discount', price: '80', discount: '0' }).summary.result).toBe('80.00');
  expect(calc({ mode: 'discount', price: '80', discount: '100' }).summary.result).toBe('0.00');
});

// By hand: after 20 percent off a price keeps 0.8 of itself; after 10 percent off that, 0.9 of 0.8 = 0.72. So
// 1 - 0.72 = 0.28, a single discount of 28 percent (not 30). Order does not change it: 10 then 20 is 0.9 x 0.8 = 0.72.
it('stacked discounts multiply: 20 then 10 is a single discount of 28.00', () => {
  expect(stackedDiscount([new D(20), new D(10)]).percent.toString()).toBe('28');
  expect(stackedDiscount([new D(10), new D(20)]).percent.toString()).toBe('28');
  expect(stackedDiscount([new D(20), new D(10)]).factor.toString()).toBe('0.72');
  const result = stacked('20\n10', '100');
  expect(result.summary.result).toBe('28.00');
  expect(line(result, 'Single discount')).toBe('28.00');
  expect(line(result, 'Price after the discounts')).toBe('72.00');
  expect(line(result, 'Saving')).toBe('28.00');
  expect(result.working).toContain('single discount = (1 - (1 - d1 / 100) x (1 - d2 / 100) x ...) x 100');
  expect(result.working).toContain('1 - 0.8 x 0.9 = 0.28');
  // Without a price there is only the single discount; blank lines are skipped; three discounts: 10, 10, 10 is 27.10.
  const noPrice = stacked('20\n\n10');
  expect(noPrice.summary.lines.map((l) => l.label)).toEqual(['Single discount']);
  expect(stacked('10\n10\n10').summary.result).toBe('27.10');
  // 100 anywhere makes the single discount 100; 0 changes nothing.
  expect(stacked('20\n100').summary.result).toBe('100.00');
  expect(stacked('0').summary.result).toBe('0.00');
  // A single line works, and the cap is 20 lines.
  expect(stacked('12.5').summary.result).toBe('12.50');
  const twenty = Array.from({ length: 20 }, () => '1').join('\n');
  expect(stacked(twenty).summary.result).toBe('18.21');
  const tooMany = refused(() => stacked(`${twenty}\n1`));
  expect(tooMany.field).toBe('Discounts');
  expect(tooMany.message).toContain('20');
  expect(tooMany.line).toBe(21);
});

it('a change from zero, a whole of zero and a discount over 100 are reported plainly', () => {
  expect(percentChange(new D(0), new D(5))).toBeNull();
  const fromZero = change('0', '5');
  expect(fromZero.summary.result).toBeNull();
  expect(fromZero.summary.notes.join(' ')).toContain('A change from 0 has no percent');
  expect(line(fromZero, 'Change')).toBe('5.00');
  expect(whatPercent(new D(5), new D(0))).toBeNull();
  const noWhole = calc({ mode: 'what', part: '5', whole: '0' });
  expect(noWhole.summary.result).toBeNull();
  expect(noWhole.summary.notes.join(' ')).toContain('whole of 0');
  expect(noWhole.working).toContain('whole is 0');
  // A discount above 100 is refused naming the field, alone and in a stack with its line and column.
  expect(refused(() => calc({ mode: 'discount', price: '80', discount: '101' })).field).toBe('Discount (percent)');
  expect(() => discountedPrice(new D(80), new D(100.5))).toThrow(MoneyInputError);
  const inStack = refused(() => stacked('20\n  101'));
  expect(inStack.field).toBe('Discounts');
  expect(inStack.line).toBe(2);
  expect(inStack.column).toBe(3);
  const negative = refused(() => stacked('20\n-5'));
  expect(negative.line).toBe(2);
  expect(negative.column).toBe(1);
  expect(refused(() => stacked('20|10')).line).toBe(1);
  expect(refused(() => stacked('ten')).message).toContain('discount');
  expect(refused(() => calc({ mode: 'discount', price: '80', discount: '-1' })).field).toBe('Discount (percent)');
  // Missing numbers are named, a bad number is refused, an unknown mode too, and nothing typed shows nothing.
  expect(refused(() => calculatePercentage({ mode: 'of', percent: '15' })).field).toBe('Number');
  expect(refused(() => calculatePercentage({ mode: 'of', percent: '1,5', value: '80' })).field).toBe('Percent');
  expect(refused(() => calculatePercentage({ mode: 'what', part: '1e3', whole: '2' })).field).toBe('Part');
  expect(refused(() => calculatePercentage({ mode: 'discount', price: '-80', discount: '5' })).field).toBe('Price');
  expect(refused(() => calculatePercentage({ mode: 'median' })).field).toBe('Mode');
  expect(refused(() => calculatePercentage({ mode: 'of', percent: '1', value: '1', decimals: '5' })).field).toBe(
    'Decimal places',
  );
  expect(calculatePercentage({ mode: 'of' })).toBeNull();
  expect(calculatePercentage({ mode: 'stacked', discounts: '  \n ' })).toBeNull();
  expect(calculatePercentage({ mode: 'stacked', price: '100' })).toBeNull();
  expect(calculatePercentage({ mode: 'change', percent: '1', value: '2' })).toBeNull();
  expect(calculatePercentage({})).toBeNull();
});

// Results are rounded half away from zero only when shown. 1 of 8 is 12.5 exactly: shown 13 at no places, 12.5 at one.
// 0.5 percent of 1 is 0.005, shown 0.01 at 2 places (not 0.00), and -0.5 percent of 1 is -0.005, shown -0.01.
it('results are rounded half away from zero only when shown, to the chosen places', () => {
  expect(calc({ mode: 'what', part: '1', whole: '8', decimals: '0' }).summary.result).toBe('13');
  expect(calc({ mode: 'what', part: '1', whole: '8', decimals: '1' }).summary.result).toBe('12.5');
  expect(calc({ mode: 'what', part: '1', whole: '8', decimals: '4' }).summary.result).toBe('12.5000');
  expect(calc({ mode: 'what', part: '-1', whole: '8', decimals: '0' }).summary.result).toBe('-13');
  expect(calc({ mode: 'of', percent: '0.5', value: '1' }).summary.result).toBe('0.01');
  expect(calc({ mode: 'of', percent: '-0.5', value: '1' }).summary.result).toBe('-0.01');
  // The working keeps the unrounded figure and says how it was rounded; a figure that rounds to nothing has no minus.
  const third = calc({ mode: 'what', part: '1', whole: '3' });
  expect(third.working).toContain('= 33.3333333333');
  expect(third.working).toContain('rounded half away from zero to 2 decimal places');
  expect(calc({ mode: 'of', percent: '-0.1', value: '1' }).summary.result).toBe('0.00');
});

// In JavaScript floating point 0.3 - 0.1 is 0.19999999999999998, so a change from 0.1 to 0.3 (0.1 plus 0.2) comes out as
// 199.99999999999997 percent. Through this tool it is exactly 200.
it('0.1 plus 0.2 is exactly 0.3 through this tool', () => {
  expect(((0.3 - 0.1) / 0.1) * 100).toBe(199.99999999999997);
  const sum = new D('0.1').plus('0.2');
  expect(sum.toString()).toBe('0.3');
  expect(percentChange(new D('0.1'), sum)!.toString()).toBe('200');
  const result = change('0.1', '0.3');
  expect(result.summary.result).toBe('200.00');
  expect(line(result, 'Change')).toBe('0.20');
  expect(result.working).toContain('(0.3 - 0.1) / 0.1 x 100 = 200');
});

it('only arithmetic is shown: no wording recommends or rates anything', () => {
  const texts = [
    calc({ mode: 'of', percent: '15', value: '80' }).working,
    change('0', '5').summary.notes.join(' '),
    calc({ mode: 'what', part: '5', whole: '0' }).summary.notes.join(' '),
    change('-50', '-25').working,
    calc({ mode: 'discount', price: '80', discount: '15' }).working,
    stacked('20\n10', '100').working,
    meta.about,
    ...meta.supports,
    ...meta.limits,
    ...meta.ambiguities,
  ].join('\n');
  expect(texts).not.toMatch(/\b(should|recommend\w*|best|better|worse|good|bad|worth|cheap|expensive|safe|risky)\b/i);
  expect(texts).not.toMatch(/\b(buy|sell|hold) (it|now|more|less)\b/i);
});
