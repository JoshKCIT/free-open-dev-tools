/**
 * The page-side helper that starts the email viewer's background worker, waits for it to report that it is ready, posts the
 * job, and races the run against a fixed time limit, terminating the worker unconditionally when the limit wins.
 *
 * Imports the worker with the build-time inlining suffix, not the URL-and-constructor form -- see
 * run-jsonpath-in-worker.ts's own comment for why that line is load-bearing for the privacy harness.
 *
 * A close copy of run-glob-tester-in-worker.ts, not a shared helper -- the same reason that file gives for its own
 * duplication. Every run gets a NEW worker, so no run ever inherits anything from the previous one. Starting one costs
 * a few tens of milliseconds.
 *
 * The handshake exists because every worker on the site is a module worker (apps/web/vite.config.ts), and a module
 * whose evaluation is still running drops a message posted to it. The worker says `eml-viewer-ready` as the last
 * statement of its module; the job is posted only then. Two limits follow from that. A worker that never says ready is
 * stopped after 10 seconds with its own message, so a tab whose worker cannot start does not wait forever. The 20 second
 * run limit starts when the job is posted, not when the worker is created, so a slow start is never counted against the
 * visitor's message.
 *
 * Reading a message of 25 MiB, decoding its parts and hashing every attachment is real work, which is why it runs here
 * and not on the page; the page owns the limit because the worker may be stuck inside one synchronous call when it
 * matters, and terminate() is the only real way to stop it.
 *
 * Only the picked file or the pasted bytes go in. The analysis comes back, with the attachment buffers handed over rather
 * than copied, or a fixed sentence; no message holds any text of the message.
 */
import EmlViewerWorker from './workers/eml-viewer.worker.ts?worker&inline';
import type { EmlViewerJobMessage, EmlViewerWorkerMessage } from './workers/eml-viewer.worker';
import type { EmlAnalysis, EmlViewerPart } from '@fodt/eml-viewer';
import type { RunContext } from './tool-ui';

export const EML_VIEWER_TIME_LIMIT_MS = 20000;

export const EML_VIEWER_TIME_LIMIT_MESSAGE =
  'Stopped after 20 seconds: the message took too long to read. Try a smaller message, or only its headers.';

export const EML_VIEWER_START_LIMIT_MS = 10000;

export const EML_VIEWER_START_LIMIT_MESSAGE =
  'The background task did not start within 10 seconds. Reload the page and try again.';

export const EML_VIEWER_NOT_STARTED_MESSAGE = 'The background task could not start.';

export const EML_VIEWER_STOPPED_MESSAGE = 'The background task stopped unexpectedly.';

/** A refusal of the message, as the worker reported it: a fixed sentence and the part it is about. */
export class EmlViewerRunError extends Error {
  readonly part?: EmlViewerPart;

  constructor(message: string, detail: { part?: EmlViewerPart } = {}) {
    super(message);
    this.name = 'EmlViewerRunError';
    this.part = detail.part;
  }
}

/**
 * Reads one message in a new background worker, resolving with its analysis. Settlement is the point of this function --
 * see run-jsonpath-in-worker.ts's own comment on the guarded `settle` closure this copies wholesale, covering success, an
 * application error, a native worker failure, an undeliverable message, an abort, an already-aborted signal, the start
 * limit and the time limit itself. Whichever of those comes first decides the outcome; `settle` runs once, clears both
 * timers and terminates the worker once.
 */
export function emlViewerInWorker(job: EmlViewerJobMessage, ctx: RunContext): Promise<EmlAnalysis> {
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<EmlAnalysis>((resolve, reject) => {
    const worker = new EmlViewerWorker();
    let settled = false;
    let runTimer: ReturnType<typeof setTimeout> | undefined;
    // Whether the job has been posted. A worker that fails after that did start, so it is not reported as unable to.
    let posted = false;
    const failedMessage = () => (posted ? EML_VIEWER_STOPPED_MESSAGE : EML_VIEWER_NOT_STARTED_MESSAGE);

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
    };

    type Outcome = { ok: true; value: EmlAnalysis } | { ok: false; error: Error };

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

    const onMessage = (event: MessageEvent<EmlViewerWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'eml-viewer-ready') {
        // The worker is listening. Only now does the run exist: the start timer has done its job, and the time limit
        // begins at the moment the job is posted.
        clearTimeout(startTimer);
        runTimer = setTimeout(() => {
          settle({ ok: false, error: new Error(EML_VIEWER_TIME_LIMIT_MESSAGE) });
        }, EML_VIEWER_TIME_LIMIT_MS);
        try {
          // Pasted bytes are handed over; a picked file is cloned by reference and read in the worker.
          if (job.bytes !== undefined) worker.postMessage(job, [job.bytes.buffer]);
          else worker.postMessage(job);
          posted = true;
        } catch {
          settle({ ok: false, error: new Error(EML_VIEWER_NOT_STARTED_MESSAGE) });
        }
      } else if (data.type === 'eml-viewer-done') {
        settle({ ok: true, value: data.result });
      } else {
        settle({ ok: false, error: new EmlViewerRunError(data.message, { part: data.part }) });
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
      settle({ ok: false, error: new Error(EML_VIEWER_START_LIMIT_MESSAGE) });
    }, EML_VIEWER_START_LIMIT_MS);
  });
}
