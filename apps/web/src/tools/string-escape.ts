import { meta, escapeLiteral, unescapeLiteral, StringEscapeError, LANGUAGES, type Language } from '@fodt/string-escape';
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

const PER_LINE_LANGUAGES = new Set(['javascript', 'java', 'csharp', 'python', 'go']);
const QUOTE_LANGUAGES = new Set(['javascript', 'python']);
const NON_ASCII_LANGUAGES = new Set(['javascript', 'java', 'csharp', 'python', 'go']);
const WRAP_LANGUAGES = new Set(['javascript', 'java', 'csharp', 'python', 'go', 'sql']);

export default defineTool({
  id: 'string-escape',
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
      default: 'escape',
      options: [
        { value: 'escape', label: 'Escape' },
        { value: 'unescape', label: 'Unescape' },
      ],
    },
    {
      name: 'language',
      label: 'Language',
      type: 'select',
      default: 'javascript',
      options: LANGUAGES.map((l) => ({ value: l.id, label: l.label })),
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
      name: 'quote',
      label: 'Quote character',
      type: 'select',
      default: '"',
      options: [
        { value: '"', label: 'Double quote (")' },
        { value: "'", label: "Single quote (')" },
      ],
      visible: (v) => QUOTE_LANGUAGES.has(String(v.language)) && (v.direction === 'escape' || v.wrap === false),
    },
    {
      name: 'csharpForm',
      label: 'C# literal form',
      type: 'select',
      default: 'regular',
      options: [
        { value: 'regular', label: 'Regular ("...")' },
        { value: 'verbatim', label: 'Verbatim (@"...")' },
      ],
      visible: (v) => v.language === 'csharp',
    },
    {
      name: 'sqlStyle',
      label: 'SQL style',
      type: 'select',
      default: 'standard',
      options: [
        { value: 'standard', label: "Standard SQL ('' doubling)" },
        { value: 'mysql', label: 'MySQL / MariaDB (backslash escapes)' },
      ],
      visible: (v) => v.language === 'sql',
    },
    {
      name: 'csvDelimiter',
      label: 'CSV delimiter',
      type: 'select',
      default: ',',
      options: [
        { value: ',', label: 'Comma (,)' },
        { value: ';', label: 'Semicolon (;)' },
        { value: '\t', label: 'Tab' },
        { value: '|', label: 'Pipe (|)' },
      ],
      visible: (v) => v.language === 'csv',
    },
    {
      name: 'escapeNonAscii',
      label: 'Escape non-ASCII characters',
      type: 'checkbox',
      default: false,
      visible: (v) => v.direction === 'escape' && NON_ASCII_LANGUAGES.has(String(v.language)),
    },
    {
      name: 'wrap',
      label: 'Include the surrounding quotes',
      type: 'checkbox',
      default: true,
      visible: (v) => WRAP_LANGUAGES.has(String(v.language)),
    },
    {
      name: 'perLine',
      label: 'One literal per line',
      type: 'checkbox',
      default: false,
      visible: (v) => v.direction === 'escape' && PER_LINE_LANGUAGES.has(String(v.language)),
    },
  ],
  examples: [
    {
      label: 'JavaScript escape',
      values: { direction: 'escape', language: 'javascript', input: 'Line one\nShe said "hi"\twaved 👋' },
    },
    { label: 'Python unescape', values: { direction: 'unescape', language: 'python', input: '"café \\x41\\101"' } },
    { label: 'POSIX shell escape', values: { direction: 'escape', language: 'shell', input: "it's done" } },
    { label: 'Go unescape', values: { direction: 'unescape', language: 'go', input: '"\\xe2\\x9c\\x93 done"' } },
    { label: 'CSV escape', values: { direction: 'escape', language: 'csv', input: 'Smith, "Jo"' } },
    {
      label: 'Regular expression escape',
      values: { direction: 'escape', language: 'regex', input: 'price: $4.99 (approx.)' },
    },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input) return { outputs: [] };

    const language = str(values, 'language', 'javascript') as Language;
    const wrap = bool(values, 'wrap', true);
    const quote = str(values, 'quote', '"') as '"' | "'";
    const csharpForm = str(values, 'csharpForm', 'regular') as 'regular' | 'verbatim';
    const sqlStyle = str(values, 'sqlStyle', 'standard') as 'standard' | 'mysql';
    const csvDelimiter = str(values, 'csvDelimiter', ',') as ',' | ';' | '\t' | '|';

    if (values.direction === 'escape') {
      try {
        const result = escapeLiteral(input, {
          language,
          quote,
          escapeNonAscii: bool(values, 'escapeNonAscii', false),
          wrap,
          perLine: bool(values, 'perLine', false),
          csharpForm,
          sqlStyle,
          csvDelimiter,
        });
        return {
          outputs: [{ kind: 'code', label: 'Escaped', value: result.value, download: 'escaped.txt' }],
          warnings: result.warnings.map((w) => `${w.message} (position ${w.position})`),
          stats: [
            ['Input', `${input.length} char${input.length === 1 ? '' : 's'}`],
            ['Output', `${result.value.length} chars`],
          ],
        };
      } catch (err) {
        if (err instanceof StringEscapeError) {
          const pos = err.position === undefined ? undefined : lineColumn(input, err.position);
          return { outputs: [], errors: [{ message: err.message, line: pos?.line, column: pos?.column }] };
        }
        throw err;
      }
    }

    try {
      const result = unescapeLiteral(input, { language, quote, wrap, csharpForm, sqlStyle, csvDelimiter });
      return {
        outputs: [{ kind: 'code', label: 'Unescaped', value: result.value, download: 'unescaped.txt' }],
        warnings: result.warnings.map((w) => `${w.message} (position ${w.position})`),
        stats: [
          ['Input', `${input.length} char${input.length === 1 ? '' : 's'}`],
          ['Output', `${result.value.length} chars`],
        ],
      };
    } catch (err) {
      if (err instanceof StringEscapeError) {
        const pos = err.position === undefined ? undefined : lineColumn(input, err.position);
        return { outputs: [], errors: [{ message: err.message, line: pos?.line, column: pos?.column }] };
      }
      throw err;
    }
  },
});
