import meta from './meta.json';
import {
  D,
  type Dec,
  MoneyInputError,
  isBlank,
  formatMoney,
  parseDecimal,
  parseCount,
  parseCurrency,
  parseRows,
  cellDecimal,
  cellText,
  roundTo,
  toPlain,
  minorUnits,
} from './money';

export { meta, D, MoneyInputError, isBlank, formatMoney };
export type { Dec };

/** The most cards accepted. */
export const MAX_CARDS = 20;
/** The longest plan played, in months: 100 years. A plan still not paid off then is reported as such. */
export const MAX_MONTHS = 1200;

/** Longest name accepted for a card, so a table cell stays readable. */
const MAX_NAME = 60;
/** A plan is stopped when the total owed passes this, long before the 40 digits of working precision run out. */
const RUNAWAY = new D('1e30');
/** Used in the 12 months a year divisor: the monthly rate is the yearly rate in percent over 100 over 12. */
const MONTHLY_DIVISOR = 1200;

export type PayoffOrder = 'highest-rate' | 'smallest-balance';
const ORDERS: readonly { order: PayoffOrder; label: string }[] = [
  { order: 'highest-rate', label: 'Highest rate first' },
  { order: 'smallest-balance', label: 'Smallest balance first' },
];

/** One card as typed: its balance, its yearly rate in percent and its fixed minimum payment. `line` is its line in the text. */
export type Card = { name: string; balance: Dec; apr: Dec; minimum: Dec; line: number };

const FIELD_CARDS = 'Cards';
const FIELD_BUDGET = 'Total monthly payment';
const FIELD_MONTHS = 'Finish within (months)';
const FIELD_CURRENCY = 'Currency (ISO 4217 code)';
const FIELD_MODE = 'Mode';

const ZERO = new D(0);

/** Where in a card line the cell with this index starts, for an error message. */
function cellColumn(starts: number[], index: number): number {
  return starts[index] ?? 1;
}

/**
 * Reads the card lines: one card per line as name | balance | APR in percent | minimum payment. Blank lines are
 * skipped (but counted), a blank name becomes `Card <line>`, a balance may be 0, the APR is from 0 to 100, the
 * minimum is above 0, and amounts have no more decimal places than the currency's smallest unit. An empty text
 * gives no cards. A problem names the line and the column of the cell.
 */
export function parseCards(text: string, currency: string): Card[] {
  const dp = minorUnits(currency);
  const rows = parseRows(text, FIELD_CARDS, {
    columns: ['name', 'balance', 'APR', 'minimum'],
    required: 4,
    maxRows: MAX_CARDS,
  });
  return rows.map((row) => {
    const name = cellText(row, 0) === '' ? `Card ${row.line}` : cellText(row, 0);
    if (name.length > MAX_NAME) {
      throw new MoneyInputError(FIELD_CARDS, `name: at most ${MAX_NAME} characters`, {
        line: row.line,
        column: cellColumn(row.starts, 0),
      });
    }
    const balance = cellDecimal(row, 1, FIELD_CARDS, 'balance');
    const apr = cellDecimal(row, 2, FIELD_CARDS, 'APR');
    const minimum = cellDecimal(row, 3, FIELD_CARDS, 'minimum');
    const at = (index: number) => ({ line: row.line, column: cellColumn(row.starts, index) });
    for (const [value, heading, index] of [
      [balance, 'balance', 1],
      [minimum, 'minimum', 3],
    ] as const) {
      if (value.decimalPlaces() > dp) {
        throw new MoneyInputError(
          FIELD_CARDS,
          `${heading}: ${currency} amounts have at most ${dp} decimal places, so every month adds up to the last cent`,
          at(index),
        );
      }
    }
    if (apr.gt(100)) throw new MoneyInputError(FIELD_CARDS, 'APR: must be from 0 to 100 percent', at(2));
    if (!minimum.gt(0)) {
      throw new MoneyInputError(FIELD_CARDS, 'minimum: must be more than 0, type the smallest payment due', at(3));
    }
    return { name, balance, apr, minimum, line: row.line };
  });
}

/** One month of a plan: the interest added, everything paid that month, and the total still owed afterwards. */
export interface PayoffRow {
  month: number;
  interest: Dec;
  paid: Dec;
  balance: Dec;
}

export interface PayoffRun {
  /** Months played: the month the last card was cleared, or where the plan was stopped. */
  months: number;
  paidOff: boolean;
  /** True when the plan was stopped early because the total owed grew past 10^30. */
  runaway: boolean;
  totalInterest: Dec;
  totalPaid: Dec;
  rows: PayoffRow[];
  /** For each card as typed: the month it was cleared, 0 when it had no balance, null when it never was. */
  cardPayoffMonth: (number | null)[];
}

/** Whether card `i` should get the extra money before card `j`, for this order. Ties fall to the earlier card. */
function takesPriority(cards: Card[], bal: Dec[], order: PayoffOrder, i: number, j: number): boolean {
  const ci = cards[i]!;
  const cj = cards[j]!;
  const byBalance = bal[i]!.cmp(bal[j]!);
  const byRate = ci.apr.cmp(cj.apr);
  if (order === 'highest-rate') {
    if (byRate !== 0) return byRate > 0;
    return byBalance < 0;
  }
  if (byBalance !== 0) return byBalance < 0;
  return byRate > 0;
}

/** The month-by-month play shared by `simulatePayoff` and the payment search; assumes the input was checked. */
function play(
  cards: Card[],
  budget: Dec,
  order: PayoffOrder,
  dp: number,
  maxMonths: number,
  keepRows: boolean,
): PayoffRun {
  const bal = cards.map((card) => card.balance);
  const cleared: (number | null)[] = cards.map((card) => (card.balance.isZero() ? 0 : null));
  const live = cards.map((_, i) => i).filter((i) => !bal[i]!.isZero());
  const rows: PayoffRow[] = [];
  let totalInterest = ZERO;
  let totalPaid = ZERO;

  for (let month = 1; month <= maxMonths; month++) {
    // Interest first: balance x APR / 100 / 12, rounded to the smallest unit, added to the card.
    let interest = ZERO;
    for (const i of live) {
      const owed = bal[i]!;
      if (owed.isZero()) continue;
      const charge = roundTo(owed.times(cards[i]!.apr).div(MONTHLY_DIVISOR), dp);
      bal[i] = owed.plus(charge);
      interest = interest.plus(charge);
    }

    // Then every card gets its minimum, never more than it owes.
    let rest = budget;
    for (const i of live) {
      const owed = bal[i]!;
      if (owed.isZero()) continue;
      const minimum = cards[i]!.minimum;
      const pay = minimum.lt(owed) ? minimum : owed;
      bal[i] = owed.minus(pay);
      rest = rest.minus(pay);
      if (bal[i]!.isZero()) cleared[i] = month;
    }

    // The rest of the fixed monthly payment goes to one card at a time, moving on when a card is cleared.
    while (rest.gt(0)) {
      let target = -1;
      for (const i of live) {
        if (bal[i]!.isZero()) continue;
        if (target < 0 || takesPriority(cards, bal, order, i, target)) target = i;
      }
      if (target < 0) break;
      const owed = bal[target]!;
      const pay = rest.lt(owed) ? rest : owed;
      bal[target] = owed.minus(pay);
      rest = rest.minus(pay);
      if (bal[target]!.isZero()) cleared[target] = month;
    }

    const paid = budget.minus(rest);
    totalInterest = totalInterest.plus(interest);
    totalPaid = totalPaid.plus(paid);
    let left = ZERO;
    for (const i of live) left = left.plus(bal[i]!);
    if (keepRows) rows.push({ month, interest, paid, balance: left });

    if (left.isZero()) {
      return { months: month, paidOff: true, runaway: false, totalInterest, totalPaid, rows, cardPayoffMonth: cleared };
    }
    if (left.gt(RUNAWAY)) {
      return { months: month, paidOff: false, runaway: true, totalInterest, totalPaid, rows, cardPayoffMonth: cleared };
    }
  }
  return {
    months: maxMonths,
    paidOff: false,
    runaway: false,
    totalInterest,
    totalPaid,
    rows,
    cardPayoffMonth: cleared,
  };
}

/** The sum of the minimum payments of the cards that still have a balance. */
function sumMinimums(cards: Card[]): Dec {
  return cards.reduce((sum, card) => (card.balance.isZero() ? sum : sum.plus(card.minimum)), ZERO);
}

/** Refuses a list of cards that has nothing to pay off. */
function checkCards(cards: Card[]): void {
  if (cards.every((card) => card.balance.isZero())) {
    throw new MoneyInputError(FIELD_CARDS, 'every balance is 0, type a card with a balance to pay off');
  }
}

/** Refuses a plan with nothing to pay off or with a monthly payment below the minimums. */
function checkPlan(cards: Card[], budget: Dec, dp: number): void {
  checkCards(cards);
  if (!budget.gt(0)) throw new MoneyInputError(FIELD_BUDGET, 'must be more than 0, type what you can pay each month');
  if (budget.decimalPlaces() > dp) {
    throw new MoneyInputError(FIELD_BUDGET, `amounts have at most ${dp} decimal places in this currency`);
  }
  const minimums = sumMinimums(cards);
  if (budget.lt(minimums)) {
    throw new MoneyInputError(
      FIELD_BUDGET,
      `${toPlain(budget, dp)} is less than the ${toPlain(minimums, dp)} needed to pay every minimum payment, so no plan can be shown`,
    );
  }
}

/**
 * Plays the months one at a time for one order. Each month: interest of balance x APR / 100 / 12, rounded to the
 * smallest unit, is added to every card with a balance (12 CFR 1026 Appendix M1 (b)(4)(xi) and Appendix M2);
 * every card is paid its minimum, never more than it owes; the rest of the fixed `budget` goes to one card at a
 * time, the highest APR first (a tie: the smaller balance, then the earlier card) or the smallest balance first
 * (a tie: the higher APR, then the earlier card), moving on in the same month when a card is cleared. The last
 * payment on a card is exactly its balance plus that month's interest (Appendix M1 (b)(4)(v)). The plan stops
 * when every balance is 0 or after `maxMonths` months (at most 1,200) with `paidOff` false. A `budget` below the
 * sum of the minimums is refused naming both amounts.
 */
export function simulatePayoff(
  cards: Card[],
  budget: Dec,
  order: PayoffOrder,
  currency: string,
  maxMonths: number = MAX_MONTHS,
): PayoffRun {
  const dp = minorUnits(currency);
  checkPlan(cards, budget, dp);
  return play(cards, budget, order, dp, Math.min(maxMonths, MAX_MONTHS), true);
}

/**
 * The smallest monthly payment, in whole units of the currency's smallest unit, with which the plan for this
 * order is paid off within `months` months (1 to 1,200), or null when no payment can do it (never the case for
 * a whole number of months of at least 1, because paying every balance and its interest in month 1 always works).
 * A bigger payment is never slower, so the answer is found by halving the range of whole units; it is never
 * below the sum of the minimum payments.
 */
export function paymentToFinishBy(cards: Card[], months: number, order: PayoffOrder, currency: string): Dec | null {
  if (!Number.isInteger(months) || months < 1 || months > MAX_MONTHS) {
    throw new MoneyInputError(FIELD_MONTHS, `type a whole number from 1 to ${MAX_MONTHS}`);
  }
  const dp = minorUnits(currency);
  const minimums = sumMinimums(cards);
  checkCards(cards);
  const scale = new D(10).pow(dp);
  const finishes = (units: Dec) => play(cards, units.div(scale), order, dp, months, false).paidOff;

  // Anything below balances / months cannot finish, because interest only adds to what must be paid.
  let balances = ZERO;
  let everything = ZERO;
  for (const card of cards) {
    balances = balances.plus(card.balance);
    everything = everything.plus(card.balance).plus(roundTo(card.balance.times(card.apr).div(MONTHLY_DIVISOR), dp));
  }
  const floor = minimums.times(scale);
  let lo = D.max(floor, balances.times(scale).div(months).ceil());
  // Paying every balance and its first month of interest in month 1 finishes at once.
  let hi = D.max(floor, everything.times(scale));
  if (lo.gt(hi)) lo = hi;
  if (!finishes(hi)) return null;
  while (lo.lt(hi)) {
    const mid = lo.plus(hi).div(2).floor();
    if (finishes(mid)) hi = mid;
    else lo = mid.plus(1);
  }
  // A bigger payment is never slower, so one unit less must not finish; step down if it somehow does.
  while (hi.gt(floor) && finishes(hi.minus(1))) hi = hi.minus(1);
  return hi.div(scale);
}

/** The values the page holds, exactly as typed. */
export interface PayoffTexts {
  cards: string;
  /** `time` (months to pay off at a chosen payment, the default) or `target` (the payment to finish by a month). */
  mode?: string;
  budget?: string;
  months?: string;
  currency?: string;
}

/** One month as plain decimal strings at the currency's smallest unit. */
export interface OrderRow {
  month: number;
  interest: string;
  paid: string;
  balance: string;
}

export interface OrderResult {
  order: PayoffOrder;
  label: string;
  /** The total monthly payment this plan uses: the one typed, or the one found for the target. */
  payment: string;
  months: number;
  paidOff: boolean;
  totalInterest: string;
  totalPaid: string;
  /** Each card that had a balance with the month it was cleared, null when it never was. */
  cardPayoff: { name: string; month: number | null }[];
  rows: OrderRow[];
}

export interface PayoffSummary {
  currency: string;
  /** Decimal places of the currency's smallest unit. */
  decimals: number;
  mode: 'time' | 'target';
  /** Cards with a balance. */
  cardCount: number;
  sumMinimums: string;
  totalBalance: string;
  budget?: string;
  targetMonths?: number;
}

export interface PayoffResult {
  summary: PayoffSummary;
  /** Highest rate first, then smallest balance first. */
  orders: OrderResult[];
  /** The rules and the typed numbers put into them. */
  working: string;
  notes: string[];
  warnings: string[];
}

const COMMA = new Intl.NumberFormat('en-US');

/** Works out both orders from the page's typed values, or returns null when nothing was typed. */
export function calculatePayoff(texts: PayoffTexts): PayoffResult | null {
  const modeText = texts.mode === undefined || isBlank(texts.mode) ? 'time' : texts.mode.trim();
  if (modeText !== 'time' && modeText !== 'target') {
    throw new MoneyInputError(FIELD_MODE, 'choose months to pay off or the payment to finish by a month');
  }
  const mode: 'time' | 'target' = modeText;
  const budgetText = texts.budget ?? '';
  const monthsText = texts.months ?? '';
  if (isBlank(texts.cards) && isBlank(mode === 'time' ? budgetText : monthsText)) return null;

  const currency = parseCurrency(texts.currency ?? 'USD', FIELD_CURRENCY);
  const dp = minorUnits(currency);
  const cards = parseCards(texts.cards, currency);
  if (cards.length === 0) {
    throw new MoneyInputError(FIELD_CARDS, 'missing, type a card such as Card A | 2500 | 24.9 | 50');
  }
  const live = cards.filter((card) => !card.balance.isZero());
  if (live.length === 0)
    throw new MoneyInputError(FIELD_CARDS, 'every balance is 0, type a card with a balance to pay off');
  const minimums = sumMinimums(cards);
  const totalBalance = live.reduce((sum, card) => sum.plus(card.balance), ZERO);

  let budget: Dec | undefined;
  let targetMonths: number | undefined;
  if (mode === 'time') {
    budget = parseDecimal(budgetText, FIELD_BUDGET);
    checkPlan(cards, budget, dp);
  } else {
    targetMonths = parseCount(monthsText, FIELD_MONTHS, 1, MAX_MONTHS);
  }

  const warnings: string[] = [];
  const notes: string[] = [
    'Appendix M1 (b)(4)(ix) assumes payments go to lower-APR balances first when an issuer prints its minimum-payment disclosures. That is a convention for those disclosures, not either order offered here.',
  ];
  const money = (x: Dec) => x.toFixed(dp);
  /** For sentences read by a person: with the currency's symbol and digit grouping. */
  const shown = (x: Dec) => formatMoney(x, currency);

  const orders: OrderResult[] = ORDERS.map(({ order, label }) => {
    let payment: Dec;
    if (budget !== undefined) {
      payment = budget;
    } else {
      const needed = paymentToFinishBy(cards, targetMonths!, order, currency);
      if (needed === null) {
        throw new MoneyInputError(
          FIELD_MONTHS,
          `no monthly payment finishes ${label.toLowerCase()} in ${targetMonths} months`,
        );
      }
      payment = needed;
      if (payment.eq(minimums)) {
        notes.push(
          `${label}: the minimum payments alone (${shown(minimums)} a month) clear every card within ${targetMonths} months, so that is the smallest payment that can be used.`,
        );
      }
    }
    const run = simulatePayoff(cards, payment, order, currency);
    if (!run.paidOff) {
      warnings.push(
        run.runaway
          ? `${label}: not paid off. The balance grows faster than ${shown(payment)} a month pays it down and was stopped at month ${run.months} when it passed 1,000,000,000,000,000,000,000,000,000,000.`
          : `${label}: not paid off after ${COMMA.format(MAX_MONTHS)} months (100 years). ${shown(payment)} a month does not beat the interest, so the balance never clears; a larger monthly payment is needed.`,
      );
    }
    return {
      order,
      label,
      payment: money(payment),
      months: run.months,
      paidOff: run.paidOff,
      totalInterest: money(run.totalInterest),
      totalPaid: money(run.totalPaid),
      cardPayoff: cards
        .map((card, i) => ({ card, month: run.cardPayoffMonth[i] ?? null }))
        .filter(({ card }) => !card.balance.isZero())
        .map(({ card, month }) => ({ name: card.name, month })),
      rows: run.rows.map((row) => ({
        month: row.month,
        interest: money(row.interest),
        paid: money(row.paid),
        balance: money(row.balance),
      })),
    };
  });

  const firstMonth = live.map((card) => {
    const exact = card.balance.times(card.apr).div(MONTHLY_DIVISOR);
    const rounded = roundTo(exact, dp);
    const result = exact.eq(rounded)
      ? rounded.toFixed(dp)
      : `${toPlain(exact, 12)} (to 12 places), rounded to ${rounded.toFixed(dp)}`;
    return `    ${card.name}: ${card.balance.toFixed()} x ${card.apr.toFixed()} / 100 / 12 = ${result}`;
  });

  const working = [
    'Month by month, following 12 CFR 1026 Appendix M1 and Appendix M2 (repayment disclosures):',
    '  monthly rate = APR / 100 / 12 (Appendix M2 sets the periodic rate as (APR / 365) x (365 / 12), which is the yearly rate divided by 12)',
    `  interest each month = balance x APR / 100 / 12, rounded half away from zero to ${dp} decimal places, the smallest unit of ${currency} (Appendix M1 (b)(4)(xi) allows rounding to the cent)`,
    '  each month: the interest is added to every card with a balance, every card is paid its minimum (never more than it owes), then the rest of the total monthly payment goes to one card at a time',
    "  the final payment on a card is its balance plus that month's interest, so nothing is left owing (Appendix M1 (b)(4)(v))",
    '',
    'Where the extra money goes:',
    '  highest rate first: the card with the highest APR; a tie goes to the smaller balance, then to the card typed first',
    '  smallest balance first: the card with the smallest balance; a tie goes to the higher APR, then to the card typed first',
    '  a card that is cleared passes its minimum on, because the total monthly payment stays the same',
    '',
    'With your numbers:',
    budget !== undefined
      ? `  total monthly payment = ${money(budget)}, the minimums add up to ${money(minimums)}`
      : `  finish within ${targetMonths} months: the smallest total monthly payment, in whole units of ${currency}, with which every card is cleared in time; one unit less takes longer. The minimums add up to ${money(minimums)}`,
    '  interest in month 1, balance x APR / 100 / 12:',
    ...firstMonth,
    '',
    ...orders.map(
      (o) =>
        `${o.label}: payment ${o.payment} a month, ${o.paidOff ? `${o.months} months` : `not paid off after ${o.months} months`}, total interest ${o.totalInterest}, total paid ${o.totalPaid}.`,
    ),
  ].join('\n');

  const summary: PayoffSummary = {
    currency,
    decimals: dp,
    mode,
    cardCount: live.length,
    sumMinimums: money(minimums),
    totalBalance: money(totalBalance),
  };
  if (budget !== undefined) summary.budget = money(budget);
  if (targetMonths !== undefined) summary.targetMonths = targetMonths;

  return { summary, orders, working, notes, warnings };
}
