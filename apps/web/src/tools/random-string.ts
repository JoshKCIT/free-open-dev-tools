import { meta, generate, RandomStringError, type AlphabetName } from '@fodt/random-string';
import { defineTool, str, num, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const PRESET_LABELS: Record<AlphabetName, string> = {
  urlSafe: 'URL-safe (letters, digits, hyphen, underscore)',
  unambiguous: 'Unambiguous (look-alikes removed)',
  hex: 'Hexadecimal (0-9, a-f)',
  alphanumeric: 'Letters and digits',
  lower: 'Lower-case letters only',
  digits: 'Digits only',
};

export default defineTool({
  id: 'random-string',
  autoRun: false,
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'alphabet',
      label: 'Alphabet',
      type: 'select',
      default: 'urlSafe',
      options: [
        ...Object.entries(PRESET_LABELS).map(([value, label]) => ({ value, label })),
        { value: 'custom', label: 'Custom' },
      ],
    },
    {
      name: 'customAlphabet',
      label: 'Custom alphabet',
      type: 'text',
      mono: true,
      placeholder: 'Characters to draw from',
      visible: (v) => v.alphabet === 'custom',
    },
    { name: 'length', label: 'Length', type: 'number', default: 21, min: 1, max: 1024 },
    { name: 'count', label: 'How many', type: 'number', default: 1, min: 1, max: 1000 },
  ],
  examples: [
    { label: 'URL-safe identifier', values: { alphabet: 'urlSafe', length: 21 } },
    { label: 'Unambiguous code', values: { alphabet: 'unambiguous', length: 8 } },
  ],
  run(values): ToolResult {
    const alphabet = str(values, 'alphabet', 'urlSafe') as AlphabetName | 'custom';
    const customAlphabet = str(values, 'customAlphabet');
    const length = Math.min(Math.max(num(values, 'length', 21), 1), 1024);
    const count = Math.min(Math.max(num(values, 'count', 1), 1), 1000);

    let result: ReturnType<typeof generate>;
    try {
      result = generate({ alphabet, customAlphabet, length, count });
    } catch (err) {
      return {
        outputs: [],
        errors: [{ message: err instanceof RandomStringError ? err.message : 'Could not generate a random string.' }],
      };
    }

    const outputs: OutputBlock[] = [
      {
        kind: 'code',
        label: count === 1 ? 'Random string' : `${count} random strings`,
        value: result.values.join('\n'),
      },
    ];

    if (result.duplicatesRemoved > 0) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value: `The custom alphabet had ${result.duplicatesRemoved} duplicate character${result.duplicatesRemoved === 1 ? '' : 's'} removed before generating.`,
      });
    }

    return {
      outputs,
      stats: [
        ['Length', `${length} characters`],
        ['Alphabet size', String(result.alphabet.length)],
        ['Entropy', `${result.bitsPerValue.toFixed(1)} bits`],
        ['Source of randomness', result.source],
      ],
    };
  },
});
