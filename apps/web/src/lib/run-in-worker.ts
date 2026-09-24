/**
 * The page-side helper that starts the file-hashing worker, forwards its
 * progress to the run context, and turns an abort into a real stop.
 *
 * Imports the worker with the build-time inlining suffix, not the
 * URL-and-constructor form. This is the single most important line in this
 * file: the default form emits the worker as a separately fetched file,
 * and because the worker is constructed when the visitor presses Run, that
 * fetch would land inside the window the privacy harness records, where it
 * is an offending request. The inlining form embeds the worker's code in
 * the page chunk and constructs it from an object URL, which the harness's
 * existing filter already excludes.
 */
import HashFileWorker from './workers/hash-file.worker.ts?worker&inline';
import type { HashFileJobMessage, HashFileWorkerMessage } from './workers/hash-file.worker';
import type { Algorithm, OutputFormat, FileHashResult } from '@fodt/hash-file';
import { formatBytes, type RunContext } from './tool-ui';

/**
 * 8 MiB in production. The one place this project's chunk size is chosen;
 * a caller with a good reason to override it (the browser test suite,
 * which needs a few-megabyte file to span many chunks so its
 * timing-dependent scenarios are deterministic rather than hopeful) can
 * pass a smaller value explicitly.
 */
const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024;

/**
 * Hashes a file in the background worker, resolving with one result per
 * requested algorithm.
 *
 * Settlement is the point of this function, not an afterthought: it
 * resolves or rejects exactly once, through the single guarded `settle`
 * closure below, covering every way a background job can end -- success,
 * an application-level error the worker reports on purpose, a native
 * worker failure that never gets to report anything, a message that could
 * not be delivered in either direction, an abort, and a signal that was
 * already aborted before this function was even called. Every one of
 * those paths terminates the worker and removes every listener this
 * function registered, so a settled run never keeps a background thread
 * or a stale listener alive.
 */
export function hashFileInWorker(
  file: File,
  algorithms: Algorithm[],
  format: OutputFormat,
  ctx: RunContext,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): Promise<FileHashResult[]> {
  // Already aborted before construction: a listener registered on an
  // already-fired signal never runs, so this must be checked up front
  // rather than relying on the 'abort' listener registered below.
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<FileHashResult[]>((resolve, reject) => {
    const worker = new HashFileWorker();
    let settled = false;

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
    };

    type Outcome = { ok: true; value: FileHashResult[] } | { ok: false; error: Error };

    /**
     * The single place this promise settles. Guarded by `settled` so it
     * can be called from any of the five listeners below without risk of
     * a double resolve/reject. Always removes every listener and always
     * terminates the worker -- the `finally` makes that unconditional even
     * if removing a listener were ever to throw.
     */
    const settle = (outcome: Outcome) => {
      if (settled) return;
      settled = true;
      try {
        removeListeners();
      } finally {
        worker.terminate();
      }
      if (outcome.ok) resolve(outcome.value);
      else reject(outcome.error);
    };

    const onMessage = (event: MessageEvent<HashFileWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'hash-file-progress') {
        const fraction = data.totalBytes === 0 ? 1 : data.bytesRead / data.totalBytes;
        const pct = Math.round(fraction * 100);
        ctx.onProgress?.(fraction, `${pct}% — ${formatBytes(data.bytesRead)} of ${formatBytes(data.totalBytes)} read`);
      } else if (data.type === 'hash-file-done') {
        settle({ ok: true, value: data.results });
      } else if (data.type === 'hash-file-error') {
        settle({ ok: false, error: new Error(data.message) });
      }
    };

    // Native worker failure: the worker throws while its module is
    // initialising, so it never gets to post anything of its own. Without
    // this listener the promise above would never settle at all, leaving
    // the Run button stuck on its Working label forever.
    const onNativeError = () => {
      settle({ ok: false, error: new Error('The background task could not start.') });
    };

    // A message could not be delivered in either direction (for instance,
    // a value that cannot be structured-cloned). Treated the same as a
    // native failure rather than left to hang.
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

    const job: HashFileJobMessage = { type: 'hash-file-job', file, algorithms, format, chunkSize };
    try {
      worker.postMessage(job);
    } catch {
      // postMessage throws synchronously when its argument cannot be
      // structured-cloned. Settle from the catch rather than leaving the
      // promise pending. The same fixed message as the other native
      // failure paths below: the raw exception (often a terse native
      // "could not be cloned" error) is not more useful to a visitor than
      // this sentence, and matching it keeps every startup failure on this
      // page reading the same way.
      settle({ ok: false, error: new Error('The background task could not start.') });
    }
  });
}
