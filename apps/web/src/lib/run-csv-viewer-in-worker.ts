/**
 * The page-side helper that starts the csv-viewer worker and races it
 * against a fixed time limit, terminating it unconditionally if that limit
 * wins.
 *
 * Imports the worker with the build-time inlining suffix, not the
 * URL-and-constructor form -- the single most important line in this file,
 * for exactly the reason `run-in-worker.ts` (plan 02-10) documents: the
 * default form emits the worker as a separately fetched file, and because
 * the worker is constructed when the visitor's input changes, that fetch
 * would land inside the window the privacy harness records, where it is an
 * offending request. The inlining form embeds the worker's code in the
 * page chunk and constructs it from an object URL, which the harness's
 * existing filter already excludes.
 *
 * A close copy of `run-regex-in-worker.ts`'s own settlement contract: one
 * guarded `settle` closure, the same fixed failure message on every
 * native-failure path, and a `setTimeout` race the page itself owns,
 * since a large synchronous parse/sort/filter pass has no JavaScript-level
 * yield point a runaway job could use to report its own elapsed time.
 */
import CsvViewerWorker from './workers/csv-viewer.worker.ts?worker&inline';
import type { CsvViewerJobMessage, CsvViewerWorkerMessage, CsvViewerJob } from './workers/csv-viewer.worker';
import { CsvViewerError, type ViewCsvResult } from '@fodt/csv-viewer';
import type { RunContext } from './tool-ui';

/** D-57's own "time limit" requirement; ten seconds gives a genuinely large file room to parse before this page gives up on it. */
export const CSV_TIME_LIMIT_MS = 10000;

export const CSV_TIME_LIMIT_MESSAGE =
  'Stopped after 10 seconds: this data took too long to read. Try a smaller file or a narrower filter.';

/**
 * Runs one csv-viewer job in the background worker, resolving with its
 * result.
 *
 * Settlement is the point of this function, not an afterthought: it
 * resolves or rejects exactly once, through the single guarded `settle`
 * closure below, covering every way a background job can end -- success, an
 * application-level error the worker reports on purpose, a native worker
 * failure that never gets to report anything, a message that could not be
 * delivered in either direction, an abort, a signal that was already
 * aborted before this function was even called, and the time limit itself.
 */
export function csvViewerInWorker(job: CsvViewerJob, ctx: RunContext): Promise<ViewCsvResult> {
  // Already aborted before construction: a listener registered on an
  // already-fired signal never runs, so this must be checked up front
  // rather than relying on the 'abort' listener registered below.
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<ViewCsvResult>((resolve, reject) => {
    const worker = new CsvViewerWorker();
    let settled = false;

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
    };

    type Outcome = { ok: true; value: ViewCsvResult } | { ok: false; error: Error };

    /**
     * The single place this promise settles. Guarded by `settled` so it
     * can be called from any of the listeners below, or from the timer,
     * without risk of a double resolve/reject. Always clears the timer,
     * always removes every listener and always terminates the worker.
     */
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

    const onMessage = (event: MessageEvent<CsvViewerWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'csv-viewer-done') settle({ ok: true, value: data.result });
      else if (data.type === 'csv-viewer-error') {
        settle({ ok: false, error: new CsvViewerError(data.message, data.line, data.column) });
      }
    };

    // Native worker failure: the worker throws while its module is
    // initialising, so it never gets to post anything of its own.
    const onNativeError = () => {
      settle({ ok: false, error: new Error('The background task could not start.') });
    };

    // A message could not be delivered in either direction. Treated the
    // same as a native failure rather than left to hang.
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

    // The outcome unique to this worker: parsing, sorting or filtering a
    // huge file genuinely froze the worker's own thread, so the WORKER
    // cannot post anything -- this timer, started right after
    // postMessage, is the only thing that can still notice.
    const timer = setTimeout(() => {
      settle({ ok: false, error: new Error(CSV_TIME_LIMIT_MESSAGE) });
    }, CSV_TIME_LIMIT_MS);

    const message: CsvViewerJobMessage = { type: 'csv-viewer-job', job };
    try {
      worker.postMessage(message);
    } catch {
      // postMessage throws synchronously when its argument cannot be
      // structured-cloned. Settle from the catch rather than leaving the
      // promise pending.
      settle({ ok: false, error: new Error('The background task could not start.') });
    }
  });
}
