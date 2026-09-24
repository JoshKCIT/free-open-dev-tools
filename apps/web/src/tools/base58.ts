import {
  meta,
  encodeBytes,
  decodeToBytes,
  encodeCheck,
  decodeCheck,
  Base58Error,
  type Base58Alphabet,
} from '@fodt/base58';
import { defineTool, str, bool, num, type ToolResult } from '../lib/tool-ui';

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

function fromHex(hexStr: string): Uint8Array {
  const cleaned = hexStr.replace(/[\s:_-]/g, '');
  const out = new Uint8Array(Math.ceil(cleaned.length / 2));
  for (let i = 0; i < cleaned.length; i += 2) {
    out[i / 2] = parseInt(cleaned.slice(i, i + 2).padEnd(2, '0'), 16) || 0;
  }
  return out;
}

export default defineTool({
  id: 'base58',
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
      label: 'Input (hex bytes)',
      type: 'text',
      mono: true,
      placeholder: 'de ad be ef',
      default: '',
      help: 'Paste hex bytes to encode, e.g. from a hash. Nothing leaves your browser.',
      visible: (v) => v.direction === 'encode',
    },
    {
      name: 'toDecode',
      label: 'Base58 value',
      type: 'text',
      mono: true,
      placeholder: '1PMycacnJaSqwwJqjawXBErnLsZ7RkXUAs',
      default: '',
      visible: (v) => v.direction === 'decode',
    },
    {
      name: 'alphabet',
      label: 'Alphabet',
      type: 'select',
      default: 'bitcoin',
      options: [
        { value: 'bitcoin', label: 'Bitcoin' },
        { value: 'ripple', label: 'Ripple (XRP Ledger)' },
        { value: 'flickr', label: 'Flickr' },
      ],
    },
    {
      name: 'check',
      label: 'Base58Check',
      type: 'checkbox',
      default: false,
      help: 'Adds a four-byte checksum (encode) or expects and verifies one (decode).',
    },
    {
      name: 'version',
      label: 'Version byte',
      type: 'number',
      default: 0,
      min: 0,
      max: 255,
      visible: (v) => v.direction === 'encode' && Boolean(v.check),
    },
  ],
  examples: [
    {
      label: 'Bitcoin address (Base58Check)',
      values: { direction: 'decode', toDecode: '1PMycacnJaSqwwJqjawXBErnLsZ7RkXUAs', alphabet: 'bitcoin', check: true },
    },
    { label: 'Plain bytes', values: { direction: 'encode', input: 'de ad be ef', alphabet: 'bitcoin', check: false } },
  ],
  run(values): ToolResult {
    const alphabet = str(values, 'alphabet', 'bitcoin') as Base58Alphabet;
    const check = bool(values, 'check', false);

    if (values.direction === 'encode') {
      const input = str(values, 'input');
      if (!input.trim()) return { outputs: [] };
      const bytes = fromHex(input);
      try {
        const version = num(values, 'version', 0);
        const encoded = check ? encodeCheck(version, bytes, { alphabet }) : encodeBytes(bytes, { alphabet });
        return {
          outputs: [{ kind: 'code', label: 'Base58', value: encoded, download: 'encoded.txt' }],
          stats: [
            ['Input', `${bytes.length} byte${bytes.length === 1 ? '' : 's'}`],
            ['Output', `${encoded.length} chars`],
            ['Alphabet', alphabet],
          ],
        };
      } catch (err) {
        if (err instanceof Base58Error) {
          return {
            outputs: [],
            errors: [
              { message: err.message, line: 1, column: err.position === undefined ? undefined : err.position + 1 },
            ],
          };
        }
        throw err;
      }
    }

    const toDecode = str(values, 'toDecode');
    if (!toDecode.trim()) return { outputs: [] };
    try {
      if (check) {
        const { version, payload } = decodeCheck(toDecode, { alphabet });
        return {
          outputs: [
            {
              kind: 'keyvalue',
              label: 'Decoded',
              pairs: [
                ['Version byte', String(version)],
                ['Payload (hex)', toHex(payload)],
              ],
            },
          ],
          stats: [
            ['Payload', `${payload.length} byte${payload.length === 1 ? '' : 's'}`],
            ['Alphabet', alphabet],
          ],
        };
      }
      const bytes = decodeToBytes(toDecode, { alphabet });
      return {
        outputs: [{ kind: 'code', label: 'Decoded (hex)', value: toHex(bytes), download: 'decoded.txt' }],
        stats: [
          ['Decoded', `${bytes.length} byte${bytes.length === 1 ? '' : 's'}`],
          ['Alphabet', alphabet],
        ],
      };
    } catch (err) {
      if (err instanceof Base58Error) {
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
