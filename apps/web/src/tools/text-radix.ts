import {
  meta,
  textToRadix,
  radixToText,
  ENCODINGS,
  TextRadixError,
  type Radix,
  type TextEncodingName,
} from '@fodt/text-radix';
import { defineTool, str, bool, type ToolResult } from '../lib/tool-ui';

/** Converts a character-offset position into a one-based line and column for multi-line input. */
function lineColumn(text: string, position: number): { line: number; column: number } {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < position && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      lastNewline = i;
    }
  }
  return { line, column: position - lastNewline };
}

const ENCODING_OPTIONS = (Object.keys(ENCODINGS) as TextEncodingName[]).map((value) => ({
  value,
  label: ENCODINGS[value].label,
}));

export default defineTool({
  id: 'text-radix',
  docs: {
    about: meta.about,
    supports: meta.supports,
    limits: meta.limits,
    standards: meta.standards,
  },
  fields: [
    {
      name: 'direction',
      label: 'Direction',
      type: 'radio',
      default: 'toRadix',
      options: [
        { value: 'toRadix', label: 'Text → digits' },
        { value: 'toText', label: 'Digits → text' },
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
      name: 'radix',
      label: 'Radix',
      type: 'select',
      default: 'hexadecimal',
      options: [
        { value: 'binary', label: 'Binary' },
        { value: 'octal', label: 'Octal' },
        { value: 'decimal', label: 'Decimal' },
        { value: 'hexadecimal', label: 'Hexadecimal' },
      ],
    },
    {
      name: 'encoding',
      label: 'Character encoding',
      type: 'select',
      default: 'utf-8',
      options: ENCODING_OPTIONS,
      help: 'The bytes each character produces depend on this choice. See limits for the windows-1252 caveat.',
    },
    {
      name: 'separator',
      label: 'Group separator',
      type: 'text',
      default: ' ',
      mono: true,
    },
    {
      name: 'fixedWidth',
      label: 'Pad every group to a fixed width',
      type: 'checkbox',
      default: true,
      visible: (v) => v.direction === 'toRadix',
    },
    {
      name: 'upperCase',
      label: 'Upper-case hexadecimal',
      type: 'checkbox',
      default: false,
      visible: (v) => v.direction === 'toRadix' && v.radix === 'hexadecimal',
    },
  ],
  examples: [
    { label: 'Digits are characters', values: { direction: 'toRadix', input: '255', radix: 'binary' } },
    { label: 'windows-1252 euro sign', values: { direction: 'toRadix', input: '€', encoding: 'windows-1252' } },
    { label: 'Decode', values: { direction: 'toText', input: '48 69 21', radix: 'hexadecimal' } },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input) return { outputs: [] };

    const radix = str(values, 'radix', 'hexadecimal') as Radix;
    const encoding = str(values, 'encoding', 'utf-8') as TextEncodingName;
    const separator = str(values, 'separator', ' ');
    const direction = str(values, 'direction', 'toRadix');

    if (direction === 'toRadix') {
      try {
        const fixedWidth = bool(values, 'fixedWidth', true);
        const upperCase = bool(values, 'upperCase', false);
        const groups = textToRadix(input, { radix, encoding, separator, fixedWidth, upperCase });
        const byteCount = groups.length === 0 ? 0 : groups.split(separator || ' ').filter(Boolean).length;
        return {
          outputs: [{ kind: 'code', label: 'Digits', value: groups, download: 'text-radix.txt' }],
          stats: [
            ['Characters', `${Array.from(input).length}`],
            ['Bytes', `${byteCount}`],
            ['Encoding', ENCODINGS[encoding].label],
          ],
        };
      } catch (err) {
        if (err instanceof TextRadixError) {
          const pos = err.position === undefined ? undefined : lineColumn(input, err.position);
          return { outputs: [], errors: [{ message: err.message, line: pos?.line, column: pos?.column }] };
        }
        throw err;
      }
    }

    try {
      const text = radixToText(input, { radix, encoding, separator });
      return {
        outputs: [{ kind: 'code', label: 'Text', value: text, download: 'decoded.txt' }],
        stats: [
          ['Characters', `${Array.from(text).length}`],
          ['Encoding', ENCODINGS[encoding].label],
        ],
      };
    } catch (err) {
      if (err instanceof TextRadixError) {
        const pos = err.position === undefined ? undefined : lineColumn(input, err.position);
        return { outputs: [], errors: [{ message: err.message, line: pos?.line, column: pos?.column }] };
      }
      throw err;
    }
  },
});
