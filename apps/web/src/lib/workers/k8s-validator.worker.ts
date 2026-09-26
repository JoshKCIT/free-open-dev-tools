/**
 * Runs one Kubernetes-manifest validation job and posts back its result or
 * its error. Mirrors docker-compose-validator.worker.ts's shape (plan
 * 07-01): no progress message (a synchronous YAML parse plus Ajv validate
 * calls have no point partway through where it could report how far along it
 * is), and this worker cannot report its own timeout either -- see
 * run-k8s-in-worker.ts's own comment for why the page, not this file, owns
 * the time limit.
 */
import { validateManifests, K8sValidatorError, YamlSourceError, type K8sValidateResult } from '@fodt/k8s-validator';

/** One message the page sends to start a run. */
export interface K8sJobMessage {
  type: 'k8s-job';
  text: string;
}

export interface K8sDoneMessage {
  type: 'k8s-done';
  result: K8sValidateResult;
}

export interface K8sErrorMessage {
  type: 'k8s-error';
  message: string;
  line?: number;
  column?: number;
  path?: string;
}

export type K8sWorkerMessage = K8sDoneMessage | K8sErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the browser
 * types tool pages need) but not the worker library, so TypeScript resolves
 * the ambient global in this file to a window-shaped global rather than the
 * worker's own global scope it actually is at runtime. Narrowing once into
 * this small locally declared shape sidesteps the mismatch, the same
 * pattern docker-compose-validator.worker.ts uses.
 */
interface WorkerGlobal {
  postMessage(message: K8sWorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<K8sJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

function handleJob(job: K8sJobMessage): void {
  try {
    const result = validateManifests(job.text);
    workerGlobal.postMessage({ type: 'k8s-done', result });
  } catch (err) {
    if (err instanceof YamlSourceError) {
      workerGlobal.postMessage({
        type: 'k8s-error',
        message: err.message,
        line: err.line,
        column: err.column,
        path: err.path,
      });
      return;
    }
    if (err instanceof K8sValidatorError) {
      workerGlobal.postMessage({ type: 'k8s-error', message: err.message });
      return;
    }
    workerGlobal.postMessage({
      type: 'k8s-error',
      message: err instanceof Error ? err.message : 'The background task failed for an unknown reason.',
    });
  }
}

workerGlobal.addEventListener('message', (event) => {
  handleJob(event.data);
});
