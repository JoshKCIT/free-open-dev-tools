import {
  EditorConfigError,
  MAX_LISTED,
  MAX_SHOWN_CELL,
  meta,
  resolveEditorConfig,
  visible,
  withCommas,
  type EditorConfigResult,
  type FileRow,
  type OverriddenRow,
  type PropertyRow,
  type SectionRow,
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

/** What a table cell or list item shows of a pasted name: hidden characters written out, and no more than a cell holds. */
function shown(text: string): string {
  return visible(text, MAX_SHOWN_CELL);
}

/** Where a setting is: the file, the section header and the line. */
function place(file: string, section: string, line: number): string {
  return `${shown(file)} [${shown(section)}] line ${line}`;
}

function decidedBy(row: PropertyRow): string {
  const where = place(row.file, row.section, row.line);
  return row.how === 'derived' && row.from !== undefined ? `derived from ${shown(row.from)}, set at ${where}` : where;
}

function propertiesBlocks(result: EditorConfigResult): OutputBlock[] {
  if (result.properties.length === 0) {
    return [
      {
        kind: 'note',
        tone: 'info',
        value:
          'No property applies to this path: no section of the files that were used matches it. That is an answer, not an error. The lists below show which sections were tried.',
      },
    ];
  }
  return [
    {
      kind: 'table',
      label: 'Properties that apply',
      table: {
        headers: ['Property', 'Value', 'Decided by', 'How'],
        rows: result.properties.map((row) => [
          shown(row.key),
          row.value === '' ? '(empty)' : shown(row.value),
          decidedBy(row),
          row.how,
        ]),
        mono: [0, 1, 2],
      },
    },
  ];
}

function overriddenRow(row: OverriddenRow): (string | number)[] {
  return [
    shown(row.key),
    row.value === '' ? '(empty)' : shown(row.value),
    place(row.file, row.section, row.line),
    place(row.byFile, row.bySection, row.byLine),
  ];
}

function overriddenBlocks(result: EditorConfigResult): OutputBlock[] {
  if (result.overridden.length === 0) return [];
  const shownRows = result.overridden.slice(0, MAX_LISTED);
  const blocks: OutputBlock[] = [
    {
      kind: 'table',
      label: 'Earlier settings that were overridden',
      table: {
        headers: ['Property', 'Earlier value', 'Set at', 'Replaced at'],
        rows: shownRows.map(overriddenRow),
        mono: [0, 1, 2, 3],
      },
    },
  ];
  const rest = result.overridden.length - shownRows.length;
  if (rest > 0) blocks.push(restNote(rest, 'setting', 'listed', 'the table'));
  return blocks;
}

/** A note that says how many more items there are than the list or table shows. */
function restNote(rest: number, noun: string, verb: string, where: string): OutputBlock {
  return {
    kind: 'note',
    tone: 'info',
    value: `${withCommas(rest)} more ${rest === 1 ? noun : noun + 's'} ${rest === 1 ? 'is' : 'are'} not ${verb}: ${where} stops at ${MAX_LISTED} items.`,
  };
}

function listBlocks<T>(label: string, rows: T[], line: (row: T) => string, noun: string): OutputBlock[] {
  if (rows.length === 0) return [];
  const blocks: OutputBlock[] = [{ kind: 'list', label, items: rows.slice(0, MAX_LISTED).map(line) }];
  if (rows.length > MAX_LISTED) blocks.push(restNote(rows.length - MAX_LISTED, noun, 'listed', 'the list'));
  return blocks;
}

function usedLine(row: FileRow): string {
  return row.root === true ? `${shown(row.label)} (sets root to true, so the search stops here)` : shown(row.label);
}

function notUsedLine(row: FileRow): string {
  return `${shown(row.label)}: ${row.reason ?? ''}`;
}

function matchedLine(row: SectionRow): string {
  return `${shown(row.file)} [${shown(row.section)}] line ${row.line}`;
}

function notMatchedLine(row: SectionRow): string {
  return `${matchedLine(row)}: ${row.reason ?? ''}`;
}

function problemBlocks(result: EditorConfigResult): OutputBlock[] {
  const blocks: OutputBlock[] = result.problems.slice(0, MAX_LISTED).map((problem) => ({
    kind: 'note',
    tone: 'warn',
    value: `${shown(problem.file)}, line ${problem.line}: ${problem.message}`,
  }));
  const rest = result.problems.length - blocks.length;
  if (rest > 0) blocks.push(restNote(rest, 'line problem', 'shown', 'the list of problems'));
  return blocks;
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
      const outputs: OutputBlock[] = [
        ...propertiesBlocks(result),
        ...overriddenBlocks(result),
        ...listBlocks('Files used', result.filesUsed, usedLine, 'file'),
        ...listBlocks('Files not used', result.filesNotUsed, notUsedLine, 'file'),
        ...listBlocks('Sections that matched', result.sectionsMatched, matchedLine, 'section'),
        ...listBlocks('Sections that did not match', result.sectionsNotMatched, notMatchedLine, 'section'),
        ...problemBlocks(result),
      ];
      for (const note of result.notes) outputs.push({ kind: 'note', tone: 'info', value: note });
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
