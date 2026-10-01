import meta from './meta.json';
import {
  D,
  type Dec,
  MoneyInputError,
  isBlank,
  formatMoney,
  parseCount,
  parseCurrency,
  parseDecimal,
  roundTo,
  toPlain,
  minorUnits,
} from './money';

export { meta, D, MoneyInputError, isBlank, formatMoney };
export type { Dec };

/** Decimal places used for the unrounded figures in the working. */
const WORKING_PLACES = 10;

/** The five numbers a visitor can type. */
export type AdInput = 'spend' | 'impressions' | 'clicks' | 'conversions' | 'revenue';

/** The page's field label for each number, used in error messages. */
const FIELD: Record<AdInput, string> = {
  spend: 'Ad spend',
  impressions: 'Impressions',
  clicks: 'Clicks',
  conversions: 'Conversions',
  revenue: 'Revenue from the ads',
};
/** How a number is named in the middle of a sentence. */
const PHRASE: Record<AdInput, string> = {
  spend: 'ad spend',
  impressions: 'impressions',
  clicks: 'clicks',
  conversions: 'conversions',
  revenue: 'revenue',
};
const FIELD_DECIMALS = 'Decimal places';
const FIELD_CURRENCY = 'Currency (ISO 4217 code)';

export interface AdMetricDefinition {
  id: 'cpc' | 'cpm' | 'ctr' | 'cvr' | 'cpa' | 'roas';
  name: string;
  /** The formula as text, for the page. */
  formula: string;
  /** The numerator, then the denominator: the two numbers the ratio needs. */
  needs: readonly [AdInput, AdInput];
  /** The number that must be above 0. */
  nonZero: AdInput;
  /** What the numerator is multiplied by before dividing: 1, 100 (a percent) or 1000 (per thousand). */
  scale: 1 | 100 | 1000;
  /** `cost` is an amount, `percent` a rate in percent, `ratio` a plain ratio. */
  kind: 'cost' | 'percent' | 'ratio';
}

/** The six metrics in the order they are always shown. */
export const AD_METRICS: readonly AdMetricDefinition[] = [
  {
    id: 'cpc',
    name: 'Cost per click',
    formula: 'spend / clicks',
    needs: ['spend', 'clicks'],
    nonZero: 'clicks',
    scale: 1,
    kind: 'cost',
  },
  {
    id: 'cpm',
    name: 'Cost per thousand impressions',
    formula: 'spend / impressions x 1000',
    needs: ['spend', 'impressions'],
    nonZero: 'impressions',
    scale: 1000,
    kind: 'cost',
  },
  {
    id: 'ctr',
    name: 'Click-through rate',
    formula: 'clicks / impressions x 100',
    needs: ['clicks', 'impressions'],
    nonZero: 'impressions',
    scale: 100,
    kind: 'percent',
  },
  {
    id: 'cvr',
    name: 'Conversion rate',
    formula: 'conversions / clicks x 100',
    needs: ['conversions', 'clicks'],
    nonZero: 'clicks',
    scale: 100,
    kind: 'percent',
  },
  {
    id: 'cpa',
    name: 'Cost per acquisition',
    formula: 'spend / conversions',
    needs: ['spend', 'conversions'],
    nonZero: 'conversions',
    scale: 1,
    kind: 'cost',
  },
  {
    id: 'roas',
    name: 'Return on ad spend',
    formula: 'revenue / spend',
    needs: ['revenue', 'spend'],
    nonZero: 'spend',
    scale: 1,
    kind: 'ratio',
  },
];

/** The five numbers as exact values, `null` for a number that was not typed. */
export type AdInputs = Record<AdInput, Dec | null>;

export interface AdOutcome {
  id: AdMetricDefinition['id'];
  name: string;
  formula: string;
  /** The exact value, or null when it cannot be worked out. */
  value: Dec | null;
  /** What is missing, or which number must be above 0, when `value` is null. */
  reason: string | null;
}

/** Works out each metric whose numbers are present and whose denominator is above 0, in the fixed order. */
export function adMetrics(inputs: AdInputs): AdOutcome[] {
  return AD_METRICS.map((metric) => {
    const [top, bottom] = metric.needs;
    const base = { id: metric.id, name: metric.name, formula: metric.formula };
    const missing = metric.needs.filter((key) => inputs[key] === null).map((key) => PHRASE[key]);
    if (missing.length > 0) return { ...base, value: null, reason: `Needs ${missing.join(' and ')}.` };
    const numerator = inputs[top]!;
    const denominator = inputs[bottom]!;
    if (denominator.isZero()) {
      return {
        ...base,
        value: null,
        reason: `${FIELD[metric.nonZero]} is 0, so ${metric.name.toLowerCase()} cannot be worked out: type a number above 0.`,
      };
    }
    return { ...base, value: numerator.times(metric.scale).div(denominator), reason: null };
  });
}

/** The values the page holds, exactly as typed. Any of them may be left out. */
export interface AdTexts {
  spend?: string;
  impressions?: string;
  clicks?: string;
  conversions?: string;
  revenue?: string;
  /** Decimal places of rates and ratios, 0 to 4, 2 by default. */
  decimals?: string;
  currency?: string;
}

export interface AdRow {
  id: AdMetricDefinition['id'];
  name: string;
  formula: string;
  /** The formula with the typed numbers and the exact result, or `not worked out`. */
  withNumbers: string;
  /** The rounded figure as plain decimal text, or null. */
  value: string | null;
  /** The figure with its unit for display, or null. */
  display: string | null;
  /** What is missing or must be above 0, or null when the metric was worked out. */
  message: string | null;
}

export interface AdSummary {
  currency: string;
  /** Decimal places of rates and ratios. */
  decimals: number;
  /** Decimal places of costs: the larger of the currency's smallest unit and `decimals`. */
  costPlaces: number;
  /** How many of the six metrics were worked out. */
  computed: number;
  warnings: string[];
  /** Set when numbers were typed but no metric can be worked out yet. */
  notice: string | null;
}

export interface AdResult {
  summary: AdSummary;
  rows: AdRow[];
  /** The formulas, the typed numbers put into them, and how the figures are rounded. */
  working: string;
}

/** A figure for the working: rounded half away from zero to 10 places with trailing zeros dropped. */
function exact(x: Dec): string {
  return roundTo(x, WORKING_PLACES).toFixed();
}

/** Reads a whole number of 0 or more with up to 15 digits, digits only. */
function parseWhole(text: string, field: string): Dec {
  const t = text.trim();
  if (!/^\d+$/.test(t)) {
    throw new MoneyInputError(field, 'type a whole number of 0 or more, digits only (no dot, comma or sign)');
  }
  return parseDecimal(t, field, { maxInt: 15, maxFrac: 0 });
}

/** Works out the metrics from the page's typed values, or returns null when every number is blank. */
export function calculateAdMetrics(texts: AdTexts): AdResult | null {
  const typed = (text: string | undefined) => text !== undefined && !isBlank(text);
  const keys: AdInput[] = ['spend', 'impressions', 'clicks', 'conversions', 'revenue'];
  if (!keys.some((key) => typed(texts[key]))) return null;

  const currency = parseCurrency(texts.currency ?? 'USD', FIELD_CURRENCY);
  const decimals = typed(texts.decimals) ? parseCount(texts.decimals!, FIELD_DECIMALS, 0, 4) : 2;
  const costPlaces = Math.max(minorUnits(currency), decimals);

  const inputs: AdInputs = { spend: null, impressions: null, clicks: null, conversions: null, revenue: null };
  for (const key of keys) {
    const text = texts[key];
    if (!typed(text)) continue;
    inputs[key] =
      key === 'spend' || key === 'revenue' ? parseDecimal(text!, FIELD[key]) : parseWhole(text!, FIELD[key]);
  }

  const outcomes = adMetrics(inputs);
  const rows: AdRow[] = [];
  const working: string[] = [
    'Each metric is worked out from the numbers you typed, in exact decimal arithmetic, and rounded only when shown. A metric needs its own numbers and a denominator above 0.',
    '',
  ];
  for (const [index, outcome] of outcomes.entries()) {
    const metric = AD_METRICS[index]!;
    const [top, bottom] = metric.needs;
    let withNumbers = 'not worked out';
    let value: string | null = null;
    let display: string | null = null;
    working.push(`${metric.name.toLowerCase()} = ${metric.formula}`);
    if (outcome.value !== null) {
      const scale = metric.scale === 1 ? '' : ` x ${metric.scale}`;
      withNumbers = `${inputs[top]!.toFixed()} / ${inputs[bottom]!.toFixed()}${scale} = ${exact(outcome.value)}`;
      working.push(`  ${metric.name.toLowerCase()} = ${withNumbers}`);
      if (metric.kind === 'cost') {
        value = toPlain(outcome.value, costPlaces);
        display = `${value} ${currency}`;
      } else if (metric.kind === 'percent') {
        value = toPlain(outcome.value, decimals);
        display = `${value} %`;
      } else {
        value = toPlain(outcome.value, decimals);
        const percent = outcome.value.times(100);
        display = `${value} (${toPlain(percent, decimals)} %)`;
        working.push(`  as a percent: ${exact(outcome.value)} x 100 = ${exact(percent)} percent`);
      }
    } else {
      working.push(`  ${outcome.reason}`);
    }
    working.push('');
    rows.push({
      id: metric.id,
      name: metric.name,
      formula: metric.formula,
      withNumbers,
      value,
      display,
      message: outcome.reason,
    });
  }
  working.push(
    `Costs are rounded half away from zero to ${costPlaces} decimal places (the larger of the smallest unit of ${currency} and the decimal places chosen), and rates and ratios to ${decimals} decimal places; nothing is rounded before that.`,
  );

  const warnings: string[] = [];
  if (inputs.clicks !== null && inputs.impressions !== null && inputs.clicks.gt(inputs.impressions)) {
    warnings.push(
      `Clicks (${inputs.clicks.toFixed()}) are more than impressions (${inputs.impressions.toFixed()}), so the click-through rate is above 100 percent; the ratios are still worked out from what you typed.`,
    );
  }
  if (inputs.conversions !== null && inputs.clicks !== null && inputs.conversions.gt(inputs.clicks)) {
    warnings.push(
      `Conversions (${inputs.conversions.toFixed()}) are more than clicks (${inputs.clicks.toFixed()}), so the conversion rate is above 100 percent; the ratios are still worked out from what you typed.`,
    );
  }

  const computed = outcomes.filter((outcome) => outcome.value !== null).length;
  const notice =
    computed === 0
      ? 'Nothing can be worked out yet. Each ratio needs two numbers: ad spend with clicks, impressions or conversions, clicks with impressions or conversions, or revenue with ad spend. Type one more.'
      : null;

  return {
    summary: { currency, decimals, costPlaces, computed, warnings, notice },
    rows,
    working: working.join('\n'),
  };
}
