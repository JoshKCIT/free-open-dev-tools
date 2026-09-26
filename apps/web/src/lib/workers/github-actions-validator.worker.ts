/**
 * Runs one workflow-file validation job and posts back its result or its
 * error. Mirrors docker-compose-validator.worker.ts's shape (plan 07-01):
 * no progress message (a synchronous YAML parse plus one Ajv validate call
 * has no point partway through where it could report how far along it is),
 * and this worker cannot report its own timeout either -- see
 * run-github-actions-in-worker.ts's own comment for why the page, not this
 * file, owns the time limit.
 */
import {
  validateWorkflow,
  WorkflowValidatorError,
  YamlSourceError,
  type WorkflowValidateResult,
} from '@fodt/github-actions-validator';

/** One message the page sends to start a run. */
export interface WorkflowJobMessage {
  type: 'workflow-job';
  text: string;
}

export interface WorkflowDoneMessage {
  type: 'workflow-done';
  result: WorkflowValidateResult;
}

export interface WorkflowErrorMessage {
  type: 'workflow-error';
  message: string;
  line?: number;
  column?: number;
  path?: string;
}

export type WorkflowWorkerMessage = WorkflowDoneMessage | WorkflowErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the browser
 * types tool pages need) but not the worker library, so TypeScript resolves
 * the ambient global in this file to a window-shaped global rather than the
 * worker's own global scope it actually is at runtime. Narrowing once into
 * this small locally declared shape sidesteps the mismatch, the same
 * pattern docker-compose-validator.worker.ts uses.
 */
interface WorkerGlobal {
  postMessage(message: WorkflowWorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkflowJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

function handleJob(job: WorkflowJobMessage): void {
  try {
    const result = validateWorkflow(job.text);
    workerGlobal.postMessage({ type: 'workflow-done', result });
  } catch (err) {
    if (err instanceof YamlSourceError) {
      workerGlobal.postMessage({
        type: 'workflow-error',
        message: err.message,
        line: err.line,
        column: err.column,
        path: err.path,
      });
      return;
    }
    if (err instanceof WorkflowValidatorError) {
      workerGlobal.postMessage({ type: 'workflow-error', message: err.message });
      return;
    }
    workerGlobal.postMessage({
      type: 'workflow-error',
      message: err instanceof Error ? err.message : 'The background task failed for an unknown reason.',
    });
  }
}

workerGlobal.addEventListener('message', (event) => {
  handleJob(event.data);
});
