import { meta, calculateLoan, MoneyInputError, isBlank, formatMoney, D } from '@fodt/loan-calculator';
import { defineTool, str, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'loan-calculator',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'amount',
      label: 'Loan amount',
      type: 'text',
      placeholder: '162000',
      help: 'The amount borrowed, digits and an optional dot only.',
    },
    {
      name: 'rate',
      label: 'Annual interest rate (percent)',
      type: 'text',
      placeholder: '3.875',
      help: 'The yearly rate as a percent, for example 3.875. Nothing is filled in for you.',
    },
    {
      name: 'years',
      label: 'Term (years)',
      type: 'text',
      placeholder: '30',
      help: 'Up to 50 years, in steps of a quarter year for monthly payments, for example 30 or 0.25.',
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
      label: 'CFPB sample: 162,000 at 3.875 percent for 30 years',
      values: { amount: '162000', rate: '3.875', years: '30', currency: 'USD' },
    },
    {
      label: '1,200 at no interest for 1 year',
      values: { amount: '1200', rate: '0', years: '1', currency: 'USD' },
    },
  ],
  run(values): ToolResult {
    const amount = str(values, 'amount');
    const rate = str(values, 'rate');
    const years = str(values, 'years');
    if (isBlank(amount) && isBlank(rate) && isBlank(years)) return { outputs: [] };
    try {
      const result = calculateLoan({ amount, rate, years, currency: str(values, 'currency', 'USD') });
      const { summary } = result;
      return {
        outputs: [
          {
            kind: 'keyvalue',
            label: 'Summary',
            pairs: [
              ['Payment per month', formatMoney(new D(summary.payment), summary.currency)],
              ['Number of payments', summary.payments],
            ],
          },
          { kind: 'code', label: 'How this was worked out', value: result.working },
        ],
      };
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
