/**
 * The page-side helper that starts the glob-tester worker, waits for it to report that it is ready, posts the job, and
 * races the run against a fixed time limit, terminating the worker unconditionally when the limit wins.
 *
 * Imports the worker with the build-time inlining suffix, not the URL-and-constructor form -- see
 * run-jsonpath-in-worker.ts's own comment for why that line is load-bearing for the privacy harness.
 *
 * A close copy of run-jq-playground-in-worker.ts, not a shared helper -- the same reason that file gives for its own
 * duplication. Every run gets a NEW worker, so no run ever inherits anything from the previous one. Starting one costs
 * a few tens of milliseconds.
 *
 * The handshake exists because every worker on the site is a module worker (apps/web/vite.config.ts), and a module
 * whose evaluation is still running drops a message posted to it. The worker says `glob-tester-ready` as the last
 * statement of its module; the job is posted only then. Two limits follow from that. A worker that never says ready is
 * stopped after 10 seconds with its own message, so a tab whose worker cannot start does not wait forever. The 5 second
 * run limit starts when the job is posted, not when the worker is created, so a slow start is never counted against the
 * visitor's patterns.
 *
 * The run limit is 5 seconds. Matching 1,000 patterns against 5,000 paths took about 2 to 3 seconds in the slowest measured
 * case, while `*a*a*a*a*a*a*a*a*b` against 40 letters a and a c takes about 6 seconds in picomatch, so 5 seconds is
 * well above any realistic paste and stops exactly the patterns that backtrack. The page owns the limit because the
 * worker is stuck inside one synchronous call when it matters, and terminate() is the only real way to stop it.
 *
 * Only the mode, the two pasted texts and two options go in; only rows, regular expressions or a fixed sentence come
 * back, and no message holds pasted text.
 */
import GlobTesterWorker from './workers/glob-tester.worker.ts?worker&inline';
import type { GlobTesterJobMessage, GlobTesterWorkerMessage } from './workers/glob-tester.worker';
import type { TestResult } from '@fodt/glob-tester';
import type { RunContext } from './tool-ui';

export const GLOB_TESTER_TIME_LIMIT_MS = 5000;

export const GLOB_TESTER_TIME_LIMIT_MESSAGE =
  'Stopped after 5 seconds: a pattern took too long on one of the paths. Shorten the pattern or the path. A very large .gitignore paste can also take this long: try fewer rules or fewer paths.';

export const GLOB_TESTER_START_LIMIT_MS = 10000;

export const GLOB_TESTER_START_LIMIT_MESSAGE =
  'The background task did not start within 10 seconds. Reload the page and try again.';

export const GLOB_TESTER_NOT_STARTED_MESSAGE = 'The background task could not start.';

export const GLOB_TESTER_STOPPED_MESSAGE = 'The background task stopped unexpectedly.';

/** A problem with what was pasted, as the worker reported it: a fixed sentence, the part it is in and the line. */
export class GlobTesterRunError extends Error {
  readonly part?: 'patterns' | 'paths';
  readonly line?: number;

  constructor(message: string, detail: { part?: 'patterns' | 'paths'; line?: number } = {}) {
    super(message);
    this.name = 'GlobTesterRunError';
    this.part = detail.part;
    this.line = detail.line;
  }
}

/**
 * Runs one test in a new background worker, resolving with its rows. Settlement is the point of this function -- see
 * run-jsonpath-in-worker.ts's own comment on the guarded `settle` closure this copies wholesale, covering success, an
 * application error, a native worker failure, an undeliverable message, an abort, an already-aborted signal, the start
 * limit and the time limit itself. Whichever of those comes first decides the outcome; `settle` runs once, clears both
 * timers and terminates the worker once.
 */
export function globTesterInWorker(job: GlobTesterJobMessage, ctx: RunContext): Promise<TestResult> {
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<TestResult>((resolve, reject) => {
    const worker = new GlobTesterWorker();
    let settled = false;
    let runTimer: ReturnType<typeof setTimeout> | undefined;
    // Whether the job has been posted. A worker that fails after that did start, so it is not reported as unable to.
    let posted = false;
    const failedMessage = () => (posted ? GLOB_TESTER_STOPPED_MESSAGE : GLOB_TESTER_NOT_STARTED_MESSAGE);

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
    };

    type Outcome = { ok: true; value: TestResult } | { ok: false; error: Error };

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

    const onMessage = (event: MessageEvent<GlobTesterWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'glob-tester-ready') {
        // The worker is listening. Only now does the run exist: the start timer has done its job, and the time limit
        // begins at the moment the job is posted.
        clearTimeout(startTimer);
        runTimer = setTimeout(() => {
          settle({ ok: false, error: new Error(GLOB_TESTER_TIME_LIMIT_MESSAGE) });
        }, GLOB_TESTER_TIME_LIMIT_MS);
        try {
          worker.postMessage(job);
          posted = true;
        } catch {
          settle({ ok: false, error: new Error(GLOB_TESTER_NOT_STARTED_MESSAGE) });
        }
      } else if (data.type === 'glob-tester-done') {
        settle({ ok: true, value: data.result });
      } else {
        settle({ ok: false, error: new GlobTesterRunError(data.message, { part: data.part, line: data.line }) });
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
      settle({ ok: false, error: new Error(GLOB_TESTER_START_LIMIT_MESSAGE) });
    }, GLOB_TESTER_START_LIMIT_MS);
  });
}
