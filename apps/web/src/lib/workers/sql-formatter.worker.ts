/**
 * Runs one SQL formatting/minifying job and posts back its result or its
 * error. Mirrors ts-to-js.worker.ts's shape: a single synchronous
 * `formatSql` call has no point partway through where it could report
 * progress, and this worker cannot report its own timeout either -- see
 * run-sql-formatter-in-worker.ts's own comment for why the page, not this
 * file, owns the time limit.
 */
import { formatSql, SqlFormatterError, type FormatSqlOptions, type FormatSqlResult } from '@fodt/sql-formatter';

export interface SqlFormatterJobMessage {
  type: 'sql-formatter-job';
  source: string;
  options: FormatSqlOptions;
}

export interface SqlFormatterDoneMessage {
  type: 'sql-formatter-done';
  result: FormatSqlResult;
}

export interface SqlFormatterErrorMessage {
  type: 'sql-formatter-error';
  message: string;
  line?: number;
  column?: number;
}

export type SqlFormatterWorkerMessage = SqlFormatterDoneMessage | SqlFormatterErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the
 * browser types tool pages need) but not the worker library, so
 * TypeScript resolves the ambient global in this file to a window-shaped
 * global rather than the worker's own global scope it actually is at
 * runtime. Narrowing once into this small locally declared shape
 * sidesteps the mismatch, the same pattern ts-to-js.worker.ts uses.
 */
interface WorkerGlobal {
  postMessage(message: SqlFormatterWorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<SqlFormatterJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

function handleJob(job: SqlFormatterJobMessage): void {
  try {
    const result = formatSql(job.source, job.options);
    workerGlobal.postMessage({ type: 'sql-formatter-done', result });
  } catch (err) {
    if (err instanceof SqlFormatterError) {
      workerGlobal.postMessage({
        type: 'sql-formatter-error',
        message: err.message,
        line: err.line,
        column: err.column,
      });
      return;
    }
    workerGlobal.postMessage({
      type: 'sql-formatter-error',
      message: err instanceof Error ? err.message : 'The background task failed for an unknown reason.',
    });
  }
}

workerGlobal.addEventListener('message', (event) => {
  handleJob(event.data);
});
