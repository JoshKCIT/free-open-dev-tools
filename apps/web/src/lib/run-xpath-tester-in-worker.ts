/**
 * The page-side helper that starts the XPath-evaluating worker and races it
 * against a fixed time limit, terminating it unconditionally if that limit
 * wins.
 *
 * Imports the worker with the build-time inlining suffix, not the
 * URL-and-constructor form -- the single most important line in this file,
 * for exactly the reason run-jsonpath-in-worker.ts documents: the default
 * form emits the worker as a separately fetched file, and because the
 * worker is constructed when the visitor presses Run, that fetch would land
 * inside the window the privacy harness records, where it is an offending
 * request. The inlining form embeds the worker's code in the page chunk and
 * constructs it from an object URL, which the harness's existing filter
 * already excludes.
 *
 * A close copy of run-jsonpath-in-worker.ts, not a shared helper -- see that
 * file's own comment on why the duplication is deliberate. The settlement
 * contract is copied wholesale: one guarded `settle` closure, the same
 * fixed failure message on every native-failure path, and the same
 * `setTimeout` race that is the only way to stop a runaway expression --
 * `//descendant-or-self::node()` style paths and certain predicates can
 * walk the whole document repeatedly, which is synchronous and
 * un-interruptible from inside once started.
 */
import XPathWorker from './workers/xpath-tester.worker.ts?worker&inline';
import type { XPathJobMessage, XPathWorkerMessage } from './workers/xpath-tester.worker';
import type { XPathEvaluateResult } from '@fodt/xpath-tester';
import type { RunContext } from './tool-ui';

/** The exact value this file enforces, same register as the jsonpath worker's own 1.5 second limit. */
export const XPATH_TIME_LIMIT_MS = 1500;

export const XPATH_TIME_LIMIT_MESSAGE =
  'Stopped after 1.5 seconds: this expression took too long on this document. Try a more specific path or a smaller document.';

/**
 * Carries the position a document or expression error was found at across
 * the worker boundary -- postMessage cannot clone an XPathTesterError
 * instance with its prototype intact, so the worker posts its fields as
 * plain data and this class reconstructs an Error the page can catch and
 * read `kind`, `line` and `column` from.
 */
export class XPathRunError extends Error {
  readonly kind: 'xml' | 'expression';
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, kind: 'xml' | 'expression', line?: number, column?: number) {
    super(message);
    this.name = 'XPathRunError';
    this.kind = kind;
    this.line = line;
    this.column = column;
  }
}

/**
 * Runs one XPath job in the background worker, resolving with its result.
 *
 * Settlement is the point of this function, not an afterthought: it
 * resolves or rejects exactly once, through the single guarded `settle`
 * closure below, covering every way a background job can end -- success, an
 * application-level error the worker reports on purpose, a native worker
 * failure that never gets to report anything, a message that could not be
 * delivered in either direction, an abort, a signal that was already
 * aborted before this function was even called, and the time limit itself.
 * Every one of those paths terminates the worker and removes every
 * listener this function registered, so a settled run never keeps a
 * background thread, a stale listener or a pending timer alive.
 */
export function xpathInWorker(job: XPathJobMessage, ctx: RunContext): Promise<XPathEvaluateResult> {
  // Already aborted before construction: a listener registered on an
  // already-fired signal never runs, so this must be checked up front
  // rather than relying on the 'abort' listener registered below.
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<XPathEvaluateResult>((resolve, reject) => {
    const worker = new XPathWorker();
    let settled = false;

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
    };

    type Outcome = { ok: true; value: XPathEvaluateResult } | { ok: false; error: Error };

    /**
     * The single place this promise settles. Guarded by `settled` so it
     * can be called from any of the listeners below, or from the timer,
     * without risk of a double resolve/reject. Always clears the timer,
     * always removes every listener and always terminates the worker --
     * the `finally` makes listener removal and termination unconditional
     * even if removing a listener were ever to throw.
     */
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

    const onMessage = (event: MessageEvent<XPathWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'xpath-done') settle({ ok: true, value: data.result });
      else settle({ ok: false, error: new XPathRunError(data.message, data.kind, data.line, data.column) });
    };

    // Native worker failure: the worker throws while its module is
    // initialising, so it never gets to post anything of its own. Without
    // this listener the promise above would never settle at all, leaving
    // the Run button stuck on its Working label forever.
    const onNativeError = () => {
      settle({ ok: false, error: new Error('The background task could not start.') });
    };

    // A message could not be delivered in either direction (for instance,
    // a value that cannot be structured-cloned). Treated the same as a
    // native failure rather than left to hang.
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

    // The outcome unique to this worker: the evaluation genuinely froze the
    // worker's own thread, so the WORKER cannot post anything -- this timer,
    // started right after postMessage, is the only thing that can still
    // notice. When it wins the race it terminates the worker unconditionally
    // and writes the message itself, since the worker never gets the chance.
    const timer = setTimeout(() => {
      settle({ ok: false, error: new Error(XPATH_TIME_LIMIT_MESSAGE) });
    }, XPATH_TIME_LIMIT_MS);

    try {
      worker.postMessage(job);
    } catch {
      // postMessage throws synchronously when its argument cannot be
      // structured-cloned. Settle from the catch rather than leaving the
      // promise pending. The same fixed message as the other native
      // failure paths above, for the same reason run-jsonpath-in-worker.ts
      // gives: matching it keeps every startup failure on this page
      // reading the same way.
      settle({ ok: false, error: new Error('The background task could not start.') });
    }
  });
}
