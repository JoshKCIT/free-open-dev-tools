/**
 * The page-side helper that starts the bcrypt worker, forwards its
 * progress to the run context, and turns an abort into a real stop.
 *
 * Imports the worker with the build-time inlining suffix, not the
 * URL-and-constructor form -- the single most important line in this file,
 * for exactly the reason `run-in-worker.ts` (plan 02-10) documents: the
 * default form emits the worker as a separately fetched file, and because
 * the worker is constructed when the visitor presses Run, that fetch would
 * land inside the window the privacy harness records, where it is an
 * offending request. The inlining form embeds the worker's code in the
 * page chunk and constructs it from an object URL, which the harness's
 * existing filter already excludes.
 *
 * A second, close copy of `run-in-worker.ts`, not a shared helper -- see
 * `bcrypt.worker.ts`'s own comment on why the duplication is deliberate.
 * The settlement contract below is copied wholesale from that file: one
 * guarded `settle` closure, the same seven outcomes, the same fixed
 * failure message on every native-failure path.
 */
import BcryptWorker from './workers/bcrypt.worker.ts?worker&inline';
import type { BcryptJobMessage, BcryptWorkerMessage } from './workers/bcrypt.worker';
import type { HashReport, VerifyReport } from '@fodt/bcrypt';
import type { RunContext } from './tool-ui';

export type BcryptJob =
  { operation: 'hash'; password: string; cost: number } | { operation: 'verify'; password: string; hash: string };

/**
 * Runs one bcrypt job in the background worker. Overloaded so the return
 * type follows the job's own `operation` field: a `'hash'` job always
 * resolves with a `HashReport`, a `'verify'` job always resolves with a
 * `VerifyReport` -- whose three-valued `outcome` (`'correct' | 'incorrect'
 * | 'cannot-check'`) is carried through unchanged. Nothing on this path
 * ever collapses it to a boolean.
 *
 * Settlement is the point of this function, not an afterthought: it
 * resolves or rejects exactly once, through the single guarded `settle`
 * closure below, covering every way a background job can end -- success,
 * an application-level error the worker reports on purpose, a native
 * worker failure that never gets to report anything, a message that could
 * not be delivered in either direction, an abort, and a signal that was
 * already aborted before this function was even called. Every one of
 * those paths terminates the worker and removes every listener this
 * function registered.
 */
export function bcryptInWorker(
  job: { operation: 'hash'; password: string; cost: number },
  ctx: RunContext,
): Promise<HashReport>;
export function bcryptInWorker(
  job: { operation: 'verify'; password: string; hash: string },
  ctx: RunContext,
): Promise<VerifyReport>;
export function bcryptInWorker(job: BcryptJob, ctx: RunContext): Promise<HashReport | VerifyReport> {
  // Already aborted before construction: a listener registered on an
  // already-fired signal never runs, so this must be checked up front
  // rather than relying on the 'abort' listener registered below.
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<HashReport | VerifyReport>((resolve, reject) => {
    const worker = new BcryptWorker();
    let settled = false;

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
    };

    type Outcome = { ok: true; value: HashReport | VerifyReport } | { ok: false; error: Error };

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

    const onMessage = (event: MessageEvent<BcryptWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'bcrypt-progress') {
        ctx.onProgress?.(data.fraction);
      } else if (data.type === 'bcrypt-done') {
        settle({ ok: true, value: data.report });
      } else if (data.type === 'bcrypt-error') {
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

    const message: BcryptJobMessage =
      job.operation === 'hash'
        ? { type: 'bcrypt-job', operation: 'hash', password: job.password, cost: job.cost }
        : { type: 'bcrypt-job', operation: 'verify', password: job.password, hash: job.hash };
    try {
      worker.postMessage(message);
    } catch {
      // postMessage throws synchronously when its argument cannot be
      // structured-cloned. Settle from the catch rather than leaving the
      // promise pending. The same fixed message as the other native
      // failure paths above, for the same reason `run-in-worker.ts` gives:
      // matching it keeps every startup failure on this page reading the
      // same way.
      settle({ ok: false, error: new Error('The background task could not start.') });
    }
  });
}
