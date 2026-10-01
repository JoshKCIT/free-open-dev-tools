import { meta, calculateFreelance, MoneyInputError, formatMoney, D } from '@fodt/freelance-rate';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'freelance-rate',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'income',
      label: 'Target yearly income after tax',
      type: 'text',
      placeholder: '60000',
      help: 'What you want to keep each year once tax is paid, above 0, digits and an optional dot.',
    },
    {
      name: 'expenses',
      label: 'Yearly business expenses',
      type: 'text',
      placeholder: '6000',
      help: 'Everything the business costs you in a year, 0 or more.',
    },
    {
      name: 'taxRate',
      label: 'Share of profit set aside for tax (percent)',
      type: 'text',
      placeholder: '25',
      help: 'The share of your profit you set aside for tax, 0 or more and below 100. Nothing is filled in for you; type 0 for none. It is applied to profit, not to expenses.',
    },
    {
      name: 'workingDays',
      label: 'Working days in a year',
      type: 'text',
      placeholder: '260',
      help: 'A whole number from 1 to 366, the days you would work if you took no time off.',
    },
    {
      name: 'daysOff',
      label: 'Days off (holidays, sickness, training)',
      type: 'text',
      placeholder: '25',
      help: 'A whole number, 0 or more and fewer than the working days. Type 0 for none.',
    },
    {
      name: 'hoursPerDay',
      label: 'Hours in a working day',
      type: 'text',
      placeholder: '8',
      help: 'From 0.25 to 24.',
    },
    {
      name: 'billable',
      label: 'Share of working time you can bill (percent)',
      type: 'text',
      placeholder: '75',
      help: 'From 1 to 100. Finding clients, admin and training are time you cannot bill.',
    },
    {
      name: 'currency',
      label: 'Currency (ISO 4217 code)',
      type: 'text',
      default: 'USD',
      help: 'A three-letter code such as USD, EUR or JPY. It sets the decimal places of the amounts.',
    },
  ],
  examples: [
    {
      label:
        'Keep 60,000 after a 25 percent tax share, with 6,000 of expenses, 235 working days of 8 hours and 75 percent billable',
      values: {
        income: '60000',
        expenses: '6000',
        taxRate: '25',
        workingDays: '260',
        daysOff: '25',
        hoursPerDay: '8',
        billable: '75',
        currency: 'USD',
      },
    },
    {
      label: 'No tax share and no expenses: 40,000 over 220 days of 7.5 hours, all of it billable',
      values: {
        income: '40000',
        expenses: '0',
        taxRate: '0',
        workingDays: '230',
        daysOff: '10',
        hoursPerDay: '7.5',
        billable: '100',
        currency: 'USD',
      },
    },
  ],
  run(values): ToolResult {
    try {
      const result = calculateFreelance({
        income: str(values, 'income'),
        expenses: str(values, 'expenses'),
        taxRate: str(values, 'taxRate'),
        workingDays: str(values, 'workingDays'),
        daysOff: str(values, 'daysOff'),
        hoursPerDay: str(values, 'hoursPerDay'),
        billable: str(values, 'billable'),
        currency: str(values, 'currency', 'USD'),
      });
      if (result === null) return { outputs: [] };
      const { summary } = result;
      const outputs: OutputBlock[] = [
        {
          kind: 'keyvalue',
          label: 'Rates',
          pairs: summary.lines.map((line): [string, string] => [
            line.label,
            line.kind === 'money' ? formatMoney(new D(line.value), summary.currency) : line.value,
          ]),
        },
        {
          kind: 'table',
          label: 'Assumptions',
          table: { headers: ['Assumption', 'Value'], rows: result.assumptions },
        },
        {
          kind: 'note',
          tone: 'info',
          value:
            'The tax share is applied to your profit, not to your expenses: the profit is the income you want to keep divided by one minus the share, and the expenses are added on top.',
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
