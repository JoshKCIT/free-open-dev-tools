import { meta, calculatePay, MoneyInputError, formatMoney, D, PAY_PERIODS } from '@fodt/salary-converter';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'salary-converter',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'amount',
      label: 'Pay',
      type: 'text',
      placeholder: '52000',
      help: 'The pay you know, 0 or more, digits and an optional dot (no commas).',
    },
    {
      name: 'period',
      label: 'Pay is given per',
      type: 'select',
      default: 'yearly',
      options: PAY_PERIODS.map((p) => ({ value: p.id, label: p.label })),
    },
    {
      name: 'hoursPerWeek',
      label: 'Hours a week',
      type: 'text',
      default: '40',
      help: 'Hours you work in a week, above 0 and at most 168. A working-time choice you can change.',
    },
    {
      name: 'daysPerWeek',
      label: 'Days a week',
      type: 'text',
      default: '5',
      help: 'Days you work in a week, from 1 to 7. A working-time choice you can change.',
    },
    {
      name: 'weeksPerYear',
      label: 'Weeks a year',
      type: 'text',
      default: '52',
      help: 'Weeks you are paid for in a year, above 0 and at most 53, for example 52 or 52.175. A working-time choice you can change.',
    },
    {
      name: 'currency',
      label: 'Currency (ISO 4217 code)',
      type: 'text',
      default: 'USD',
      help: 'A three-letter code such as USD, EUR or JPY. It sets the decimal places the amounts are rounded to.',
    },
  ],
  examples: [
    {
      label: '52,000 a year at 40 hours a week, 5 days a week and 52 weeks a year',
      values: {
        amount: '52000',
        period: 'yearly',
        hoursPerWeek: '40',
        daysPerWeek: '5',
        weeksPerYear: '52',
        currency: 'USD',
      },
    },
    {
      label: '89,033 a year at 40 hours a week and 52.175 weeks a year (2,087 hours)',
      values: {
        amount: '89033',
        period: 'yearly',
        hoursPerWeek: '40',
        daysPerWeek: '5',
        weeksPerYear: '52.175',
        currency: 'USD',
      },
    },
    {
      label: '25 an hour at 37.5 hours a week and 52 weeks a year',
      values: {
        amount: '25',
        period: 'hourly',
        hoursPerWeek: '37.5',
        daysPerWeek: '5',
        weeksPerYear: '52',
        currency: 'USD',
      },
    },
  ],
  run(values): ToolResult {
    try {
      const result = calculatePay({
        amount: str(values, 'amount'),
        period: str(values, 'period', 'yearly'),
        hoursPerWeek: str(values, 'hoursPerWeek', '40'),
        daysPerWeek: str(values, 'daysPerWeek', '5'),
        weeksPerYear: str(values, 'weeksPerYear', '52'),
        currency: str(values, 'currency', 'USD'),
      });
      if (result === null) return { outputs: [] };
      const { summary } = result;
      const outputs: OutputBlock[] = [
        {
          kind: 'table',
          label: 'Pay for each period',
          table: {
            headers: ['Period', 'Amount'],
            rows: summary.rows.map((row) => [row.label, formatMoney(new D(row.amount), summary.currency)]),
          },
        },
        { kind: 'code', label: 'How this was worked out', value: result.working },
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
