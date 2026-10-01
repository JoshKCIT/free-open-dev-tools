import { meta, calculateMarkup, MoneyInputError, formatMoney, D } from '@fodt/currency-markup';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'currency-markup',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'amount',
      label: 'Amount in the source currency',
      type: 'text',
      placeholder: '1000',
      help: 'The amount you are converting, above 0, digits and an optional dot (no commas).',
    },
    {
      name: 'source',
      label: 'Source currency (ISO 4217 code)',
      type: 'text',
      default: 'EUR',
      help: 'The currency you are converting from, a three-letter code such as EUR, USD, GBP or JPY.',
    },
    {
      name: 'target',
      label: 'Target currency (ISO 4217 code)',
      type: 'text',
      default: 'USD',
      help: 'The currency you are converting to, a three-letter code such as USD, EUR, GBP or JPY.',
    },
    {
      name: 'offered',
      label: 'Rate offered (target per 1 source)',
      type: 'text',
      placeholder: '1.0780',
      help: 'The rate the bank or card offers you, as units of the target currency for one unit of the source currency. Typed by you: no rate is filled in.',
    },
    {
      name: 'mid',
      label: 'Reference mid-market rate (target per 1 source)',
      type: 'text',
      placeholder: '1.1000',
      help: 'The reference rate you want to compare with, in the same direction: units of the target currency for one unit of the source currency. Typed by you: no rate is looked up.',
    },
    {
      name: 'decimals',
      label: 'Decimal places of the percentage',
      type: 'select',
      default: '2',
      options: [
        { value: '0', label: '0' },
        { value: '1', label: '1' },
        { value: '2', label: '2 (default)' },
        { value: '3', label: '3' },
        { value: '4', label: '4' },
      ],
    },
  ],
  examples: [
    {
      label: '1,000 euros at 1.0780 against a reference rate of 1.1000: a 2.00 percent markup',
      values: { amount: '1000', source: 'EUR', target: 'USD', offered: '1.0780', mid: '1.1000', decimals: '2' },
    },
    {
      label: 'An offer better than the reference rate gives a negative markup',
      values: { amount: '1000', source: 'EUR', target: 'USD', offered: '1.1200', mid: '1.1000', decimals: '2' },
    },
    {
      label: '100,000 yen into Bahraini dinars: each currency keeps its own decimals',
      values: { amount: '100000', source: 'JPY', target: 'BHD', offered: '0.0025', mid: '0.0026', decimals: '2' },
    },
  ],
  run(values): ToolResult {
    try {
      const result = calculateMarkup({
        amount: str(values, 'amount'),
        source: str(values, 'source', 'EUR'),
        target: str(values, 'target', 'USD'),
        offered: str(values, 'offered'),
        mid: str(values, 'mid'),
        decimals: str(values, 'decimals', '2'),
      });
      if (result === null) return { outputs: [] };
      const { summary } = result;
      const inSource = (value: string) => formatMoney(new D(value), summary.source);
      const inTarget = (value: string) => formatMoney(new D(value), summary.target);

      const outputs: OutputBlock[] = [
        {
          kind: 'keyvalue',
          label: 'Result',
          pairs: [
            ['Amount', inSource(summary.amount)],
            [`Converted at the offered rate (${summary.offered})`, inTarget(summary.convertedOffered)],
            [`Converted at the reference rate (${summary.mid})`, inTarget(summary.convertedMid)],
            ['Markup over the reference rate', `${summary.markupPercent} %`],
            [`Hidden cost in ${summary.target}`, inTarget(summary.hiddenTarget)],
            [`Hidden cost in ${summary.source}`, inSource(summary.hiddenSource)],
          ],
        },
      ];
      for (const note of summary.notes) outputs.push({ kind: 'note', tone: 'info', value: note });
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
