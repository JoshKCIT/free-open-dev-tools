import { meta, generate, RandomNumberError, type RandomNumberSource } from '@fodt/random-number';
import { defineTool, str, bool, num, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'random-number',
  autoRun: false,
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'integer',
      options: [
        { value: 'integer', label: 'Integer' },
        { value: 'decimal', label: 'Decimal' },
      ],
    },
    { name: 'min', label: 'Minimum', type: 'number', default: 1 },
    { name: 'max', label: 'Maximum', type: 'number', default: 6 },
    { name: 'count', label: 'How many', type: 'number', default: 1, min: 1, max: 10000 },
    {
      name: 'places',
      label: 'Decimal places',
      type: 'number',
      default: 2,
      min: 0,
      max: 10,
      visible: (v) => v.mode === 'decimal',
    },
    {
      name: 'unique',
      label: 'No repeated values',
      type: 'checkbox',
      default: false,
      visible: (v) => v.mode === 'integer',
    },
    {
      name: 'source',
      label: 'Source of randomness',
      type: 'select',
      default: 'crypto',
      options: [
        { value: 'crypto', label: 'Cryptographic (crypto.getRandomValues)' },
        { value: 'math', label: 'Non-cryptographic (Math.random) — test data only' },
      ],
    },
  ],
  examples: [
    { label: 'Dice roll', values: { mode: 'integer', min: 1, max: 6, count: 1 } },
    { label: 'Ten unique picks', values: { mode: 'integer', min: 1, max: 49, count: 6, unique: true } },
    { label: 'Decimal 0-1', values: { mode: 'decimal', min: 0, max: 1, places: 3, count: 1 } },
  ],
  run(values): ToolResult {
    const mode = str(values, 'mode', 'integer') === 'decimal' ? 'decimal' : 'integer';
    const min = num(values, 'min', 1);
    const max = num(values, 'max', 6);
    const count = Math.max(1, Math.floor(num(values, 'count', 1)));
    const places = num(values, 'places', 2);
    const unique = bool(values, 'unique');
    const source = (str(values, 'source', 'crypto') === 'math' ? 'math' : 'crypto') as RandomNumberSource;

    try {
      const result = generate({ mode, min, max, count, places, unique, source });
      const noun = mode === 'integer' ? 'random integer' : 'random decimal';
      return {
        outputs: [
          {
            kind: 'code',
            label: `${result.values.length} ${noun}${result.values.length === 1 ? '' : 's'}`,
            value: result.values.join('\n'),
            download: 'random-numbers.txt',
          },
        ],
        stats: [
          ['Range', `${result.min}–${result.max}`],
          ['Source', result.source === 'crypto' ? 'crypto.getRandomValues' : 'Math.random'],
        ],
      };
    } catch (err) {
      if (err instanceof RandomNumberError) {
        return { outputs: [], errors: [{ message: err.message }] };
      }
      throw err;
    }
  },
});
