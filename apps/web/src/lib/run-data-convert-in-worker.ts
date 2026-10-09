/**
 * The page-side helper that starts the data-convert worker and races it
 * against a fixed time limit, terminating it unconditionally if that limit
 * wins.
 *
 * Imports the worker with the build-time inlining suffix, not the
 * URL-and-constructor form -- see run-jsonpath-in-worker.ts's own comment
 * for why that line is load-bearing for the privacy harness.
 *
 * A close copy of run-yaml-formatter-in-worker.ts, not a shared helper --
 * same reason that file gives for its own duplication. Used only when the
 * source format is YAML (`from: 'yaml'`, either branch of `convertData`,
 * including YAML-to-YAML): the installed yaml 2.9.1 checks duplicate
 * mapping keys by scanning the whole mapping for every new key it composes,
 * so a flat mapping's parse time grows quadratically with its key count
 * -- the exact same package and the exact
 * same risk yaml-formatter already carries a time limit for. A JSON or TOML
 * source never calls this function; neither parser has a comparable
 * pathological case, so those conversions still run directly on the main
 * thread, unchanged.
 */
import DataConvertWorker from './workers/data-convert.worker.ts?worker&inline';
import type { DataConvertJobMessage, DataConvertWorkerMessage } from './workers/data-convert.worker';
import type { ConvertResult } from '@fodt/data-convert';
import type { RunContext } from './tool-ui';

/**
 * The exact value this file enforces: 10 seconds, the same as yaml-formatter's own limit, because it is the same yaml
 * package and the same quadratic duplicate-key check. It was 1.5 seconds until the 2026-10-03 nightly full run, which
 * failed when a loaded runner pushed a realistic YAML job in the same package past 1.5 seconds. A flat mapping of
 * 40,000 keys takes about 6.8 seconds in Node and one of 80,000 about 34 seconds, so 10 seconds still stops the
 * runaway case this limit exists for. Other workers that run a YAML parse differ: some allow 2 seconds, yaml-formatter
 * allows 10.
 */
export const DATA_CONVERT_TIME_LIMIT_MS = 10000;

export const DATA_CONVERT_TIME_LIMIT_MESSAGE =
  'Stopped after 10 seconds: this document took too long to check for duplicate keys. Try a smaller document.';

export class DataConvertRunError extends Error {
  readonly line?: number;
  readonly column?: number;
  readonly path?: string;

  constructor(message: string, detail: { line?: number; column?: number; path?: string } = {}) {
    super(message);
    this.name = 'DataConvertRunError';
    this.line = detail.line;
    this.column = detail.column;
    this.path = detail.path;
  }
}

/**
 * Runs one YAML-source conversion job in the background worker, resolving
 * with its result. Settlement is the point of this function -- see
 * run-jsonpath-in-worker.ts's own comment on the guarded `settle` closure
 * this copies wholesale, covering success, an application error, a native
 * worker failure, an undeliverable message, an abort, an already-aborted
 * signal, and the time limit itself.
 */
export function dataConvertInWorker(job: DataConvertJobMessage, ctx: RunContext): Promise<ConvertResult> {
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<ConvertResult>((resolve, reject) => {
    const worker = new DataConvertWorker();
    let settled = false;

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
    };

    type Outcome = { ok: true; value: ConvertResult } | { ok: false; error: Error };

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

    const onMessage = (event: MessageEvent<DataConvertWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'data-convert-done') settle({ ok: true, value: data.result });
      else
        settle({
          ok: false,
          error: new DataConvertRunError(data.message, { line: data.line, column: data.column, path: data.path }),
        });
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
      settle({ ok: false, error: new Error(DATA_CONVERT_TIME_LIMIT_MESSAGE) });
    }, DATA_CONVERT_TIME_LIMIT_MS);

    try {
      worker.postMessage(job);
    } catch {
      settle({ ok: false, error: new Error('The background task could not start.') });
    }
  });
}
