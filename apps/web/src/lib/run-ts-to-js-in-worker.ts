/**
 * The page-side helper that starts the type-stripping worker and races it
 * against a fixed time limit, terminating it unconditionally if that limit
 * wins.
 *
 * Imports the worker with the build-time inlining suffix, not the
 * URL-and-constructor form -- see run-jsonpath-in-worker.ts's own comment
 * for why that line is load-bearing for the privacy harness.
 *
 * A close copy of run-jsonpath-in-worker.ts, not a shared helper -- same
 * reason that file gives for its own duplication. Measured this session
 * (D-57, profile first): a 200KB realistic TypeScript file transpiles in
 * about half a second on an idle machine (the limit's own comment below has
 * the figures under load). The real risk is a long chain of string-literal
 * `+` concatenation -- TypeScript's own binary-expression printer shows
 * clear super-linear growth measured directly against the installed
 * compiler (10,000 terms ~840ms, 20,000 ~2.2s, 30,000 ~5.2s, 100,000 ~92
 * seconds). `transpileModule` is, once started, a single synchronous,
 * un-interruptible call, exactly the same category of runaway main-thread
 * work `run-jsonpath-in-worker.ts` exists for, so the same
 * settle-once/terminate-on-timeout contract applies here.
 */
import TsToJsWorker from './workers/ts-to-js.worker.ts?worker&inline';
import type { TsToJsJobMessage, TsToJsWorkerMessage } from './workers/ts-to-js.worker';
import type { StripTypesResult } from '@fodt/ts-to-js';
import type { RunContext } from './tool-ui';

/**
 * The exact value this file enforces, same register as the other formatter
 * pages' own 10 second limit. It was 1.5 seconds until the 2026-10-03
 * nightly full run showed a loaded runner pushing the same TypeScript
 * compiler call (the JavaScript formatter's own 200 KB minify) past 1.5
 * seconds in WebKit. A 200 KB realistic file here takes about 0.5 seconds in
 * WebKit on an idle machine, but with the CPU oversubscribed 2x it crossed
 * 1.5 seconds in 3 of 5 runs, so an ordinary file could hit the limit. A
 * 60,000-term string-concatenation chain, the runaway case this limit exists
 * for, takes about 29 seconds in Node, so 10 seconds still stops it (WebKit is
 * faster, and overflows its call stack somewhere between 50,000 and 60,000
 * terms).
 */
export const TS_TO_JS_TIME_LIMIT_MS = 10000;

export const TS_TO_JS_TIME_LIMIT_MESSAGE =
  'Stopped after 10 seconds: this input took too long to compile. Try a smaller file.';

export class TsToJsRunError extends Error {}

/**
 * Runs one type-stripping job in the background worker, resolving with its
 * result. Settlement is the point of this function -- see
 * run-jsonpath-in-worker.ts's own comment on the guarded `settle` closure
 * this copies wholesale, covering success, an application error, a native
 * worker failure, an undeliverable message, an abort, an already-aborted
 * signal, and the time limit itself.
 */
export function tsToJsInWorker(job: TsToJsJobMessage, ctx: RunContext): Promise<StripTypesResult> {
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<StripTypesResult>((resolve, reject) => {
    const worker = new TsToJsWorker();
    let settled = false;

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
    };

    type Outcome = { ok: true; value: StripTypesResult } | { ok: false; error: Error };

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

    const onMessage = (event: MessageEvent<TsToJsWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'ts-to-js-done') settle({ ok: true, value: data.result });
      else settle({ ok: false, error: new TsToJsRunError(data.message) });
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

    const timer = setTimeout(() => {
      settle({ ok: false, error: new Error(TS_TO_JS_TIME_LIMIT_MESSAGE) });
    }, TS_TO_JS_TIME_LIMIT_MS);

    try {
      worker.postMessage(job);
    } catch {
      settle({ ok: false, error: new Error('The background task could not start.') });
    }
  });
}
