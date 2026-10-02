/**
 * The page-side helper that starts the xsd-validator worker, waits for it to
 * report that it is ready, posts the job, and races the run against a fixed
 * time limit, terminating the worker unconditionally when the limit wins.
 *
 * Imports the worker with the build-time inlining suffix, not the
 * URL-and-constructor form -- see run-jsonpath-in-worker.ts's own comment
 * for why that line is load-bearing for the privacy harness.
 *
 * A close copy of run-sqlite-viewer-in-worker.ts, not a shared helper --
 * same reason that file gives for its own duplication. Every run gets a NEW
 * worker: libxml2 keeps every parsed document in the worker's memory, and a
 * trap or a runaway validation may leave an instance in an undefined state,
 * so no run ever inherits the previous one's.
 *
 * The handshake is not optional for this engine. libxml2-wasm awaits its
 * WebAssembly at the top level of its module, so the worker's module is
 * still being evaluated for a moment after it starts, and a module worker
 * drops a message posted to it while that is happening (a job posted
 * straight after construction was never answered in an earlier trial). The
 * worker says `xsd-validator-ready` as the last statement of its module and
 * the job is posted only then. A worker that never says ready is stopped
 * after 10 seconds with its own message. The 20 second run limit begins when
 * the job is posted, not when the worker is created, so a slow start is
 * never counted against the visitor's document.
 *
 * The run limit is 20 seconds. Validating a 29 MB document measured about
 * 0.6 seconds in Node when run alone, and the four-browser Playwright run
 * drives many workers at once on one machine, so 20 seconds is many times
 * the slowest measured realistic job and still short enough that nobody
 * waits on a validation that never ends. The page owns the limit because the
 * worker is stuck inside one synchronous engine call when it matters, and
 * terminate() is the only real way to stop it.
 */
import XsdValidatorWorker from './workers/xsd-validator.worker.ts?worker&inline';
import type { XsdValidatorJobMessage, XsdValidatorWorkerMessage } from './workers/xsd-validator.worker';
import type { NotLoadedReference, XsdIssue, XsdValidationResult } from '@fodt/xsd-validator';
import type { RunContext } from './tool-ui';

export const XSD_VALIDATOR_TIME_LIMIT_MS = 20000;

export const XSD_VALIDATOR_TIME_LIMIT_MESSAGE =
  'Stopped after 20 seconds: validation took too long. Try a smaller document.';

export const XSD_VALIDATOR_START_LIMIT_MS = 10000;

export const XSD_VALIDATOR_START_LIMIT_MESSAGE =
  'The background task did not start within 10 seconds. Reload the page and try again.';

/** A problem with what was pasted, as the worker reported it: the part it is in, and where libxml2 said. */
export class XsdValidatorRunError extends Error {
  readonly part?: 'schema' | 'document';
  readonly line?: number;
  readonly column?: number;
  readonly issues: XsdIssue[];
  readonly notLoaded: NotLoadedReference[];

  constructor(
    message: string,
    detail: {
      part?: 'schema' | 'document';
      line?: number;
      column?: number;
      issues?: XsdIssue[];
      notLoaded?: NotLoadedReference[];
    } = {},
  ) {
    super(message);
    this.name = 'XsdValidatorRunError';
    this.part = detail.part;
    this.line = detail.line;
    this.column = detail.column;
    this.issues = detail.issues ?? [];
    this.notLoaded = detail.notLoaded ?? [];
  }
}

/**
 * Runs one validation in a new background worker, resolving with its
 * result. Settlement is the point of this function -- see
 * run-jsonpath-in-worker.ts's own comment on the guarded `settle` closure
 * this copies wholesale, covering success, an application error, a native
 * worker failure, an undeliverable message, an abort, an already-aborted
 * signal, the start limit and the time limit itself. Whichever of those
 * comes first decides the outcome; `settle` runs once, clears both timers
 * and terminates the worker once.
 */
export function xsdValidatorInWorker(
  job: XsdValidatorJobMessage,
  ctx: RunContext,
): Promise<XsdValidationResult | null> {
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<XsdValidationResult | null>((resolve, reject) => {
    const worker = new XsdValidatorWorker();
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

    type Outcome = { ok: true; value: XsdValidationResult | null } | { ok: false; error: Error };

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

    const onMessage = (event: MessageEvent<XsdValidatorWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'xsd-validator-ready') {
        // The worker is listening. Only now does the run exist: the start timer has done its job, and the
        // time limit begins at the moment the job is posted.
        clearTimeout(startTimer);
        runTimer = setTimeout(() => {
          settle({ ok: false, error: new Error(XSD_VALIDATOR_TIME_LIMIT_MESSAGE) });
        }, XSD_VALIDATOR_TIME_LIMIT_MS);
        try {
          worker.postMessage(job);
          posted = true;
        } catch {
          settle({ ok: false, error: new Error('The background task could not start.') });
        }
      } else if (data.type === 'xsd-validator-done') {
        settle({ ok: true, value: data.result });
      } else {
        settle({
          ok: false,
          error: new XsdValidatorRunError(data.message, {
            part: data.part,
            line: data.line,
            column: data.column,
            issues: data.issues,
            notLoaded: data.notLoaded,
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
      settle({ ok: false, error: new Error(XSD_VALIDATOR_START_LIMIT_MESSAGE) });
    }, XSD_VALIDATOR_START_LIMIT_MS);
  });
}
