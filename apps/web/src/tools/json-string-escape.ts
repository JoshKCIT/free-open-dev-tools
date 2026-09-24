import { meta, escapeString, unescapeString, JsonStringError } from '@fodt/json-string-escape';
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

export default defineTool({
  id: 'json-string-escape',
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
      name: 'input',
      label: 'Input',
      type: 'textarea',
      rows: 10,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      default: '',
    },
    {
      name: 'escapeForwardSlash',
      label: 'Escape the forward slash (\\/)',
      type: 'checkbox',
      default: false,
      visible: (v) => v.direction === 'escape',
    },
    {
      name: 'escapeAboveAscii',
      label: 'Escape everything above ASCII',
      type: 'checkbox',
      default: false,
      visible: (v) => v.direction === 'escape',
    },
    {
      name: 'wrap',
      label: 'Wrap the result in double quotes',
      type: 'checkbox',
      default: false,
    },
    {
      name: 'strict',
      label: 'Strict Unicode (reject a lone surrogate escape instead of warning)',
      type: 'checkbox',
      default: false,
      visible: (v) => v.direction === 'unescape',
    },
  ],
  examples: [
    { label: 'Quotes and a newline', values: { direction: 'escape', input: 'Line one\nSays "hi"' } },
    { label: 'Out-of-plane character', values: { direction: 'escape', input: '\u{1D11E}', escapeAboveAscii: true } },
    { label: 'Lone surrogate', values: { direction: 'unescape', input: '\\uDEAD' } },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input) return { outputs: [] };

    const wrap = bool(values, 'wrap', false);

    if (values.direction === 'escape') {
      try {
        const result = escapeString(input, {
          escapeForwardSlash: bool(values, 'escapeForwardSlash', false),
          escapeAboveAscii: bool(values, 'escapeAboveAscii', false),
          wrap,
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
        if (err instanceof JsonStringError) {
          const pos = err.position === undefined ? undefined : lineColumn(input, err.position);
          return { outputs: [], errors: [{ message: err.message, line: pos?.line, column: pos?.column }] };
        }
        throw err;
      }
    }

    try {
      const result = unescapeString(input, { strict: bool(values, 'strict', false), wrap });
      return {
        outputs: [{ kind: 'code', label: 'Unescaped', value: result.value, download: 'unescaped.txt' }],
        warnings: result.warnings.map((w) => `${w.message} (position ${w.position})`),
        stats: [
          ['Input', `${input.length} char${input.length === 1 ? '' : 's'}`],
          ['Output', `${result.value.length} chars`],
        ],
      };
    } catch (err) {
      if (err instanceof JsonStringError) {
        const pos = err.position === undefined ? undefined : lineColumn(input, err.position);
        return { outputs: [], errors: [{ message: err.message, line: pos?.line, column: pos?.column }] };
      }
      throw err;
    }
  },
});
