import { meta, encodeText, decodeToText, Base32Error, type Base32Alphabet, type CrockfordMode } from '@fodt/base32';
import { defineTool, str, bool, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'base32',
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
      default: 'encode',
      options: [
        { value: 'encode', label: 'Encode' },
        { value: 'decode', label: 'Decode' },
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
      name: 'alphabet',
      label: 'Alphabet',
      type: 'select',
      default: 'base32',
      options: [
        { value: 'base32', label: 'Base32 (RFC 4648 section 6)' },
        { value: 'base32hex', label: 'Base32hex (RFC 4648 section 7)' },
        { value: 'crockford', label: "Crockford's Base32" },
      ],
    },
    {
      name: 'padding',
      label: 'Add = padding',
      type: 'checkbox',
      default: true,
      help: 'RFC alphabets only. Crockford has no padding character.',
      visible: (v) => v.direction === 'encode' && v.alphabet !== 'crockford',
    },
    {
      name: 'crockfordMode',
      label: 'Crockford mode',
      type: 'radio',
      default: 'byte',
      options: [
        { value: 'byte', label: 'Byte mode (arbitrary bytes)' },
        { value: 'number', label: 'Number mode (a single integer)' },
      ],
      help: 'The two modes produce different strings for the same input. Number mode strips leading zero digits the way an integer does; byte mode does not.',
      visible: (v) => v.alphabet === 'crockford',
    },
    {
      name: 'crockfordChecksum',
      label: 'Add check symbol',
      type: 'checkbox',
      default: false,
      help: 'Appends one extra symbol, the payload value modulo 37, so a transcription error can be detected.',
      visible: (v) => v.alphabet === 'crockford',
    },
  ],
  examples: [
    { label: 'RFC vector', values: { direction: 'encode', input: 'foobar', alphabet: 'base32' } },
    { label: 'Base32hex', values: { direction: 'encode', input: 'foobar', alphabet: 'base32hex' } },
    {
      label: 'Crockford with checksum',
      values: {
        direction: 'encode',
        input: 'foobar',
        alphabet: 'crockford',
        crockfordMode: 'byte',
        crockfordChecksum: true,
      },
    },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input) return { outputs: [] };

    const alphabet = str(values, 'alphabet', 'base32') as Base32Alphabet;
    const crockfordMode = str(values, 'crockfordMode', 'byte') as CrockfordMode;
    const crockfordChecksum = bool(values, 'crockfordChecksum', false);

    if (values.direction === 'encode') {
      const encoded = encodeText(input, {
        alphabet,
        padding: bool(values, 'padding', true),
        crockfordMode,
        crockfordChecksum,
      });
      return {
        outputs: [{ kind: 'code', label: 'Encoded', value: encoded, download: 'encoded.txt' }],
        stats: [
          ['Input', `${input.length} char${input.length === 1 ? '' : 's'}`],
          ['Output', `${encoded.length} chars`],
          ['Alphabet', alphabet === 'crockford' ? `Crockford (${crockfordMode} mode)` : alphabet],
        ],
      };
    }

    try {
      const decoded = decodeToText(input, { alphabet, crockfordMode, crockfordChecksum });
      return {
        outputs: [{ kind: 'code', label: 'Decoded text', value: decoded, download: 'decoded.txt' }],
        stats: [
          ['Decoded', `${decoded.length} char${decoded.length === 1 ? '' : 's'}`],
          ['Alphabet', alphabet === 'crockford' ? `Crockford (${crockfordMode} mode)` : alphabet],
        ],
      };
    } catch (err) {
      if (err instanceof Base32Error) {
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
