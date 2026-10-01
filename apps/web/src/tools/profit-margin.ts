import { meta, calculateProfit, MoneyInputError, formatMoney, D } from '@fodt/profit-margin';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const mode = (v: Record<string, unknown>) => str(v, 'mode', 'margin');

export default defineTool({
  id: 'profit-margin',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'Work out',
      type: 'select',
      default: 'margin',
      options: [
        { value: 'margin', label: 'Profit, margin and markup' },
        { value: 'target-margin', label: 'Price for a target margin' },
        { value: 'target-markup', label: 'Price for a target markup' },
        { value: 'break-even', label: 'Break-even units' },
      ],
    },
    {
      name: 'cost',
      label: 'Cost',
      type: 'text',
      placeholder: '60',
      help: 'What one item costs you, 0 or more, digits and an optional dot.',
      visible: (v) => ['margin', 'target-margin', 'target-markup'].includes(mode(v)),
    },
    {
      name: 'price',
      label: 'Price',
      type: 'text',
      placeholder: '100',
      help: 'What you sell one item for, 0 or more. A price below the cost is a loss and gives a negative margin.',
      visible: (v) => mode(v) === 'margin',
    },
    {
      name: 'targetMargin',
      label: 'Target margin (percent)',
      type: 'text',
      placeholder: '40',
      help: 'The share of the price you want as profit, below 100. Nothing is filled in for you.',
      visible: (v) => mode(v) === 'target-margin',
    },
    {
      name: 'targetMarkup',
      label: 'Target markup (percent)',
      type: 'text',
      placeholder: '50',
      help: 'The share of the cost you want to add on top, at least -100. Nothing is filled in for you.',
      visible: (v) => mode(v) === 'target-markup',
    },
    {
      name: 'fixedCosts',
      label: 'Fixed costs',
      type: 'text',
      placeholder: '1000',
      help: 'Costs that stay the same however many units you sell, 0 or more.',
      visible: (v) => mode(v) === 'break-even',
    },
    {
      name: 'unitPrice',
      label: 'Unit price',
      type: 'text',
      placeholder: '25',
      help: 'What one unit sells for.',
      visible: (v) => mode(v) === 'break-even',
    },
    {
      name: 'unitCost',
      label: 'Unit variable cost',
      type: 'text',
      placeholder: '15',
      help: 'What one more unit costs you to make or buy. A unit price at or below this never reaches break-even.',
      visible: (v) => mode(v) === 'break-even',
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
      label: 'Profit, margin and markup: cost 60, price 100',
      values: { mode: 'margin', cost: '60', price: '100', decimals: '2', currency: 'USD' },
    },
    {
      label: 'Price for a 40 percent target margin on a cost of 60',
      values: { mode: 'target-margin', cost: '60', targetMargin: '40', decimals: '2', currency: 'USD' },
    },
    {
      label: 'Break-even units: 1,000 of fixed costs, a unit price of 25 and a unit cost of 15',
      values: {
        mode: 'break-even',
        fixedCosts: '1000',
        unitPrice: '25',
        unitCost: '15',
        decimals: '2',
        currency: 'USD',
      },
    },
  ],
  run(values): ToolResult {
    try {
      const result = calculateProfit({
        mode: mode(values),
        cost: str(values, 'cost'),
        price: str(values, 'price'),
        targetMargin: str(values, 'targetMargin'),
        targetMarkup: str(values, 'targetMarkup'),
        fixedCosts: str(values, 'fixedCosts'),
        unitPrice: str(values, 'unitPrice'),
        unitCost: str(values, 'unitCost'),
        decimals: str(values, 'decimals', '2'),
        currency: str(values, 'currency', 'USD'),
      });
      if (result === null) return { outputs: [] };
      const { summary } = result;
      const shown = (kind: 'money' | 'percent' | 'ratio' | 'count', value: string) =>
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
