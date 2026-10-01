import { meta, calculateSavings, MoneyInputError, isBlank, formatMoney, D } from '@fodt/compound-interest';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'compound-interest',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'start',
      label: 'Starting amount',
      type: 'text',
      placeholder: '1000',
      help: 'What you begin with, digits and an optional dot only. Leave it blank for 0.',
    },
    {
      name: 'deposit',
      label: 'Regular deposit each period',
      type: 'text',
      placeholder: '100',
      help: 'One deposit in every compounding period. Leave it blank for 0.',
    },
    {
      name: 'timing',
      label: 'Deposit timing',
      type: 'select',
      default: 'end',
      options: [
        { value: 'end', label: 'At the end of each period' },
        { value: 'start', label: 'At the start of each period' },
      ],
    },
    {
      name: 'rate',
      label: 'Annual interest rate (percent)',
      type: 'text',
      placeholder: '5',
      help: 'The yearly rate as a percent, for example 5. Nothing is filled in for you.',
    },
    {
      name: 'compounding',
      label: 'Compounding',
      type: 'select',
      default: '12',
      options: [
        { value: '1', label: 'Yearly' },
        { value: '2', label: 'Twice a year' },
        { value: '4', label: 'Quarterly' },
        { value: '12', label: 'Monthly' },
        { value: '52', label: 'Weekly' },
        { value: '365', label: 'Daily (365-day year)' },
      ],
    },
    {
      name: 'years',
      label: 'Years (1 to 100)',
      type: 'text',
      placeholder: '10',
      help: 'A whole number of years from 1 to 100.',
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
      label: '100 a month at 12 percent for a year',
      values: {
        start: '0',
        deposit: '100',
        timing: 'end',
        rate: '12',
        compounding: '12',
        years: '1',
        currency: 'USD',
      },
    },
    {
      label: '1,000 at 5 percent compounded monthly for 10 years',
      values: { start: '1000', deposit: '', timing: 'end', rate: '5', compounding: '12', years: '10', currency: 'USD' },
    },
    {
      label: '1,000 and 50 a week at 4 percent for 20 years, deposits at the start',
      values: {
        start: '1000',
        deposit: '50',
        timing: 'start',
        rate: '4',
        compounding: '52',
        years: '20',
        currency: 'USD',
      },
    },
  ],
  run(values): ToolResult {
    const start = str(values, 'start');
    const deposit = str(values, 'deposit');
    const rate = str(values, 'rate');
    const years = str(values, 'years');
    if (isBlank(start) && isBlank(deposit) && isBlank(rate) && isBlank(years)) return { outputs: [] };
    try {
      const plan = calculateSavings({
        start,
        deposit,
        timing: str(values, 'timing', 'end'),
        rate,
        compounding: str(values, 'compounding', '12'),
        years,
        currency: str(values, 'currency', 'USD'),
      });
      if (plan === null) return { outputs: [] };
      const { summary } = plan;
      const money = (text: string) => formatMoney(new D(text), summary.currency);
      const outputs: OutputBlock[] = [
        {
          kind: 'keyvalue',
          label: 'Summary',
          pairs: [
            ['Final balance', money(summary.finalBalance)],
            ['Total deposits', money(summary.totalDeposits)],
            ['Total interest', money(summary.totalInterest)],
            ['Effective annual yield', `${summary.effectiveYield} %`],
          ],
        },
        {
          kind: 'table',
          label: 'Year by year',
          table: {
            headers: ['Year', 'Deposits', 'Interest', 'Balance at year end'],
            rows: plan.rows.map((row) => [row.year, money(row.deposits), money(row.interest), money(row.balance)]),
            mono: [0, 1, 2, 3],
          },
        },
        { kind: 'code', label: 'How this was worked out', value: plan.working },
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
