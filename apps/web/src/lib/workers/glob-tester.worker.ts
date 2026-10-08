/**
 * Tests pasted paths against pasted glob patterns or .gitignore rules and posts back the rows, or an error. Every run of
 * the glob and .gitignore tester goes through this worker (see run-glob-tester-in-worker.ts's own comment), and every
 * run gets a new one. Some patterns make a regular expression backtrack for seconds on a long path, and that happens in
 * one synchronous call that nothing can interrupt, so it runs here, where the page can stop it for real with
 * terminate().
 *
 * The worker imports one function from the tool package, `testPatterns`. Nothing is fetched, stored or logged here. Only
 * the rows (the paths, which rule decided each one) and the regular expressions come back; an error carries a fixed
 * sentence and the error's own name, or the package's own refusal, which names a line and never holds pasted text.
 *
 * This worker posts `glob-tester-ready` as the very last statement of the module, after its message listener exists.
 * The page posts the job only when it has seen that message, so a job can never reach a worker that has not finished
 * starting (a module worker drops a message that arrives before its evaluation is over). The worker cannot report its
 * own timeout: it may be stuck inside one call, so the page owns the limit and terminates it.
 */
import { GlobTesterError, testPatterns, type TestResult } from '@fodt/glob-tester';

export interface GlobTesterJobMessage {
  type: 'glob-tester-job';
  mode: 'glob' | 'gitignore' | 'codeowners';
  patterns: string;
  paths: string;
  /** Glob mode only; the page sends false in .gitignore mode. */
  dot: boolean;
  /** Glob mode only; the page sends false in .gitignore mode. */
  nocase: boolean;
}

export interface GlobTesterReadyMessage {
  type: 'glob-tester-ready';
}

export interface GlobTesterDoneMessage {
  type: 'glob-tester-done';
  result: TestResult;
}

export interface GlobTesterErrorMessage {
  type: 'glob-tester-error';
  message: string;
  line?: number;
  part?: 'patterns' | 'paths';
}

export type GlobTesterWorkerMessage = GlobTesterReadyMessage | GlobTesterDoneMessage | GlobTesterErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the browser types tool pages need) but not the worker
 * library, so TypeScript resolves the ambient global in this file to a window-shaped global rather than the worker's
 * own global scope it actually is at runtime. Narrowing once into this small locally declared shape sidesteps the
 * mismatch, the same pattern the other workers use.
 */
interface WorkerGlobal {
  postMessage(message: GlobTesterWorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<GlobTesterJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

/** A fixed sentence and the error's own name. The package's refusals carry plain messages that hold no pasted text. */
function describe(err: unknown): GlobTesterErrorMessage {
  if (err instanceof GlobTesterError) {
    return err.line === undefined
      ? { type: 'glob-tester-error', message: err.message, part: err.part }
      : { type: 'glob-tester-error', message: err.message, part: err.part, line: err.line };
  }
  const name = err instanceof Error && err.name !== '' ? err.name : 'Error';
  return { type: 'glob-tester-error', message: `The background task could not test these patterns (${name}).` };
}

function handleJob(job: GlobTesterJobMessage): void {
  try {
    const result = testPatterns({
      mode: job.mode,
      patterns: job.patterns,
      paths: job.paths,
      dot: job.dot,
      nocase: job.nocase,
    });
    workerGlobal.postMessage({ type: 'glob-tester-done', result });
  } catch (err) {
    workerGlobal.postMessage(describe(err));
  }
}

workerGlobal.addEventListener('message', (event) => {
  handleJob(event.data);
});

// Last statement of the module: the listener above exists, so a job posted now cannot be lost.
workerGlobal.postMessage({ type: 'glob-tester-ready' });
