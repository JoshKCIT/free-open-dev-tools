import { meta, calculatePercentage, MoneyInputError } from '@fodt/percentage-calculator';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const mode = (v: Record<string, unknown>) => str(v, 'mode', 'of');

export default defineTool({
  id: 'percentage-calculator',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'Work out',
      type: 'select',
      default: 'of',
      options: [
        { value: 'of', label: 'X percent of Y' },
        { value: 'what', label: 'What percent X is of Y' },
        { value: 'change', label: 'Percent change' },
        { value: 'discount', label: 'Price after a discount' },
        { value: 'stacked', label: 'Stacked discounts' },
      ],
    },
    {
      name: 'percent',
      label: 'Percent',
      type: 'text',
      placeholder: '15',
      help: 'The percent to take, digits and an optional dot, with a minus sign if needed.',
      visible: (v) => mode(v) === 'of',
    },
    {
      name: 'value',
      label: 'Number',
      type: 'text',
      placeholder: '80',
      help: 'The number to take the percent of.',
      visible: (v) => mode(v) === 'of',
    },
    {
      name: 'part',
      label: 'Part',
      type: 'text',
      placeholder: '12',
      help: 'The number you want as a percent of the whole.',
      visible: (v) => mode(v) === 'what',
    },
    {
      name: 'whole',
      label: 'Whole',
      type: 'text',
      placeholder: '80',
      help: 'The number the part is compared with. A whole of 0 has no percent.',
      visible: (v) => mode(v) === 'what',
    },
    {
      name: 'from',
      label: 'Starting value',
      type: 'text',
      placeholder: '80',
      help: 'The value the change starts from. A starting value of 0 has no percent change.',
      visible: (v) => mode(v) === 'change',
    },
    {
      name: 'to',
      label: 'Ending value',
      type: 'text',
      placeholder: '100',
      help: 'The value the change ends at.',
      visible: (v) => mode(v) === 'change',
    },
    {
      name: 'price',
      label: 'Price',
      type: 'text',
      placeholder: '80',
      help: 'The price before any discount, 0 or more. For stacked discounts it is optional: type it to see the price after them.',
      visible: (v) => ['discount', 'stacked'].includes(mode(v)),
    },
    {
      name: 'discount',
      label: 'Discount (percent)',
      type: 'text',
      placeholder: '15',
      help: 'The percent taken off, from 0 to 100.',
      visible: (v) => mode(v) === 'discount',
    },
    {
      name: 'discounts',
      label: 'Discounts, one percent per line',
      type: 'textarea',
      rows: 4,
      placeholder: '20\n10',
      help: 'One discount percent per line, each from 0 to 100, in the order they are applied. Between 1 and 20 lines.',
      visible: (v) => mode(v) === 'stacked',
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
  ],
  examples: [
    {
      label: 'Stacked discounts: 20 percent off and then 10 percent off a price of 100',
      values: { mode: 'stacked', discounts: '20\n10', price: '100', decimals: '2' },
    },
    {
      label: '15 percent of 80',
      values: { mode: 'of', percent: '15', value: '80', decimals: '2' },
    },
    {
      label: 'Percent change from 80 to 100',
      values: { mode: 'change', from: '80', to: '100', decimals: '2' },
    },
  ],
  run(values): ToolResult {
    try {
      const result = calculatePercentage({
        mode: mode(values),
        percent: str(values, 'percent'),
        value: str(values, 'value'),
        part: str(values, 'part'),
        whole: str(values, 'whole'),
        from: str(values, 'from'),
        to: str(values, 'to'),
        price: str(values, 'price'),
        discount: str(values, 'discount'),
        discounts: str(values, 'discounts'),
        decimals: str(values, 'decimals', '2'),
      });
      if (result === null) return { outputs: [] };
      const { summary } = result;

      const outputs: OutputBlock[] = [];
      if (summary.lines.length > 0) {
        outputs.push({
          kind: 'keyvalue',
          label: 'Result',
          pairs: summary.lines.map((line): [string, string] => [
            line.label,
            line.kind === 'percent' ? `${line.value} %` : line.value,
          ]),
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
