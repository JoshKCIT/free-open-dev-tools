import { meta, calculatePayoff, MoneyInputError, isBlank, formatMoney, D } from '@fodt/credit-card-payoff';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const TWO_CARDS = 'Card A | 1000 | 24 | 25\nCard B | 500 | 12 | 25';

export default defineTool({
  id: 'credit-card-payoff',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'What to work out',
      type: 'select',
      default: 'time',
      options: [
        { value: 'time', label: 'Months to pay off at a monthly payment' },
        { value: 'target', label: 'Monthly payment to finish by a month' },
      ],
    },
    {
      name: 'cards',
      label: 'Cards, one per line: name | balance | APR (percent) | minimum payment',
      type: 'textarea',
      rows: 5,
      placeholder: 'Card A | 2500 | 24.9 | 50',
      help: 'One card per line: a name, the balance, the yearly rate in percent and the fixed minimum payment, separated by vertical bars. Up to 20 cards. Nothing is filled in for you.',
    },
    {
      name: 'budget',
      label: 'Total monthly payment',
      type: 'text',
      placeholder: '200',
      help: 'Everything you pay across all the cards each month. It must cover the minimums.',
      visible: (v) => str(v, 'mode', 'time') === 'time',
    },
    {
      name: 'months',
      label: 'Finish within (months)',
      type: 'text',
      placeholder: '12',
      help: 'A whole number from 1 to 1,200. Each order shows the smallest payment, to the cent, that clears every card in time.',
      visible: (v) => str(v, 'mode', 'time') === 'target',
    },
    {
      name: 'currency',
      label: 'Currency (ISO 4217 code)',
      type: 'text',
      default: 'USD',
      help: 'A three-letter code such as USD, EUR or JPY. It sets the decimal places shown.',
    },
  ],
  examples: [
    {
      label: 'Two cards, 200 a month',
      values: { mode: 'time', cards: TWO_CARDS, budget: '200', currency: 'USD' },
    },
    {
      label: 'One card of 1,000 at 12 percent, 100 a month',
      values: { mode: 'time', cards: 'Card | 1000 | 12 | 25', budget: '100', currency: 'USD' },
    },
    {
      label: 'The same two cards, finish within 12 months',
      values: { mode: 'target', cards: TWO_CARDS, months: '12', currency: 'USD' },
    },
  ],
  run(values): ToolResult {
    const mode = str(values, 'mode', 'time');
    const cards = str(values, 'cards');
    const budget = str(values, 'budget');
    const months = str(values, 'months');
    if (isBlank(cards) && isBlank(mode === 'target' ? months : budget)) return { outputs: [] };
    try {
      const plan = calculatePayoff({ cards, mode, budget, months, currency: str(values, 'currency', 'USD') });
      if (plan === null) return { outputs: [] };
      const { summary } = plan;
      const money = (text: string) => formatMoney(new D(text), summary.currency);
      const target = summary.mode === 'target';
      const howLong = (months: number, paidOff: boolean) => (paidOff ? String(months) : 'Not paid off');

      const outputs: OutputBlock[] = [
        {
          kind: 'table',
          label: 'Both orders compared',
          table: {
            headers: target
              ? ['Order', 'Monthly payment needed', 'Months', 'Total interest', 'Total paid']
              : ['Order', 'Months', 'Total interest', 'Total paid'],
            rows: plan.orders.map((o) =>
              target
                ? [o.label, money(o.payment), howLong(o.months, o.paidOff), money(o.totalInterest), money(o.totalPaid)]
                : [o.label, howLong(o.months, o.paidOff), money(o.totalInterest), money(o.totalPaid)],
            ),
            mono: target ? [1, 2, 3, 4] : [1, 2, 3],
          },
        },
      ];
      for (const warning of plan.warnings) outputs.push({ kind: 'note', tone: 'warn', value: warning });
      for (const o of plan.orders) {
        outputs.push({
          kind: 'table',
          label: `${o.label}: the month each card is cleared`,
          table: {
            headers: ['Card', 'Cleared in month'],
            rows: o.cardPayoff.map((c) => [c.name, c.month === null ? 'Not paid off' : String(c.month)]),
            mono: [1],
          },
        });
      }
      for (const o of plan.orders) {
        outputs.push({
          kind: 'table',
          label: `${o.label}: month by month`,
          table: {
            headers: ['Month', 'Interest', 'Paid', 'Balance left'],
            rows: o.rows.map((row) => [row.month, money(row.interest), money(row.paid), money(row.balance)]),
            mono: [0, 1, 2, 3],
          },
        });
      }
      outputs.push({ kind: 'code', label: 'How this was worked out', value: plan.working });
      for (const note of plan.notes) outputs.push({ kind: 'note', tone: 'info', value: note });
      return { outputs };
    } catch (err) {
      if (err instanceof MoneyInputError) {
        return {
          outputs: [],
          errors: [{ message: `${err.field}: ${err.message}`, line: err.line, column: err.column }],
        };
      }
      throw err;
    }
  },
});
