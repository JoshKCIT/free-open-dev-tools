import meta from './meta.json';
import {
  D,
  type Dec,
  MoneyInputError,
  isBlank,
  formatMoney,
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
/** The most single-unit moves the search for the smallest charge may make before it gives up. */
const MAX_STEPS = 20;

const FIELD_MODE = 'Work out';
const FIELD_AMOUNT = 'Payment amount';
const FIELD_TARGET = 'Amount you want to receive';
const FIELD_PERCENT = 'Percentage fee (percent)';
const FIELD_FIXED = 'Fixed fee per payment';
const FIELD_CURRENCY = 'Currency (ISO 4217 code)';

function checkRates(percent: Dec, fixed: Dec): void {
  if (percent.lt(0) || percent.gte(100)) {
    throw new MoneyInputError(
      FIELD_PERCENT,
      'must be 0 or more and below 100 percent, a fee of 100 percent or more takes the whole payment',
    );
  }
  if (fixed.lt(0)) throw new MoneyInputError(FIELD_FIXED, 'must be 0 or more');
}

/** The unrounded fee: amount x percentage / 100 + fixed fee. */
function rawFee(amount: Dec, percent: Dec, fixed: Dec): Dec {
  return amount.times(percent).div(100).plus(fixed);
}

/** The fee on a payment, rounded once, half away from zero, to the currency's smallest unit. Percentage 0 to below 100, fixed fee 0 or more. */
export function feeOn(amount: Dec, percent: Dec, fixed: Dec, currency: string): Dec {
  checkRates(percent, fixed);
  return roundTo(rawFee(amount, percent, fixed), minorUnits(currency));
}

/** One charge tried while searching: its unrounded fee, the fee rounded to the smallest unit and what is left. */
export interface ChargeCheck {
  charge: Dec;
  rawFee: Dec;
  fee: Dec;
  received: Dec;
}

export interface ChargeSearch {
  /** The exact gross-up (target + fixed fee) / (1 - percentage / 100), before any rounding. */
  exact: Dec;
  /** The exact gross-up rounded up to the smallest unit: where the search starts. */
  start: Dec;
  /** The smallest charge that leaves at least the target after the rounded fee. */
  charge: Dec;
  fee: Dec;
  received: Dec;
  /** Every charge tried, in order, starting with `start`; the last one that fails (if any) is the one just below `charge`. */
  checked: ChargeCheck[];
}

/**
 * The smallest charge that leaves at least `target` after the rounded fee. It starts from the exact gross-up rounded up
 * to the smallest unit, moves up one unit while the amount received is below the target, and moves down one unit while
 * that still leaves at least the target. The amount received never falls as the charge rises by one unit, so the first
 * charge found this way is the smallest. At most 20 single-unit moves are made before it gives up.
 */
export function searchCharge(target: Dec, percent: Dec, fixed: Dec, currency: string): ChargeSearch {
  checkRates(percent, fixed);
  if (!target.gt(0)) throw new MoneyInputError(FIELD_TARGET, 'must be above 0');
  const dp = minorUnits(currency);
  const scale = new D(10).pow(dp);
  const unit = new D(1).div(scale);
  const exact = target.plus(fixed).div(new D(1).minus(percent.div(100)));
  const start = exact.times(scale).ceil().div(scale);

  const check = (charge: Dec): ChargeCheck => {
    const raw = rawFee(charge, percent, fixed);
    const fee = roundTo(raw, dp);
    return { charge, rawFee: raw, fee, received: charge.minus(fee) };
  };
  const giveUp = () =>
    new MoneyInputError(
      FIELD_TARGET,
      `could not settle on a charge within ${MAX_STEPS} steps of one smallest unit, check the fees you typed`,
    );

  const checked: ChargeCheck[] = [check(start)];
  let current = checked[0]!;
  let steps = 0;
  while (current.received.lt(target)) {
    if (++steps > MAX_STEPS) throw giveUp();
    current = check(current.charge.plus(unit));
    checked.push(current);
  }
  if (steps === 0) {
    // the start already works: see whether one unit less still does
    for (;;) {
      const lower = current.charge.minus(unit);
      if (!lower.gt(0)) break;
      if (++steps > MAX_STEPS) throw giveUp();
      const tried = check(lower);
      checked.push(tried);
      if (tried.received.lt(target)) break;
      current = tried;
    }
  }
  return { exact, start, charge: current.charge, fee: current.fee, received: current.received, checked };
}

/** The smallest charge that leaves at least `target` after the rounded fee (see `searchCharge`). */
export function amountToCharge(target: Dec, percent: Dec, fixed: Dec, currency: string): Dec {
  return searchCharge(target, percent, fixed, currency).charge;
}

export type FeeMode = 'charge' | 'receive';

/** The values the page holds, exactly as typed. Any of them may be left out. */
export interface FeeTexts {
  /** `charge` (the default): the fee on a payment. `receive`: the amount to charge to receive a chosen sum. */
  mode?: string;
  /** The payment, in `charge` mode. */
  amount?: string;
  /** The amount you want to receive, in `receive` mode. */
  target?: string;
  /** The percentage fee, in percent. Nothing is filled in for you. */
  percentFee?: string;
  /** The fixed fee per payment. Nothing is filled in for you. */
  fixedFee?: string;
  currency?: string;
}

export interface FeeLine {
  label: string;
  value: string;
  kind: 'money';
}

export interface FeeSummary {
  mode: FeeMode;
  currency: string;
  /** Decimal places of the currency's smallest unit. */
  currencyDecimals: number;
  fee: string;
  /** The amount received; negative when the fee is larger than the payment. */
  received: string;
  /** The amount to charge, in `receive` mode; otherwise null. */
  charge: string | null;
  /** How far the payment falls short of the fee, when the fee is larger than the payment; otherwise null. */
  shortfall: string | null;
  lines: FeeLine[];
  /** Plain statements about an unusual result. */
  notes: string[];
}

export interface FeeResult {
  summary: FeeSummary;
  /** The formulas, the typed numbers put into them, and the charges checked. */
  working: string;
}

/** A figure for the working: rounded half away from zero to 10 places with trailing zeros dropped. */
function exactText(x: Dec): string {
  return roundTo(x, WORKING_PLACES).toFixed();
}

/** Works out the fee, or the charge that receives a chosen sum, from the page's typed values; null when nothing is typed. */
export function calculateFees(texts: FeeTexts): FeeResult | null {
  const modeText = texts.mode === undefined || isBlank(texts.mode) ? 'charge' : texts.mode.trim();
  const mode: FeeMode | undefined = modeText === 'charge' || modeText === 'receive' ? modeText : undefined;
  if (mode === undefined) {
    throw new MoneyInputError(FIELD_MODE, 'choose the fee on a payment or the amount to charge to receive a sum');
  }
  const sumText = mode === 'charge' ? texts.amount : texts.target;
  if ([sumText, texts.percentFee, texts.fixedFee].every((text) => text === undefined || isBlank(text))) return null;

  const currency = parseCurrency(texts.currency ?? 'USD', FIELD_CURRENCY);
  const dp = minorUnits(currency);
  const sumField = mode === 'charge' ? FIELD_AMOUNT : FIELD_TARGET;
  /** An amount of money: digits and an optional dot with no more places than the currency's smallest unit. */
  const moneyText = (text: string | undefined, field: string): Dec => {
    const x = parseDecimal(text ?? '', field);
    if (x.dp() > dp) {
      throw new MoneyInputError(
        field,
        `${currency} has ${dp} decimal place${dp === 1 ? '' : 's'}, so type at most that many`,
      );
    }
    return x;
  };
  const sum = moneyText(sumText, sumField);
  const percent = parseDecimal(texts.percentFee ?? '', FIELD_PERCENT);
  const fixed = moneyText(texts.fixedFee, FIELD_FIXED);
  if (!sum.gt(0)) throw new MoneyInputError(sumField, 'must be above 0');
  checkRates(percent, fixed);

  const money = (x: Dec) => toPlain(x, dp);
  const notes: string[] = [];
  const lines: FeeLine[] = [];
  const working: string[] = [];

  if (mode === 'charge') {
    const percentPart = sum.times(percent).div(100);
    const raw = percentPart.plus(fixed);
    const fee = roundTo(raw, dp);
    const received = sum.minus(fee);
    lines.push(
      { label: 'Payment', value: money(sum), kind: 'money' },
      { label: 'Fee', value: money(fee), kind: 'money' },
      { label: 'Amount received', value: money(received), kind: 'money' },
    );
    let shortfall: string | null = null;
    if (fee.gt(sum)) {
      shortfall = money(fee.minus(sum));
      lines.push({ label: 'Shortfall', value: shortfall, kind: 'money' });
      notes.push(
        `The fee (${money(fee)} ${currency}) is larger than the payment (${money(sum)} ${currency}): the payment falls short of the fee by ${shortfall} ${currency}, so nothing is received.`,
      );
    }
    working.push(
      'Fee on a payment (no standards body defines this; the percentage and fixed fee are the ones you typed):',
      '  fee = payment x percentage fee / 100 + fixed fee, rounded once, half away from zero, to the smallest unit',
      '  amount received = payment - fee',
      '',
      'With your numbers:',
      `  percentage part = ${sum.toFixed()} x ${percent.toFixed()} / 100 = ${exactText(percentPart)}`,
      `  fee before rounding = ${exactText(percentPart)} + ${fixed.toFixed()} = ${exactText(raw)}`,
      `  fee = ${money(fee)} ${currency} (rounded half away from zero to ${dp} decimal places, the smallest unit of ${currency})`,
      `  amount received = ${sum.toFixed()} - ${money(fee)} = ${money(received)} ${currency}`,
    );
    return {
      summary: {
        mode,
        currency,
        currencyDecimals: dp,
        fee: money(fee),
        received: money(received),
        charge: null,
        shortfall,
        lines,
        notes,
      },
      working: working.join('\n'),
    };
  }

  const found = searchCharge(sum, percent, fixed, currency);
  lines.push(
    { label: 'Amount you want to receive', value: money(sum), kind: 'money' },
    { label: 'Amount to charge', value: money(found.charge), kind: 'money' },
    { label: 'Fee', value: money(found.fee), kind: 'money' },
    { label: 'Amount received', value: money(found.received), kind: 'money' },
  );
  if (found.received.gt(sum)) {
    notes.push(
      `The smallest charge leaves ${money(found.received)} ${currency}, which is ${money(found.received.minus(sum))} ${currency} more than you asked for, because the fee is rounded to the smallest unit.`,
    );
  }
  working.push(
    'Amount to charge to receive a chosen sum (no standards body defines this; the percentage and fixed fee are the ones you typed).',
    'The fee is worked out on the charge, so the charge comes from a gross-up and is then checked against the rounded fee:',
    '  first guess = (amount wanted + fixed fee) / (1 - percentage fee / 100), rounded up to the smallest unit',
    '  fee = charge x percentage fee / 100 + fixed fee, rounded once, half away from zero, to the smallest unit',
    '  amount received = charge - fee',
    '  the charge is moved one smallest unit at a time until it is the smallest one that leaves at least the amount wanted',
    '',
    'With your numbers:',
    `  first guess = (${sum.toFixed()} + ${fixed.toFixed()}) / (1 - ${percent.toFixed()} / 100) = ${exactText(found.exact)}, rounded up to ${money(found.start)}`,
  );
  for (const c of found.checked) {
    const verdict = c.received.gte(sum)
      ? `at least ${sum.toFixed()}, so this charge works`
      : `below ${sum.toFixed()}, so this charge is too small`;
    working.push(
      `  charge ${money(c.charge)}: fee ${exactText(c.rawFee)} rounded to ${money(c.fee)}, received ${money(c.received)}, ${verdict}`,
    );
  }
  working.push(
    `  the smallest charge that works is ${money(found.charge)} ${currency}: fee ${money(found.fee)}, received ${money(found.received)}`,
    `  (rounded half away from zero to ${dp} decimal places, the smallest unit of ${currency})`,
  );
  return {
    summary: {
      mode,
      currency,
      currencyDecimals: dp,
      fee: money(found.fee),
      received: money(found.received),
      charge: money(found.charge),
      shortfall: null,
      lines,
      notes,
    },
    working: working.join('\n'),
  };
}
