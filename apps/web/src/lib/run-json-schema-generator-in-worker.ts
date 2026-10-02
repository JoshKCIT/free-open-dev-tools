/**
 * The page-side helper that starts the json-schema-generator worker, waits for it to report that it is ready, posts the
 * job, and races the run against a fixed time limit, terminating the worker unconditionally when the limit wins.
 *
 * Imports the worker with the build-time inlining suffix, not the URL-and-constructor form -- see
 * run-jsonpath-in-worker.ts's own comment for why that line is load-bearing for the privacy harness.
 *
 * A close copy of run-hex-viewer-in-worker.ts, itself a close copy of run-spreadsheet-converter-in-worker.ts, not a
 * shared helper -- same reason those files give for their own duplication. Used only when the samples are YAML
 * (`inputFormat: 'yaml'`): the installed yaml 2.9.1 checks duplicate mapping keys by scanning the whole mapping for every
 * new key it composes, so a flat mapping's read time grows with the square of its key count (about 1.8 seconds at 20,000
 * keys and 9 seconds at 40,000), the same package and risk the data converter's YAML source and the YAML formatter
 * already carry a time limit for. JSON or XML samples never call this function; neither reader has a comparable case,
 * so those still run on the page.
 *
 * Every run gets a NEW worker, so nothing from a sample is kept once the run ends. Starting one costs a few tens of
 * milliseconds.
 *
 * The handshake exists because every worker on the site is a module worker (apps/web/vite.config.ts), and a module
 * whose evaluation is still running drops a message posted to it. The worker says `json-schema-generator-ready` as the
 * last statement of its module; the job is posted only then. Two limits follow from that. A worker that never says ready
 * is stopped after 10 seconds with its own message, so a tab whose worker cannot start does not wait forever. The 5
 * second run limit starts when the job is posted, not when the worker is created, so a slow start is never counted
 * against the visitor's samples.
 *
 * The run limit is 5 seconds: a realistic YAML sample reads in milliseconds, and the page keeps working while a run is
 * in flight (Cancel stops it at once), so 5 seconds is long enough for a very large mapping and short enough that
 * nobody waits on one that cannot finish. The page owns the limit because the worker is inside one synchronous call when
 * it matters, and terminate() is the only real way to stop it.
 */
import JsonSchemaGeneratorWorker from './workers/json-schema-generator.worker.ts?worker&inline';
import type {
  JsonSchemaGeneratorJobMessage,
  JsonSchemaGeneratorWorkerMessage,
} from './workers/json-schema-generator.worker';
import type { GenerateSchemaResult } from '@fodt/json-schema-generator';
import type { RunContext } from './tool-ui';

export const JSON_SCHEMA_GENERATOR_TIME_LIMIT_MS = 5000;

export const JSON_SCHEMA_GENERATOR_TIME_LIMIT_MESSAGE =
  'Stopped after 5 seconds: this YAML took too long to read. Try a smaller document.';

export const JSON_SCHEMA_GENERATOR_START_LIMIT_MS = 10000;

export const JSON_SCHEMA_GENERATOR_START_LIMIT_MESSAGE =
  'The background task did not start within 10 seconds. Reload the page and try again.';

export class JsonSchemaGeneratorRunError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'JsonSchemaGeneratorRunError';
    if (detail.line !== undefined) this.line = detail.line;
    if (detail.column !== undefined) this.column = detail.column;
  }
}

/**
 * Runs one job in a new background worker, resolving with its result. Settlement is the point of this function -- see
 * run-jsonpath-in-worker.ts's own comment on the guarded `settle` closure this copies wholesale, covering success, an
 * application error, a native worker failure, an undeliverable message, an abort, an already-aborted signal, the start
 * limit and the time limit itself. Whichever of those comes first decides the outcome; `settle` runs once, clears both
 * timers and terminates the worker once.
 */
export function jsonSchemaGeneratorInWorker(
  message: JsonSchemaGeneratorJobMessage,
  ctx: RunContext,
): Promise<GenerateSchemaResult> {
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<GenerateSchemaResult>((resolve, reject) => {
    const worker = new JsonSchemaGeneratorWorker();
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

    type Outcome = { ok: true; value: GenerateSchemaResult } | { ok: false; error: Error };

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

    const onMessage = (event: MessageEvent<JsonSchemaGeneratorWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'json-schema-generator-ready') {
        // The worker is listening. Only now does the run exist: the start timer has done its job, and the time limit
        // begins at the moment the job is posted.
        clearTimeout(startTimer);
        runTimer = setTimeout(() => {
          settle({ ok: false, error: new Error(JSON_SCHEMA_GENERATOR_TIME_LIMIT_MESSAGE) });
        }, JSON_SCHEMA_GENERATOR_TIME_LIMIT_MS);
        try {
          worker.postMessage(message);
          posted = true;
        } catch {
          settle({ ok: false, error: new Error('The background task could not start.') });
        }
      } else if (data.type === 'json-schema-generator-done') {
        settle({ ok: true, value: data.result });
      } else {
        settle({
          ok: false,
          error: new JsonSchemaGeneratorRunError(data.message, {
            ...(data.line !== undefined ? { line: data.line } : {}),
            ...(data.column !== undefined ? { column: data.column } : {}),
          }),
        });
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
      settle({ ok: false, error: new Error(JSON_SCHEMA_GENERATOR_START_LIMIT_MESSAGE) });
    }, JSON_SCHEMA_GENERATOR_START_LIMIT_MS);
  });
}
