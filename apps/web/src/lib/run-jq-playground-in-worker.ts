/**
 * The page-side helper that starts the jq-playground worker, waits for it to
 * report that it is ready, posts the job, and races the run against a fixed
 * time limit, terminating the worker unconditionally when the limit wins.
 *
 * Imports the worker with the build-time inlining suffix, not the
 * URL-and-constructor form -- see run-jsonpath-in-worker.ts's own comment
 * for why that line is load-bearing for the privacy harness.
 *
 * A close copy of run-sqlite-viewer-in-worker.ts, not a shared helper --
 * same reason that file gives for its own duplication. Every run gets a NEW
 * worker: jq's engine keeps its input and its memory inside one WebAssembly
 * instance, and a filter that runs out of memory aborts that instance, so no
 * run is ever allowed to inherit the previous one's. Starting one costs a few
 * tens of milliseconds.
 *
 * Every worker on the site is a module worker, and a module worker drops a
 * message posted to it while its module is still being evaluated. The worker
 * says `jq-playground-ready` as the last statement of its module and the job
 * is posted only then. A worker that never says ready is stopped after 10
 * seconds with its own message. The 5 second run limit begins when the job is
 * posted, not when the worker is created, so a slow start is never counted
 * against the visitor's filter.
 *
 * The run limit is 5 seconds. A filter over a 5 MiB input measured well under
 * a second in Node when run alone, while `def f: f; f` never returns, so 5
 * seconds is many times the slowest realistic filter and still short enough
 * that nobody waits on one that never ends. The page owns the limit because
 * the worker is stuck inside one synchronous engine call when it matters, and
 * terminate() is the only real way to stop it.
 */
import JqPlaygroundWorker from './workers/jq-playground.worker.ts?worker&inline';
import type { JqPlaygroundJobMessage, JqPlaygroundWorkerMessage } from './workers/jq-playground.worker';
import type { JqResult } from '@fodt/jq-playground';
import type { RunContext } from './tool-ui';

export const JQ_PLAYGROUND_TIME_LIMIT_MS = 5000;

export const JQ_PLAYGROUND_TIME_LIMIT_MESSAGE =
  'Stopped after 5 seconds: this filter took too long. Check it for a loop that never ends.';

export const JQ_PLAYGROUND_START_LIMIT_MS = 10000;

export const JQ_PLAYGROUND_START_LIMIT_MESSAGE =
  'The background task did not start within 10 seconds. Reload the page and try again.';

/** A problem with what was pasted, as the worker reported it: the part it is in, where jq said, and any output so far. */
export class JqPlaygroundRunError extends Error {
  readonly part?: 'input' | 'filter' | 'arguments' | 'run';
  readonly line?: number;
  readonly column?: number;
  readonly output: string;
  /** What debug and stderr wrote before the run failed. */
  readonly diagnostics: string;

  constructor(
    message: string,
    detail: {
      part?: 'input' | 'filter' | 'arguments' | 'run';
      line?: number;
      column?: number;
      output?: string;
      diagnostics?: string;
    } = {},
  ) {
    super(message);
    this.name = 'JqPlaygroundRunError';
    this.part = detail.part;
    this.line = detail.line;
    this.column = detail.column;
    this.output = detail.output ?? '';
    this.diagnostics = detail.diagnostics ?? '';
  }
}

/**
 * Runs one filter in a new background worker, resolving with its result.
 * Settlement is the point of this function -- see run-jsonpath-in-worker.ts's
 * own comment on the guarded `settle` closure this copies wholesale, covering
 * success, an application error, a native worker failure, an undeliverable
 * message, an abort, an already-aborted signal, the start limit and the time
 * limit itself. Whichever of those comes first decides the outcome; `settle`
 * runs once, clears both timers and terminates the worker once.
 */
export function jqPlaygroundInWorker(job: JqPlaygroundJobMessage, ctx: RunContext): Promise<JqResult | null> {
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<JqResult | null>((resolve, reject) => {
    const worker = new JqPlaygroundWorker();
    let settled = false;
    let runTimer: ReturnType<typeof setTimeout> | undefined;

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
    };

    type Outcome = { ok: true; value: JqResult | null } | { ok: false; error: Error };

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

    const onMessage = (event: MessageEvent<JqPlaygroundWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'jq-playground-ready') {
        // The worker is listening. Only now does the run exist: the start timer has done its job, and the
        // time limit begins at the moment the job is posted.
        clearTimeout(startTimer);
        runTimer = setTimeout(() => {
          settle({ ok: false, error: new Error(JQ_PLAYGROUND_TIME_LIMIT_MESSAGE) });
        }, JQ_PLAYGROUND_TIME_LIMIT_MS);
        try {
          worker.postMessage(job);
        } catch {
          settle({ ok: false, error: new Error('The background task could not start.') });
        }
      } else if (data.type === 'jq-playground-done') {
        settle({ ok: true, value: data.result });
      } else {
        settle({
          ok: false,
          error: new JqPlaygroundRunError(data.message, {
            part: data.part,
            line: data.line,
            column: data.column,
            output: data.output,
            diagnostics: data.diagnostics,
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
      settle({ ok: false, error: new Error(JQ_PLAYGROUND_START_LIMIT_MESSAGE) });
    }, JQ_PLAYGROUND_START_LIMIT_MS);
  });
}
