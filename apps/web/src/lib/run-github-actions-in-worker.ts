/**
 * The page-side helper that starts the workflow-validating worker and races
 * it against a fixed time limit, terminating it unconditionally if that
 * limit wins.
 *
 * A close copy of `run-docker-compose-in-worker.ts` (plan 07-01), not a
 * shared helper -- see that file's own comment on why the duplication is
 * deliberate. Imports the worker with the build-time inlining suffix, not
 * the URL-and-constructor form, for the same privacy-harness reason that
 * file gives: the worker is constructed when the visitor presses Run (or
 * types), and the inlining form embeds the worker's code in the page chunk
 * instead of emitting a separately fetched file. The settlement contract is
 * copied wholesale: one guarded `settle` closure, the same fixed failure
 * message on every native-failure path, and the same `setTimeout` race that
 * is the only way to stop a runaway validation -- a pathological YAML
 * document's duplicate-key scan is synchronous and un-interruptible from
 * inside once started, so this function, not the worker, owns the timer.
 */
import GithubActionsWorker from './workers/github-actions-validator.worker.ts?worker&inline';
import type { WorkflowJobMessage, WorkflowWorkerMessage } from './workers/github-actions-validator.worker';
import type { WorkflowValidateResult } from '@fodt/github-actions-validator';
import type { RunContext } from './tool-ui';

/** "About 2 seconds" per D-09/D-25/D-14/D-15/D-27; the exact value this file enforces. */
export const GITHUB_ACTIONS_TIME_LIMIT_MS = 2000;

export const GITHUB_ACTIONS_TIME_LIMIT_MESSAGE =
  'Stopped after 2 seconds: checking this file took too long. A mapping with a very large number of keys can do this; split the file and try again.';

/**
 * Carries the position a workflow validation error was found at across the
 * worker boundary -- postMessage cannot clone a `YamlSourceError`/
 * `WorkflowValidatorError` instance with its prototype intact, so the worker
 * posts its fields as plain data and this class reconstructs an Error the
 * page can catch and read `line`, `column` and `path` from.
 */
export class GithubActionsRunError extends Error {
  readonly line?: number;
  readonly column?: number;
  readonly path?: string;

  constructor(message: string, line?: number, column?: number, path?: string) {
    super(message);
    this.name = 'GithubActionsRunError';
    this.line = line;
    this.column = column;
    this.path = path;
  }
}

/**
 * Runs one workflow-validation job in the background worker, resolving with
 * its result.
 *
 * Settlement is the point of this function, not an afterthought: it
 * resolves or rejects exactly once, through the single guarded `settle`
 * closure below, covering every way a background job can end -- success, an
 * application-level error the worker reports on purpose, a native worker
 * failure that never gets to report anything, a message that could not be
 * delivered in either direction, an abort, a signal that was already
 * aborted before this function was even called, and the time limit itself.
 * Every one of those paths terminates the worker and removes every listener
 * this function registered, so a settled run never keeps a background
 * thread, a stale listener or a pending timer alive.
 */
export function githubActionsInWorker(job: WorkflowJobMessage, ctx: RunContext): Promise<WorkflowValidateResult> {
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<WorkflowValidateResult>((resolve, reject) => {
    const worker = new GithubActionsWorker();
    let settled = false;

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
    };

    type Outcome = { ok: true; value: WorkflowValidateResult } | { ok: false; error: Error };

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

    const onMessage = (event: MessageEvent<WorkflowWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'workflow-done') settle({ ok: true, value: data.result });
      else settle({ ok: false, error: new GithubActionsRunError(data.message, data.line, data.column, data.path) });
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
      settle({ ok: false, error: new Error(GITHUB_ACTIONS_TIME_LIMIT_MESSAGE) });
    }, GITHUB_ACTIONS_TIME_LIMIT_MS);

    try {
      worker.postMessage(job);
    } catch {
      settle({ ok: false, error: new Error('The background task could not start.') });
    }
  });
}
