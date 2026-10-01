import { meta, calculateInvestment, MoneyInputError, formatMoney, D } from '@fodt/investment-return';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'investment-return',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'What you know',
      type: 'select',
      default: 'prices',
      options: [
        { value: 'prices', label: 'Buy and sell prices' },
        { value: 'values', label: 'Start and end values' },
      ],
    },
    {
      name: 'buyPrice',
      label: 'Buy price',
      type: 'text',
      placeholder: '100',
      help: 'The price paid for one unit, digits and an optional dot only.',
      visible: (v) => str(v, 'mode', 'prices') === 'prices',
    },
    {
      name: 'sellPrice',
      label: 'Sell price',
      type: 'text',
      placeholder: '150',
      help: 'The price received for one unit. Type 0 for a sale for nothing.',
      visible: (v) => str(v, 'mode', 'prices') === 'prices',
    },
    {
      name: 'quantity',
      label: 'Quantity',
      type: 'text',
      placeholder: '10',
      help: 'How many units, a fraction is fine, for example 0.5.',
      visible: (v) => str(v, 'mode', 'prices') === 'prices',
    },
    {
      name: 'startValue',
      label: 'Start value',
      type: 'text',
      placeholder: '1000',
      help: 'What the investment was worth when you put the money in.',
      visible: (v) => str(v, 'mode', 'prices') === 'values',
    },
    {
      name: 'endValue',
      label: 'End value',
      type: 'text',
      placeholder: '1500',
      help: 'What it was worth at the end. Type 0 if all of it was lost.',
      visible: (v) => str(v, 'mode', 'prices') === 'values',
    },
    {
      name: 'buyFees',
      label: 'Fees when buying (optional)',
      type: 'text',
      placeholder: '5',
      help: 'Charges you paid on the way in. They are added to the cost. Leave it blank for 0.',
    },
    {
      name: 'sellFees',
      label: 'Fees when selling (optional)',
      type: 'text',
      placeholder: '5',
      help: 'Charges you paid on the way out. They are taken off what you received. Leave it blank for 0.',
    },
    {
      name: 'startDate',
      label: 'Start date (optional, YYYY-MM-DD)',
      type: 'text',
      placeholder: '2021-01-01',
      help: 'The day the money went in. Type both dates to see the annualised return.',
    },
    {
      name: 'endDate',
      label: 'End date (optional, YYYY-MM-DD)',
      type: 'text',
      placeholder: '2025-12-31',
      help: 'The day it came out, or the day of the end value. It cannot be before the start date.',
    },
    {
      name: 'decimals',
      label: 'Decimal places',
      type: 'select',
      default: '2',
      options: [
        { value: '0', label: '0' },
        { value: '1', label: '1' },
        { value: '2', label: '2 (nearest hundredth of a percent)' },
        { value: '3', label: '3' },
        { value: '4', label: '4' },
      ],
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
      label: '1,000 growing to 1,500 between 2021-01-01 and 2025-12-31',
      values: {
        mode: 'values',
        startValue: '1000',
        endValue: '1500',
        startDate: '2021-01-01',
        endDate: '2025-12-31',
        decimals: '2',
        currency: 'USD',
      },
    },
    {
      label: '10 units bought at 100 and sold at 150, with 5 in fees each way',
      values: {
        mode: 'prices',
        buyPrice: '100',
        sellPrice: '150',
        quantity: '10',
        buyFees: '5',
        sellFees: '5',
        decimals: '2',
        currency: 'USD',
      },
    },
  ],
  run(values): ToolResult {
    try {
      const result = calculateInvestment({
        mode: str(values, 'mode', 'prices'),
        buyPrice: str(values, 'buyPrice'),
        sellPrice: str(values, 'sellPrice'),
        quantity: str(values, 'quantity'),
        startValue: str(values, 'startValue'),
        endValue: str(values, 'endValue'),
        buyFees: str(values, 'buyFees'),
        sellFees: str(values, 'sellFees'),
        startDate: str(values, 'startDate'),
        endDate: str(values, 'endDate'),
        decimals: str(values, 'decimals', '2'),
        currency: str(values, 'currency', 'USD'),
      });
      if (result === null) return { outputs: [] };
      const { summary } = result;
      const money = (text: string) => formatMoney(new D(text), summary.currency);

      const pairs: [string, string][] = [
        ['Total cost', money(summary.cost)],
        ['Total proceeds', money(summary.proceeds)],
        ['Profit or loss', money(summary.profit)],
        ['Return on investment', `${summary.roi} %`],
      ];
      if (summary.days !== null && summary.years !== null) {
        pairs.push(['Holding period', `${summary.days} days (${summary.years} years at days over 365)`]);
      }
      pairs.push([
        'Annualised return',
        summary.annualised !== null ? `${summary.annualised} % a year` : (summary.annualisedNote ?? ''),
      ]);
      const outputs: OutputBlock[] = [
        { kind: 'keyvalue', label: 'Results', pairs },
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
