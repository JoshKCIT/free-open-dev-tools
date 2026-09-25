import { meta, MAX_DISPLAY_ROWS, CsvViewerError, type ViewCsvOptions } from '@fodt/csv-viewer';
import { csvViewerInWorker } from '../lib/run-csv-viewer-in-worker';
import { defineTool, str, bool, files, type Field, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const DELIMITER_LABEL: Record<string, string> = { ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' };

const fields: Field[] = [
  { name: 'file', label: 'Open a file', type: 'file', accept: '.csv,.tsv,.txt,text/csv' },
  {
    name: 'input',
    label: 'Input',
    type: 'textarea',
    rows: 10,
    placeholder: 'Type or paste here. Nothing leaves your browser.',
    help: 'Used only when no file is attached above.',
  },
  {
    name: 'delimiter',
    label: 'Delimiter',
    type: 'select',
    default: 'auto',
    options: [
      { value: 'auto', label: 'Auto' },
      { value: ',', label: 'Comma' },
      { value: ';', label: 'Semicolon' },
      { value: '\t', label: 'Tab' },
      { value: '|', label: 'Pipe' },
    ],
  },
  { name: 'header', label: 'First row is a header', type: 'checkbox', default: true },
  { name: 'sortColumn', label: 'Sort column', type: 'text', placeholder: 'Header name or column number' },
  {
    name: 'sortDirection',
    label: 'Sort direction',
    type: 'select',
    default: 'asc',
    options: [
      { value: 'asc', label: 'Ascending' },
      { value: 'desc', label: 'Descending' },
    ],
  },
  {
    name: 'sortAs',
    label: 'Sort as',
    type: 'select',
    default: 'auto',
    options: [
      { value: 'auto', label: 'Auto' },
      { value: 'text', label: 'Text' },
      { value: 'number', label: 'Number' },
    ],
  },
  { name: 'filter', label: 'Filter text', type: 'text' },
  {
    name: 'filterColumn',
    label: 'Filter column',
    type: 'text',
    placeholder: 'Header name or column number, or leave blank for any',
  },
];

export default defineTool({
  id: 'csv-viewer',
  cancellable: true,
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields,
  async run(values, ctx): Promise<ToolResult> {
    const picked = files(values, 'file');
    let text: string;
    if (picked.length > 0) {
      text = await picked[0]!.text();
    } else {
      text = str(values, 'input');
    }
    if (!text.trim()) return { outputs: [] };

    const options: ViewCsvOptions = {
      delimiter: str(values, 'delimiter', 'auto'),
      header: bool(values, 'header', true),
      sortColumn: str(values, 'sortColumn'),
      sortDirection: str(values, 'sortDirection', 'asc') as 'asc' | 'desc',
      sortAs: str(values, 'sortAs', 'auto') as 'auto' | 'text' | 'number',
      filter: str(values, 'filter'),
      filterColumn: str(values, 'filterColumn'),
    };

    try {
      const result = await csvViewerInWorker({ text, options }, ctx);
      const outputs: OutputBlock[] = [];
      if (options.delimiter === 'auto' || options.delimiter === undefined) {
        outputs.push({
          kind: 'note',
          tone: 'info',
          value: `Detected delimiter: ${DELIMITER_LABEL[result.delimiter] ?? result.delimiter}`,
        });
      }
      if (result.matchedRows > MAX_DISPLAY_ROWS) {
        outputs.push({
          kind: 'note',
          tone: 'info',
          value: `Showing ${MAX_DISPLAY_ROWS} of ${result.matchedRows} matching rows`,
        });
      }
      outputs.push({ kind: 'table', table: { headers: result.headers, rows: result.rows } });
      if (result.warnings.length > 0) {
        outputs.push({ kind: 'note', tone: 'warn', value: result.warnings.join(' ') });
      }
      return {
        outputs,
        stats: [
          ['Rows', String(result.totalRows)],
          ['Columns', String(result.headers.length)],
          ['Matching rows', String(result.matchedRows)],
        ],
      };
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      if (err instanceof CsvViewerError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      const message = err instanceof Error ? err.message : 'Could not read that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
