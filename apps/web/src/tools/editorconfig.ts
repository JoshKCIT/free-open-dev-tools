import {
  EditorConfigError,
  MAX_SHOWN_CELL,
  meta,
  resolveEditorConfig,
  visible,
  type EditorConfigResult,
  type PropertyRow,
} from '@fodt/editorconfig';
import { defineTool, str, type OutputBlock, type ToolIssue, type ToolResult } from '../lib/tool-ui';

const EXAMPLE_NESTED = [
  'root = true',
  '',
  '[*]',
  'indent_style = space',
  'indent_size = 4',
  'end_of_line = lf',
  '',
  '[*.md]',
  'trim_trailing_whitespace = false',
  '',
  '=== src ===',
  '[*.{js,ts}]',
  'indent_size = 2',
  '',
  '[lib/**.js]',
  'indent_style = tab',
].join('\n');

const EXAMPLE_ROOT_STOP = [
  'root = true',
  '',
  '[*]',
  'charset = utf-8',
  '',
  '=== docs ===',
  'root = true',
  '',
  '[*.md]',
  'indent_size = 2',
].join('\n');

/** What a table cell shows of a pasted name: hidden characters written out, and no more than a cell holds. */
function shown(text: string): string {
  return visible(text, MAX_SHOWN_CELL);
}

function decidedBy(row: PropertyRow): string {
  const place = `${shown(row.file)} [${shown(row.section)}] line ${row.line}`;
  return row.how === 'derived' && row.from !== undefined ? `derived from ${shown(row.from)}, set at ${place}` : place;
}

function propertiesBlock(result: EditorConfigResult): OutputBlock {
  return {
    kind: 'table',
    label: 'Properties that apply',
    table: {
      headers: ['Property', 'Value', 'Decided by', 'How'],
      rows: result.properties.map((row) => [shown(row.key), shown(row.value), decidedBy(row), row.how]),
      mono: [0, 1, 2],
    },
  };
}

export default defineTool({
  id: 'editorconfig',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'files',
      label: '.editorconfig files',
      type: 'textarea',
      rows: 14,
      wide: true,
      placeholder:
        'Type or paste here. Nothing leaves your browser. Start the file of each nested folder with a line such as === src ===.',
      help: 'The text before the first === folder === line is the file at the top folder. Each === folder === line starts the file of that folder.',
    },
    {
      name: 'path',
      label: 'File path',
      type: 'text',
      mono: true,
      placeholder: 'src/lib/index.js',
      help: 'Relative to the top folder, with forward slashes.',
    },
  ],
  examples: [
    {
      label: 'A nested folder overrides the top file',
      values: { files: EXAMPLE_NESTED, path: 'src/lib/index.js' },
    },
    {
      label: 'A root file stops the search',
      values: { files: EXAMPLE_ROOT_STOP, path: 'docs/guide.md' },
    },
  ],
  run(values): ToolResult {
    const files = str(values, 'files');
    const path = str(values, 'path');
    if (files.trim() === '' || path.trim() === '') return { outputs: [] };
    try {
      const result = resolveEditorConfig(files, path);
      const outputs: OutputBlock[] = [propertiesBlock(result)];
      outputs.push({
        kind: 'note',
        tone: 'info',
        value:
          'Only the files you paste are read: this page does not look at your disk. Editors honour only some properties, and properties the specification does not define are passed through as written.',
      });
      return { outputs };
    } catch (err) {
      if (err instanceof EditorConfigError) {
        // A line number is only a line of the paste when no file is named; otherwise the message names file and line.
        const issue: ToolIssue =
          err.line === undefined || err.file !== undefined
            ? { message: err.message }
            : { message: err.message, line: err.line };
        return { outputs: [], errors: [issue] };
      }
      return { outputs: [], errors: [{ message: 'Could not resolve these files.' }] };
    }
  },
});
