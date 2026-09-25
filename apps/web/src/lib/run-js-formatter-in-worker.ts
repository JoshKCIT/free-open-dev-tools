/**
 * The page-side helper that starts the TypeScript-minify worker and races
 * it against a fixed time limit, terminating it unconditionally if that
 * limit wins.
 *
 * Imports the worker with the build-time inlining suffix, not the
 * URL-and-constructor form -- see run-jsonpath-in-worker.ts's own comment
 * for why that line is load-bearing for the privacy harness.
 *
 * A close copy of run-ts-to-js-in-worker.ts, not a shared helper -- same
 * reason that file gives for its own duplication. Only the TypeScript +
 * minify combination uses this worker: it calls `ts.transpileModule` the
 * same way ts-to-js does, and that call was already measured (05-01) to
 * show clear super-linear growth on a long chain of string-literal `+`
 * concatenation (10,000 terms ~840ms, 20,000 ~2.2s, 30,000 ~5.2s, 100,000
 * ~92 seconds), confirmed again directly against this tool's own TypeScript
 * minify path this session. Beautify (either language) and JavaScript
 * minify all measured well under 1 second on a 200KB realistic input and
 * stay off the worker (D-57, profile first -- only the path shown to need
 * it gets one).
 */
import JsFormatterWorker from './workers/js-formatter.worker.ts?worker&inline';
import type { JsFormatterJobMessage, JsFormatterWorkerMessage } from './workers/js-formatter.worker';
import type { FormatJsResult } from '@fodt/js-formatter';
import type { RunContext } from './tool-ui';

/** The exact value this file enforces, same register as the jsonpath and ts-to-js workers' own 1.5 second limit. */
export const JS_FORMATTER_TIME_LIMIT_MS = 1500;

export const JS_FORMATTER_TIME_LIMIT_MESSAGE =
  'Stopped after 1.5 seconds: this input took too long to compile. Try a smaller file.';

export class JsFormatterRunError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, line?: number, column?: number) {
    super(message);
    this.name = 'JsFormatterRunError';
    this.line = line;
    this.column = column;
  }
}

/**
 * Runs one TypeScript-minify job in the background worker, resolving with
 * its result. Settlement is the point of this function -- see
 * run-jsonpath-in-worker.ts's own comment on the guarded `settle` closure
 * this copies wholesale, covering success, an application error, a native
 * worker failure, an undeliverable message, an abort, an already-aborted
 * signal, and the time limit itself.
 */
export function jsFormatterInWorker(job: JsFormatterJobMessage, ctx: RunContext): Promise<FormatJsResult> {
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<FormatJsResult>((resolve, reject) => {
    const worker = new JsFormatterWorker();
    let settled = false;

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
    };

    type Outcome = { ok: true; value: FormatJsResult } | { ok: false; error: Error };

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

    const onMessage = (event: MessageEvent<JsFormatterWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'js-formatter-done') settle({ ok: true, value: data.result });
      else settle({ ok: false, error: new JsFormatterRunError(data.message, data.line, data.column) });
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
      settle({ ok: false, error: new Error(JS_FORMATTER_TIME_LIMIT_MESSAGE) });
    }, JS_FORMATTER_TIME_LIMIT_MS);

    try {
      worker.postMessage(job);
    } catch {
      settle({ ok: false, error: new Error('The background task could not start.') });
    }
  });
}
