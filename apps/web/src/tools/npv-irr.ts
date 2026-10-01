import { meta, calculateCashFlows, MoneyInputError, isBlank, formatMoney, D } from '@fodt/npv-irr';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const OMB_NET_FLOWS = '0\n-10\n-20\n-25\n-20\n10\n30\n35\n35\n35\n20';

export default defineTool({
  id: 'npv-irr',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'flows',
      label: 'Cash flows, one per line, the first line is now (period 0): amount, or label | amount',
      type: 'textarea',
      rows: 8,
      placeholder: '-1000\n400\n400\n400',
      help: 'One cash flow per line, the first line is now (period 0) and is not discounted. A negative amount is money paid out. You can put a label and a vertical bar before an amount. Between 2 and 200 lines.',
    },
    {
      name: 'rate',
      label: 'Discount rate per period (percent)',
      type: 'text',
      placeholder: '10',
      help: 'The rate for one period as a percent, above -100. Nothing is filled in for you.',
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
      label: 'Ten years of net flows at a 3.1 percent discount rate',
      values: { flows: OMB_NET_FLOWS, rate: '3.1', currency: 'USD' },
    },
    {
      label: 'An outlay of 1,000 then three flows of 400, at 10 percent',
      values: { flows: '-1000\n400\n400\n400', rate: '10', currency: 'USD' },
    },
    {
      label: 'Two changes of sign, so more than one rate',
      values: { flows: '-1\n3\n-2', rate: '10', currency: 'USD' },
    },
  ],
  run(values): ToolResult {
    const flows = str(values, 'flows');
    const rate = str(values, 'rate');
    if (isBlank(flows) && isBlank(rate)) return { outputs: [] };
    try {
      const result = calculateCashFlows({ flows, rate, currency: str(values, 'currency', 'USD') });
      if (result === null) return { outputs: [] };
      const { summary } = result;
      const money = (text: string) => formatMoney(new D(text), summary.currency);
      const periods = (text: string | null) =>
        text === null ? 'Not reached within the cash flows' : `${text} periods`;

      const outputs: OutputBlock[] = [
        {
          kind: 'keyvalue',
          label: 'Results',
          pairs: [
            ['Net present value', money(summary.npv)],
            ['Internal rate of return', summary.irr.message],
            ['Payback', periods(summary.payback)],
            ['Discounted payback', periods(summary.discountedPayback)],
          ],
        },
      ];
      for (const warning of result.warnings) outputs.push({ kind: 'note', tone: 'warn', value: warning });
      outputs.push({
        kind: 'table',
        label: 'Period by period',
        table: {
          headers: [
            'Period',
            'Label',
            'Cash flow',
            'Discount factor',
            'Present value',
            'Running total',
            'Discounted running total',
          ],
          rows: result.rows.map((row) => [
            row.period,
            row.label,
            money(row.cashFlow),
            row.discountFactor,
            money(row.presentValue),
            money(row.runningTotal),
            money(row.discountedRunningTotal),
          ]),
          mono: [0, 2, 3, 4, 5, 6],
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
