import { meta, buildTable, TableBuilderError } from '@fodt/table-builder';
import { defineTool, str, bool, grid, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const DELIMITERS: Record<string, string> = { comma: ',', semicolon: ';', tab: '\t', pipe: '|' };
const LANGUAGES: Record<string, string | undefined> = {
  markdown: 'markdown',
  html: 'html',
  csv: undefined,
  json: 'json',
};
const DOWNLOADS: Record<string, string> = {
  markdown: 'table.md',
  html: 'table.html',
  csv: 'table.csv',
  json: 'table.json',
};

const DEFAULT_GRID = [
  ['Column 1', 'Column 2'],
  ['', ''],
  ['', ''],
];

export default defineTool({
  id: 'table-builder',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    { name: 'table', label: 'Table', type: 'grid', default: DEFAULT_GRID },
    {
      name: 'format',
      label: 'Format',
      type: 'radio',
      default: 'markdown',
      options: [
        { value: 'markdown', label: 'Markdown' },
        { value: 'html', label: 'HTML' },
        { value: 'csv', label: 'CSV' },
        { value: 'json', label: 'JSON' },
      ],
    },
    { name: 'headerRow', label: 'First row is a header', type: 'checkbox', default: true },
    {
      name: 'alignments',
      label: 'Column alignments (optional)',
      type: 'text',
      placeholder: 'left, center, right',
      help: 'A comma list of left, center, right or none, one per column.',
    },
    {
      name: 'pad',
      label: 'Pad cells to column width',
      type: 'checkbox',
      default: true,
      visible: (values) => str(values, 'format', 'markdown') === 'markdown',
    },
    {
      name: 'csvDelimiter',
      label: 'Delimiter',
      type: 'select',
      default: 'comma',
      options: [
        { value: 'comma', label: 'Comma' },
        { value: 'semicolon', label: 'Semicolon' },
        { value: 'tab', label: 'Tab' },
        { value: 'pipe', label: 'Pipe' },
      ],
      visible: (values) => str(values, 'format', 'markdown') === 'csv',
    },
    {
      name: 'pretty',
      label: 'Pretty-print',
      type: 'checkbox',
      default: true,
      visible: (values) => ['html', 'json'].includes(str(values, 'format', 'markdown')),
    },
  ],
  examples: [
    {
      label: 'GFM example',
      values: {
        table: [
          ['foo', 'bar'],
          ['baz', 'bim'],
        ],
        format: 'markdown',
      },
    },
  ],
  run(values): ToolResult {
    const format = str(values, 'format', 'markdown') as 'markdown' | 'html' | 'csv' | 'json';

    try {
      const result = buildTable(grid(values, 'table'), {
        format,
        headerRow: bool(values, 'headerRow', true),
        alignments: str(values, 'alignments'),
        pad: bool(values, 'pad', true),
        csvDelimiter: DELIMITERS[str(values, 'csvDelimiter', 'comma')] ?? ',',
        pretty: bool(values, 'pretty', true),
      });

      const outputs: OutputBlock[] = [
        {
          kind: 'code',
          label: 'Output',
          language: LANGUAGES[format],
          value: result.output,
          download: DOWNLOADS[format],
        },
      ];
      if (result.warnings.length > 0) {
        outputs.push({ kind: 'note', label: 'Warnings', tone: 'warn', value: result.warnings.join('\n') });
      }

      return {
        outputs,
        stats: [
          ['Rows', String(result.rows)],
          ['Columns', String(result.columns)],
        ],
      };
    } catch (err) {
      if (err instanceof TableBuilderError) {
        return { outputs: [], errors: [{ message: err.message }] };
      }
      const message = err instanceof Error ? err.message : 'Could not build a table from that grid.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
