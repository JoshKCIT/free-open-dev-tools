import {
  meta,
  encipher,
  decipher,
  caesarAllShifts,
  CIPHERS,
  ClassicalCipherError,
  type CipherName,
} from '@fodt/classical-cipher';
import { defineTool, str, num, bool, type OutputBlock, type ToolResult } from '../lib/tool-ui';

/** The table is built from at most this many code points; a much larger input would freeze the tab, 25 rows over. */
const ALL_SHIFTS_CHAR_CAP = 10000;

export default defineTool({
  id: 'classical-cipher',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'cipher',
      label: 'Cipher',
      type: 'select',
      default: 'caesar',
      options: CIPHERS.map((c) => ({ value: c.id, label: c.label })),
    },
    {
      name: 'direction',
      label: 'Direction',
      type: 'radio',
      default: 'encipher',
      options: [
        { value: 'encipher', label: 'Encipher' },
        { value: 'decipher', label: 'Decipher' },
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
      name: 'shift',
      label: 'Shift',
      type: 'number',
      default: 3,
      min: 0,
      max: 25,
      help: 'How many positions each letter moves.',
      visible: (v) => v.cipher === 'caesar' && !(v.direction === 'decipher' && v.allShifts === true),
    },
    {
      name: 'key',
      label: 'Key',
      type: 'text',
      default: '',
      help: 'A word or phrase. Non-letters in the key are ignored.',
      visible: (v) => v.cipher === 'vigenere',
    },
    {
      name: 'allShifts',
      label: 'Try every Caesar shift',
      type: 'checkbox',
      default: false,
      visible: (v) => v.cipher === 'caesar' && v.direction === 'decipher',
    },
  ],
  examples: [
    { label: 'Caesar', values: { cipher: 'caesar', direction: 'encipher', input: 'Attack at dawn', shift: 3 } },
    { label: 'ROT13', values: { cipher: 'rot13', direction: 'encipher', input: 'Hello, World!' } },
    { label: 'ROT47', values: { cipher: 'rot47', direction: 'encipher', input: 'Hello, World! 123' } },
    { label: 'Vigenere', values: { cipher: 'vigenere', direction: 'encipher', input: 'attackatdawn', key: 'lemon' } },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input) return { outputs: [] };

    const cipher = str(values, 'cipher', 'caesar') as CipherName;
    const direction = values.direction === 'decipher' ? 'decipher' : 'encipher';

    if (cipher === 'caesar' && direction === 'decipher' && bool(values, 'allShifts')) {
      const codePoints = Array.from(input);
      const wasCut = codePoints.length > ALL_SHIFTS_CHAR_CAP;
      const text = wasCut ? codePoints.slice(0, ALL_SHIFTS_CHAR_CAP).join('') : input;
      const rows = caesarAllShifts(text);

      const outputs: OutputBlock[] = [
        {
          kind: 'table',
          label: 'Every Caesar shift',
          table: {
            headers: ['Shift', 'Deciphered text'],
            rows: rows.map((r) => [String(r.shift), r.text]),
            mono: [0, 1],
          },
        },
      ];
      if (wasCut) {
        outputs.push({
          kind: 'note',
          tone: 'info',
          value: `This text is ${codePoints.length.toLocaleString()} characters long. Each row above shows only the first ${ALL_SHIFTS_CHAR_CAP.toLocaleString()} characters.`,
        });
      }

      return {
        outputs,
        stats: [
          ['Characters', String(codePoints.length)],
          ['Shifts tried', '25'],
        ],
      };
    }

    const options = {
      cipher,
      shift: num(values, 'shift', 3),
      key: str(values, 'key'),
    };

    try {
      const output = direction === 'decipher' ? decipher(input, options) : encipher(input, options);
      const descriptor = CIPHERS.find((c) => c.id === cipher);
      let transformed = 0;
      for (let i = 0; i < input.length; i++) if (input[i] !== output[i]) transformed++;

      return {
        outputs: [{ kind: 'code', label: descriptor?.label ?? cipher, value: output, download: 'cipher.txt' }],
        stats: [
          ['Characters', String(input.length)],
          ['Characters transformed', String(transformed)],
        ],
      };
    } catch (err) {
      if (err instanceof ClassicalCipherError) {
        return { outputs: [], errors: [{ message: err.message }] };
      }
      throw err;
    }
  },
});
