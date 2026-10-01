import { meta, calculateFees, MoneyInputError, formatMoney, D } from '@fodt/payment-fees';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const mode = (v: Record<string, unknown>) => str(v, 'mode', 'charge');

export default defineTool({
  id: 'payment-fees',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'Work out',
      type: 'select',
      default: 'charge',
      options: [
        { value: 'charge', label: 'Fee on a payment' },
        { value: 'receive', label: 'Amount to charge to receive a sum' },
      ],
    },
    {
      name: 'amount',
      label: 'Payment amount',
      type: 'text',
      placeholder: '100',
      help: 'The payment the fee is taken from, above 0, with no more decimal places than the currency has.',
      visible: (v) => mode(v) === 'charge',
    },
    {
      name: 'target',
      label: 'Amount you want to receive',
      type: 'text',
      placeholder: '100',
      help: 'What you want left after the fee, above 0, with no more decimal places than the currency has.',
      visible: (v) => mode(v) === 'receive',
    },
    {
      name: 'percentFee',
      label: 'Percentage fee (percent)',
      type: 'text',
      placeholder: '2.9',
      help: 'The percentage of each payment taken as a fee, 0 or more and below 100. Nothing is filled in for you; type 0 if there is none.',
    },
    {
      name: 'fixedFee',
      label: 'Fixed fee per payment',
      type: 'text',
      placeholder: '0.30',
      help: 'The fixed amount taken from each payment, 0 or more. Nothing is filled in for you; type 0 if there is none.',
    },
    {
      name: 'currency',
      label: 'Currency (ISO 4217 code)',
      type: 'text',
      default: 'USD',
      help: 'A three-letter code such as USD, EUR or JPY. It sets the decimal places the fee is rounded to.',
    },
  ],
  examples: [
    {
      label: 'Fee on a payment of 100 with a 2.9 percent fee plus 0.30',
      values: { mode: 'charge', amount: '100', percentFee: '2.9', fixedFee: '0.30', currency: 'USD' },
    },
    {
      label: 'Amount to charge to receive 100 after a 2.9 percent fee plus 0.30',
      values: { mode: 'receive', target: '100', percentFee: '2.9', fixedFee: '0.30', currency: 'USD' },
    },
    {
      label: 'Whole-unit currency: a 3.6 percent fee on 1,000 yen',
      values: { mode: 'charge', amount: '1000', percentFee: '3.6', fixedFee: '0', currency: 'JPY' },
    },
  ],
  run(values): ToolResult {
    try {
      const result = calculateFees({
        mode: mode(values),
        amount: str(values, 'amount'),
        target: str(values, 'target'),
        percentFee: str(values, 'percentFee'),
        fixedFee: str(values, 'fixedFee'),
        currency: str(values, 'currency', 'USD'),
      });
      if (result === null) return { outputs: [] };
      const { summary } = result;
      const outputs: OutputBlock[] = [
        {
          kind: 'keyvalue',
          label: 'Result',
          pairs: summary.lines.map((line): [string, string] => [
            line.label,
            formatMoney(new D(line.value), summary.currency),
          ]),
        },
      ];
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
