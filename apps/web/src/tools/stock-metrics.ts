import { meta, calculateStock, MoneyInputError, formatMoney, D } from '@fodt/stock-metrics';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const mode = (v: Record<string, unknown>) => str(v, 'mode', 'eps');

export default defineTool({
  id: 'stock-metrics',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'Work out',
      type: 'select',
      default: 'eps',
      options: [
        { value: 'eps', label: 'Earnings per share' },
        { value: 'pe', label: 'Price to earnings ratio' },
        { value: 'yield', label: 'Dividend yield' },
        { value: 'payout', label: 'Payout ratio' },
        { value: 'margin', label: 'Margin call price' },
      ],
    },
    {
      name: 'earnings',
      label: 'Earnings',
      type: 'text',
      placeholder: '5000000',
      help: 'Net profit for the period, digits and an optional dot, with a minus sign for a loss. For a payout ratio use the same basis as the dividends.',
      visible: (v) => ['eps', 'payout'].includes(mode(v)),
    },
    {
      name: 'shares',
      label: 'Shares outstanding',
      type: 'text',
      placeholder: '2000000',
      help: 'The number of shares, more than 0.',
      visible: (v) => mode(v) === 'eps',
    },
    {
      name: 'price',
      label: 'Share price',
      type: 'text',
      placeholder: '50',
      help: 'The price of one share, more than 0.',
      visible: (v) => ['pe', 'yield'].includes(mode(v)),
    },
    {
      name: 'eps',
      label: 'Earnings per share',
      type: 'text',
      placeholder: '2.50',
      help: 'Earnings per share, with a minus sign for a loss. A ratio needs it above 0.',
      visible: (v) => mode(v) === 'pe',
    },
    {
      name: 'dividend',
      label: 'Annual dividend per share',
      type: 'text',
      placeholder: '2',
      help: 'What one share pays in a year.',
      visible: (v) => mode(v) === 'yield',
    },
    {
      name: 'dividends',
      label: 'Dividends paid',
      type: 'text',
      placeholder: '1000000',
      help: 'Dividends for the period, on the same basis as the earnings (both totals or both per share).',
      visible: (v) => mode(v) === 'payout',
    },
    {
      name: 'buyPrice',
      label: 'Buy price',
      type: 'text',
      placeholder: '100',
      help: 'The price of one share when bought, more than 0.',
      visible: (v) => mode(v) === 'margin',
    },
    {
      name: 'initialMargin',
      label: 'Initial margin (percent)',
      type: 'text',
      placeholder: '50',
      help: 'The share of the price you pay yourself, more than 0 and at most 100. Nothing is filled in for you.',
      visible: (v) => mode(v) === 'margin',
    },
    {
      name: 'maintenanceMargin',
      label: 'Maintenance margin (percent)',
      type: 'text',
      placeholder: '25',
      help: 'The share of the market value your equity must stay above, at least 0 and below 100. Nothing is filled in for you.',
      visible: (v) => mode(v) === 'margin',
    },
    {
      name: 'decimals',
      label: 'Decimal places',
      type: 'select',
      default: '2',
      options: [
        { value: '0', label: '0' },
        { value: '1', label: '1' },
        { value: '2', label: '2' },
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
      label: 'Margin call price: bought at 100 with 50 percent initial and 25 percent maintenance margin',
      values: {
        mode: 'margin',
        buyPrice: '100',
        initialMargin: '50',
        maintenanceMargin: '25',
        decimals: '2',
        currency: 'USD',
      },
    },
    {
      label: 'Earnings per share: 5,000,000 over 2,000,000 shares',
      values: { mode: 'eps', earnings: '5000000', shares: '2000000', decimals: '2', currency: 'USD' },
    },
    {
      label: 'Price to earnings: a price of 50 over earnings per share of 2.50',
      values: { mode: 'pe', price: '50', eps: '2.50', decimals: '2', currency: 'USD' },
    },
  ],
  run(values): ToolResult {
    try {
      const result = calculateStock({
        mode: mode(values),
        earnings: str(values, 'earnings'),
        shares: str(values, 'shares'),
        price: str(values, 'price'),
        eps: str(values, 'eps'),
        dividend: str(values, 'dividend'),
        dividends: str(values, 'dividends'),
        buyPrice: str(values, 'buyPrice'),
        initialMargin: str(values, 'initialMargin'),
        maintenanceMargin: str(values, 'maintenanceMargin'),
        decimals: str(values, 'decimals', '2'),
        currency: str(values, 'currency', 'USD'),
      });
      if (result === null) return { outputs: [] };
      const { summary } = result;
      const shown = (kind: 'money' | 'ratio' | 'percent', value: string) =>
        kind === 'money' ? formatMoney(new D(value), summary.currency) : kind === 'percent' ? `${value} %` : value;

      const outputs: OutputBlock[] = [];
      if (summary.lines.length > 0) {
        outputs.push({
          kind: 'keyvalue',
          label: 'Result',
          pairs: summary.lines.map((line): [string, string] => [line.label, shown(line.kind, line.value)]),
        });
      }
      for (const note of summary.notes) outputs.push({ kind: 'note', tone: 'warn', value: note });
      outputs.push({ kind: 'code', label: 'How this was worked out', value: result.working });
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
