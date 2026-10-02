/**
 * The page-side helper that starts the hex-viewer search worker, waits for it to report that it is ready, posts the job,
 * and races the search against a fixed time limit, terminating the worker unconditionally when the limit wins.
 *
 * Imports the worker with the build-time inlining suffix, not the URL-and-constructor form -- see
 * run-jsonpath-in-worker.ts's own comment for why that line is load-bearing for the privacy harness.
 *
 * A close copy of run-spreadsheet-converter-in-worker.ts, itself a close copy of run-go-formatter-in-worker.ts, not a
 * shared helper -- same reason those files give for their own duplication. Every search gets a NEW worker: it reads the
 * picked file as a stream, and a search cancelled or stopped part way must leave nothing behind, so no search ever
 * inherits the previous one's. Starting one costs a few tens of milliseconds.
 *
 * The handshake exists because every worker on the site is a module worker (apps/web/vite.config.ts), and a module
 * whose evaluation is still running drops a message posted to it. The worker says `hex-viewer-ready` as the last
 * statement of its module; the job is posted only then. Two limits follow from that. A worker that never says ready is
 * stopped after 10 seconds with its own message, so a tab whose worker cannot start does not wait forever. The 20 second
 * search limit starts when the job is posted, not when the worker is created, so a slow start is never counted against
 * the visitor's file.
 *
 * The search limit is 20 seconds: a 314.6 MB file was searched in 0.38 to 0.66 seconds in three browsers, so a search
 * over the 1 GiB the page allows takes a few seconds, and 20 seconds is several times that and still short enough that
 * nobody waits on a search that cannot finish. The page owns the limit because the worker is inside a long scan when it
 * matters, and terminate() is the only real way to stop it.
 */
import HexViewerWorker from './workers/hex-viewer.worker.ts?worker&inline';
import type { HexViewerJobMessage, HexViewerWorkerMessage } from './workers/hex-viewer.worker';
import type { SearchResult } from '@fodt/hex-viewer';
import type { RunContext } from './tool-ui';

export const HEX_VIEWER_TIME_LIMIT_MS = 20000;

export const HEX_VIEWER_TIME_LIMIT_MESSAGE =
  'Stopped after 20 seconds: the search took too long. Try a smaller file or a longer search term.';

export const HEX_VIEWER_START_LIMIT_MS = 10000;

export const HEX_VIEWER_START_LIMIT_MESSAGE =
  'The background task did not start within 10 seconds. Reload the page and try again.';

export class HexViewerRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HexViewerRunError';
  }
}

/**
 * Runs one search in a new background worker, resolving with its result. Settlement is the point of this function -- see
 * run-jsonpath-in-worker.ts's own comment on the guarded `settle` closure this copies wholesale, covering success, an
 * application error, a native worker failure, an undeliverable message, an abort, an already-aborted signal, the start
 * limit and the time limit itself. Whichever of those comes first decides the outcome; `settle` runs once, clears both
 * timers and terminates the worker once.
 */
export function hexViewerInWorker(message: HexViewerJobMessage, ctx: RunContext): Promise<SearchResult> {
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<SearchResult>((resolve, reject) => {
    const worker = new HexViewerWorker();
    let settled = false;
    let runTimer: ReturnType<typeof setTimeout> | undefined;

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
    };

    type Outcome = { ok: true; value: SearchResult } | { ok: false; error: Error };

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

    const onMessage = (event: MessageEvent<HexViewerWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'hex-viewer-ready') {
        // The worker is listening. Only now does the run exist: the start timer has done its job, and the time limit
        // begins at the moment the job is posted.
        clearTimeout(startTimer);
        runTimer = setTimeout(() => {
          settle({ ok: false, error: new Error(HEX_VIEWER_TIME_LIMIT_MESSAGE) });
        }, HEX_VIEWER_TIME_LIMIT_MS);
        try {
          worker.postMessage(message);
        } catch {
          settle({ ok: false, error: new Error('The background task could not start.') });
        }
      } else if (data.type === 'hex-viewer-done') {
        settle({ ok: true, value: data.result });
      } else {
        settle({ ok: false, error: new HexViewerRunError(data.message) });
      }
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

    const startTimer = setTimeout(() => {
      settle({ ok: false, error: new Error(HEX_VIEWER_START_LIMIT_MESSAGE) });
    }, HEX_VIEWER_START_LIMIT_MS);
  });
}
