/**
 * Runs one JSONPath evaluation job and posts back its result or its error.
 * Mirrors regex-tester.worker.ts's shape: no progress message (a
 * synchronous document parse plus one `exec` call has no point partway
 * through where it could report how far along it is), and this worker
 * cannot report its own timeout either -- see run-jsonpath-in-worker.ts's
 * own comment for why the page, not this file, owns the time limit.
 */
import { evaluateJsonPath, JsonPathError, type JsonPathResult } from '@fodt/jsonpath';

/** One message the page sends to start a run. */
export interface JsonPathJobMessage {
  type: 'jsonpath-job';
  documentText: string;
  expression: string;
}

export interface JsonPathDoneMessage {
  type: 'jsonpath-done';
  result: JsonPathResult;
}

export interface JsonPathErrorMessage {
  type: 'jsonpath-error';
  kind: 'document' | 'expression';
  message: string;
  line?: number;
  column?: number;
}

export type JsonPathWorkerMessage = JsonPathDoneMessage | JsonPathErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the
 * browser types tool pages need) but not the worker library, so
 * TypeScript resolves the ambient global in this file to a window-shaped
 * global rather than the worker's own global scope it actually is at
 * runtime. Narrowing once into this small locally declared shape
 * sidesteps the mismatch, the same pattern regex-tester.worker.ts uses.
 */
interface WorkerGlobal {
  postMessage(message: JsonPathWorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<JsonPathJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

function handleJob(job: JsonPathJobMessage): void {
  try {
    const result = evaluateJsonPath(job.documentText, job.expression);
    workerGlobal.postMessage({ type: 'jsonpath-done', result });
  } catch (err) {
    if (err instanceof JsonPathError) {
      workerGlobal.postMessage({
        type: 'jsonpath-error',
        kind: err.kind,
        message: err.message,
        line: err.line,
        column: err.column,
      });
      return;
    }
    workerGlobal.postMessage({
      type: 'jsonpath-error',
      kind: 'expression',
      message: err instanceof Error ? err.message : 'The background task failed for an unknown reason.',
    });
  }
}

workerGlobal.addEventListener('message', (event) => {
  handleJob(event.data);
});
