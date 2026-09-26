import { meta, convertAll, ColorConverterError } from '@fodt/color-converter';
import { defineTool, str, num, bool, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'color-converter',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'input',
      label: 'Colour',
      type: 'text',
      default: '#3366ff',
      placeholder: '#3366ff, rgb(51 102 255), hsl(220 100% 60%), oklch(58% 0.19 264)',
      help: 'HEX, rgb(), hsl(), hwb(), lab(), lch(), oklab(), oklch() or device-cmyk() text.',
    },
    {
      name: 'precision',
      label: 'Precision',
      type: 'select',
      default: '3',
      options: [0, 1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) })),
    },
    { name: 'legacy', label: 'Legacy comma syntax', type: 'checkbox', default: false },
  ],
  examples: [
    { label: 'Royal blue', values: { input: '#3366ff' } },
    { label: 'HSL', values: { input: 'hsl(150 77.78% 55%)' } },
    { label: 'Out of gamut OKLCH', values: { input: 'oklch(70% 0.4 150)' } },
    { label: 'Device CMYK', values: { input: 'device-cmyk(0 81% 81% 30%)' } },
  ],
  run(values): ToolResult {
    const input = str(values, 'input', '#3366ff');
    const precision = num(values, 'precision', 3);
    const legacy = bool(values, 'legacy', false);

    let result;
    try {
      result = convertAll(input, { precision, legacy });
    } catch (err) {
      if (err instanceof ColorConverterError) {
        return { outputs: [], errors: [{ message: err.message }] };
      }
      throw err;
    }

    const outputs: OutputBlock[] = [
      {
        kind: 'swatches',
        label: result.inGamut ? 'Colour' : 'Colour (exact and mapped)',
        colors: result.inGamut
          ? [{ css: result.swatch, label: result.swatch }]
          : [
              { css: result.swatch, label: result.swatch, caption: 'Mapped into sRGB' },
              { css: result.formats.find((f) => f.format === 'oklch')!.value, label: 'exact', caption: 'Outside sRGB' },
            ],
      },
      {
        kind: 'table',
        label: 'Formats',
        table: {
          headers: ['Format', 'Value'],
          rows: result.formats.map((f) => [f.format.toUpperCase(), f.value]),
          mono: [1],
        },
      },
      {
        kind: 'keyvalue',
        label: 'Gamut',
        pairs: [
          ['Inside sRGB', result.inGamut ? 'Yes' : 'No'],
          ['Mapping distance', result.mapped ? result.deltaE.toFixed(4) : '0'],
        ],
      },
    ];

    if (result.mapped) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value:
          'This colour is outside the sRGB gamut. The sRGB-bound formats above show it mapped into range by the CSS Color 4 gamut mapping algorithm; LAB, LCH, OKLAB and OKLCH show the exact value.',
      });
    }

    return { outputs, warnings: result.warnings.length > 0 ? result.warnings : undefined };
  },
});
