/**
 * Runs one regex job (test, replace or explain) and posts back its result or
 * its error. Unlike hash-file.worker.ts, this worker posts no progress
 * message: a synchronous `RegExp.exec`/`matchAll`/AST walk has no point
 * partway through where it could report how far along it is, so that
 * message type is omitted entirely rather than left unused.
 *
 * This worker cannot report its own timeout either -- see
 * run-regex-in-worker.ts's own comment for why the page, not this file,
 * owns the time limit.
 */
import { runRegexJob, type RegexJob, type RegexResult } from '@fodt/regex-tester';

/** One message the page sends to start a run. */
export interface RegexJobMessage {
  type: 'regex-tester-job';
  job: RegexJob;
}

export interface RegexDoneMessage {
  type: 'regex-tester-done';
  result: RegexResult;
}

export interface RegexErrorMessage {
  type: 'regex-tester-error';
  /** The RegexToolError's own message when the job failed on purpose; a fixed sentence otherwise. */
  message: string;
}

export type RegexWorkerMessage = RegexDoneMessage | RegexErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the
 * browser types tool pages need) but not the worker library, so
 * TypeScript resolves the ambient global in this file to a window-shaped
 * global rather than the worker's own global scope it actually is at
 * runtime. Assigning a handler directly onto that global's own message
 * property inherits that same wrong shape and does not typecheck cleanly
 * either. Narrowing once into this small locally declared shape sidesteps
 * the mismatch instead: everything below goes through `workerGlobal`,
 * never through the raw global directly, and never through a direct
 * property assignment for the message handler -- that is exactly the form
 * this narrowing exists to avoid.
 */
interface WorkerGlobal {
  postMessage(message: RegexWorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<RegexJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

function handleJob(job: RegexJob): void {
  try {
    const result = runRegexJob(job);
    workerGlobal.postMessage({ type: 'regex-tester-done', result });
  } catch (err) {
    workerGlobal.postMessage({
      type: 'regex-tester-error',
      message: err instanceof Error ? err.message : 'The background task failed for an unknown reason.',
    });
  }
}

workerGlobal.addEventListener('message', (event) => {
  handleJob(event.data.job);
});
