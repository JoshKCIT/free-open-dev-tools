/**
 * The page-side helper that starts the SCSS & Less Compiler's worker, waits for it to report that it is ready, posts the
 * stylesheet to it, and races the run against a fixed time limit, terminating the worker unconditionally when a limit
 * wins.
 *
 * Imports the worker with the build-time inlining suffix, not the URL-and-constructor form -- see
 * run-jsonpath-in-worker.ts's own comment for why that line is load-bearing for the privacy harness.
 *
 * A close copy of run-key-converter-in-worker.ts, not a shared helper -- the same reason that file gives for its own
 * duplication. Every run gets a NEW worker, so no run ever inherits anything from the previous one. Starting one costs
 * about 100 to 150 milliseconds for Sass, which loads with the module, and a few tens of milliseconds for Less.
 *
 * The handshake exists because every worker on the site is a module worker (apps/web/vite.config.ts), and a module
 * whose evaluation is still running drops a message posted to it. The worker says `sass-less-compiler-ready` as the last
 * statement of its module; the stylesheet is posted only then. Two limits follow from that. A worker that never says
 * ready is stopped after 10 seconds with its own message, so a tab whose worker cannot start does not wait forever. The
 * 20 second run limit starts when the stylesheet is posted, not when the worker is created, so a slow start is never
 * counted against the visitor's stylesheet.
 *
 * The run limit is 20 seconds. Ordinary stylesheets compile in 9 to 22 milliseconds and a 200,000-rule loop in 1.6 to
 * 3.3 seconds in every tested engine, so 20 seconds is several times the slowest measured honest compile; an endless
 * `@while true` loop is stopped there. The page owns the limit because the worker is inside one engine call when it
 * matters, and terminate() is the only real way to stop it.
 *
 * Only the stylesheet and two choices go in; only the CSS, the warnings and the engine's name come back, or the
 * package's own plain message with its position.
 */
import SassLessCompilerWorker from './workers/sass-less-compiler.worker.ts?worker&inline';
import type { SassLessCompilerJobMessage, SassLessCompilerWorkerMessage } from './workers/sass-less-compiler.worker';
import type { RunContext } from './tool-ui';

export const SASS_LESS_COMPILER_TIME_LIMIT_MS = 20000;

export const SASS_LESS_COMPILER_TIME_LIMIT_MESSAGE =
  'Stopped after 20 seconds: compiling this stylesheet took too long. Look for a loop that never ends.';

export const SASS_LESS_COMPILER_START_LIMIT_MS = 10000;

export const SASS_LESS_COMPILER_START_LIMIT_MESSAGE =
  'The background task did not start within 10 seconds. Reload the page and try again.';

export const SASS_LESS_COMPILER_NOT_STARTED_MESSAGE = 'The background task could not start.';

export const SASS_LESS_COMPILER_STOPPED_MESSAGE = 'The background task stopped unexpectedly.';

/** A problem the helper or the worker reports, with the position the package gave when it gave one. */
export class SassLessCompilerRunError extends Error {
  readonly kind?: 'syntax' | 'import' | 'limit';
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, position?: { kind?: 'syntax' | 'import' | 'limit'; line?: number; column?: number }) {
    super(message);
    this.name = 'SassLessCompilerRunError';
    if (position?.kind !== undefined) this.kind = position.kind;
    if (position?.line !== undefined) this.line = position.line;
    if (position?.column !== undefined) this.column = position.column;
  }
}

export interface CompiledStylesheet {
  css: string;
  warnings: string[];
  engine: string;
}

/**
 * Compiles one stylesheet in a new background worker, resolving with its CSS, warnings and engine name. Settlement is the
 * point of this function -- see run-jsonpath-in-worker.ts's own comment on the guarded `settle` closure this copies
 * wholesale, covering success, an application error, a native worker failure, an undeliverable message, an abort, an
 * already-aborted signal, the start limit and the time limit itself. Whichever of those comes first decides the outcome;
 * `settle` runs once, clears both timers and terminates the worker once.
 */
export function compileInWorker(
  job: Omit<SassLessCompilerJobMessage, 'type'>,
  ctx: RunContext,
): Promise<CompiledStylesheet> {
  if (ctx.signal.aborted) {
    return Promise.reject(new SassLessCompilerRunError('The run was cancelled before it started.'));
  }

  return new Promise<CompiledStylesheet>((resolve, reject) => {
    const worker = new SassLessCompilerWorker();
    let settled = false;
    let runTimer: ReturnType<typeof setTimeout> | undefined;
    // Whether the job has been posted. A worker that fails after that did start, so it is not reported as unable to.
    let posted = false;
    const failedMessage = () => (posted ? SASS_LESS_COMPILER_STOPPED_MESSAGE : SASS_LESS_COMPILER_NOT_STARTED_MESSAGE);

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
    };

    type Outcome = { ok: true; value: CompiledStylesheet } | { ok: false; error: Error };

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

    const onMessage = (event: MessageEvent<SassLessCompilerWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'sass-less-compiler-ready') {
        // The worker is listening. Only now does the run exist: the start timer has done its job, and the time limit
        // begins at the moment the job is posted.
        clearTimeout(startTimer);
        runTimer = setTimeout(() => {
          settle({ ok: false, error: new SassLessCompilerRunError(SASS_LESS_COMPILER_TIME_LIMIT_MESSAGE) });
        }, SASS_LESS_COMPILER_TIME_LIMIT_MS);
        try {
          worker.postMessage({ type: 'sass-less-compiler-job', ...job } satisfies SassLessCompilerJobMessage);
          posted = true;
        } catch {
          settle({ ok: false, error: new SassLessCompilerRunError(SASS_LESS_COMPILER_NOT_STARTED_MESSAGE) });
        }
      } else if (data.type === 'sass-less-compiler-done') {
        settle({ ok: true, value: { css: data.css, warnings: data.warnings, engine: data.engine } });
      } else {
        settle({
          ok: false,
          error: new SassLessCompilerRunError(data.message, { kind: data.kind, line: data.line, column: data.column }),
        });
      }
    };

    const onNativeError = () => {
      settle({ ok: false, error: new SassLessCompilerRunError(failedMessage()) });
    };

    const onMessageError = () => {
      settle({ ok: false, error: new SassLessCompilerRunError(failedMessage()) });
    };

    const onAbort = () => {
      settle({ ok: false, error: new SassLessCompilerRunError('The run was cancelled.') });
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onNativeError);
    worker.addEventListener('messageerror', onMessageError);
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    const startTimer = setTimeout(() => {
      settle({ ok: false, error: new SassLessCompilerRunError(SASS_LESS_COMPILER_START_LIMIT_MESSAGE) });
    }, SASS_LESS_COMPILER_START_LIMIT_MS);
  });
}
