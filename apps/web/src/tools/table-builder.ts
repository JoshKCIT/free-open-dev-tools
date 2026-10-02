import { meta, buildTable, importTable, TableBuilderError, TableImportError } from '@fodt/table-builder';
import { defineTool, str, bool, grid, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const DELIMITERS: Record<string, string> = { comma: ',', semicolon: ';', tab: '\t', pipe: '|' };
const LANGUAGES: Record<string, string | undefined> = {
  markdown: 'markdown',
  html: 'html',
  csv: undefined,
  tsv: undefined,
  json: 'json',
};
const DOWNLOADS: Record<string, string> = {
  markdown: 'table.md',
  html: 'table.html',
  csv: 'table.csv',
  tsv: 'table.tsv',
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
      name: 'importFrom',
      label: 'Import from',
      type: 'select',
      default: 'grid',
      options: [
        { value: 'grid', label: 'The grid above' },
        { value: 'html', label: 'HTML' },
        { value: 'csv', label: 'CSV' },
        { value: 'tsv', label: 'TSV' },
        { value: 'markdown', label: 'Markdown' },
      ],
      help: 'Imported rows replace the grid for this run; the grid keeps what you typed.',
    },
    {
      name: 'importText',
      label: 'Table to import',
      type: 'textarea',
      rows: 8,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'The first table is read, up to 10,000 cells. HTML is read as text and never run.',
      visible: (values) => str(values, 'importFrom', 'grid') !== 'grid',
    },
    {
      name: 'importDelimiter',
      label: 'Import delimiter',
      type: 'select',
      default: 'comma',
      options: [
        { value: 'comma', label: 'Comma' },
        { value: 'semicolon', label: 'Semicolon' },
        { value: 'tab', label: 'Tab' },
        { value: 'pipe', label: 'Pipe' },
      ],
      visible: (values) => str(values, 'importFrom', 'grid') === 'csv',
    },
    {
      name: 'format',
      label: 'Format',
      type: 'radio',
      default: 'markdown',
      options: [
        { value: 'markdown', label: 'Markdown' },
        { value: 'html', label: 'HTML' },
        { value: 'csv', label: 'CSV' },
        { value: 'tsv', label: 'TSV' },
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
    const format = str(values, 'format', 'markdown') as 'markdown' | 'html' | 'csv' | 'tsv' | 'json';
    const importFrom = str(values, 'importFrom', 'grid');

    try {
      let source = grid(values, 'table');
      const importWarnings: string[] = [];
      if (importFrom !== 'grid') {
        const text = str(values, 'importText');
        if (text.trim() === '') return { outputs: [] };
        const imported = importTable(text, importFrom as 'html' | 'csv' | 'tsv' | 'markdown', {
          delimiter: (DELIMITERS[str(values, 'importDelimiter', 'comma')] ?? ',') as ',' | ';' | '\t' | '|',
        });
        source = imported.rows;
        importWarnings.push(...imported.warnings);
      }

      const result = buildTable(source, {
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
      if (importFrom !== 'grid') {
        outputs.push({
          kind: 'note',
          label: 'Imported table',
          tone: 'info',
          value: 'The imported rows replace the grid for this run.',
        });
      }
      const warnings = [...importWarnings, ...result.warnings];
      if (warnings.length > 0) {
        outputs.push({ kind: 'note', label: 'Warnings', tone: 'warn', value: warnings.join('\n') });
      }

      return {
        outputs,
        stats: [
          ['Rows', String(result.rows)],
          ['Columns', String(result.columns)],
        ],
      };
    } catch (err) {
      if (err instanceof TableBuilderError || err instanceof TableImportError) {
        return { outputs: [], errors: [{ message: err.message }] };
      }
      const message = err instanceof Error ? err.message : 'Could not build a table from that grid.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
