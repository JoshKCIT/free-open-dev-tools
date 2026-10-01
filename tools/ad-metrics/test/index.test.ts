import { it, expect } from 'vitest';
import { AD_METRICS, adMetrics, calculateAdMetrics, meta, type AdInputs, type AdTexts } from '../src/index';
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

const full: AdTexts = {
  spend: '500',
  impressions: '100000',
  clicks: '2000',
  conversions: '50',
  revenue: '2000',
  currency: 'USD',
};
const calc = (over: AdTexts = {}, base: AdTexts = full) => {
  const result = calculateAdMetrics({ ...base, ...over });
  expect(result).not.toBeNull();
  return result!;
};
/** The rows by metric id. */
const byId = (over: AdTexts = {}, base: AdTexts = full) => {
  const { rows } = calc(over, base);
  return Object.fromEntries(rows.map((row) => [row.id, row]));
};
const only = (texts: AdTexts) => byId({}, { currency: 'USD', ...texts });

it('meta: id, name, dependency pin, no standards body and the two required sentences in limits', () => {
  expect(meta.id).toBe('ad-metrics');
  expect(meta.name).toBe('Ad Campaign Metrics');
  expect(meta.dependencies['decimal.js']).toBe('10.6.0');
  expect(meta.standards).toEqual([]);
  expect(meta.testNotes).toMatch(/no standards body/i);
  expect(meta.limits.length).toBeGreaterThanOrEqual(3);
  expect(meta.limits.some((l: string) => /half away from zero/i.test(l))).toBe(true);
  expect(meta.limits.some((l: string) => /not financial, tax or legal advice; it ignores /i.test(l))).toBe(true);
});

it('the usage example in meta.json shows what the code returns', () => {
  const { rows } = calc();
  expect(rows.map((row) => `${row.name}: ${row.display}`)).toEqual([
    'Cost per click: 0.25 USD',
    'Cost per thousand impressions: 5.00 USD',
    'Click-through rate: 2.00 %',
    'Conversion rate: 2.50 %',
    'Cost per acquisition: 10.00 USD',
    'Return on ad spend: 4.00 (400.00 %)',
  ]);
  expect(meta.usage).toContain(
    "'Cost per click: 0.25 USD', 'Cost per thousand impressions: 5.00 USD', 'Click-through rate: 2.00 %'",
  );
  expect(meta.usage).toContain(
    "'Conversion rate: 2.50 %', 'Cost per acquisition: 10.00 USD', 'Return on ad spend: 4.00 (400.00 %)'",
  );
});

// By hand, with spend 500, impressions 100,000, clicks 2,000, conversions 50 and revenue 2,000:
//   cost per click                 500 / 2000                     = 0.25
//   cost per thousand impressions  500 / 100000 x 1000 = 0.005 x 1000 = 5
//   click-through rate             2000 / 100000 x 100             = 2 percent
//   conversion rate                50 / 2000 x 100                 = 2.5 percent
//   cost per acquisition           500 / 50                        = 10
//   return on ad spend             2000 / 500                      = 4, which is 400 percent
it('every ratio follows its stated formula: 500 spend, 100000 impressions, 2000 clicks, 50 conversions and 2000 revenue', () => {
  const r = byId();
  expect(r.cpc!.value).toBe('0.25');
  expect(r.cpm!.value).toBe('5.00');
  expect(r.ctr!.value).toBe('2.00');
  expect(r.cvr!.value).toBe('2.50');
  expect(r.cpa!.value).toBe('10.00');
  expect(r.roas!.value).toBe('4.00');
  expect(r.roas!.display).toBe('4.00 (400.00 %)');
  // The exact values underneath.
  const exact = adMetrics({
    spend: new D(500),
    impressions: new D(100000),
    clicks: new D(2000),
    conversions: new D(50),
    revenue: new D(2000),
  });
  expect(exact.map((m) => m.value!.toString())).toEqual(['0.25', '5', '2', '2.5', '10', '4']);
  // The decimal places option applies to rates and ratios.
  expect(byId({ decimals: '0' }).ctr!.value).toBe('2');
  expect(byId({ decimals: '4' }).cvr!.value).toBe('2.5000');
});

it('metrics are always listed in the same order and each one shows its formula with the numbers typed', () => {
  expect(AD_METRICS.map((m) => m.name)).toEqual([
    'Cost per click',
    'Cost per thousand impressions',
    'Click-through rate',
    'Conversion rate',
    'Cost per acquisition',
    'Return on ad spend',
  ]);
  expect(AD_METRICS.map((m) => m.formula)).toEqual([
    'spend / clicks',
    'spend / impressions x 1000',
    'clicks / impressions x 100',
    'conversions / clicks x 100',
    'spend / conversions',
    'revenue / spend',
  ]);
  const ids = AD_METRICS.map((m) => m.id);
  // Whatever subset is typed, the rows come in the same order.
  const subsets: AdTexts[] = [
    { revenue: '2000', spend: '500' },
    { conversions: '50', clicks: '2000' },
    { impressions: '100000', clicks: '2000', spend: '500' },
    { spend: '500' },
    full,
  ];
  for (const subset of subsets) expect(calc({}, { currency: 'USD', ...subset }).rows.map((row) => row.id)).toEqual(ids);
  const r = byId();
  expect(r.cpc!.formula).toBe('spend / clicks');
  expect(r.cpc!.withNumbers).toBe('500 / 2000 = 0.25');
  expect(r.cpm!.withNumbers).toBe('500 / 100000 x 1000 = 5');
  expect(r.ctr!.withNumbers).toBe('2000 / 100000 x 100 = 2');
  expect(r.cvr!.withNumbers).toBe('50 / 2000 x 100 = 2.5');
  expect(r.cpa!.withNumbers).toBe('500 / 50 = 10');
  expect(r.roas!.withNumbers).toBe('2000 / 500 = 4');
  const { working } = calc();
  for (const line of ['cost per click = spend / clicks', 'cost per click = 500 / 2000 = 0.25', 'half away from zero']) {
    expect(working).toContain(line);
  }
});

it('only metrics whose inputs are present are computed, and each missing one names what it needs', () => {
  const r = only({ spend: '500', clicks: '2000' });
  expect(r.cpc!.value).toBe('0.25');
  expect(r.cpc!.message).toBeNull();
  expect(r.cpm!.value).toBeNull();
  expect(r.cpm!.message).toBe('Needs impressions.');
  expect(r.ctr!.message).toBe('Needs impressions.');
  expect(r.cvr!.message).toBe('Needs conversions.');
  expect(r.cpa!.message).toBe('Needs conversions.');
  expect(r.roas!.message).toBe('Needs revenue.');
  // Two missing numbers are both named.
  expect(only({ revenue: '1' }).cpc!.message).toBe('Needs ad spend and clicks.');
  expect(only({ clicks: '2000' }).cpc!.message).toBe('Needs ad spend.');
  expect(only({ revenue: '10' }).roas!.message).toBe('Needs ad spend.');
  expect(only({ impressions: '100' }).ctr!.message).toBe('Needs clicks.');
  expect(only({ conversions: '5' }).cvr!.message).toBe('Needs clicks.');
  // Values typed but nothing can be worked out: the page is told what to add.
  const none = calc({}, { currency: 'USD', spend: '500' });
  expect(none.rows.every((row) => row.value === null)).toBe(true);
  expect(none.summary.computed).toBe(0);
  expect(none.summary.notice).toContain('Nothing can be worked out yet');
  expect(none.summary.notice).toContain('clicks');
  expect(calc().summary.notice).toBeNull();
  expect(calc().summary.computed).toBe(6);
});

it('a zero denominator gives a plain message, never Infinity', () => {
  const zeroClicks = only({ spend: '500', clicks: '0', conversions: '50' });
  expect(zeroClicks.cpc!.value).toBeNull();
  expect(zeroClicks.cpc!.message).toBe('Clicks is 0, so cost per click cannot be worked out: type a number above 0.');
  expect(zeroClicks.cvr!.message).toContain('Clicks is 0');
  const zeroImpressions = only({ spend: '500', impressions: '0', clicks: '5' });
  expect(zeroImpressions.cpm!.message).toContain('Impressions is 0');
  expect(zeroImpressions.ctr!.message).toContain('Impressions is 0');
  expect(only({ spend: '500', conversions: '0' }).cpa!.message).toContain('Conversions is 0');
  const zeroSpend = only({ spend: '0', revenue: '100' });
  expect(zeroSpend.roas!.message).toContain('Ad spend is 0');
  // Zero in the numerator is a real answer: zero clicks out of some impressions is a rate of 0, 0 spend a cost of 0.
  const zeroTop = only({ spend: '0', impressions: '1000', clicks: '0', conversions: '3' });
  expect(zeroTop.ctr!.value).toBe('0.00');
  expect(zeroTop.cpm!.value).toBe('0.00');
  for (const texts of [
    { spend: '500', clicks: '0', impressions: '0', conversions: '0', revenue: '0' },
    { spend: '0', clicks: '0', impressions: '0', conversions: '0', revenue: '0' },
  ]) {
    const result = calc({}, { currency: 'USD', ...texts });
    const everything = JSON.stringify(result) + result.working;
    expect(everything).not.toMatch(/Infinity|NaN/);
  }
  const exact = adMetrics({ spend: new D(5), impressions: null, clicks: new D(0), conversions: null, revenue: null });
  expect(exact[0]!.value).toBeNull();
  expect(exact[0]!.reason).toContain('Clicks is 0');
});

it('clicks equal to impressions is a 100 click-through rate with no warning, and more clicks than impressions is a warning', () => {
  const equal = calc({}, { currency: 'USD', impressions: '100', clicks: '100' });
  expect(equal.rows.find((row) => row.id === 'ctr')!.value).toBe('100.00');
  expect(equal.summary.warnings).toEqual([]);
  const more = calc({}, { currency: 'USD', impressions: '100', clicks: '101' });
  expect(more.rows.find((row) => row.id === 'ctr')!.value).toBe('101.00');
  expect(more.summary.warnings).toHaveLength(1);
  expect(more.summary.warnings[0]).toContain('more than impressions');
  // Conversions above clicks is the second warning, and both can appear together in a fixed order.
  const conv = calc({}, { currency: 'USD', clicks: '10', conversions: '11' });
  expect(conv.summary.warnings).toHaveLength(1);
  expect(conv.summary.warnings[0]).toContain('more than clicks');
  expect(calc({}, { currency: 'USD', clicks: '10', conversions: '10' }).summary.warnings).toEqual([]);
  const both = calc({}, { currency: 'USD', impressions: '1', clicks: '2', conversions: '3' });
  expect(both.summary.warnings.map((w) => /impressions|clicks/.exec(w)![0])).toEqual(['impressions', 'clicks']);
  expect(both.rows.find((row) => row.id === 'cvr')!.value).toBe('150.00');
});

it('counts must be whole numbers and nothing typed shows nothing', () => {
  expect(refused(() => calculateAdMetrics({ ...full, impressions: '12.5' })).field).toBe('Impressions');
  expect(refused(() => calculateAdMetrics({ ...full, clicks: '-1' })).field).toBe('Clicks');
  expect(refused(() => calculateAdMetrics({ ...full, conversions: '1,000' })).field).toBe('Conversions');
  expect(refused(() => calculateAdMetrics({ ...full, impressions: '1e3' })).field).toBe('Impressions');
  expect(refused(() => calculateAdMetrics({ ...full, clicks: '1234567890123456' })).field).toBe('Clicks');
  expect(refused(() => calculateAdMetrics({ ...full, spend: '-5' })).field).toBe('Ad spend');
  expect(refused(() => calculateAdMetrics({ ...full, revenue: 'abc' })).field).toBe('Revenue from the ads');
  expect(refused(() => calculateAdMetrics({ ...full, decimals: '5' })).field).toBe('Decimal places');
  expect(refused(() => calculateAdMetrics({ ...full, currency: 'DOLLARS' })).field).toBe('Currency (ISO 4217 code)');
  // 15 digits is the most, and it stays exact.
  expect(calc({ impressions: '999999999999999', clicks: '1' }).summary.computed).toBe(6);
  // Nothing typed, or only blanks and a currency, shows nothing.
  expect(calculateAdMetrics({})).toBeNull();
  expect(
    calculateAdMetrics({ spend: '', impressions: ' ', clicks: '', conversions: '', revenue: '', currency: 'USD' }),
  ).toBeNull();
  expect(calculateAdMetrics({ currency: 'EUR', decimals: '4' })).toBeNull();
});

// By hand: spend 1 over 3 impressions, times 1000: 1 / 3 x 1000 = 333.333..., shown 333.33 at 2 places and 333.3333 at 4.
it('cost per thousand impressions is exact: 1 spend over 3 impressions is 333.33', () => {
  const r = only({ spend: '1', impressions: '3' });
  expect(r.cpm!.value).toBe('333.33');
  expect(r.cpm!.display).toBe('333.33 USD');
  expect(byId({ decimals: '4' }, { currency: 'USD', spend: '1', impressions: '3' }).cpm!.value).toBe('333.3333');
  const exact = adMetrics({ spend: new D(1), impressions: new D(3), clicks: null, conversions: null, revenue: null });
  expect(exact[1]!.value!.toFixed(10)).toBe('333.3333333');
  // The cost is shown to the larger of the currency's smallest unit and the chosen decimal places.
  expect(byId({ decimals: '0' }, { currency: 'JPY', spend: '1', impressions: '3' }).cpm!.value).toBe('333');
  expect(byId({ decimals: '4' }, { currency: 'JPY', spend: '1', impressions: '3' }).cpm!.value).toBe('333.3333');
});

// In JavaScript floating point 0.3 / 0.1 is 2.9999999999999996. Revenue of 0.3, the sum of 0.1 and 0.2, over a spend of
// 0.1 is a return on ad spend of exactly 3.
it('0.1 plus 0.2 is exactly 0.3 through this tool', () => {
  expect(0.3 / 0.1).toBe(2.9999999999999996);
  const exact = adMetrics({
    spend: new D('0.1'),
    impressions: null,
    clicks: null,
    conversions: null,
    revenue: new D('0.1').plus('0.2'),
  });
  expect(exact[5]!.value!.toString()).toBe('3');
  const r = only({ spend: '0.1', revenue: '0.3' });
  expect(r.roas!.withNumbers).toBe('0.3 / 0.1 = 3');
  expect(r.roas!.display).toBe('3.00 (300.00 %)');
});

it('only arithmetic is shown: no wording recommends or rates anything', () => {
  const result = calc(
    {},
    { currency: 'USD', impressions: '1', clicks: '2', conversions: '3', spend: '4', revenue: '5' },
  );
  const texts = [
    result.working,
    ...result.summary.warnings,
    ...result.rows.map((row) => `${row.name} ${row.formula} ${row.withNumbers} ${row.display} ${row.message ?? ''}`),
    calc({}, { currency: 'USD', spend: '5' }).summary.notice ?? '',
    meta.about,
    ...meta.supports,
    ...meta.limits,
  ].join('\n');
  expect(texts).not.toMatch(
    /\b(should|recommend\w*|best|better|worse|good|bad|worth|raise|increase|reduce|cut|improve)\b/i,
  );
});

// Keep the inputs type honest for callers that build it by hand.
it('AdInputs has one slot for each number the page holds', () => {
  const inputs: AdInputs = { spend: null, impressions: null, clicks: null, conversions: null, revenue: null };
  expect(Object.keys(inputs)).toEqual(['spend', 'impressions', 'clicks', 'conversions', 'revenue']);
  expect(adMetrics(inputs).every((m) => m.value === null && m.reason !== null)).toBe(true);
});
