import { meta, parseNumber, formatNumber, ScientificNotationError, type Notation } from '@fodt/scientific-notation';
import { defineTool, str, num, bool, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'scientific-notation',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'input',
      label: 'Value',
      type: 'text',
      mono: true,
      default: '0.000123',
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'A plain decimal, or scientific/E notation such as 1.23e-4. Thousands separators and underscores are accepted.',
    },
    {
      name: 'notation',
      label: 'Convert to',
      type: 'radio',
      default: 'scientific',
      options: [
        { value: 'decimal', label: 'Decimal' },
        { value: 'scientific', label: 'Scientific' },
        { value: 'engineering', label: 'Engineering' },
        { value: 'e', label: 'E notation' },
      ],
    },
    {
      name: 'letterExponent',
      label: 'Use the letter form of the exponent (1.5e+10) for scientific/engineering',
      type: 'checkbox',
      default: false,
      visible: (v) => v.notation === 'scientific' || v.notation === 'engineering',
    },
    {
      name: 'significantFigures',
      label: 'Round to this many significant figures',
      type: 'number',
      default: 0,
      min: 0,
      max: 100,
      help: '0 leaves the input exactly as stated, inventing no trailing zero.',
    },
  ],
  examples: [
    { label: 'Small value', values: { input: '0.000123', notation: 'scientific' } },
    { label: 'Engineering', values: { input: '12345.678', notation: 'engineering' } },
    {
      label: 'More digits than a double can hold',
      values: { input: '1.23456789012345678901234567890e50', notation: 'e' },
    },
    { label: 'Rounded', values: { input: '3.14159265', notation: 'decimal', significantFigures: 3 } },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const notation = str(values, 'notation', 'scientific') as Notation;
    const letterExponent = bool(values, 'letterExponent', false);
    const significantFigures = num(values, 'significantFigures', 0);

    try {
      const value = parseNumber(input);
      const formatted = formatNumber(value, notation, {
        letterExponent,
        ...(significantFigures > 0 ? { significantFigures } : {}),
      });

      return {
        outputs: [{ kind: 'code', label: 'Converted', value: formatted }],
        stats: [
          ['Significant figures', String(value.digits === '0' ? 1 : value.digits.length)],
          ['Exponent', String(value.exponent)],
          ['Separators stripped', value.separatorStripped ? 'yes' : 'no'],
        ],
      };
    } catch (err) {
      if (err instanceof ScientificNotationError) {
        return {
          outputs: [],
          errors: [
            { message: err.message, line: 1, column: err.position === undefined ? undefined : err.position + 1 },
          ],
        };
      }
      throw err;
    }
  },
});
