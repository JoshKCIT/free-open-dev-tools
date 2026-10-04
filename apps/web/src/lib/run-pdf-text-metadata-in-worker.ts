/**
 * The page-side helper that starts the metadata-removal worker, waits for it to report that it is ready, posts the file
 * to it, and races the run against a fixed time limit, terminating the worker unconditionally when the limit wins.
 *
 * Imports the worker with the build-time inlining suffix, not the URL-and-constructor form -- see
 * run-jsonpath-in-worker.ts's own comment for why that line is load-bearing for the privacy harness.
 *
 * A close copy of run-qr-barcode-reader-in-worker.ts, not a shared helper -- the same reason that file gives for its own
 * duplication. Every run gets a NEW worker, so no run ever inherits anything from the previous one. Starting one costs
 * a few tens of milliseconds.
 *
 * The handshake exists because every worker on the site is a module worker (apps/web/vite.config.ts), and a module
 * whose evaluation is still running drops a message posted to it. The worker says `pdf-text-metadata-ready` as the last
 * statement of its module; the file is posted only then. Two limits follow from that. A worker that never says ready is
 * stopped after 10 seconds with its own message, so a tab whose worker cannot start does not wait forever. The 20 second
 * run limit starts when the file is posted, not when the worker is created, so a slow start is never counted against the
 * visitor's file.
 *
 * The run limit is 20 seconds. Removing the metadata from a 60 MB file took 152 milliseconds in Node and a three page
 * file 29 to 42 milliseconds in a worker in the three tested engines, so 20 seconds is far above any measured run and
 * still short enough that nobody waits on a file that never comes back. The page owns the limit because the worker is
 * inside one call when it matters, and terminate() is the only real way to stop it.
 *
 * The file goes in as bytes, transferred, and the copy and a report of what was removed come back; nothing is fetched,
 * stored, logged or turned into an address here.
 */
import PdfTextMetadataWorker from './workers/pdf-text-metadata.worker.ts?worker&inline';
import type { PdfTextMetadataWorkerMessage } from './workers/pdf-text-metadata.worker';
import type { StripReport } from '@fodt/pdf-text-metadata';
import type { RunContext } from './tool-ui';

export const PDF_TEXT_METADATA_TIME_LIMIT_MS = 20000;

export const PDF_TEXT_METADATA_TIME_LIMIT_MESSAGE =
  'Stopped after 20 seconds: removing the metadata took too long. Try a smaller file.';

export const PDF_TEXT_METADATA_START_LIMIT_MS = 10000;

export const PDF_TEXT_METADATA_START_LIMIT_MESSAGE =
  'The background task did not start within 10 seconds. Reload the page and try again.';

const NOT_STARTED_MESSAGE = 'The background task could not start.';

const STOPPED_MESSAGE = 'The background task stopped unexpectedly.';

export class PdfTextMetadataRunError extends Error {
  /** The kind of a refusal from the package (`encrypted`, `damaged`), when the worker reported one. */
  readonly kind: string | undefined;
  constructor(message: string, kind?: string) {
    super(message);
    this.name = 'PdfTextMetadataRunError';
    this.kind = kind;
  }
}

export interface StripResult {
  bytes: Uint8Array;
  report: StripReport;
  /** What the copy still holds after removal, found by pdf-lib in the worker; an empty list means nothing. */
  left: string[];
}

/**
 * Removes the metadata from `bytes` in a new background worker, resolving with the copy and the report. The bytes are
 * handed over (their buffer is detached), so a caller that needs the original afterwards reads the file again. Settlement
 * is the point of this function -- see run-jsonpath-in-worker.ts's own comment on the guarded `settle` closure this
 * copies in shape, covering a result, an application error, a native worker failure, an undeliverable message, an abort,
 * an already-aborted signal, the start limit and the run limit. Whichever of those comes first decides the outcome;
 * `settle` runs once, clears both timers, removes every listener and terminates the worker once.
 */
export function stripInWorker(bytes: Uint8Array, ctx: RunContext): Promise<StripResult> {
  if (ctx.signal.aborted) {
    return Promise.reject(new PdfTextMetadataRunError('The run was cancelled before it started.'));
  }

  return new Promise<StripResult>((resolve, reject) => {
    const worker = new PdfTextMetadataWorker();
    let settled = false;
    let runTimer: ReturnType<typeof setTimeout> | undefined;
    // Whether the file has been posted. A worker that fails after that did start, so it is not reported as unable to.
    let posted = false;
    const failedMessage = () => (posted ? STOPPED_MESSAGE : NOT_STARTED_MESSAGE);

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
    };

    type Outcome = { ok: true; value: StripResult } | { ok: false; error: Error };

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

    const onMessage = (event: MessageEvent<PdfTextMetadataWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'pdf-text-metadata-ready') {
        // The worker is listening. Only now does the run exist: the start timer has done its job, and the time limit
        // begins at the moment the file is posted.
        clearTimeout(startTimer);
        runTimer = setTimeout(() => {
          settle({ ok: false, error: new PdfTextMetadataRunError(PDF_TEXT_METADATA_TIME_LIMIT_MESSAGE) });
        }, PDF_TEXT_METADATA_TIME_LIMIT_MS);
        try {
          const whole = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
          const buffer = whole.buffer as ArrayBuffer;
          worker.postMessage({ type: 'pdf-text-metadata-job', bytes: buffer }, [buffer]);
          posted = true;
        } catch {
          settle({ ok: false, error: new PdfTextMetadataRunError(NOT_STARTED_MESSAGE) });
        }
      } else if (data.type === 'pdf-text-metadata-done') {
        settle({ ok: true, value: { bytes: new Uint8Array(data.bytes), report: data.report, left: data.left } });
      } else {
        settle({ ok: false, error: new PdfTextMetadataRunError(data.message, data.kind) });
      }
    };

    const onNativeError = () => {
      settle({ ok: false, error: new PdfTextMetadataRunError(failedMessage()) });
    };

    const onMessageError = () => {
      settle({ ok: false, error: new PdfTextMetadataRunError(failedMessage()) });
    };

    const onAbort = () => {
      settle({ ok: false, error: new PdfTextMetadataRunError('The run was cancelled.') });
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onNativeError);
    worker.addEventListener('messageerror', onMessageError);
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    const startTimer = setTimeout(() => {
      settle({ ok: false, error: new PdfTextMetadataRunError(PDF_TEXT_METADATA_START_LIMIT_MESSAGE) });
    }, PDF_TEXT_METADATA_START_LIMIT_MS);
  });
}
