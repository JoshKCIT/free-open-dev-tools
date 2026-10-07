/**
 * The page-side helper that starts the font inspector's background worker, waits for it to report that it is ready, posts
 * the job, and races the unpacking against a fixed time limit, terminating the worker unconditionally when the limit wins.
 *
 * Imports the worker with the build-time inlining suffix, not the URL-and-constructor form -- see
 * run-jsonpath-in-worker.ts's own comment for why that line is load-bearing for the privacy harness.
 *
 * A close copy of run-hex-viewer-in-worker.ts, not a shared helper -- same reason that file gives for its own
 * duplication. Every job gets a NEW worker: it holds a font and the WOFF2 engine's memory, and a job cancelled or stopped
 * part way must leave nothing behind, so no job ever inherits the previous one's. Starting one costs a short moment while
 * the engine starts.
 *
 * The handshake exists because every worker on the site is a module worker (apps/web/vite.config.ts), and a module
 * whose evaluation is still running drops a message posted to it. The worker says `font-inspector-ready` as the last
 * statement of its module, after the engine has started; the job is posted only then. Two limits follow from that. A
 * worker that never says ready is stopped after 10 seconds with its own message, so a tab whose worker cannot start does
 * not wait forever. The 60 second limit starts when the job is posted, not when the worker is created, so a slow start is
 * never counted against the visitor's font.
 *
 * The limit is 60 seconds: unpacking a font takes a fraction of a second, so the limit is there for the conversion, whose
 * WOFF2 compression runs at about a second per MiB on a fast machine and is several times slower on a phone, and for the
 * re-read check that follows it. The page owns the limit because the worker is inside the engine when it matters, and
 * terminate() is the only real way to stop it.
 */
import FontInspectorWorker from './workers/font-inspector.worker.ts?worker&inline';
import type {
  FontInspectorJobMessage,
  FontInspectorWorkerMessage,
  FontInspectorWorkerResult,
} from './workers/font-inspector.worker';
import type { RunContext } from './tool-ui';

export type {
  FontInspectorConversion,
  FontInspectorWorkerResult,
  FontInspectorWrapper,
} from './workers/font-inspector.worker';

export const FONT_INSPECTOR_TIME_LIMIT_MS = 60000;

export const FONT_INSPECTOR_TIME_LIMIT_MESSAGE =
  'Stopped after 60 seconds: the font took too long to unpack or convert. No file was offered. Try a smaller file.';

export const FONT_INSPECTOR_START_LIMIT_MS = 10000;

export const FONT_INSPECTOR_START_LIMIT_MESSAGE =
  'The background task did not start within 10 seconds. Reload the page and try again.';

export class FontInspectorRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FontInspectorRunError';
  }
}

/**
 * Runs one job in a new background worker, resolving with its result. Settlement is the point of this function -- see
 * run-jsonpath-in-worker.ts's own comment on the guarded `settle` closure this copies wholesale, covering success, an
 * application error, a native worker failure, an undeliverable message, an abort, an already-aborted signal, the start
 * limit and the time limit itself. Whichever of those comes first decides the outcome; `settle` runs once, clears both
 * timers and terminates the worker once.
 */
export function fontInspectorInWorker(
  message: FontInspectorJobMessage,
  ctx: RunContext,
): Promise<FontInspectorWorkerResult> {
  if (ctx.signal.aborted) {
    return Promise.reject(new FontInspectorRunError('The run was cancelled before it started.'));
  }

  return new Promise<FontInspectorWorkerResult>((resolve, reject) => {
    const worker = new FontInspectorWorker();
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

    type Outcome = { ok: true; value: FontInspectorWorkerResult } | { ok: false; error: Error };

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

    const onMessage = (event: MessageEvent<FontInspectorWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'font-inspector-ready') {
        // The worker is listening and its engine has started. Only now does the run exist: the start timer has done its
        // job, and the time limit begins at the moment the job is posted.
        clearTimeout(startTimer);
        runTimer = setTimeout(() => {
          settle({ ok: false, error: new FontInspectorRunError(FONT_INSPECTOR_TIME_LIMIT_MESSAGE) });
        }, FONT_INSPECTOR_TIME_LIMIT_MS);
        try {
          worker.postMessage(message, [message.bytes.buffer]);
          posted = true;
        } catch {
          settle({ ok: false, error: new FontInspectorRunError('The background task could not start.') });
        }
      } else if (data.type === 'font-inspector-done') {
        settle({ ok: true, value: data.result });
      } else {
        settle({ ok: false, error: new FontInspectorRunError(data.message) });
      }
    };

    const onNativeError = () => {
      settle({ ok: false, error: new FontInspectorRunError(failedMessage()) });
    };

    const onMessageError = () => {
      settle({ ok: false, error: new FontInspectorRunError(failedMessage()) });
    };

    const onAbort = () => {
      settle({ ok: false, error: new FontInspectorRunError('The run was cancelled.') });
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onNativeError);
    worker.addEventListener('messageerror', onMessageError);
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    const startTimer = setTimeout(() => {
      settle({ ok: false, error: new FontInspectorRunError(FONT_INSPECTOR_START_LIMIT_MESSAGE) });
    }, FONT_INSPECTOR_START_LIMIT_MS);
  });
}
