import { meta, toWords, NumberToWordsError, type WordStyle } from '@fodt/number-to-words';
import { defineTool, str, bool, num, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'number-to-words',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'style',
      label: 'Style',
      type: 'radio',
      default: 'cardinal',
      options: [
        { value: 'cardinal', label: 'Cardinal' },
        { value: 'ordinal', label: 'Ordinal' },
        { value: 'currency', label: 'Currency' },
      ],
    },
    {
      name: 'value',
      label: 'Number',
      type: 'text',
      mono: true,
      default: '1994',
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'Spaces, commas, underscores and apostrophes are accepted as separators.',
    },
    {
      name: 'connective',
      label: 'Say "and" before the final small group (e.g. "one hundred and one")',
      type: 'checkbox',
      default: true,
    },
    {
      name: 'majorUnit',
      label: 'Major unit',
      type: 'text',
      default: 'dollar',
      visible: (v) => v.style === 'currency',
    },
    {
      name: 'minorUnit',
      label: 'Minor unit',
      type: 'text',
      default: 'cent',
      visible: (v) => v.style === 'currency',
    },
    {
      name: 'minorScale',
      label: 'Minor unit digits',
      type: 'number',
      default: 2,
      min: 0,
      max: 6,
      visible: (v) => v.style === 'currency',
    },
  ],
  examples: [
    { label: '1994', values: { style: 'cardinal', value: '1994' } },
    { label: '21st', values: { style: 'ordinal', value: '21' } },
    { label: '$12.34', values: { style: 'currency', value: '12.34' } },
    { label: 'Beyond a safe integer', values: { style: 'cardinal', value: '9007199254740993' } },
  ],
  run(values): ToolResult {
    const value = str(values, 'value');
    if (!value.trim()) return { outputs: [] };

    const style = str(values, 'style', 'cardinal') as WordStyle;
    const connective = bool(values, 'connective', true);

    try {
      const words = toWords(value, {
        style,
        connective,
        majorUnit: str(values, 'majorUnit', 'dollar'),
        minorUnit: str(values, 'minorUnit', 'cent'),
        minorScale: num(values, 'minorScale', 2),
      });

      return {
        outputs: [{ kind: 'text', label: 'In words', value: words }],
        stats: [
          ['Style', style],
          ['Digit count', String(value.replace(/[^0-9]/g, '').length)],
        ],
      };
    } catch (err) {
      if (err instanceof NumberToWordsError) {
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
