import { meta, calculateSalesTax, MoneyInputError, formatMoney, D } from '@fodt/sales-tax';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'sales-tax',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'Work out',
      type: 'select',
      default: 'add',
      options: [
        { value: 'add', label: 'Add tax to net amounts' },
        { value: 'extract', label: 'Take tax out of gross amounts' },
      ],
    },
    {
      name: 'lines',
      label: 'Amounts, one per line: amount, or description | amount',
      type: 'textarea',
      rows: 5,
      placeholder: 'Coffee | 3.50\nCake | 4.25',
      help: 'One amount per line, 0 or more, with at most the decimal places of the currency. You can put a description and a vertical bar before an amount. Up to 200 lines. In the first mode they are net amounts, in the second they include the tax.',
    },
    {
      name: 'rates',
      label: 'Tax rates, one per line: rate, or name | rate (percent)',
      type: 'textarea',
      rows: 3,
      placeholder: 'State | 6.25\nCity | 2',
      help: 'One tax component per line, each from 0 to 100 percent, typed by you: nothing is filled in. Several components each apply to the net amount and are not compounded. Up to 10 lines.',
    },
    {
      name: 'rounding',
      label: 'Rounding',
      type: 'select',
      default: 'total',
      options: [
        { value: 'total', label: 'Round on the total (default)' },
        { value: 'line', label: 'Round each line' },
      ],
    },
    {
      name: 'currency',
      label: 'Currency (ISO 4217 code)',
      type: 'text',
      default: 'USD',
      help: 'A three-letter code such as USD, EUR, GBP or JPY. It sets the decimal places of the amounts.',
    },
  ],
  examples: [
    {
      label: 'Take VAT out of 2.40 at 20 percent: 0.40 of VAT, one sixth',
      values: { mode: 'extract', lines: '2.40', rates: 'VAT | 20', rounding: 'total', currency: 'GBP' },
    },
    {
      label: 'Add a state tax of 6.25 percent and a city tax of 2 percent to two items',
      values: {
        mode: 'add',
        lines: 'Coffee | 3.50\nCake | 4.25',
        rates: 'State | 6.25\nCity | 2',
        rounding: 'total',
        currency: 'USD',
      },
    },
    {
      label: 'Three lines of 0.05 at 10 percent, rounded on each line',
      values: { mode: 'add', lines: '0.05\n0.05\n0.05', rates: 'Tax | 10', rounding: 'line', currency: 'USD' },
    },
  ],
  run(values): ToolResult {
    try {
      const result = calculateSalesTax({
        mode: str(values, 'mode', 'add'),
        lines: str(values, 'lines'),
        rates: str(values, 'rates'),
        rounding: str(values, 'rounding', 'total'),
        currency: str(values, 'currency', 'USD'),
      });
      if (result === null) return { outputs: [] };
      const { summary } = result;
      const money = (value: string) => formatMoney(new D(value), summary.currency);
      const heading = (c: { name: string; rate: string }) => `${c.name} (${c.rate} %)`;

      const taxLabel = summary.mode === 'add' ? 'Tax added' : 'Tax taken out';
      const pairs: [string, string][] = [
        [summary.mode === 'add' ? 'Net total' : 'Net total (without tax)', money(summary.totals.net)],
        ...summary.components.map((c, i): [string, string] => [heading(c), money(summary.totals.taxes[i] ?? '0')]),
        [summary.components.length > 1 ? `${taxLabel}, all components` : taxLabel, money(summary.totals.tax)],
        [summary.mode === 'add' ? 'Gross total (with tax)' : 'Gross total', money(summary.totals.gross)],
        ['Rounding', summary.rounding === 'total' ? 'On the total, once' : 'On each line'],
      ];
      if (summary.fraction !== null) pairs.push(['VAT fraction (HMRC VAT Notice 700 section 7.3.1)', summary.fraction]);

      const outputs: OutputBlock[] = [
        { kind: 'keyvalue', label: 'Totals', pairs },
        {
          kind: 'table',
          label: 'Lines',
          table: {
            headers: ['Line', 'Description', 'Net', ...summary.components.map(heading), 'Gross'],
            rows: summary.rows.map((row) => [
              row.line,
              row.description,
              money(row.net),
              ...row.taxes.map(money),
              money(row.gross),
            ]),
            mono: [0, 2, ...summary.components.map((_, i) => i + 3), summary.components.length + 3],
          },
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
