import { TextEncodingFixerError, meta, repairMojibake, type RepairFrom } from '@fodt/text-encoding-fixer';
import { defineTool, str, type ToolResult, type Values } from '../lib/tool-ui';

type Mode = 'decode' | 'repair' | 'eol' | 'bom';

function modeOf(values: Values): Mode {
  const mode = str(values, 'mode', 'repair');
  return mode === 'decode' || mode === 'eol' || mode === 'bom' ? mode : 'repair';
}

/** The text of a count with English grouping. */
function count(n: number): string {
  return n.toLocaleString('en-US');
}

/** How many characters (code points) a text holds. */
function charactersOf(text: string): number {
  let n = 0;
  for (const character of text) {
    void character;
    n++;
  }
  return n;
}

function repair(values: Values): ToolResult {
  const text = str(values, 'text');
  if (text === '') return { outputs: [] };
  const from: RepairFrom = str(values, 'repairFrom', 'windows-1252') === 'iso-8859-1' ? 'iso-8859-1' : 'windows-1252';
  const result = repairMojibake(text, from, { perLine: false });
  const before = charactersOf(text);
  const after = charactersOf(result.text);
  return {
    outputs: [
      { kind: 'code', label: 'Repaired text', language: 'text', value: result.text, download: 'repaired.txt' },
      result.changed
        ? {
            kind: 'note',
            tone: 'success',
            value: `Repaired: ${count(before)} characters became ${count(after)}.`,
          }
        : { kind: 'note', tone: 'info', value: 'Nothing needed repair.' },
    ],
    stats: [
      ['Characters before', count(before)],
      ['Characters after', count(after)],
    ],
  };
}

export default defineTool({
  id: 'text-encoding-fixer',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'repair',
      options: [
        { value: 'decode', label: 'Decode bytes' },
        { value: 'repair', label: 'Repair garbled text' },
        { value: 'eol', label: 'Line endings' },
        { value: 'bom', label: 'Byte order mark' },
      ],
    },
    {
      name: 'text',
      label: 'Text',
      type: 'textarea',
      rows: 8,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'The text to work on. Byte order mark mode writes it as UTF-8 unless you give a file or hex below.',
      visible: (v) => modeOf(v) !== 'decode',
    },
    {
      name: 'file',
      label: 'File',
      type: 'file',
      help: 'Any file, up to 20 MiB, read in your browser. It is used instead of the text or hex below.',
      visible: (v) => modeOf(v) === 'decode' || modeOf(v) === 'bom',
    },
    {
      name: 'hex',
      label: 'Bytes as hex',
      type: 'textarea',
      rows: 4,
      mono: true,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'Used only when no file is attached above. Pairs of hex digits; spaces and line breaks are allowed.',
      visible: (v) => modeOf(v) === 'decode' || modeOf(v) === 'bom',
    },
    {
      name: 'encoding',
      label: 'Encoding label',
      type: 'text',
      default: 'windows-1252',
      placeholder: 'windows-1252',
      help: 'A WHATWG label such as windows-1252, windows-1251, koi8-r, iso-8859-2, shift_jis, gbk or utf-16le.',
      visible: (v) => modeOf(v) === 'decode',
    },
    {
      name: 'repairFrom',
      label: 'Repair from',
      type: 'select',
      default: 'windows-1252',
      options: [
        { value: 'windows-1252', label: 'Windows-1252' },
        { value: 'iso-8859-1', label: 'ISO-8859-1' },
      ],
      help: 'The encoding the UTF-8 bytes were wrongly read as.',
      visible: (v) => modeOf(v) === 'repair',
    },
  ],
  examples: [
    {
      label: 'Repair cafÃ© and quotes',
      values: {
        mode: 'repair',
        text: 'The cafÃ© said â€œhello, naÃ¯ve worldâ€\u009d and Ã¼ber â€™quotedâ€™ text',
        repairFrom: 'windows-1252',
      },
    },
  ],
  run(values, ctx): ToolResult {
    try {
      if (modeOf(values) === 'repair') return repair(values);
      return { outputs: [] };
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the runner's own cancellation note owns that message.
      if (ctx.signal.aborted) throw err;
      if (err instanceof TextEncodingFixerError) {
        const where = err.position === undefined ? '' : ` (character ${err.position})`;
        return { outputs: [], errors: [{ message: `${err.message}${where}` }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
