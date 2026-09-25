import { meta, dataToSql, DataToSqlError, type Dialect } from '@fodt/data-to-sql';
import { defineTool, str, bool, type ToolResult } from '../lib/tool-ui';

const DIALECT_LABELS: Record<Dialect, string> = {
  postgresql: 'PostgreSQL',
  mysql: 'MySQL',
  sqlite: 'SQLite',
  sqlserver: 'SQL Server',
};

export default defineTool({
  id: 'data-to-sql',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'format',
      label: 'Input format',
      type: 'radio',
      default: 'json',
      options: [
        { value: 'json', label: 'JSON (array of objects)' },
        { value: 'csv', label: 'CSV (with a header row)' },
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
      name: 'dialect',
      label: 'SQL dialect',
      type: 'select',
      default: 'postgresql',
      options: (['postgresql', 'mysql', 'sqlite', 'sqlserver'] as Dialect[]).map((d) => ({
        value: d,
        label: DIALECT_LABELS[d],
      })),
    },
    { name: 'table', label: 'Table name', type: 'text', default: 'my_table' },
    { name: 'createTable', label: 'Include CREATE TABLE', type: 'checkbox', default: true },
    {
      name: 'inferTypes',
      label: 'Infer types (true, false, null and numbers)',
      type: 'checkbox',
      default: true,
      visible: (values) => str(values, 'format', 'json') === 'csv',
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
      visible: (values) => str(values, 'format', 'json') === 'csv',
    },
  ],
  examples: [
    {
      label: 'JSON to PostgreSQL',
      values: { format: 'json', input: '[{"id":1,"name":"Ada"},{"id":2,"name":"Alan"}]', dialect: 'postgresql' },
    },
    { label: 'CSV to SQLite', values: { format: 'csv', input: 'id,name\n1,Ada\n2,Alan', dialect: 'sqlite' } },
    {
      label: 'A value that tries to end the string early',
      values: { format: 'json', input: '[{"id":1,"note":"; DROP TABLE t; --"}]', dialect: 'mysql' },
    },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const format = str(values, 'format', 'json') as 'json' | 'csv';
    const dialect = str(values, 'dialect', 'postgresql') as Dialect;
    const table = str(values, 'table', 'my_table');
    const delimiterMap: Record<string, string> = { comma: ',', semicolon: ';', tab: '\t', pipe: '|' };

    try {
      const result = dataToSql(input, {
        format,
        dialect,
        table: table.trim() === '' ? 'my_table' : table,
        createTable: bool(values, 'createTable', true),
        inferTypes: bool(values, 'inferTypes', true),
        delimiter: delimiterMap[str(values, 'delimiter', 'comma')] ?? ',',
      });

      return {
        outputs: [{ kind: 'code', label: 'SQL', language: 'sql', value: result.output }],
        warnings: result.warnings,
        stats: [
          ['Rows', String(result.rows)],
          ['Columns', String(result.columns)],
          ['Statements', String(result.output === '' ? 0 : result.output.split('\n\n').length)],
        ],
      };
    } catch (err) {
      if (err instanceof DataToSqlError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
