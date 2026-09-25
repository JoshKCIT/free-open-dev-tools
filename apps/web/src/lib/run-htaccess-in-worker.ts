/**
 * The page-side helper that starts this page's own htpasswd worker and
 * races it against a fixed time limit, terminating it unconditionally if
 * that limit wins.
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
 * A close copy of `run-bcrypt-in-worker.ts`'s settlement contract (the
 * guarded `settle` closure, seven covered outcomes) plus
 * `run-jsonpath-in-worker.ts`'s time-limit race, not a shared helper --
 * see either file's own comment on why the duplication is deliberate.
 */
import HtaccessWorker from './workers/htaccess-generator.worker.ts?worker&inline';
import type { HtpasswdJobMessage, HtpasswdWorkerMessage } from './workers/htaccess-generator.worker';
import type { RunContext } from './tool-ui';

/** A bcrypt round at a high cost genuinely can run long; 60 seconds gives real cost-15 runs room to finish. */
export const HTPASSWD_TIME_LIMIT_MS = 60000;

export const HTPASSWD_TIME_LIMIT_MESSAGE =
  'Making the .htpasswd line took longer than 60 seconds, so it was stopped. Choose a lower cost.';

export interface HtpasswdWorkerResult {
  line: string;
  warnings: string[];
}

export interface HtpasswdWorkerJob {
  user: string;
  password: string;
  cost: number;
}

/**
 * Runs one htpasswd job in the background worker, resolving with its
 * `{ line, warnings }` result.
 *
 * Settlement is the point of this function, not an afterthought: it
 * resolves or rejects exactly once, through the single guarded `settle`
 * closure below, covering every way a background job can end -- success, an
 * application-level error the worker reports on purpose, a native worker
 * failure that never gets to report anything, a message that could not be
 * delivered in either direction, an abort, a signal that was already
 * aborted before this function was even called, and the time limit itself.
 * Every one of those paths terminates the worker and removes every
 * listener this function registered.
 *
 * `timeLimitMs` accepts a shorter limit only for the test hook
 * (`window.__FODT_HTACCESS_TEST_HOOKS__`, `apps/web/src/tools/htaccess-generator.ts`);
 * a real visitor always gets `HTPASSWD_TIME_LIMIT_MS`.
 */
export function htpasswdInWorker(
  job: HtpasswdWorkerJob,
  ctx: RunContext,
  options: { timeLimitMs?: number } = {},
): Promise<HtpasswdWorkerResult> {
  // Already aborted before construction: a listener registered on an
  // already-fired signal never runs, so this must be checked up front
  // rather than relying on the 'abort' listener registered below.
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  const timeLimitMs = options.timeLimitMs ?? HTPASSWD_TIME_LIMIT_MS;

  return new Promise<HtpasswdWorkerResult>((resolve, reject) => {
    const worker = new HtaccessWorker();
    let settled = false;

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
    };

    type Outcome = { ok: true; value: HtpasswdWorkerResult } | { ok: false; error: Error };

    /**
     * The single place this promise settles. Guarded by `settled` so it
     * can be called from any of the listeners below, or from the timer,
     * without risk of a double resolve/reject. Always clears the timer,
     * always removes every listener and always terminates the worker --
     * the `finally` makes listener removal and termination unconditional
     * even if removing a listener were ever to throw.
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

    const onMessage = (event: MessageEvent<HtpasswdWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'htpasswd-done') {
        settle({ ok: true, value: { line: data.line, warnings: data.warnings } });
      } else {
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

    // The outcome unique to this worker: a high-cost bcrypt round genuinely
    // froze the worker's own thread, so the WORKER cannot post anything --
    // this timer, started right after postMessage, is the only thing that
    // can still notice. When it wins the race it terminates the worker
    // unconditionally and writes the message itself, since the worker
    // never gets the chance.
    const timer = setTimeout(() => {
      settle({ ok: false, error: new Error(HTPASSWD_TIME_LIMIT_MESSAGE) });
    }, timeLimitMs);

    const message: HtpasswdJobMessage = {
      type: 'htpasswd-job',
      user: job.user,
      password: job.password,
      cost: job.cost,
    };
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
