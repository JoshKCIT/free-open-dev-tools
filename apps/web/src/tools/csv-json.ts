import { meta, csvToJson, jsonToCsv, CsvJsonError } from '@fodt/csv-json';
import { defineTool, str, bool, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const DELIMITERS: Record<string, string> = { comma: ',', semicolon: ';', tab: '\t', pipe: '|' };

export default defineTool({
  id: 'csv-json',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'direction',
      label: 'Direction',
      type: 'radio',
      default: 'csv-to-json',
      options: [
        { value: 'csv-to-json', label: 'CSV to JSON' },
        { value: 'json-to-csv', label: 'JSON to CSV' },
      ],
    },
    {
      name: 'input',
      label: 'Input',
      type: 'textarea',
      rows: 14,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'delimiter',
      label: 'Delimiter',
      type: 'select',
      default: 'comma',
      options: [
        { value: 'comma', label: 'Comma' },
        { value: 'semicolon', label: 'Semicolon' },
        { value: 'tab', label: 'Tab' },
        { value: 'pipe', label: 'Pipe' },
      ],
    },
    { name: 'header', label: 'First row is a header', type: 'checkbox', default: true },
    {
      name: 'inferTypes',
      label: 'Infer types (true, false, null and numbers)',
      type: 'checkbox',
      default: false,
      visible: (values) => str(values, 'direction', 'csv-to-json') === 'csv-to-json',
    },
    {
      name: 'quoteAll',
      label: 'Quote every field',
      type: 'checkbox',
      default: false,
      visible: (values) => str(values, 'direction', 'csv-to-json') === 'json-to-csv',
    },
    {
      name: 'lineEnding',
      label: 'Line ending',
      type: 'select',
      default: 'crlf',
      options: [
        { value: 'crlf', label: 'CRLF (RFC 4180)' },
        { value: 'lf', label: 'LF' },
      ],
      visible: (values) => str(values, 'direction', 'csv-to-json') === 'json-to-csv',
    },
  ],
  examples: [
    { label: 'CSV to JSON', values: { direction: 'csv-to-json', input: 'name,quote\r\nAda,"Hello, world"' } },
    { label: 'JSON to CSV', values: { direction: 'json-to-csv', input: '[{"name":"Ada","note":"a, b"}]' } },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const direction = str(values, 'direction', 'csv-to-json');
    const delimiter = DELIMITERS[str(values, 'delimiter', 'comma')] ?? ',';
    const header = bool(values, 'header', true);

    try {
      const result =
        direction === 'json-to-csv'
          ? jsonToCsv(input, {
              delimiter,
              header,
              quoteAll: bool(values, 'quoteAll'),
              lineEnding: str(values, 'lineEnding', 'crlf') as 'crlf' | 'lf',
            })
          : csvToJson(input, { delimiter, header, inferTypes: bool(values, 'inferTypes') });

      const outputs: OutputBlock[] = [
        {
          kind: 'code',
          label: 'Output',
          language: direction === 'json-to-csv' ? undefined : 'json',
          value: result.output,
        },
      ];
      return {
        outputs,
        stats: [
          ['Rows', String(result.rows)],
          ['Columns', String(result.columns)],
        ],
      };
    } catch (err) {
      if (err instanceof CsvJsonError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
