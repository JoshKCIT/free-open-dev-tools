import {
  QUANTITIES,
  UnitConverterError,
  convertUnit,
  findUnit,
  listUnits,
  meta,
  type Quantity,
} from '@fodt/unit-converter';
import { defineTool, num, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

/** The quantity named by the select, which can only hold one of the fourteen. */
function quantityOf(text: string): Quantity {
  return QUANTITIES.find((q) => q.id === text)?.id ?? 'length';
}

function exactText(exact: boolean): string {
  return exact ? 'yes' : 'no, the factor is rounded to the digits shown';
}

export default defineTool({
  id: 'unit-converter',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'quantity',
      label: 'Quantity',
      type: 'select',
      default: 'length',
      options: QUANTITIES.map((q) => ({ value: q.id, label: q.label })),
    },
    {
      name: 'value',
      label: 'Value',
      type: 'text',
      placeholder: '1',
      mono: true,
      help: 'A plain decimal number, read exactly as typed. Up to 50 digits, between -1e100 and 1e100.',
    },
    {
      name: 'from',
      label: 'From unit',
      type: 'text',
      placeholder: 'mi',
      help: 'A symbol (with its case: mm is not Mm) or a name, such as mi, mile, kg, pound, F or celsius.',
    },
    {
      name: 'to',
      label: 'To unit',
      type: 'text',
      placeholder: 'km',
      help: 'Leave blank to see the value in every unit of the quantity.',
    },
    {
      name: 'digits',
      label: 'Significant digits',
      type: 'number',
      default: 10,
      min: 1,
      max: 30,
      step: 1,
      help: 'A whole number from 1 to 30. Results are rounded half to even.',
    },
  ],
  examples: [
    {
      label: 'Miles to kilometres',
      values: { quantity: 'length', value: '26.2', from: 'mi', to: 'km', digits: 10 },
    },
    {
      label: 'Fahrenheit to Celsius',
      values: { quantity: 'temperature', value: '98.6', from: 'F', to: 'C', digits: 10 },
    },
  ],
  run(values, ctx): ToolResult {
    try {
      const quantity = quantityOf(str(values, 'quantity', 'length'));
      const value = str(values, 'value');
      if (value.trim() === '') return { outputs: [] };
      const digits = num(values, 'digits', 10);
      const from = str(values, 'from');
      const to = str(values, 'to');

      if (to.trim() === '') {
        const rows = listUnits(quantity, value, from, digits);
        const unit = findUnit(quantity, from, 'From unit');
        const outputs: OutputBlock[] = [
          {
            kind: 'table',
            label: `${value.trim()} ${unit.symbol} in every unit`,
            table: {
              headers: ['Unit', 'Symbol', 'Value', 'Factor to base', 'Exact'],
              rows: rows.map((row) => [row.name, row.symbol, row.value, row.factor, row.exact ? 'yes' : 'no']),
              mono: [1, 2, 3],
            },
          },
          {
            kind: 'note',
            tone: 'info',
            value: `Factor to base says how each unit becomes the base unit of ${QUANTITIES.find((q) => q.id === quantity)?.label.toLowerCase() ?? ''}. Exact is yes only when the definition is exact and the factor is a finite decimal.`,
          },
        ];
        return { outputs };
      }

      const conversion = convertUnit(quantity, value, from, to, digits);
      const target = findUnit(quantity, to, 'To unit');
      const outputs: OutputBlock[] = [
        {
          kind: 'keyvalue',
          label: 'Conversion',
          pairs: [
            ['Result', `${conversion.result} ${target.symbol}`],
            ['Factor', conversion.factor],
            ['Exact', exactText(conversion.exact)],
            ['Definition', conversion.definition],
          ],
        },
      ];
      return { outputs };
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the runner's own cancellation note owns that message.
      if (ctx.signal.aborted) throw err;
      if (err instanceof UnitConverterError) return { outputs: [], errors: [{ message: err.message }] };
      const message = err instanceof Error ? err.message : 'Could not convert that.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
