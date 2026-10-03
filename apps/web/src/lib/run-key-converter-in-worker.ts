/**
 * The page-side helper that starts the key-converter worker, waits for it to report that it is ready, posts the job,
 * and races the run against a fixed time limit, terminating the worker unconditionally when the limit wins.
 *
 * Imports the worker with the build-time inlining suffix, not the URL-and-constructor form -- see
 * run-jsonpath-in-worker.ts's own comment for why that line is load-bearing for the privacy harness.
 *
 * A close copy of run-sqlite-viewer-in-worker.ts, not a shared helper -- the same reason that file gives for its own
 * duplication. Every run gets a NEW worker, so no run ever inherits anything from the previous one. Starting one costs
 * a few tens of milliseconds.
 *
 * The handshake exists because every worker on the site is a module worker (apps/web/vite.config.ts), and a module
 * whose evaluation is still running drops a message posted to it. The worker says `key-converter-ready` as the last
 * statement of its module; the job is posted only then. Two limits follow from that. A worker that never says ready is
 * stopped after 10 seconds with its own message, so a tab whose worker cannot start does not wait forever. The 60 second
 * run limit starts when the job is posted, not when the worker is created, so a slow start is never counted against the
 * visitor's key.
 *
 * The run limit is 60 seconds. Generating a 4096-bit RSA key took a median of 0.3 to 1.5 seconds and at most 3.9
 * seconds in 30 runs per browser, and 4.7 seconds once under load; the time prime search takes has a long tail, so 60
 * seconds is more than ten times the slowest measured run and still short enough that nobody waits on a key that never
 * arrives. The page owns the limit because the worker is inside one engine call when it matters, and terminate() is
 * the only real way to stop it.
 *
 * Only the key size goes in, and only the PKCS#8 and public key bytes come back; the page reads and formats them.
 */
import KeyConverterWorker from './workers/key-converter.worker.ts?worker&inline';
import type { KeyConverterJobMessage, KeyConverterWorkerMessage } from './workers/key-converter.worker';
import type { RunContext } from './tool-ui';

export const KEY_CONVERTER_TIME_LIMIT_MS = 60000;

export const KEY_CONVERTER_TIME_LIMIT_MESSAGE =
  'Stopped after 60 seconds: generating this key took too long. Try a smaller key size.';

export const KEY_CONVERTER_START_LIMIT_MS = 10000;

export const KEY_CONVERTER_START_LIMIT_MESSAGE =
  'The background task did not start within 10 seconds. Reload the page and try again.';

export class KeyConverterRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyConverterRunError';
  }
}

interface GeneratedBytes {
  pkcs8: Uint8Array;
  spki: Uint8Array;
}

/**
 * Runs one RSA key generation in a new background worker, resolving with the key's PKCS#8 and SubjectPublicKeyInfo
 * bytes. Settlement is the point of this function -- see run-jsonpath-in-worker.ts's own comment on the guarded
 * `settle` closure this copies wholesale, covering success, an application error, a native worker failure, an
 * undeliverable message, an abort, an already-aborted signal, the start limit and the time limit itself. Whichever of
 * those comes first decides the outcome; `settle` runs once, clears both timers and terminates the worker once.
 */
export function keyConverterInWorker(job: KeyConverterJobMessage, ctx: RunContext): Promise<GeneratedBytes> {
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<GeneratedBytes>((resolve, reject) => {
    const worker = new KeyConverterWorker();
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

    type Outcome = { ok: true; value: GeneratedBytes } | { ok: false; error: Error };

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

    const onMessage = (event: MessageEvent<KeyConverterWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'key-converter-ready') {
        // The worker is listening. Only now does the run exist: the start timer has done its job, and the time limit
        // begins at the moment the job is posted.
        clearTimeout(startTimer);
        runTimer = setTimeout(() => {
          settle({ ok: false, error: new Error(KEY_CONVERTER_TIME_LIMIT_MESSAGE) });
        }, KEY_CONVERTER_TIME_LIMIT_MS);
        try {
          worker.postMessage(job);
          posted = true;
        } catch {
          settle({ ok: false, error: new Error('The background task could not start.') });
        }
      } else if (data.type === 'key-converter-done') {
        settle({ ok: true, value: { pkcs8: data.pkcs8, spki: data.spki } });
      } else {
        settle({ ok: false, error: new KeyConverterRunError(data.message) });
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
      settle({ ok: false, error: new Error(KEY_CONVERTER_START_LIMIT_MESSAGE) });
    }, KEY_CONVERTER_START_LIMIT_MS);
  });
}
