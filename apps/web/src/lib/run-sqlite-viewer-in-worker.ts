/**
 * The page-side helper that starts the sqlite-viewer worker, waits for it to
 * report that it is ready, posts the job, and races the run against a fixed
 * time limit, terminating the worker unconditionally when the limit wins.
 *
 * Imports the worker with the build-time inlining suffix, not the
 * URL-and-constructor form -- see run-jsonpath-in-worker.ts's own comment
 * for why that line is load-bearing for the privacy harness.
 *
 * A close copy of run-go-formatter-in-worker.ts, not a shared helper -- same
 * reason that file gives for its own duplication -- plus a ready handshake.
 * Every run gets a NEW worker: SQLite keeps the database in the worker's
 * memory, and a trap or a runaway query may leave an instance in an
 * undefined state, so no run ever inherits the previous one's. Starting one
 * costs a few tens of milliseconds.
 *
 * The handshake exists because every worker on the site is a module worker
 * (apps/web/vite.config.ts), and a module whose evaluation is still running
 * drops a message posted to it. The worker says `sqlite-viewer-ready` as the
 * last statement of its module; the job is posted only then. Two limits
 * follow from that. A worker that never says ready is stopped after 10
 * seconds with its own message, so a tab whose worker cannot start does not
 * wait forever. The 10 second run limit starts when the job is posted, not
 * when the worker is created, so a slow start is never counted against the
 * visitor's query.
 *
 * The run limit is 10 seconds. Opening and querying a 134 MB database
 * measured 0.55 to 0.9 seconds in Chromium, Firefox and WebKit when run
 * alone, and the four-browser Playwright run drives many workers at once on
 * one machine, so 10 seconds is many times the slowest measured realistic
 * job and still short enough that nobody waits on a query that never ends
 * (a recursive query with no end condition never returns). The page owns
 * the limit because the worker is stuck inside one synchronous engine call
 * when it matters, and terminate() is the only real way to stop it.
 */
import SqliteViewerWorker from './workers/sqlite-viewer.worker.ts?worker&inline';
import type { SqliteViewerJobMessage, SqliteViewerWorkerMessage } from './workers/sqlite-viewer.worker';
import type { SqliteRunResult } from '@fodt/sqlite-viewer';
import type { RunContext } from './tool-ui';

export const SQLITE_VIEWER_TIME_LIMIT_MS = 10000;

export const SQLITE_VIEWER_TIME_LIMIT_MESSAGE =
  'Stopped after 10 seconds: this query took too long. Try a smaller query or add a LIMIT.';

export const SQLITE_VIEWER_START_LIMIT_MS = 10000;

export const SQLITE_VIEWER_START_LIMIT_MESSAGE =
  'The background task did not start within 10 seconds. Reload the page and try again.';

export class SqliteViewerRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqliteViewerRunError';
  }
}

/**
 * Runs one SQLite job in a new background worker, resolving with its
 * result. Settlement is the point of this function -- see
 * run-jsonpath-in-worker.ts's own comment on the guarded `settle` closure
 * this copies wholesale, covering success, an application error, a native
 * worker failure, an undeliverable message, an abort, an already-aborted
 * signal, the start limit and the time limit itself. Whichever of those
 * comes first decides the outcome; `settle` runs once, clears both timers
 * and terminates the worker once.
 */
export function sqliteViewerInWorker(job: SqliteViewerJobMessage, ctx: RunContext): Promise<SqliteRunResult> {
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<SqliteRunResult>((resolve, reject) => {
    const worker = new SqliteViewerWorker();
    let settled = false;
    let runTimer: ReturnType<typeof setTimeout> | undefined;
    // Whether the job has been posted. A worker that fails after that did start, so it is not reported as unable to.
    let posted = false;
    const failedMessage = () =>
      posted ? 'The background task stopped unexpectedly.' : 'The background task could not start.';

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
    };

    type Outcome = { ok: true; value: SqliteRunResult } | { ok: false; error: Error };

    const settle = (outcome: Outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(startTimer);
      clearTimeout(runTimer);
      try {
        removeListeners();
      } finally {
        worker.terminate();
      }
      if (outcome.ok) resolve(outcome.value);
      else reject(outcome.error);
    };

    const onMessage = (event: MessageEvent<SqliteViewerWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'sqlite-viewer-ready') {
        // The worker is listening. Only now does the run exist: the start timer has done its job, and the
        // time limit begins at the moment the job is posted.
        clearTimeout(startTimer);
        runTimer = setTimeout(() => {
          settle({ ok: false, error: new Error(SQLITE_VIEWER_TIME_LIMIT_MESSAGE) });
        }, SQLITE_VIEWER_TIME_LIMIT_MS);
        try {
          worker.postMessage(job, job.bytes ? [job.bytes.buffer as ArrayBuffer] : []);
          posted = true;
        } catch {
          settle({ ok: false, error: new Error('The background task could not start.') });
        }
      } else if (data.type === 'sqlite-viewer-done') {
        settle({ ok: true, value: data.result });
      } else {
        settle({ ok: false, error: new SqliteViewerRunError(data.message) });
      }
    };

    const onNativeError = () => {
      settle({ ok: false, error: new Error(failedMessage()) });
    };

    const onMessageError = () => {
      settle({ ok: false, error: new Error(failedMessage()) });
    };

    const onAbort = () => {
      settle({ ok: false, error: new Error('The run was cancelled.') });
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onNativeError);
    worker.addEventListener('messageerror', onMessageError);
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    const startTimer = setTimeout(() => {
      settle({ ok: false, error: new Error(SQLITE_VIEWER_START_LIMIT_MESSAGE) });
    }, SQLITE_VIEWER_START_LIMIT_MS);
  });
}
