import {
  meta,
  inspect,
  normalise,
  toEscapes,
  fromEscapes,
  UnicodeInspectorError,
  type NormalisationForm,
  type EscapeStyle,
} from '@fodt/unicode-inspector';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

/** D-24: the row cap for the inspection table. Stated in meta.json limits too. */
const ROW_CAP = 5000;

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

export default defineTool({
  id: 'unicode-inspector',
  docs: {
    about: meta.about,
    supports: meta.supports,
    limits: meta.limits,
    standards: meta.standards,
  },
  fields: [
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'inspect',
      options: [
        { value: 'inspect', label: 'Inspect' },
        { value: 'normalise', label: 'Normalise' },
        { value: 'escapes', label: 'Escape sequences' },
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
      name: 'form',
      label: 'Normalisation form',
      type: 'select',
      default: 'NFC',
      options: [
        { value: 'NFC', label: 'NFC — canonical composition' },
        { value: 'NFD', label: 'NFD — canonical decomposition' },
        { value: 'NFKC', label: 'NFKC — compatibility composition' },
        { value: 'NFKD', label: 'NFKD — compatibility decomposition' },
      ],
      visible: (v) => v.mode === 'normalise',
    },
    {
      name: 'escapeDirection',
      label: 'Direction',
      type: 'radio',
      default: 'toEscapes',
      options: [
        { value: 'toEscapes', label: 'Text → escapes' },
        { value: 'fromEscapes', label: 'Escapes → text' },
      ],
      visible: (v) => v.mode === 'escapes',
    },
    {
      name: 'style',
      label: 'Escape style',
      type: 'select',
      default: 'javascript',
      options: [
        { value: 'javascript', label: 'JavaScript (\\uXXXX)' },
        { value: 'html-numeric', label: 'HTML numeric (&#DDDD;)' },
        { value: 'code-point', label: 'Code point (\\u{HEX})' },
      ],
      visible: (v) => v.mode === 'escapes',
    },
  ],
  examples: [
    { label: 'Hidden zero-width space', values: { mode: 'inspect', input: 'ad​min' } },
    { label: 'Composed vs decomposed', values: { mode: 'normalise', input: 'é', form: 'NFC' } },
    { label: 'Escape to HTML numeric', values: { mode: 'escapes', input: 'café', style: 'html-numeric' } },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input) return { outputs: [] };
    const mode = str(values, 'mode', 'inspect');

    if (mode === 'inspect') {
      const rows = inspect(input);
      const invisibleCount = rows.filter((r) => r.invisible).length;
      const shown = rows.slice(0, ROW_CAP);
      const byteCount = rows.reduce((n, r) => n + (r.utf8Bytes ? r.utf8Bytes.split(' ').length : 0), 0);

      const outputs: OutputBlock[] = [
        {
          kind: 'table',
          label: 'Code points',
          table: {
            headers: ['Char', 'Visible as', 'Code point', 'Name', 'Category', 'UTF-8 bytes'],
            rows: shown.map((r) => [r.char, r.visibleAs, r.codePoint, r.name, r.category, r.utf8Bytes]),
            mono: [1, 2, 5],
          },
        },
      ];
      if (invisibleCount > 0) {
        outputs.push({
          kind: 'note',
          tone: 'info',
          value: `This text contains ${invisibleCount} invisible or non-printing character${invisibleCount === 1 ? '' : 's'}, shown above as a bracketed name or symbol so they do not disappear from the table.`,
        });
      }
      if (rows.length > ROW_CAP) {
        outputs.push({
          kind: 'note',
          tone: 'info',
          value: `This text has ${rows.length} code points. Only the first ${ROW_CAP} are shown as rows; every code point is still counted in the stats below.`,
        });
      }

      return {
        outputs,
        stats: [
          ['Code points', `${rows.length}`],
          ['UTF-8 bytes', `${byteCount}`],
          ['Invisible', `${invisibleCount}`],
        ],
      };
    }

    if (mode === 'normalise') {
      const form = str(values, 'form', 'NFC') as NormalisationForm;
      const result = normalise(input, form);
      return {
        outputs: [{ kind: 'code', label: form, value: result, download: 'normalised.txt' }],
        stats: [
          ['Input code points', `${Array.from(input).length}`],
          ['Output code points', `${Array.from(result).length}`],
          ['Changed', result === input ? 'no' : 'yes'],
        ],
      };
    }

    // mode === 'escapes'
    const style = str(values, 'style', 'javascript') as EscapeStyle;
    const direction = str(values, 'escapeDirection', 'toEscapes');
    try {
      if (direction === 'toEscapes') {
        const escaped = toEscapes(input, { style });
        return {
          outputs: [{ kind: 'code', label: 'Escaped', value: escaped, download: 'escaped.txt' }],
          stats: [['Style', style]],
        };
      }
      const text = fromEscapes(input, { style });
      return {
        outputs: [{ kind: 'code', label: 'Text', value: text, download: 'decoded.txt' }],
        stats: [['Style', style]],
      };
    } catch (err) {
      if (err instanceof UnicodeInspectorError) {
        const pos = err.position === undefined ? undefined : lineColumn(input, err.position);
        return { outputs: [], errors: [{ message: err.message, line: pos?.line, column: pos?.column }] };
      }
      throw err;
    }
  },
});
