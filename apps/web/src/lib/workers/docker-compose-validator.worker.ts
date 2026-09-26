/**
 * Runs one Compose-file validation job and posts back its result or its
 * error. Mirrors json-schema-validator.worker.ts's shape (plan 07-01): no
 * progress message (a synchronous YAML parse plus one Ajv validate call has
 * no point partway through where it could report how far along it is), and
 * this worker cannot report its own timeout either -- see
 * run-docker-compose-in-worker.ts's own comment for why the page, not this
 * file, owns the time limit.
 */
import {
  validateCompose,
  ComposeValidatorError,
  YamlSourceError,
  type ComposeValidateResult,
} from '@fodt/docker-compose-validator';

/** One message the page sends to start a run. */
export interface ComposeJobMessage {
  type: 'compose-job';
  text: string;
}

export interface ComposeDoneMessage {
  type: 'compose-done';
  result: ComposeValidateResult;
}

export interface ComposeErrorMessage {
  type: 'compose-error';
  message: string;
  line?: number;
  column?: number;
  path?: string;
}

export type ComposeWorkerMessage = ComposeDoneMessage | ComposeErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the browser
 * types tool pages need) but not the worker library, so TypeScript resolves
 * the ambient global in this file to a window-shaped global rather than the
 * worker's own global scope it actually is at runtime. Narrowing once into
 * this small locally declared shape sidesteps the mismatch, the same
 * pattern json-schema-validator.worker.ts uses.
 */
interface WorkerGlobal {
  postMessage(message: ComposeWorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<ComposeJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

function handleJob(job: ComposeJobMessage): void {
  try {
    const result = validateCompose(job.text);
    workerGlobal.postMessage({ type: 'compose-done', result });
  } catch (err) {
    if (err instanceof YamlSourceError) {
      workerGlobal.postMessage({
        type: 'compose-error',
        message: err.message,
        line: err.line,
        column: err.column,
        path: err.path,
      });
      return;
    }
    if (err instanceof ComposeValidatorError) {
      workerGlobal.postMessage({ type: 'compose-error', message: err.message });
      return;
    }
    workerGlobal.postMessage({
      type: 'compose-error',
      message: err instanceof Error ? err.message : 'The background task failed for an unknown reason.',
    });
  }
}

workerGlobal.addEventListener('message', (event) => {
  handleJob(event.data);
});
