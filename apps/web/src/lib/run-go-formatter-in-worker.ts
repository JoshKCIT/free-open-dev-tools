/**
 * The page-side helper that starts the go-formatter worker and races it
 * against a fixed time limit, terminating it unconditionally if that limit
 * wins.
 *
 * Imports the worker with the build-time inlining suffix, not the
 * URL-and-constructor form -- see run-jsonpath-in-worker.ts's own comment
 * for why that line is load-bearing for the privacy harness.
 *
 * A close copy of run-markdown-formatter-in-worker.ts, not a shared helper
 * -- same reason that file gives for its own duplication. Every run goes
 * through this worker and every run gets a NEW worker: the engine is a
 * WebAssembly build of Go's own formatter, and a trap (a stack overflow on
 * a very deeply nested expression, for example) may leave an instance in an
 * undefined state, so no run is ever allowed to inherit the previous one's.
 * Starting one costs a few tens of milliseconds.
 *
 * The limit is 10 seconds. Formatting 1 MB of source measured 0.1 to 1.9
 * seconds across the six engines of this family when run alone in Node, and
 * the four-browser-project Playwright run drives many worker jobs at once on
 * one machine, which the markdown formatter's own comment documents turning
 * a 0.6 to 2.3 second job into one that crosses 3 seconds. A pasted file is
 * rarely over 200 KB, so 10 seconds is several times the slowest measured
 * realistic job and still short enough that nobody waits on a stuck tab.
 * The page owns the limit because the worker is stuck inside one
 * synchronous engine call when it matters, and terminate() is the only real
 * way to stop it.
 */
import GoFormatterWorker from './workers/go-formatter.worker.ts?worker&inline';
import type { GoFormatterJobMessage, GoFormatterWorkerMessage } from './workers/go-formatter.worker';
import type { FormatGoResult } from '@fodt/go-formatter';
import type { RunContext } from './tool-ui';

export const GO_FORMATTER_TIME_LIMIT_MS = 10000;

export const GO_FORMATTER_TIME_LIMIT_MESSAGE =
  'Stopped after 10 seconds: this code took too long to format. Try a smaller input.';

export class GoFormatterRunError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, line?: number, column?: number) {
    super(message);
    this.name = 'GoFormatterRunError';
    this.line = line;
    this.column = column;
  }
}

/**
 * Runs one Go-format job in the background worker, resolving with its
 * result. Settlement is the point of this function -- see
 * run-jsonpath-in-worker.ts's own comment on the guarded `settle` closure
 * this copies wholesale, covering success, an application error, a native
 * worker failure, an undeliverable message, an abort, an already-aborted
 * signal, and the time limit itself. Whichever of those comes first decides
 * the outcome; `settle` runs once, clears the timer and terminates the
 * worker once.
 */
export function goFormatterInWorker(job: GoFormatterJobMessage, ctx: RunContext): Promise<FormatGoResult> {
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<FormatGoResult>((resolve, reject) => {
    const worker = new GoFormatterWorker();
    let settled = false;

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
    };

    type Outcome = { ok: true; value: FormatGoResult } | { ok: false; error: Error };

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

    const onMessage = (event: MessageEvent<GoFormatterWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'go-formatter-done') settle({ ok: true, value: data.result });
      else settle({ ok: false, error: new GoFormatterRunError(data.message, data.line, data.column) });
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
      settle({ ok: false, error: new Error(GO_FORMATTER_TIME_LIMIT_MESSAGE) });
    }, GO_FORMATTER_TIME_LIMIT_MS);

    try {
      worker.postMessage(job);
    } catch {
      settle({ ok: false, error: new Error('The background task could not start.') });
    }
  });
}
