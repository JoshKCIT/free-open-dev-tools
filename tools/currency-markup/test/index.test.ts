import { it, expect } from 'vitest';
import { calculateMarkup, markup, meta, type MarkupTexts } from '../src/index';
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

const BASE: MarkupTexts = { amount: '1000', source: 'EUR', target: 'USD', offered: '1.0780', mid: '1.1000' };
const calc = (texts: MarkupTexts = {}) => {
  const result = calculateMarkup({ ...BASE, ...texts });
  expect(result).not.toBeNull();
  return result!;
};

it('meta: id, name, dependency pin, the two required sentences in limits and the cited regulation', () => {
  expect(meta.id).toBe('currency-markup');
  expect(meta.name).toBe('Currency Conversion Markup');
  expect(meta.dependencies['decimal.js']).toBe('10.6.0');
  expect(meta.limits.length).toBeGreaterThanOrEqual(3);
  expect(meta.limits.some((l: string) => /half away from zero/i.test(l))).toBe(true);
  expect(meta.limits.some((l: string) => /not financial, tax or legal advice; it ignores /i.test(l))).toBe(true);
  expect(meta.standards).toHaveLength(1);
  expect(meta.standards[0]?.url).toBe('https://www.legislation.gov.uk/eur/2019/518/data.html');
});

it('the usage example in meta.json shows what the code returns', () => {
  const { summary } = calc();
  expect([summary.markupPercent, summary.hiddenTarget, summary.hiddenSource]).toEqual(['2.00', '22.00', '20.00']);
  expect(meta.usage).toContain("// '2.00'");
  expect(meta.usage).toContain("// '22.00'");
  expect(meta.usage).toContain("// '20.00'");
});

// Regulation (EU) 2019/518, Article 3a(1), fetched 2026-10-01 from https://www.legislation.gov.uk/eur/2019/518/data.html:
// "... shall express the total currency conversion charges as a percentage mark-up over the latest available euro
// foreign exchange reference rates issued by the European Central Bank (ECB)." The regulation gives no formula or
// direction, so this tool states its own, derived by hand:
//   markup = (mid - offered) / mid x 100 = (1.1000 - 1.0780) / 1.1000 x 100 = 0.0220 / 1.1 x 100 = 2 percent exactly.
it('Regulation (EU) 2019/518 Article 3a(1): the markup is a percentage over the reference rate, 1.0780 against 1.1000 is 2.00', () => {
  const { summary } = calc();
  expect(summary.markupPercent).toBe('2.00');
  expect(summary.direction).toBe('worse');
  const exact = markup(new D('1000'), new D('1.0780'), new D('1.1000'));
  expect(exact.markupPercent.eq(2)).toBe(true);
  // The percentage is over the reference rate, not over the offered rate (which would be 2.04).
  expect(exact.markupPercent.eq(new D('0.022').div('1.078').times(100))).toBe(false);
  // The decimals choice sets the places shown, not the figure.
  expect(calc({ decimals: '0' }).summary.markupPercent).toBe('2');
  expect(calc({ decimals: '4' }).summary.markupPercent).toBe('2.0000');
  expect(calc({ offered: '1.0781' }).summary.markupPercent).toBe('1.99');
});

// Derived by hand: 1000 x 1.0780 = 1078 and 1000 x 1.1000 = 1100 in the target currency; the hidden cost in the target
// currency is 1000 x (1.1 - 1.078) = 1000 x 0.022 = 22; in the source currency 22 / 1.1 = 20.
it('the hidden cost is shown in both currencies: 1000 at 1.0780 against 1.1000 costs 22.00 in the target and 20.00 in the source', () => {
  const { summary } = calc();
  expect(summary.convertedOffered).toBe('1078.00');
  expect(summary.convertedMid).toBe('1100.00');
  expect(summary.hiddenTarget).toBe('22.00');
  expect(summary.hiddenSource).toBe('20.00');
  expect(summary.source).toBe('EUR');
  expect(summary.target).toBe('USD');
  const exact = markup(new D('1000'), new D('1.0780'), new D('1.1000'));
  expect(exact.convertedOffered.toFixed()).toBe('1078');
  expect(exact.convertedMid.toFixed()).toBe('1100');
  expect(exact.hiddenTarget.toFixed()).toBe('22');
  expect(exact.hiddenSource.toFixed()).toBe('20');
});

it('an offered rate equal to the reference rate is a markup of exactly 0.00 and no hidden cost', () => {
  const { summary, working } = calc({ offered: '1.1000' });
  expect(summary.markupPercent).toBe('0.00');
  expect(summary.hiddenTarget).toBe('0.00');
  expect(summary.hiddenSource).toBe('0.00');
  expect(summary.direction).toBe('equal');
  // Equal in value even when typed differently.
  expect(calc({ offered: '1.10' }).summary.direction).toBe('equal');
  expect(working).toContain('no hidden cost');
  const exact = markup(new D('1000'), new D('1.1'), new D('1.1'));
  expect(exact.markupPercent.isZero()).toBe(true);
  expect(exact.hiddenTarget.isZero()).toBe(true);
  expect(exact.hiddenSource.isZero()).toBe(true);
});

it('an offered rate better than the reference gives a negative markup with a note, never a reordered result', () => {
  const { summary, working } = calc({ offered: '1.12', mid: '1.10' });
  // (1.10 - 1.12) / 1.10 x 100 = -1.8181..., the hidden cost 1000 x -0.02 = -20 and -20 / 1.1 = -18.1818...
  expect(summary.markupPercent).toBe('-1.82');
  expect(summary.hiddenTarget).toBe('-20.00');
  expect(summary.hiddenSource).toBe('-18.18');
  expect(summary.direction).toBe('better');
  // The two rates stay where they were typed: nothing is swapped.
  expect(summary.offered).toBe('1.12');
  expect(summary.mid).toBe('1.10');
  expect(summary.convertedOffered).toBe('1120.00');
  expect(summary.convertedMid).toBe('1100.00');
  expect(summary.notes.some((n) => /better than the reference rate/i.test(n))).toBe(true);
  expect(working).toContain('better than the reference rate');
  // A worse offer carries no such note.
  expect(calc().summary.notes.some((n) => /better than the reference rate/i.test(n))).toBe(false);
});

it('rates are read as target units per one source unit, and a zero or blank rate is refused naming it', () => {
  const { working } = calc();
  expect(working).toContain('units of the target currency per 1 unit of the source currency');
  // Swapping the direction gives a different (and for these numbers a negative) answer: the page does not reorder.
  expect(calc({ offered: '1.1000', mid: '1.0780' }).summary.markupPercent).toBe('-2.04');

  expect(refused(() => calculateMarkup({ ...BASE, offered: '0' })).field).toBe('Rate offered (target per 1 source)');
  expect(refused(() => calculateMarkup({ ...BASE, offered: '0.000' })).message).toMatch(/above zero/);
  expect(refused(() => calculateMarkup({ ...BASE, mid: '0' })).field).toBe(
    'Reference mid-market rate (target per 1 source)',
  );
  const blankOffered = refused(() => calculateMarkup({ ...BASE, offered: '' }));
  expect(blankOffered.field).toBe('Rate offered (target per 1 source)');
  expect(blankOffered.message).toMatch(/missing/);
  const blankMid = refused(() => calculateMarkup({ ...BASE, mid: '   ' }));
  expect(blankMid.field).toBe('Reference mid-market rate (target per 1 source)');
  expect(blankMid.message).toMatch(/missing/);

  // Nothing typed gives no output; an amount alone names the first missing rate.
  expect(calculateMarkup({})).toBeNull();
  expect(calculateMarkup({ source: 'EUR', target: 'USD', offered: '1.2', mid: '1.1', amount: '' })).toBeNull();
  expect(refused(() => calculateMarkup({ amount: '100' })).field).toBe('Rate offered (target per 1 source)');

  // An amount of zero, a negative rate, an exponent and too many digits are refused naming the field.
  expect(refused(() => calculateMarkup({ ...BASE, amount: '0' })).field).toBe('Amount in the source currency');
  expect(refused(() => calculateMarkup({ ...BASE, offered: '-1.07' })).field).toBe(
    'Rate offered (target per 1 source)',
  );
  expect(refused(() => calculateMarkup({ ...BASE, mid: '1e2' })).field).toBe(
    'Reference mid-market rate (target per 1 source)',
  );
  expect(refused(() => calculateMarkup({ ...BASE, amount: '1234567890123456' })).message).toMatch(/too many digits/);
  expect(refused(() => calculateMarkup({ ...BASE, source: 'EU' })).field).toBe('Source currency (ISO 4217 code)');
  expect(refused(() => calculateMarkup({ ...BASE, target: 'ZZZ1' })).field).toBe('Target currency (ISO 4217 code)');
  expect(refused(() => calculateMarkup({ ...BASE, decimals: '5' })).field).toBe('Decimal places of the percentage');
});

it('each currency shows its own minor unit: JPY amounts have no decimals and BHD three', () => {
  // 100000 yen at 0.0025 against 0.0026 dinars per yen: 250 and 260 dinars; 100000 x 0.0001 = 10 dinars, and
  // 10 / 0.0026 = 3846.153846... yen; the markup 0.0001 / 0.0026 x 100 = 3.846153...
  const { summary } = calc({ amount: '100000', source: 'JPY', target: 'BHD', offered: '0.0025', mid: '0.0026' });
  expect(summary.sourceDecimals).toBe(0);
  expect(summary.targetDecimals).toBe(3);
  expect(summary.convertedOffered).toBe('250.000');
  expect(summary.convertedMid).toBe('260.000');
  expect(summary.hiddenTarget).toBe('10.000');
  expect(summary.hiddenSource).toBe('3846');
  expect(summary.markupPercent).toBe('3.85');
  expect(summary.amount).toBe('100000');
  // The other way round: euros to yen show no decimals on the target side.
  const toYen = calc({ amount: '1000', source: 'EUR', target: 'JPY', offered: '160.5', mid: '161' });
  expect(toYen.summary.convertedOffered).toBe('160500');
  expect(toYen.summary.convertedMid).toBe('161000');
  expect(toYen.summary.hiddenTarget).toBe('500');
  expect(toYen.summary.hiddenSource).toBe('3.11');
});

it('0.1 plus 0.2 is exactly 0.3 through this tool', () => {
  // The float 0.1 x 3 is wrong; the tool's own path is exact: 0.1 converted at 1 is 0.1, the hidden cost against a
  // reference of 3 is 0.1 x (3 - 1) = 0.2, and 0.1 plus 0.2 is exactly the reference conversion 0.1 x 3 = 0.3.
  expect(0.1 * 3).not.toBe(0.3);
  expect(0.1 * 3).toBe(0.30000000000000004);
  const exact = markup(new D('0.1'), new D('1'), new D('3'));
  expect(exact.convertedOffered.toFixed()).toBe('0.1');
  expect(exact.hiddenTarget.toFixed()).toBe('0.2');
  expect(exact.convertedMid.toFixed()).toBe('0.3');
  expect(exact.convertedOffered.plus(exact.hiddenTarget).eq(exact.convertedMid)).toBe(true);
  const { summary } = calc({ amount: '0.1', source: 'BHD', target: 'BHD', offered: '1', mid: '3' });
  expect(summary.convertedOffered).toBe('0.100');
  expect(summary.hiddenTarget).toBe('0.200');
  expect(summary.convertedMid).toBe('0.300');
});

it('the working shows the formulas with the typed numbers and cites the regulation', () => {
  const { working } = calc();
  expect(working).toContain('Regulation (EU) 2019/518');
  expect(working).toContain('1000 x 1.0780');
  expect(working).toContain('(1.1000 - 1.0780) / 1.1000 x 100');
  expect(working).toContain('half away from zero');
  expect(working).not.toMatch(/recommend|best|you should/i);
});
