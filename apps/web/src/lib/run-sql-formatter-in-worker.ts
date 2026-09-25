/**
 * The page-side helper that starts the SQL formatting/minifying worker and
 * races it against a fixed time limit, terminating it unconditionally if
 * that limit wins.
 *
 * Imports the worker with the build-time inlining suffix, not the
 * URL-and-constructor form -- see run-jsonpath-in-worker.ts's own comment
 * for why that line is load-bearing for the privacy harness.
 *
 * A close copy of run-ts-to-js-in-worker.ts, not a shared helper -- same
 * reason that file gives for its own duplication. Measured this session
 * (D-57, profile first; T-05-29): a 200KB realistic script of 2,500 simple
 * statements formats in well under half a second, and minifying anything
 * (a single linear lexer pass) is fast regardless of shape. The real risk
 * is a deeply nested parenthesised expression: the installed sql-formatter
 * package's own grammar showed clear super-linear growth measured directly
 * against it (500 levels ~1.4s, 1,000 ~5.6s, 2,000 ~23s). `format` is, once
 * started, a single synchronous, un-interruptible call, exactly the same
 * category of runaway main-thread work `run-jsonpath-in-worker.ts` exists
 * for, so the same settle-once/terminate-on-timeout contract applies here,
 * covering both modes for a single, simple page-side code path.
 */
import SqlFormatterWorker from './workers/sql-formatter.worker.ts?worker&inline';
import type { SqlFormatterJobMessage, SqlFormatterWorkerMessage } from './workers/sql-formatter.worker';
import type { FormatSqlResult } from '@fodt/sql-formatter';
import type { RunContext } from './tool-ui';

/** The exact value this file enforces, same register as the regex, jsonpath and ts-to-js workers' own 1.5 second limit. */
export const SQL_FORMATTER_TIME_LIMIT_MS = 1500;

export const SQL_FORMATTER_TIME_LIMIT_MESSAGE =
  'Stopped after 1.5 seconds: this query took too long to process. Try a less deeply nested expression.';

export class SqlFormatterRunError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'SqlFormatterRunError';
    this.line = detail.line;
    this.column = detail.column;
  }
}

/**
 * Runs one formatting/minifying job in the background worker, resolving
 * with its result. Settlement is the point of this function -- see
 * run-jsonpath-in-worker.ts's own comment on the guarded `settle` closure
 * this copies wholesale, covering success, an application error, a native
 * worker failure, an undeliverable message, an abort, an already-aborted
 * signal, and the time limit itself.
 */
export function sqlFormatterInWorker(job: SqlFormatterJobMessage, ctx: RunContext): Promise<FormatSqlResult> {
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<FormatSqlResult>((resolve, reject) => {
    const worker = new SqlFormatterWorker();
    let settled = false;

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
    };

    type Outcome = { ok: true; value: FormatSqlResult } | { ok: false; error: Error };

    const settle = (outcome: Outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        removeListeners();
      } finally {
        worker.terminate();
      }
      if (outcome.ok) resolve(outcome.value);
      else reject(outcome.error);
    };

    const onMessage = (event: MessageEvent<SqlFormatterWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'sql-formatter-done') settle({ ok: true, value: data.result });
      else
        settle({ ok: false, error: new SqlFormatterRunError(data.message, { line: data.line, column: data.column }) });
    };

    const onNativeError = () => {
      settle({ ok: false, error: new Error('The background task could not start.') });
    };

    const onMessageError = () => {
      settle({ ok: false, error: new Error('The background task could not start.') });
    };

    const onAbort = () => {
      settle({ ok: false, error: new Error('The run was cancelled.') });
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onNativeError);
    worker.addEventListener('messageerror', onMessageError);
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    const timer = setTimeout(() => {
      settle({ ok: false, error: new Error(SQL_FORMATTER_TIME_LIMIT_MESSAGE) });
    }, SQL_FORMATTER_TIME_LIMIT_MS);

    try {
      worker.postMessage(job);
    } catch {
      settle({ ok: false, error: new Error('The background task could not start.') });
    }
  });
}
