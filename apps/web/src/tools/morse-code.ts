import { meta, toMorse, fromMorse, MorseError, type ToMorseOptions, type FromMorseOptions } from '@fodt/morse-code';
import { defineTool, str, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'morse-code',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'direction',
      label: 'Direction',
      type: 'radio',
      default: 'encode',
      options: [
        { value: 'encode', label: 'Text to Morse' },
        { value: 'decode', label: 'Morse to text' },
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
      name: 'wordSeparator',
      label: 'Word separator',
      type: 'text',
      default: '/',
      help: 'Written between word groups in the Morse output, and accepted between words when reading Morse back in.',
    },
    {
      name: 'unsupportedPolicy',
      label: 'A character with no Morse code',
      type: 'select',
      default: 'reject',
      options: [
        { value: 'reject', label: 'Reject, and say where' },
        { value: 'drop', label: 'Drop it silently' },
        { value: 'replace', label: 'Replace with a stand-in code' },
      ],
      visible: (v) => v.direction === 'encode',
    },
  ],
  examples: [
    { label: 'SOS', values: { direction: 'encode', input: 'SOS' } },
    { label: 'Prosign', values: { direction: 'encode', input: '<AS> WAIT' } },
    { label: 'Decode', values: { direction: 'decode', input: '... --- .../--- -.-' } },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input) return { outputs: [] };

    const wordSeparator = str(values, 'wordSeparator', '/') || '/';

    if (values.direction === 'encode') {
      const unsupportedPolicy = str(values, 'unsupportedPolicy', 'reject') as ToMorseOptions['unsupportedPolicy'];
      try {
        const encoded = toMorse(input, { wordSeparator, unsupportedPolicy });
        const groups = encoded.split(/\s+/).filter(Boolean).length;
        return {
          outputs: [{ kind: 'code', label: 'Morse code', value: encoded, download: 'morse.txt' }],
          stats: [
            ['Characters', String(input.length)],
            ['Code groups', String(groups)],
          ],
        };
      } catch (err) {
        if (err instanceof MorseError) {
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
      const options: FromMorseOptions = { wordSeparator };
      const decoded = fromMorse(input, options);
      return {
        outputs: [{ kind: 'code', label: 'Decoded text', value: decoded, download: 'decoded.txt' }],
        stats: [['Decoded characters', String(decoded.length)]],
      };
    } catch (err) {
      if (err instanceof MorseError) {
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
