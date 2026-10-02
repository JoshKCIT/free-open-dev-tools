/**
 * The page-side helper that starts the xml-formatter worker, waits for it to
 * report that it is ready, posts the job, and races the run against a fixed
 * time limit, terminating the worker unconditionally when the limit wins.
 * Only the Canonical XML and compare modes of the XML formatter come here;
 * its format, minify, check and tree modes run on the page.
 *
 * Imports the worker with the build-time inlining suffix, not the
 * URL-and-constructor form -- see run-jsonpath-in-worker.ts's own comment
 * for why that line is load-bearing for the privacy harness.
 *
 * A close copy of run-xsd-validator-in-worker.ts, not a shared helper --
 * same reason that file gives for its own duplication. Every run gets a NEW
 * worker: libxml2 keeps every parsed document in the worker's memory, and a
 * trap or a runaway run may leave an instance in an undefined state, so no
 * run ever inherits the previous one's.
 *
 * The handshake is not optional for this engine. libxml2-wasm awaits its
 * WebAssembly at the top level of its module, so the worker's module is
 * still being evaluated for a moment after it starts, and a module worker
 * drops a message posted to it while that is happening. The worker says
 * `xml-formatter-ready` as the last statement of its module and the job is
 * posted only then. A worker that never says ready is stopped after 10
 * seconds with its own message. The 20 second run limit begins when the job
 * is posted, not when the worker is created, so a slow start is never
 * counted against the visitor's document.
 *
 * The run limit is 20 seconds, the same figure as the XML Schema validator
 * that runs the same engine: a 29 MB document parsed and validated in about
 * a second in Node, and the four-browser Playwright run drives many workers
 * at once on one machine. The page owns the limit because the worker is
 * stuck inside one synchronous engine call when it matters, and terminate()
 * is the only real way to stop it.
 */
import XmlFormatterWorker from './workers/xml-formatter.worker.ts?worker&inline';
import type {
  XmlFormatterJobMessage,
  XmlFormatterResult,
  XmlFormatterWorkerMessage,
} from './workers/xml-formatter.worker';
import type { RunContext } from './tool-ui';

export const XML_FORMATTER_TIME_LIMIT_MS = 20000;

export const XML_FORMATTER_TIME_LIMIT_MESSAGE =
  'Stopped after 20 seconds: this document took too long. Try a smaller document.';

export const XML_FORMATTER_START_LIMIT_MS = 10000;

export const XML_FORMATTER_START_LIMIT_MESSAGE =
  'The background task did not start within 10 seconds. Reload the page and try again.';

export type { XmlFormatterResult };

/** A problem with what was pasted, as the worker reported it: where libxml2 said, and which document it is in. */
export class XmlFormatterRunError extends Error {
  readonly line?: number;
  readonly column?: number;
  readonly part?: 'first' | 'second';

  constructor(message: string, detail: { line?: number; column?: number; part?: 'first' | 'second' } = {}) {
    super(message);
    this.name = 'XmlFormatterRunError';
    this.line = detail.line;
    this.column = detail.column;
    this.part = detail.part;
  }
}

/**
 * Runs one canonical or compare run in a new background worker, resolving
 * with its result. Settlement is the point of this function -- see
 * run-jsonpath-in-worker.ts's own comment on the guarded `settle` closure
 * this copies wholesale, covering success, an application error, a native
 * worker failure, an undeliverable message, an abort, an already-aborted
 * signal, the start limit and the time limit itself. Whichever of those
 * comes first decides the outcome; `settle` runs once, clears both timers
 * and terminates the worker once.
 */
export function xmlFormatterInWorker(job: XmlFormatterJobMessage, ctx: RunContext): Promise<XmlFormatterResult> {
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<XmlFormatterResult>((resolve, reject) => {
    const worker = new XmlFormatterWorker();
    let settled = false;
    let runTimer: ReturnType<typeof setTimeout> | undefined;

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
    };

    type Outcome = { ok: true; value: XmlFormatterResult } | { ok: false; error: Error };

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

    const onMessage = (event: MessageEvent<XmlFormatterWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'xml-formatter-ready') {
        // The worker is listening. Only now does the run exist: the start timer has done its job, and the
        // time limit begins at the moment the job is posted.
        clearTimeout(startTimer);
        runTimer = setTimeout(() => {
          settle({ ok: false, error: new Error(XML_FORMATTER_TIME_LIMIT_MESSAGE) });
        }, XML_FORMATTER_TIME_LIMIT_MS);
        try {
          worker.postMessage(job);
        } catch {
          settle({ ok: false, error: new Error('The background task could not start.') });
        }
      } else if (data.type === 'xml-formatter-done') {
        settle({ ok: true, value: data.result });
      } else {
        settle({
          ok: false,
          error: new XmlFormatterRunError(data.message, { line: data.line, column: data.column, part: data.part }),
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
      settle({ ok: false, error: new Error(XML_FORMATTER_START_LIMIT_MESSAGE) });
    }, XML_FORMATTER_START_LIMIT_MS);
  });
}
