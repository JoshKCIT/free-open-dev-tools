import { meta, calculateDepreciation, MoneyInputError, formatMoney, D } from '@fodt/depreciation';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'depreciation',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'method',
      label: 'Method',
      type: 'select',
      default: 'straight',
      options: [
        { value: 'straight', label: 'Straight line' },
        { value: 'declining', label: 'Declining balance, switching to straight line' },
        { value: 'syd', label: 'Sum of the years digits' },
        { value: 'units', label: 'Units of production' },
      ],
    },
    {
      name: 'cost',
      label: 'Cost',
      type: 'text',
      placeholder: '10000',
      help: 'What the asset cost, digits and an optional dot only.',
    },
    {
      name: 'salvage',
      label: 'Salvage value',
      type: 'text',
      placeholder: '0',
      help: 'What the asset is expected to be worth at the end. Leave it blank for 0. It cannot be more than the cost.',
    },
    {
      name: 'life',
      label: 'Useful life (years)',
      type: 'text',
      placeholder: '5',
      help: 'A whole number of years from 1 to 100.',
      visible: (v) => str(v, 'method', 'straight') !== 'units',
    },
    {
      name: 'factor',
      label: 'Declining balance factor',
      type: 'text',
      default: '2',
      help: 'The yearly rate is this factor divided by the useful life. 2 is the usual double rate. Above 0 and at most 10.',
      visible: (v) => str(v, 'method', 'straight') === 'declining',
    },
    {
      name: 'units',
      label: 'Units used each year, one per line',
      type: 'textarea',
      rows: 5,
      placeholder: '1000\n2000\n3000',
      help: 'One number per line, one line for each year, up to 100 lines. Nothing is filled in for you.',
      visible: (v) => str(v, 'method', 'straight') === 'units',
    },
    {
      name: 'totalUnits',
      label: 'Total units over the asset life',
      type: 'text',
      placeholder: '6000',
      help: 'Everything the asset is expected to produce or be used for in its whole life.',
      visible: (v) => str(v, 'method', 'straight') === 'units',
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
      label: '10,000 over 5 years, declining balance at factor 2',
      values: { method: 'declining', cost: '10000', salvage: '0', life: '5', factor: '2', currency: 'USD' },
    },
    {
      label: 'A 5,100 patent over 17 years, straight line',
      values: { method: 'straight', cost: '5100', salvage: '0', life: '17', currency: 'USD' },
    },
    {
      label: '10,000 with 1,000 salvage, units of production',
      values: {
        method: 'units',
        cost: '10000',
        salvage: '1000',
        units: '1000\n2000\n3000',
        totalUnits: '6000',
        currency: 'USD',
      },
    },
  ],
  run(values): ToolResult {
    try {
      const result = calculateDepreciation({
        method: str(values, 'method', 'straight'),
        cost: str(values, 'cost'),
        salvage: str(values, 'salvage'),
        life: str(values, 'life'),
        factor: str(values, 'factor'),
        units: str(values, 'units'),
        totalUnits: str(values, 'totalUnits'),
        currency: str(values, 'currency', 'USD'),
      });
      if (result === null) return { outputs: [] };
      const { summary } = result;
      const money = (text: string) => formatMoney(new D(text), summary.currency);

      const pairs: [string, string][] = [
        ['Method', summary.methodLabel],
        ['Cost', money(summary.cost)],
        ['Salvage value', money(summary.salvage)],
        ['Amount to depreciate', money(summary.depreciableAmount)],
        ['Total depreciation', money(summary.totalDepreciation)],
        ['Book value at the end', money(summary.finalBookValue)],
      ];
      if (summary.method === 'declining') {
        pairs.push([
          'Switch to straight line',
          summary.switchYear === null
            ? 'No switch, the declining amount is larger every year'
            : `Year ${summary.switchYear}`,
        ]);
      }
      if (summary.method === 'units' && summary.unitsUsed !== null && summary.totalUnits !== null) {
        pairs.push(['Units used of the total', `${summary.unitsUsed} of ${summary.totalUnits}`]);
      }
      const outputs: OutputBlock[] = [
        { kind: 'keyvalue', label: 'Totals', pairs },
        {
          kind: 'table',
          label: 'Schedule',
          table: {
            headers: ['Year', 'Opening book value', 'Depreciation', 'Accumulated', 'Closing book value'],
            rows: result.rows.map((row) => [
              row.year,
              money(row.opening),
              money(row.depreciation),
              money(row.accumulated),
              money(row.closing),
            ]),
            mono: [0, 1, 2, 3, 4],
          },
        },
        { kind: 'code', label: 'How this was worked out', value: result.working },
      ];
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
