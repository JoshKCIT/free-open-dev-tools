import { meta, toRoman, fromRoman, RomanNumeralError } from '@fodt/roman-numerals';
import { defineTool, str, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'roman-numerals',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'direction',
      label: 'Direction',
      type: 'radio',
      default: 'toRoman',
      options: [
        { value: 'toRoman', label: 'Integer to numeral' },
        { value: 'fromRoman', label: 'Numeral to integer' },
      ],
    },
    {
      name: 'value',
      label: 'Integer (1 to 3999)',
      type: 'number',
      default: 1994,
      min: 1,
      max: 3999,
      visible: (v) => v.direction === 'toRoman',
    },
    {
      name: 'numeral',
      label: 'Roman numeral',
      type: 'text',
      mono: true,
      default: 'MCMXCIV',
      placeholder: 'MCMXCIV',
      visible: (v) => v.direction === 'fromRoman',
    },
  ],
  examples: [
    { label: '1994', values: { direction: 'toRoman', value: 1994 } },
    { label: 'MCMXCIV', values: { direction: 'fromRoman', numeral: 'MCMXCIV' } },
    { label: 'The top of the range', values: { direction: 'toRoman', value: 3999 } },
  ],
  run(values): ToolResult {
    const direction = str(values, 'direction', 'toRoman');
    try {
      if (direction === 'fromRoman') {
        const numeral = str(values, 'numeral');
        if (!numeral.trim()) return { outputs: [] };
        const value = fromRoman(numeral);
        const canonical = toRoman(value);
        return {
          outputs: [{ kind: 'code', label: 'Integer', value: String(value) }],
          stats: [
            ['Value', String(value)],
            ['Numeral length', String(canonical.length)],
            ['Symbols used', String(new Set(canonical.split('')).size)],
          ],
        };
      }

      const raw = values.value;
      if (raw === undefined || raw === null || raw === '') return { outputs: [] };
      const value = typeof raw === 'number' ? raw : Number(raw);
      const numeral = toRoman(value);
      return {
        outputs: [{ kind: 'code', label: 'Roman numeral', value: numeral }],
        stats: [
          ['Numeral', numeral],
          ['Numeral length', String(numeral.length)],
          ['Symbols used', String(new Set(numeral.split('')).size)],
        ],
      };
    } catch (err) {
      if (err instanceof RomanNumeralError) {
        return {
          outputs: [],
          errors: [
            {
              message: err.message,
              line: err.position === undefined ? undefined : 1,
              column: err.position === undefined ? undefined : err.position + 1,
            },
          ],
        };
      }
      throw err;
    }
  },
});
