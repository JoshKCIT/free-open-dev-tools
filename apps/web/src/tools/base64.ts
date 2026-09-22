import {
  meta,
  encodeText,
  decodeToBytes,
  detectAlphabet,
  isValidUtf8,
  toHex,
  Base64Error,
  type Base64Alphabet,
} from '@fodt/base64';
import { defineTool, str, bool, num, type OutputBlock, type ToolResult } from '../lib/tool-ui';

function preview(bytes: Uint8Array, limit = 4096): string {
  const slice = bytes.length > limit ? bytes.slice(0, limit) : bytes;
  return (
    toHex(slice)
      .replace(/(.{2})/g, '$1 ')
      .trim() + (bytes.length > limit ? ' …' : '')
  );
}

export default defineTool({
  id: 'base64',
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
      rows: 10,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      default: '',
    },
    {
      name: 'alphabet',
      label: 'Alphabet',
      type: 'select',
      default: 'standard',
      options: [
        { value: 'standard', label: 'Standard (+ and /)' },
        { value: 'url', label: 'URL-safe (- and _)' },
      ],
      help: 'URL-safe is what JSON Web Tokens and most URL parameters use.',
      visible: (v) => v.direction === 'encode',
    },
    {
      name: 'decodeAlphabet',
      label: 'Alphabet',
      type: 'select',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Accept either' },
        { value: 'standard', label: 'Standard only (+ and /)' },
        { value: 'url', label: 'URL-safe only (- and _)' },
      ],
      visible: (v) => v.direction === 'decode',
    },
    {
      name: 'padding',
      label: 'Add = padding',
      type: 'checkbox',
      default: true,
      visible: (v) => v.direction === 'encode',
    },
    {
      name: 'lineLength',
      label: 'Wrap lines at',
      type: 'number',
      default: 0,
      min: 0,
      max: 200,
      help: '0 means one long line. 76 is what MIME uses.',
      visible: (v) => v.direction === 'encode',
    },
    {
      name: 'mode',
      label: 'Strictness',
      type: 'select',
      default: 'strict',
      options: [
        { value: 'strict', label: 'Strict — reject anything RFC 4648 does not allow' },
        { value: 'lenient', label: 'Lenient — ignore whitespace and missing padding' },
      ],
      visible: (v) => v.direction === 'decode',
    },
  ],
  examples: [
    { label: 'RFC vector', values: { direction: 'encode', input: 'foobar' } },
    { label: 'Unicode', values: { direction: 'encode', input: 'こんにちは 👋🏽' } },
    {
      label: 'JWT segment',
      values: {
        direction: 'decode',
        input: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        decodeAlphabet: 'auto',
        mode: 'lenient',
      },
    },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input) return { outputs: [] };

    if (values.direction === 'encode') {
      const encoded = encodeText(input, {
        alphabet: str(values, 'alphabet', 'standard') as Base64Alphabet,
        padding: bool(values, 'padding', true),
        lineLength: num(values, 'lineLength', 0),
      });
      const byteLength = new TextEncoder().encode(input).length;
      return {
        outputs: [{ kind: 'code', label: 'Base64', value: encoded, download: 'encoded.txt' }],
        stats: [
          ['Input', `${input.length} char${input.length === 1 ? '' : 's'}, ${byteLength} UTF-8 bytes`],
          ['Output', `${encoded.length} chars`],
          ['Overhead', `${byteLength === 0 ? '0' : Math.round(((encoded.length - byteLength) / byteLength) * 100)}%`],
        ],
        warnings:
          byteLength !== input.length
            ? [
                'This text contains characters outside ASCII. It was encoded as UTF-8 before Base64, which is what almost every system expects.',
              ]
            : undefined,
      };
    }

    try {
      const bytes = decodeToBytes(input, {
        alphabet: str(values, 'decodeAlphabet', 'auto') as Base64Alphabet | 'auto',
        mode: str(values, 'mode', 'strict') as 'strict' | 'lenient',
      });
      const valid = isValidUtf8(bytes);
      const text = new TextDecoder().decode(bytes);

      const outputs: OutputBlock[] = [
        {
          kind: 'code',
          label: valid ? 'Decoded text' : 'Decoded text (not valid UTF-8)',
          value: text,
          download: 'decoded.txt',
        },
      ];
      if (!valid) {
        outputs.unshift({
          kind: 'note',
          tone: 'warn',
          value:
            'These bytes are not valid UTF-8, so the text above contains replacement characters. The hex below shows the real bytes.',
        });
      }
      outputs.push({ kind: 'code', label: 'Bytes (hex)', value: preview(bytes) });
      outputs.push({
        kind: 'files',
        label: 'Exact bytes',
        files: [{ name: 'decoded.bin', mime: 'application/octet-stream', content: bytes }],
      });

      const detected = detectAlphabet(input);
      return {
        outputs,
        stats: [
          ['Decoded', `${bytes.length} byte${bytes.length === 1 ? '' : 's'}`],
          ['Alphabet', detected === 'ambiguous' ? 'either (no distinguishing characters)' : detected],
          ['Valid UTF-8', valid ? 'yes' : 'no'],
        ],
      };
    } catch (err) {
      if (err instanceof Base64Error) {
        return {
          outputs: [],
          errors: [{ message: err.message, column: err.position === undefined ? undefined : err.position + 1 }],
        };
      }
      throw err;
    }
  },
});
