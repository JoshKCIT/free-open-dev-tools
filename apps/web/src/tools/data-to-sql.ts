import { meta, dataToSql, sqlToRows, DataToSqlError, type Dialect } from '@fodt/data-to-sql';
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
      name: 'direction',
      label: 'Direction',
      type: 'radio',
      default: 'to-sql',
      options: [
        { value: 'to-sql', label: 'Data to SQL' },
        { value: 'from-sql', label: 'SQL to rows' },
      ],
    },
    {
      name: 'format',
      label: 'Input format',
      type: 'radio',
      default: 'json',
      options: [
        { value: 'json', label: 'JSON (array of objects)' },
        { value: 'csv', label: 'CSV (with a header row)' },
      ],
      visible: (values) => str(values, 'direction', 'to-sql') === 'to-sql',
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
    {
      name: 'rowsFormat',
      label: 'Rows as',
      type: 'select',
      default: 'json',
      options: [
        { value: 'json', label: 'JSON' },
        { value: 'csv', label: 'CSV' },
      ],
      visible: (values) => str(values, 'direction', 'to-sql') === 'from-sql',
    },
    {
      name: 'tableFilter',
      label: 'Table filter',
      type: 'text',
      placeholder: 'all tables',
      help: 'Read only this table. CSV holds one table, so name it when the SQL has several.',
      visible: (values) => str(values, 'direction', 'to-sql') === 'from-sql',
    },
    {
      name: 'table',
      label: 'Table name',
      type: 'text',
      default: 'my_table',
      visible: (values) => str(values, 'direction', 'to-sql') === 'to-sql',
    },
    {
      name: 'createTable',
      label: 'Include CREATE TABLE',
      type: 'checkbox',
      default: true,
      visible: (values) => str(values, 'direction', 'to-sql') === 'to-sql',
    },
    {
      name: 'inferTypes',
      label: 'Infer types (true, false, null and numbers)',
      type: 'checkbox',
      default: true,
      visible: (values) => str(values, 'direction', 'to-sql') === 'to-sql' && str(values, 'format', 'json') === 'csv',
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
      visible: (values) => str(values, 'direction', 'to-sql') === 'to-sql' && str(values, 'format', 'json') === 'csv',
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
    {
      label: 'SQL to rows',
      values: {
        direction: 'from-sql',
        input: "INSERT INTO users (id, name) VALUES (1, 'Ada'), (2, 'Alan');",
        dialect: 'postgresql',
      },
    },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    if (str(values, 'direction', 'to-sql') === 'from-sql') {
      const rowsFormat = str(values, 'rowsFormat', 'json') === 'csv' ? 'csv' : 'json';
      try {
        const result = sqlToRows(input, {
          dialect: str(values, 'dialect', 'postgresql') as Dialect,
          rowsFormat,
          tableFilter: str(values, 'tableFilter'),
        });
        return {
          outputs: [
            {
              kind: 'code',
              label: 'Rows',
              language: rowsFormat === 'json' ? 'json' : undefined,
              value: result.output,
              download: rowsFormat === 'json' ? 'rows.json' : 'rows.csv',
            },
          ],
          warnings: result.warnings,
          stats: [
            ['Rows', String(result.rows)],
            ['Tables', String(result.tables.length)],
            ['Other statements skipped', String(result.skipped)],
          ],
        };
      } catch (err) {
        if (err instanceof DataToSqlError) {
          return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
        }
        const message = err instanceof Error ? err.message : 'Could not read that SQL.';
        return { outputs: [], errors: [{ message }] };
      }
    }

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
