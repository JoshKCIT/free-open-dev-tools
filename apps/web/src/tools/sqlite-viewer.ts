import {
  meta,
  checkDatabaseSize,
  SqliteViewerError,
  type SqliteColumnInfo,
  type SqliteRunOptions,
} from '@fodt/sqlite-viewer';
import { sqliteViewerInWorker, SqliteViewerRunError } from '../lib/run-sqlite-viewer-in-worker';
import {
  defineTool,
  bool,
  files,
  formatBytes,
  str,
  type DownloadableFile,
  type OutputBlock,
  type ToolResult,
} from '../lib/tool-ui';

/** The first 80 characters of a statement on one line, for a result's label. */
function statementLabel(statement: string): string {
  const flat = statement.replace(/\s+/g, ' ').trim();
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
}

/** One column of the schema table: its name and type, then the facts that matter. */
function columnText(column: SqliteColumnInfo): string {
  const parts = [column.name, column.type].filter((part) => part !== '');
  if (column.pk > 0) parts.push('PRIMARY KEY');
  if (column.notnull) parts.push('NOT NULL');
  if (column.dflt_value !== '') parts.push(`DEFAULT ${column.dflt_value}`);
  return parts.join(' ');
}

export default defineTool({
  id: 'sqlite-viewer',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  // Opening a database and running SQL on it is real background work, so this waits for a deliberate Run press
  // and offers Cancel while it runs. Every run goes through a new worker with a 10 second limit (see
  // run-sqlite-viewer-in-worker.ts's own comment): the engine may be stuck inside one synchronous call, so the
  // page, not the engine, decides when a run has taken too long.
  autoRun: false,
  cancellable: true,
  fields: [
    {
      name: 'file',
      label: 'Open a database',
      type: 'file',
      accept: '.sqlite,.sqlite3,.db,.db3,application/vnd.sqlite3,application/x-sqlite3',
    },
    {
      name: 'sql',
      label: 'SQL',
      type: 'textarea',
      rows: 8,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'Leave it empty to see the schema. With no file attached, SQL runs on an empty in-memory database.',
    },
    {
      name: 'rows',
      label: 'Rows shown',
      type: 'select',
      default: '500',
      options: [
        { value: '500', label: '500' },
        { value: '100', label: '100' },
      ],
    },
    {
      name: 'export',
      label: 'Export',
      type: 'select',
      default: 'none',
      options: [
        { value: 'none', label: 'No export' },
        { value: 'csv', label: 'CSV' },
        { value: 'json', label: 'JSON' },
      ],
    },
    { name: 'download', label: 'Also give me the changed database', type: 'checkbox', default: false },
  ],
  examples: [
    {
      label: 'Create, fill and query a table',
      values: {
        sql: "create table fruit(id integer primary key, name text, price real);\ninsert into fruit(name, price) values ('apple', 0.5), ('pear', 0.75), ('plum', 1.25);\nselect name, price, round(price * 100) as cents from fruit order by price desc;",
      },
    },
    {
      label: 'Window function',
      values: {
        sql: 'create table sales(day integer, amount integer);\ninsert into sales values (1, 10), (2, 15), (3, 7), (4, 20);\nselect day, amount, row_number() over (order by amount desc) as rank_by_amount, sum(amount) over (order by day) as running_total from sales order by day;',
      },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const picked = files(values, 'file');
    const file = picked[0];
    const sql = str(values, 'sql');
    if (!file && !sql.trim()) return { outputs: [] };

    const exportChoice = str(values, 'export', 'none');
    const options: SqliteRunOptions = {
      displayRows: str(values, 'rows', '500') === '100' ? 100 : 500,
      exportFormat: exportChoice === 'csv' || exportChoice === 'json' ? exportChoice : 'none',
      includeDatabase: bool(values, 'download'),
    };

    try {
      // Refused before any byte of the file is read.
      if (file) checkDatabaseSize(file.size);
      const bytes = file ? new Uint8Array(await file.arrayBuffer()) : null;
      const result = await sqliteViewerInWorker({ type: 'sqlite-viewer-job', bytes, sql, options }, ctx);

      const outputs: OutputBlock[] = [];
      if (result.statements === 0) {
        // Blank SQL: show what the database holds.
        if (result.schema.length === 0) {
          outputs.push({
            kind: 'note',
            tone: 'info',
            value: 'This database has no tables, views, indexes or triggers.',
          });
        } else {
          outputs.push({
            kind: 'table',
            label: 'Schema',
            table: {
              headers: ['Type', 'Name', 'Table', 'Columns'],
              rows: result.schema.map((entry) => [
                entry.type,
                entry.name,
                entry.table,
                entry.columns.map(columnText).join(', '),
              ]),
              mono: [1, 2, 3],
            },
          });
          outputs.push({
            kind: 'code',
            label: 'CREATE statements',
            language: 'sql',
            value: result.schema.map((entry) => `${entry.sql};`).join('\n\n'),
          });
        }
      }
      result.results.forEach((set, index) => {
        outputs.push({
          kind: 'table',
          label: `Result ${index + 1}: ${statementLabel(set.statement)}`,
          table: { headers: set.columns, rows: set.rows, mono: set.columns.map((_, i) => i) },
        });
        if (set.truncated) {
          outputs.push({ kind: 'note', tone: 'info', value: `Showing ${set.rows.length} of ${set.total} rows.` });
        }
      });

      if (result.statements > 0 && result.results.length === 0) {
        outputs.push({
          kind: 'note',
          tone: 'info',
          value: `Ran ${result.statements} ${result.statements === 1 ? 'statement' : 'statements'}. None returned rows.`,
        });
      }

      const downloads: DownloadableFile[] = result.exports.map((e) => ({
        name: e.name,
        mime: e.mime,
        content: e.content,
      }));
      if (result.database) {
        downloads.push({ name: 'changed.sqlite', mime: 'application/vnd.sqlite3', content: result.database });
      }
      if (downloads.length > 0) outputs.push({ kind: 'files', label: 'Downloads', files: downloads });

      return {
        outputs,
        ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
        stats: [
          ['Database', file ? formatBytes(file.size) : 'empty in-memory database'],
          ['Statements run', String(result.statements)],
          ['Rows changed', String(result.changes)],
        ],
      };
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the runner's own cancellation note already owns
      // that message.
      if (ctx.signal.aborted) throw err;
      if (err instanceof SqliteViewerError || err instanceof SqliteViewerRunError) {
        return { outputs: [], errors: [{ message: err.message }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
