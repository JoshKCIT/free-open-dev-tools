/**
 * Runs one jq filter and posts back its result or its error. Every
 * jq-playground run goes through this worker (see
 * run-jq-playground-in-worker.ts's own comment), and every run gets a new
 * one, so the engine and its memory start clean each time and nothing is kept
 * once the run ends.
 *
 * The engine is jq 1.8.2 compiled to WebAssembly by jq-wasm. This is the
 * package's own `inline` entry, which carries the WebAssembly bytes inside
 * its JavaScript: the default entry builds a URL for a separate .wasm file at
 * load, which a blob worker cannot resolve, and nothing here may fetch. The
 * import is a relative path into the tool folder's installed copy of the
 * package, because the package is declared only in that folder and a bare
 * import would not resolve from here; the path is five levels up from
 * lib/workers to the repository root. The tool folder itself imports only the
 * engine's type, so the engine lands in this worker's source and in no page
 * chunk.
 *
 * The engine is loaded before the ready message, so the time it takes counts
 * against the page's 10 second start limit and never against the run limit.
 *
 * This worker posts `jq-playground-ready` as the very last statement of the
 * module, after its message listener exists. The page posts the job only when
 * it has seen that message, so a job can never reach a worker that has not
 * finished starting. The worker cannot report its own timeout: it may be
 * stuck inside one synchronous engine call, so the page owns the limit and
 * terminates it.
 */
import { loadJq } from '../../../../../tools/jq-playground/node_modules/jq-wasm/dist/inline.mjs';
import { engineFailureMessage, JqPlaygroundError, runJq, type JqOptions, type JqResult } from '@fodt/jq-playground';

export interface JqPlaygroundJobMessage {
  type: 'jq-playground-job';
  input: string;
  filter: string;
  options: JqOptions;
}

export interface JqPlaygroundReadyMessage {
  type: 'jq-playground-ready';
}

export interface JqPlaygroundDoneMessage {
  type: 'jq-playground-done';
  result: JqResult | null;
}

export interface JqPlaygroundErrorMessage {
  type: 'jq-playground-error';
  message: string;
  part?: 'input' | 'filter' | 'arguments' | 'run';
  line?: number;
  column?: number;
  output?: string;
  /** What debug and stderr wrote before the run failed. */
  diagnostics?: string;
}

export type JqPlaygroundWorkerMessage = JqPlaygroundReadyMessage | JqPlaygroundDoneMessage | JqPlaygroundErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the
 * browser types tool pages need) but not the worker library, so
 * TypeScript resolves the ambient global in this file to a window-shaped
 * global rather than the worker's own global scope it actually is at
 * runtime. Narrowing once into this small locally declared shape
 * sidesteps the mismatch, the same pattern the other workers use.
 */
interface WorkerGlobal {
  postMessage(message: JqPlaygroundWorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<JqPlaygroundJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

// Loaded here, before the ready message, so a slow load is part of the start and not of the run. A failed load is kept
// and reported as the answer to the job, with the same message the run would have given.
let engine: Awaited<ReturnType<typeof loadJq>> | undefined;
let engineFailure: unknown;
try {
  engine = await loadJq();
} catch (err) {
  engineFailure = err;
}

async function handleJob(job: JqPlaygroundJobMessage): Promise<void> {
  try {
    if (engine === undefined) throw engineFailure;
    const result = runJq(engine, job.input, job.filter, job.options);
    workerGlobal.postMessage({ type: 'jq-playground-done', result });
  } catch (err) {
    if (err instanceof JqPlaygroundError) {
      workerGlobal.postMessage({
        type: 'jq-playground-error',
        message: err.message,
        part: err.part,
        line: err.line,
        column: err.column,
        output: err.output,
        diagnostics: err.diagnostics,
      });
    } else {
      workerGlobal.postMessage({ type: 'jq-playground-error', message: engineFailureMessage(err) });
    }
  }
}

workerGlobal.addEventListener('message', (event) => {
  void handleJob(event.data);
});

// Last statement of the module: the listener above exists, so a job posted now cannot be lost.
workerGlobal.postMessage({ type: 'jq-playground-ready' });
