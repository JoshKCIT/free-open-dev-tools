import meta from './meta.json';
import {
  D,
  type Dec,
  MoneyInputError,
  isBlank,
  formatMoney,
  parseDecimal,
  parseCurrency,
  parseRows,
  cellDecimal,
  cellText,
  toPlain,
  minorUnits,
} from './money';

export { meta, D, MoneyInputError, isBlank, formatMoney };
export type { Dec };

/** The most cash flows accepted. */
export const MAX_FLOWS = 200;

/** Longest label accepted for a cash flow, so a table cell stays readable. */
const MAX_LABEL = 60;
/** A present value, running total or net present value at or above this is refused: too large to show exactly. */
const TOO_LARGE = new D('1e18');
/** A bracket for a rate is split until it is narrower than this in the rate. */
const TOLERANCE = new D('1e-12');
/** The scan of 1 + r runs over 10^(k / 20) for k from -120 to 60: 181 points from 0.000001 to 1000. */
const GRID_FIRST = -120;
const GRID_LAST = 60;
const GRID_STEPS_PER_TEN = 20;

const FIELD_FLOWS = 'Cash flows';
const FIELD_RATE = 'Discount rate per period (percent)';
const FIELD_CURRENCY = 'Currency (ISO 4217 code)';

const ZERO = new D(0);
const ONE = new D(1);

/** One typed cash flow: its optional label, its amount and its line in the text. */
export type Flow = { label: string; amount: Dec; line: number };

/**
 * Reads the cash flow lines: one flow per line, either an amount or a label, a vertical bar and an amount. Amounts
 * may be negative (money paid out) and may have any number of places up to 12. Blank lines are skipped but counted.
 * A problem names the line and the column of the cell. An empty text gives no flows.
 */
export function parseFlows(text: string): Flow[] {
  const rows = parseRows(text, FIELD_FLOWS, { columns: ['label', 'amount'], required: 1, maxRows: MAX_FLOWS });
  return rows.map((row) => {
    const labelled = row.cells.length > 1;
    const label = labelled ? cellText(row, 0) : '';
    if (label.length > MAX_LABEL) {
      throw new MoneyInputError(FIELD_FLOWS, `label: at most ${MAX_LABEL} characters`, {
        line: row.line,
        column: row.starts[0] ?? 1,
      });
    }
    const amount = cellDecimal(row, labelled ? 1 : 0, FIELD_FLOWS, 'amount', { allowNegative: true });
    return { label, amount, line: row.line };
  });
}

/** 1 plus the per-period rate as a fraction, from a rate in percent. A rate of -100 percent or less is refused. */
function growthFactor(ratePercent: Dec): Dec {
  if (ratePercent.lte(-100)) {
    throw new MoneyInputError(FIELD_RATE, 'must be above -100 percent, a rate of -100 percent or less cannot discount');
  }
  return ratePercent.div(100).plus(1);
}

/**
 * Net present value with the first flow in period 0, which is not discounted (OMB Circular A-94 Appendix B,
 * "1/(1 + discount rate)^t where t is the year"): the sum over t of CF_t / (1 + r)^t, with the rate given in percent.
 * Exact, not rounded.
 */
export function npv(ratePercent: Dec, flows: Dec[]): Dec {
  const growth = growthFactor(ratePercent);
  let total = ZERO;
  flows.forEach((flow, t) => {
    total = total.plus(flow.div(growth.pow(t)));
  });
  return total;
}

/**
 * OpenFormula 6.12.30 NPV: the sum over i = 1..N of Values_i / (1 + Rate)^i, so the first value is discounted by one
 * period. The rate is given in percent. Exact, not rounded. This tool's `npv` equals the first flow plus this
 * function applied to the flows after the first.
 */
export function openFormulaNpv(ratePercent: Dec, values: Dec[]): Dec {
  const growth = growthFactor(ratePercent);
  let total = ZERO;
  values.forEach((value, index) => {
    total = total.plus(value.div(growth.pow(index + 1)));
  });
  return total;
}

/** How many times the flows change sign, zeros ignored. It bounds the number of rates (Descartes' rule of signs). */
export function signChanges(flows: Dec[]): number {
  let changes = 0;
  let previous = 0;
  for (const flow of flows) {
    const sign = flow.isZero() ? 0 : flow.isPos() ? 1 : -1;
    if (sign === 0) continue;
    if (previous !== 0 && sign !== previous) changes++;
    previous = sign;
  }
  return changes;
}

export type IrrStatus = 'none' | 'one' | 'several' | 'all-zero';

export interface IrrResult {
  status: IrrStatus;
  /** Every rate found as a fraction (0.1 is 10 percent), in ascending order. */
  rates: Dec[];
  /** The sign changes in the flows, which allow up to that many rates. */
  signChanges: number;
}

/** The NPV curve at 1 + r = g, by Horner's rule in x = 1 / g: CF0 + x (CF1 + x (CF2 + ...)). */
function curveAt(flows: Dec[], growth: Dec): Dec {
  const x = ONE.div(growth);
  let acc = ZERO;
  for (let i = flows.length - 1; i >= 0; i--) acc = acc.times(x).plus(flows[i]!);
  return acc;
}

let grid: Dec[] | null = null;

/** The 181 values of 1 + r that the scan visits, built in decimal: 10^(k / 20) for k from -120 to 60. */
function scanGrid(): Dec[] {
  if (grid === null) {
    const ten = new D(10);
    const points: Dec[] = [];
    for (let k = GRID_FIRST; k <= GRID_LAST; k++) points.push(ten.pow(new D(k).div(GRID_STEPS_PER_TEN)));
    grid = points;
  }
  return grid;
}

/**
 * Every internal rate of return of the flows (OpenFormula 6.12.24 IRR: the rate at which NPV is zero). There is no
 * closed form. No sign change means no rate and every flow 0 is reported on its own. Otherwise the NPV curve is
 * evaluated at 1 + r on a log-spaced grid from 0.000001 to 1000, every bracket whose ends differ in sign is bisected
 * until it is narrower than 1e-12 in the rate, and a grid point where the curve is exactly zero is a rate too.
 * A root where the curve only touches zero, or two roots closer than one grid step, cannot be seen by a sign scan,
 * so `signChanges` is returned for the caller to say that up to that many rates are possible.
 */
export function irr(flows: Dec[]): IrrResult {
  if (flows.every((flow) => flow.isZero())) return { status: 'all-zero', rates: [], signChanges: 0 };
  const changes = signChanges(flows);
  if (changes === 0) return { status: 'none', rates: [], signChanges: 0 };

  const points = scanGrid();
  const rates: Dec[] = [];
  let previous = points[0]!;
  let previousValue = curveAt(flows, previous);
  if (previousValue.isZero()) rates.push(previous.minus(1));
  for (let k = 1; k < points.length; k++) {
    const current = points[k]!;
    const value = curveAt(flows, current);
    if (value.isZero()) {
      rates.push(current.minus(1));
    } else if (!previousValue.isZero() && previousValue.isPos() !== value.isPos()) {
      let low = previous;
      let high = current;
      let lowPositive = previousValue.isPos();
      let exact: Dec | null = null;
      while (high.minus(low).gte(TOLERANCE)) {
        const middle = low.plus(high).div(2);
        const middleValue = curveAt(flows, middle);
        if (middleValue.isZero()) {
          exact = middle;
          break;
        }
        if (middleValue.isPos() === lowPositive) low = middle;
        else high = middle;
      }
      rates.push((exact ?? low.plus(high).div(2)).minus(1));
    }
    previous = current;
    previousValue = value;
  }
  const status: IrrStatus = rates.length === 0 ? 'none' : rates.length === 1 ? 'one' : 'several';
  return { status, rates, signChanges: changes };
}

interface PaybackDetail {
  /** Periods, or null when the running total never turns non-negative. */
  value: Dec | null;
  /** The period in which the running total first turns non-negative. */
  period: number;
  /** The running total just before that period (0 when the period is 0). */
  before: Dec;
  /** The amount in that period. */
  amount: Dec;
}

/**
 * Finds the first period in which the running total of `amounts` is not negative after it has been negative (a
 * first flow of 0 or a leading gain is not a payback), and the part of that period needed (linear inside it). When
 * the running total is never negative there is nothing to recover and the payback is 0; when it stays negative the
 * value is null.
 */
function paybackDetail(amounts: Dec[]): PaybackDetail {
  let running = ZERO;
  let owed = false;
  for (let t = 0; t < amounts.length; t++) {
    const amount = amounts[t]!;
    const before = running;
    running = running.plus(amount);
    if (running.isNeg()) {
      owed = true;
    } else if (owed) {
      return { value: new D(t - 1).plus(before.neg().div(amount)), period: t, before, amount };
    }
  }
  return owed
    ? { value: null, period: -1, before: ZERO, amount: ZERO }
    : { value: ZERO, period: 0, before: ZERO, amount: ZERO };
}

/**
 * Periods until the running total of the flows turns non-negative after being negative: the whole periods before it
 * plus the shortfall divided by that period's flow, so the part inside the period is counted linearly. 0 when the
 * running total is never negative, null when the flows never recover.
 */
export function payback(flows: Dec[]): Dec | null {
  return paybackDetail(flows).value;
}

/** The present value of each flow at the rate in percent: CF_t / (1 + r)^t. */
function presentValues(ratePercent: Dec, flows: Dec[]): Dec[] {
  const growth = growthFactor(ratePercent);
  return flows.map((flow, t) => flow.div(growth.pow(t)));
}

/** Payback counted on the present values instead of the flows. Null when not reached within the flows. */
export function discountedPayback(ratePercent: Dec, flows: Dec[]): Dec | null {
  return paybackDetail(presentValues(ratePercent, flows)).value;
}

/** One period of the table as plain decimal strings at the currency's smallest unit (the factor to 6 places). */
export interface CashFlowRow {
  period: number;
  label: string;
  cashFlow: string;
  discountFactor: string;
  presentValue: string;
  runningTotal: string;
  discountedRunningTotal: string;
}

export interface IrrSummary {
  status: IrrStatus;
  /** Each rate found, in percent to 4 places, ascending. */
  rates: string[];
  signChanges: number;
  /** A plain sentence for the visitor. */
  message: string;
}

export interface CashFlowSummary {
  currency: string;
  /** Decimal places of the currency's smallest unit. */
  decimals: number;
  /** The discount rate in percent as typed. */
  rate: string;
  /** How many cash flows, period 0 included. */
  flowCount: number;
  npv: string;
  irr: IrrSummary;
  /** Periods to 2 places, or null when not reached. */
  payback: string | null;
  discountedPayback: string | null;
}

export interface CashFlowResult {
  summary: CashFlowSummary;
  rows: CashFlowRow[];
  /** Plain sentences for a warning note: more than one rate, or more rates possible than were found. */
  warnings: string[];
  /** The formulas, the typed numbers put into them, and the result before and after rounding. */
  working: string;
}

export interface CashFlowTexts {
  flows?: string;
  rate?: string;
  currency?: string;
}

/** The scan range in percent, for messages. */
const SCAN_RANGE = 'from -99.9999 percent to 99,900 percent';

function describeIrr(status: IrrStatus, rates: string[], changes: number): { message: string; warnings: string[] } {
  const warnings: string[] = [];
  const list = rates.map((rate) => `${rate} percent`).join(' and ');
  let message: string;
  if (status === 'all-zero') {
    message = 'Every cash flow is 0, so there is no rate to report.';
  } else if (status === 'none' && changes === 0) {
    message =
      'No internal rate of return: the cash flows never change sign (they are all positive or all negative), so no rate makes the net present value zero.';
  } else if (status === 'none') {
    message = `No rate was found ${SCAN_RANGE}. The flows change sign ${changes} times, which allows up to ${changes} rates, but none was found.`;
  } else if (status === 'one') {
    message = `${list} per period.`;
  } else {
    message = `More than one rate satisfies these cash flows: ${list} per period.`;
    warnings.push(
      `More than one rate satisfies these cash flows (${list} per period), so no single internal rate of return describes them.`,
    );
  }
  if ((status === 'one' || status === 'several') && changes > rates.length) {
    const possible = `Up to ${changes} rates are possible because the flows change sign ${changes} times; ${rates.length === 1 ? '1 was' : `${rates.length} were`} found.`;
    message = `${message} ${possible}`;
    warnings.push(possible);
  }
  return { message, warnings };
}

/** The first `count` terms of a sum, with `...` when more follow. */
function terms(parts: string[], count: number): string {
  return parts.length > count ? `${parts.slice(0, count).join(' + ')} + ...` : parts.join(' + ');
}

function paybackWorking(
  label: string,
  detail: PaybackDetail,
  money: (x: Dec) => string,
  shown: string | null,
): string[] {
  if (detail.value === null) {
    return [`  ${label}: the running total never turns non-negative within the periods typed, so it is not reached.`];
  }
  if (detail.period === 0) {
    return [
      `  ${label}: the running total is never below 0, there is nothing to recover and the payback is 0 periods.`,
    ];
  }
  return [
    `  ${label}: the running total first turns non-negative in period ${detail.period}; before it the total is ${money(detail.before)} and that period brings ${money(detail.amount)},`,
    `    so (${detail.period} - 1) + ${money(detail.before.neg())} / ${money(detail.amount)} = ${shown} periods, counted linearly inside the period.`,
  ];
}

/** Works out net present value, internal rate of return and both paybacks from the page's typed values, or null when everything is blank. */
export function calculateCashFlows(texts: CashFlowTexts): CashFlowResult | null {
  const flowsText = texts.flows ?? '';
  const rateText = texts.rate ?? '';
  if (isBlank(flowsText) && isBlank(rateText)) return null;

  const currency = parseCurrency(texts.currency ?? 'USD', FIELD_CURRENCY);
  const dp = minorUnits(currency);
  if (isBlank(flowsText)) {
    throw new MoneyInputError(
      FIELD_FLOWS,
      'missing, type one cash flow per line such as -1000 then 400 on the next line',
    );
  }
  const typed = parseFlows(flowsText);
  if (typed.length < 2) {
    throw new MoneyInputError(
      FIELD_FLOWS,
      'type at least two cash flows, one per line, the first line is now (period 0)',
    );
  }
  if (isBlank(rateText)) {
    throw new MoneyInputError(FIELD_RATE, 'missing, type the rate for one period in percent, for example 10');
  }
  const rate = parseDecimal(rateText, FIELD_RATE, { allowNegative: true, maxInt: 6 });
  const growth = growthFactor(rate);

  const amounts = typed.map((flow) => flow.amount);
  const present = presentValues(rate, amounts);
  const exactNpv = present.reduce((sum, value) => sum.plus(value), ZERO);

  let running = ZERO;
  let discountedRunning = ZERO;
  const rows: CashFlowRow[] = typed.map((flow, t) => {
    running = running.plus(flow.amount);
    discountedRunning = discountedRunning.plus(present[t]!);
    for (const value of [present[t]!, running, discountedRunning]) {
      if (value.abs().gte(TOO_LARGE)) {
        throw new MoneyInputError(
          FIELD_RATE,
          `${rate.toFixed()} percent makes a present value of 1,000,000,000,000,000,000 or more, which is too large to show exactly, try a rate closer to 0`,
        );
      }
    }
    return {
      period: t,
      label: flow.label,
      cashFlow: toPlain(flow.amount, dp),
      discountFactor: toPlain(ONE.div(growth.pow(t)), 6),
      presentValue: toPlain(present[t]!, dp),
      runningTotal: toPlain(running, dp),
      discountedRunningTotal: toPlain(discountedRunning, dp),
    };
  });

  const found = irr(amounts);
  const rates = found.rates.map((r) => toPlain(r.times(100), 4));
  const { message, warnings } = describeIrr(found.status, rates, found.signChanges);

  const simple = paybackDetail(amounts);
  const discounted = paybackDetail(present);
  const simpleShown = simple.value === null ? null : toPlain(simple.value, 2);
  const discountedShown = discounted.value === null ? null : toPlain(discounted.value, 2);

  const money = (x: Dec) => toPlain(x, dp);
  const n = typed.length - 1;
  const r = rate.div(100);
  const termList = typed.map((flow, t) =>
    t === 0 ? flow.amount.toFixed() : `${flow.amount.toFixed()} / ${growth.toFixed()}^${t}`,
  );
  const rest = amounts.slice(1);
  const restNpv = openFormulaNpv(rate, rest);
  const working = [
    'Net present value, as OMB Circular A-94 Appendix B discounts it (discount factor 1 / (1 + r)^t, t the period, period 0 not discounted):',
    '  NPV = CF0 + CF1 / (1 + r) + CF2 / (1 + r)^2 + ... + CFn / (1 + r)^n',
    '  r = discount rate / 100 for one period',
    '',
    'With your numbers:',
    `  r = ${rate.toFixed()} / 100 = ${r.toFixed()}, so 1 + r = ${growth.toFixed()}, and there are ${typed.length} cash flows, periods 0 to ${n}`,
    `  NPV = ${terms(termList, 4)}`,
    `  exact NPV = ${toPlain(exactNpv, 12)}`,
    `  NPV = ${money(exactNpv)} (rounded half away from zero to ${dp} decimal places, the smallest unit of ${currency})`,
    '',
    'OpenFormula 6.12.30 NPV discounts its first value by one period: NPV(Rate; Values) = sum over i = 1..N of Values_i / (1 + Rate)^i. This NPV is the first flow plus that function applied to the flows after the first:',
    `  OpenFormula NPV of the flows after the first = ${toPlain(restNpv, 12)}`,
    `  NPV = ${amounts[0]!.toFixed()} + ${toPlain(restNpv, 12)} = ${toPlain(amounts[0]!.plus(restNpv), 12)}`,
    '',
    'Internal rate of return, OpenFormula 6.12.24 IRR: the rate at which the NPV is zero. There is no closed form, so this page:',
    `  1. counts the sign changes in the cash flows, zeros ignored: ${found.signChanges}. No change means no rate; N changes allow up to N rates.`,
    `  2. evaluates the NPV at 181 values of 1 + r spaced evenly on a log scale from 0.000001 to 1000 (rates ${SCAN_RANGE}), and splits every bracket where the sign flips in half until it is narrower than 1e-12 in the rate.`,
    `  Result: ${message}`,
    '',
    'Payback, counted on the running total of the cash flows, and discounted payback, counted on the running total of the present values:',
    ...paybackWorking('Payback', simple, money, simpleShown),
    ...paybackWorking('Discounted payback', discounted, money, discountedShown),
    '',
    'Each table row is rounded on its own, so a column of shown rows can differ from a shown total by a unit or two of the smallest digit; the NPV is worked out from the exact values.',
  ].join('\n');

  return {
    summary: {
      currency,
      decimals: dp,
      rate: rate.toFixed(),
      flowCount: typed.length,
      npv: money(exactNpv),
      irr: { status: found.status, rates, signChanges: found.signChanges, message },
      payback: simpleShown,
      discountedPayback: discountedShown,
    },
    rows,
    warnings,
    working,
  };
}
