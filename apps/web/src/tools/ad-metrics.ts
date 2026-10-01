import { meta, calculateAdMetrics, MoneyInputError } from '@fodt/ad-metrics';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'ad-metrics',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'spend',
      label: 'Ad spend',
      type: 'text',
      placeholder: '500',
      help: 'What the campaign cost, digits and an optional dot only. Leave out whatever you do not know.',
    },
    {
      name: 'impressions',
      label: 'Impressions',
      type: 'text',
      placeholder: '100000',
      help: 'How many times the ads were shown, a whole number.',
    },
    {
      name: 'clicks',
      label: 'Clicks',
      type: 'text',
      placeholder: '2000',
      help: 'How many clicks, a whole number.',
    },
    {
      name: 'conversions',
      label: 'Conversions',
      type: 'text',
      placeholder: '50',
      help: 'How many sales or sign-ups the clicks led to, a whole number.',
    },
    {
      name: 'revenue',
      label: 'Revenue from the ads',
      type: 'text',
      placeholder: '2000',
      help: 'What the conversions brought in, in the same currency as the spend.',
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
      help: 'A three-letter code such as USD, EUR or JPY. It is only a label on the costs.',
    },
  ],
  examples: [
    {
      label: '500 spent, 100,000 impressions, 2,000 clicks, 50 conversions and 2,000 revenue',
      values: {
        spend: '500',
        impressions: '100000',
        clicks: '2000',
        conversions: '50',
        revenue: '2000',
        decimals: '2',
        currency: 'USD',
      },
    },
    {
      label: 'Only spend and clicks',
      values: { spend: '500', clicks: '2000', decimals: '2', currency: 'USD' },
    },
  ],
  run(values): ToolResult {
    try {
      const result = calculateAdMetrics({
        spend: str(values, 'spend'),
        impressions: str(values, 'impressions'),
        clicks: str(values, 'clicks'),
        conversions: str(values, 'conversions'),
        revenue: str(values, 'revenue'),
        decimals: str(values, 'decimals', '2'),
        currency: str(values, 'currency', 'USD'),
      });
      if (result === null) return { outputs: [] };
      const { summary } = result;
      const outputs: OutputBlock[] = [];
      for (const warning of summary.warnings) outputs.push({ kind: 'note', tone: 'warn', value: warning });
      if (summary.notice !== null) outputs.push({ kind: 'note', tone: 'info', value: summary.notice });
      outputs.push({
        kind: 'table',
        label: 'Metrics',
        table: {
          headers: ['Metric', 'Formula', 'With your numbers', 'Result'],
          rows: result.rows.map((row) => [row.name, row.formula, row.withNumbers, row.display ?? row.message ?? '']),
          mono: [1, 2, 3],
        },
      });
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
