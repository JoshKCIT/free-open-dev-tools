/**
 * The page-side helper that starts the spreadsheet-converter worker, waits for it to report that it is ready, posts the
 * job, and races the run against a fixed time limit, terminating the worker unconditionally when the limit wins.
 *
 * Imports the worker with the build-time inlining suffix, not the URL-and-constructor form -- see
 * run-jsonpath-in-worker.ts's own comment for why that line is load-bearing for the privacy harness.
 *
 * A close copy of run-sqlite-viewer-in-worker.ts, itself a close copy of run-go-formatter-in-worker.ts, not a shared
 * helper -- same reason those files give for their own duplication. Every run gets a NEW worker: the file's bytes and
 * the sheet built from them live in the worker's memory, and a runaway or very large conversion may leave an instance
 * in an undefined state, so no run ever inherits the previous one's. Starting one costs a few tens of milliseconds.
 *
 * The handshake exists because every worker on the site is a module worker (apps/web/vite.config.ts), and a module
 * whose evaluation is still running drops a message posted to it. The worker says `spreadsheet-converter-ready` as the
 * last statement of its module; the job is posted only then. Two limits follow from that. A worker that never says
 * ready is stopped after 10 seconds with its own message, so a tab whose worker cannot start does not wait forever.
 * The 30 second run limit starts when the job is posted, not when the worker is created, so a slow start is never
 * counted against the visitor's file.
 *
 * The run limit is 30 seconds. Reading a 100,000 row by 10 column sheet (a 4.5 MB file holding 44.5 MB of sheet XML)
 * took 1.6 seconds in Node, and the four-browser Playwright run drives many workers at once on one machine, so 30
 * seconds is many times the slowest measured realistic file and still short enough that nobody waits on a package
 * built to take forever. The page owns the limit because the worker is inside one synchronous scan when it matters,
 * and terminate() is the only real way to stop it.
 */
import SpreadsheetConverterWorker from './workers/spreadsheet-converter.worker.ts?worker&inline';
import type {
  SpreadsheetConverterJobMessage,
  SpreadsheetConverterWorkerMessage,
} from './workers/spreadsheet-converter.worker';
import type { ConvertResult } from '@fodt/spreadsheet-converter';
import type { RunContext } from './tool-ui';

export const SPREADSHEET_CONVERTER_TIME_LIMIT_MS = 30000;

export const SPREADSHEET_CONVERTER_TIME_LIMIT_MESSAGE =
  'Stopped after 30 seconds: this file took too long to convert. Try a smaller file.';

export const SPREADSHEET_CONVERTER_START_LIMIT_MS = 10000;

export const SPREADSHEET_CONVERTER_START_LIMIT_MESSAGE =
  'The background task did not start within 10 seconds. Reload the page and try again.';

export class SpreadsheetConverterRunError extends Error {
  readonly line?: number;
  readonly column?: number;
  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'SpreadsheetConverterRunError';
    if (detail.line !== undefined) this.line = detail.line;
    if (detail.column !== undefined) this.column = detail.column;
  }
}

/**
 * Runs one conversion in a new background worker, resolving with its result. Settlement is the point of this function
 * -- see run-jsonpath-in-worker.ts's own comment on the guarded `settle` closure this copies wholesale, covering
 * success, an application error, a native worker failure, an undeliverable message, an abort, an already-aborted
 * signal, the start limit and the time limit itself. Whichever of those comes first decides the outcome; `settle` runs
 * once, clears both timers and terminates the worker once.
 */
export function spreadsheetConverterInWorker(
  message: SpreadsheetConverterJobMessage,
  ctx: RunContext,
): Promise<ConvertResult> {
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<ConvertResult>((resolve, reject) => {
    const worker = new SpreadsheetConverterWorker();
    let settled = false;
    let runTimer: ReturnType<typeof setTimeout> | undefined;

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

    const onMessage = (event: MessageEvent<SpreadsheetConverterWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'spreadsheet-converter-ready') {
        // The worker is listening. Only now does the run exist: the start timer has done its job, and the time limit
        // begins at the moment the job is posted.
        clearTimeout(startTimer);
        runTimer = setTimeout(() => {
          settle({ ok: false, error: new Error(SPREADSHEET_CONVERTER_TIME_LIMIT_MESSAGE) });
        }, SPREADSHEET_CONVERTER_TIME_LIMIT_MS);
        try {
          const job = message.job;
          worker.postMessage(message, job.direction === 'xlsx-to-text' ? [job.bytes.buffer as ArrayBuffer] : []);
        } catch {
          settle({ ok: false, error: new Error('The background task could not start.') });
        }
      } else if (data.type === 'spreadsheet-converter-done') {
        settle({ ok: true, value: data.result });
      } else {
        settle({
          ok: false,
          error: new SpreadsheetConverterRunError(data.message, {
            ...(data.line !== undefined ? { line: data.line } : {}),
            ...(data.column !== undefined ? { column: data.column } : {}),
          }),
        });
      }
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

    const startTimer = setTimeout(() => {
      settle({ ok: false, error: new Error(SPREADSHEET_CONVERTER_START_LIMIT_MESSAGE) });
    }, SPREADSHEET_CONVERTER_START_LIMIT_MS);
  });
}
