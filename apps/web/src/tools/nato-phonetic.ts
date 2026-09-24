import {
  meta,
  toPhonetic,
  fromPhonetic,
  NatoPhoneticError,
  type ToPhoneticOptions,
  type FromPhoneticOptions,
} from '@fodt/nato-phonetic';
import { defineTool, str, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'nato-phonetic',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'direction',
      label: 'Direction',
      type: 'radio',
      default: 'encode',
      options: [
        { value: 'encode', label: 'Text to phonetic words' },
        { value: 'decode', label: 'Phonetic words to text' },
      ],
    },
    {
      name: 'input',
      label: 'Input',
      type: 'textarea',
      rows: 8,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      default: '',
    },
    {
      name: 'separator',
      label: 'Separator between words',
      type: 'text',
      default: ' ',
      help: 'Written between each spelled-out word, and accepted as any run of whitespace when reading back in.',
      visible: (v) => v.direction === 'encode',
    },
    {
      name: 'unsupportedPolicy',
      label: 'A character with no phonetic word',
      type: 'select',
      default: 'reject',
      options: [
        { value: 'reject', label: 'Reject, and say where' },
        { value: 'drop', label: 'Drop it silently' },
        { value: 'replace', label: 'Replace with a stand-in word' },
      ],
      visible: (v) => v.direction === 'encode',
    },
  ],
  examples: [
    { label: 'SOS', values: { direction: 'encode', input: 'SOS' } },
    { label: 'Digits', values: { direction: 'encode', input: 'ETA 2359' } },
    { label: 'Decode', values: { direction: 'decode', input: 'Sierra Oscar Sierra/Oscar Kilo' } },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input) return { outputs: [] };

    if (values.direction === 'encode') {
      const separator = str(values, 'separator', ' ') || ' ';
      const unsupportedPolicy = str(values, 'unsupportedPolicy', 'reject') as ToPhoneticOptions['unsupportedPolicy'];
      try {
        const spelled = toPhonetic(input, { separator, unsupportedPolicy });
        const words = spelled.split(/[\s/]+/).filter(Boolean).length;
        return {
          outputs: [{ kind: 'code', label: 'Phonetic spelling', value: spelled, download: 'phonetic.txt' }],
          stats: [
            ['Characters', String(input.length)],
            ['Words spelled', String(words)],
          ],
        };
      } catch (err) {
        if (err instanceof NatoPhoneticError) {
          const before = input.slice(0, err.position ?? 0);
          const line = before.split('\n').length;
          return {
            outputs: [],
            errors: [{ message: err.message, line, column: err.position === undefined ? undefined : err.position + 1 }],
          };
        }
        throw err;
      }
    }

    try {
      const options: FromPhoneticOptions = {};
      const decoded = fromPhonetic(input, options);
      return {
        outputs: [{ kind: 'code', label: 'Decoded text', value: decoded, download: 'decoded.txt' }],
        stats: [['Decoded characters', String(decoded.length)]],
      };
    } catch (err) {
      if (err instanceof NatoPhoneticError) {
        const before = input.slice(0, err.position ?? 0);
        const line = before.split('\n').length;
        return {
          outputs: [],
          errors: [{ message: err.message, line, column: err.position === undefined ? undefined : err.position + 1 }],
        };
      }
      throw err;
    }
  },
});
