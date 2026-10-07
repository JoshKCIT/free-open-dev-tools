/**
 * The page-side helper that starts the source map decoder's background task, waits for it to report that it is ready,
 * posts the job, and races the decode against a fixed time limit, terminating the task unconditionally when the limit
 * wins.
 *
 * Imports the worker with the build-time inlining suffix, not the URL-and-constructor form -- see
 * run-jsonpath-in-worker.ts's own comment for why that line is load-bearing for the privacy harness.
 *
 * A close copy of run-hex-viewer-in-worker.ts, not a shared helper -- same reason that file gives for its own
 * duplication. Every run gets a NEW task: it reads the opened map files and holds the decoded lines of every map, and a
 * run cancelled or stopped part way must leave nothing behind, so no run ever inherits the previous one's. Starting one
 * costs a few tens of milliseconds.
 *
 * The handshake exists because every worker on the site is a module worker (apps/web/vite.config.ts), and a module
 * whose evaluation is still running drops a message posted to it. The worker says `source-map-decoder-ready` as the
 * last statement of its module; the job is posted only then. Two limits follow from that. A task that never says ready
 * is stopped after 10 seconds with its own message, so a tab whose task cannot start does not wait forever. The 20
 * second decode limit starts when the job is posted, not when the task is created, so a slow start is never counted
 * against the visitor's maps.
 *
 * The decode limit is 20 seconds: a 40 MiB `mappings` string (8,000,000 segments) reads in well under a second, and
 * 20 seconds is many times that and still short enough that nobody waits on a decode that cannot finish. The page owns
 * the limit because the task is inside a long read when it matters, and terminate() is the only real way to stop it.
 */
import SourceMapDecoderWorker from './workers/source-map-decoder.worker.ts?worker&inline';
import type { SourceMapDecoderJobMessage, SourceMapDecoderWorkerMessage } from './workers/source-map-decoder.worker';
import type { DecodeReport } from '@fodt/source-map-decoder';
import type { RunContext } from './tool-ui';

export const SOURCE_MAP_DECODER_TIME_LIMIT_MS = 20000;

export const SOURCE_MAP_DECODER_TIME_LIMIT_MESSAGE =
  'Stopped after 20 seconds: the decode took too long. Try fewer or smaller maps, or a shorter trace.';

export const SOURCE_MAP_DECODER_START_LIMIT_MS = 10000;

export const SOURCE_MAP_DECODER_NOT_STARTED_MESSAGE = 'The background task could not start.';

export const SOURCE_MAP_DECODER_STOPPED_MESSAGE = 'The background task stopped unexpectedly.';

export const SOURCE_MAP_DECODER_START_LIMIT_MESSAGE =
  'The background task did not start within 10 seconds. Reload the page and try again.';

export class SourceMapDecoderRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceMapDecoderRunError';
  }
}

/**
 * Runs one decode in a new background task, resolving with its report. Settlement is the point of this function -- see
 * run-jsonpath-in-worker.ts's own comment on the guarded `settle` closure this copies wholesale, covering success, an
 * application error, a native task failure, an undeliverable message, an abort, an already-aborted signal, the start
 * limit and the time limit itself. Whichever of those comes first decides the outcome; `settle` runs once, clears both
 * timers and terminates the task once.
 */
export function sourceMapDecoderInWorker(message: SourceMapDecoderJobMessage, ctx: RunContext): Promise<DecodeReport> {
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<DecodeReport>((resolve, reject) => {
    const worker = new SourceMapDecoderWorker();
    let settled = false;
    let runTimer: ReturnType<typeof setTimeout> | undefined;
    // Whether the job has been posted. A task that fails after that did start, so it is not reported as unable to.
    let posted = false;
    const failedMessage = () => (posted ? SOURCE_MAP_DECODER_STOPPED_MESSAGE : SOURCE_MAP_DECODER_NOT_STARTED_MESSAGE);

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
    };

    type Outcome = { ok: true; value: DecodeReport } | { ok: false; error: Error };

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

    const onMessage = (event: MessageEvent<SourceMapDecoderWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'source-map-decoder-ready') {
        // The task is listening. Only now does the run exist: the start timer has done its job, and the time limit
        // begins at the moment the job is posted.
        clearTimeout(startTimer);
        runTimer = setTimeout(() => {
          settle({ ok: false, error: new Error(SOURCE_MAP_DECODER_TIME_LIMIT_MESSAGE) });
        }, SOURCE_MAP_DECODER_TIME_LIMIT_MS);
        try {
          worker.postMessage(message);
          posted = true;
        } catch {
          settle({ ok: false, error: new Error(SOURCE_MAP_DECODER_NOT_STARTED_MESSAGE) });
        }
      } else if (data.type === 'source-map-decoder-done') {
        settle({ ok: true, value: data.report });
      } else {
        settle({ ok: false, error: new SourceMapDecoderRunError(data.message) });
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
      settle({ ok: false, error: new Error(SOURCE_MAP_DECODER_START_LIMIT_MESSAGE) });
    }, SOURCE_MAP_DECODER_START_LIMIT_MS);
  });
}
