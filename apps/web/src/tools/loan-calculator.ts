import { meta, calculateLoan, MoneyInputError, isBlank, formatMoney, D } from '@fodt/loan-calculator';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const PAYMENT_LABELS: Record<string, string> = {
  monthly: 'Payment per month',
  fortnightly: 'Payment every two weeks',
  weekly: 'Payment per week',
};

export default defineTool({
  id: 'loan-calculator',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'amount',
      label: 'Loan amount',
      type: 'text',
      placeholder: '162000',
      help: 'The amount borrowed, digits and an optional dot only.',
    },
    {
      name: 'rate',
      label: 'Annual interest rate (percent)',
      type: 'text',
      placeholder: '3.875',
      help: 'The yearly rate as a percent, for example 3.875. Nothing is filled in for you.',
    },
    {
      name: 'years',
      label: 'Term (years)',
      type: 'text',
      placeholder: '30',
      help: 'Up to 50 years and a whole number of payments, for example 30, or 0.25 for monthly payments.',
    },
    {
      name: 'frequency',
      label: 'Payment frequency',
      type: 'select',
      default: 'monthly',
      options: [
        { value: 'monthly', label: 'Monthly (12 a year)' },
        { value: 'fortnightly', label: 'Every two weeks (26 a year)' },
        { value: 'weekly', label: 'Weekly (52 a year)' },
      ],
    },
    {
      name: 'extra',
      label: 'Extra payment each period (optional)',
      type: 'text',
      placeholder: '0',
      help: 'Added to every payment and taken off the balance, so the loan ends sooner.',
    },
    {
      name: 'firstPayment',
      label: 'First payment date (optional, YYYY-MM-DD)',
      type: 'text',
      placeholder: '2026-01-31',
      help: 'Gives every payment a date and shows the payoff date.',
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
      label: 'CFPB sample: 162,000 at 3.875 percent for 30 years',
      values: { amount: '162000', rate: '3.875', years: '30', frequency: 'monthly', currency: 'USD' },
    },
    {
      label: '1,000 at 12 percent for a year, with 20 extra each month',
      values: { amount: '1000', rate: '12', years: '1', frequency: 'monthly', extra: '20', currency: 'USD' },
    },
    {
      label: '1,200 at no interest for 1 year, every two weeks',
      values: { amount: '1200', rate: '0', years: '1', frequency: 'fortnightly', currency: 'USD' },
    },
  ],
  run(values): ToolResult {
    const amount = str(values, 'amount');
    const rate = str(values, 'rate');
    const years = str(values, 'years');
    if (isBlank(amount) && isBlank(rate) && isBlank(years)) return { outputs: [] };
    try {
      const result = calculateLoan({
        amount,
        rate,
        years,
        currency: str(values, 'currency', 'USD'),
        frequency: str(values, 'frequency', 'monthly'),
        extra: str(values, 'extra'),
        firstPayment: str(values, 'firstPayment'),
      });
      const { summary } = result;
      const money = (text: string) => formatMoney(new D(text), summary.currency);
      const dated = result.rows.some((row) => row.date !== undefined);

      const pairs: [string, string][] = [[PAYMENT_LABELS[summary.frequency] ?? 'Payment', money(summary.payment)]];
      if (!new D(summary.extra).isZero()) pairs.push(['Extra payment each period', money(summary.extra)]);
      pairs.push(
        ['Number of payments', summary.payments],
        ['Total interest', money(summary.totalInterest)],
        ['Total paid', money(summary.totalPaid)],
        [dated ? 'Payoff date' : 'Payoff', summary.payoffText],
      );

      const outputs: OutputBlock[] = [
        { kind: 'keyvalue', label: 'Summary', pairs },
        ...result.notes.map((note): OutputBlock => ({ kind: 'note', tone: 'info', value: note })),
        { kind: 'code', label: 'How this was worked out', value: result.working },
        {
          kind: 'table',
          label: 'Repayment schedule',
          table: {
            headers: dated
              ? ['#', 'Date', 'Payment', 'Interest', 'Principal', 'Balance']
              : ['#', 'Payment', 'Interest', 'Principal', 'Balance'],
            rows: result.rows.map((row) => {
              const money4 = [row.payment, row.interest, row.principal, row.balance].map(money);
              return dated ? [row.number, row.date ?? '', ...money4] : [row.number, ...money4];
            }),
            mono: dated ? [1, 2, 3, 4, 5] : [1, 2, 3, 4],
          },
        },
        {
          kind: 'files',
          label: 'Schedule as CSV',
          files: [{ name: 'loan-schedule.csv', mime: 'text/csv', content: result.csv }],
        },
      ];
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
