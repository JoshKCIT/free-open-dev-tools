/**
 * This page's own worker, calling this tool's own package directly -- not a
 * second copy of another page's worker importing a different tool's
 * package. The planner's own recorded choice (06-06-PLAN.md
 * `<objective>`): an existing worker pair on another page could have been
 * reused, but that page's own worker header comment already documents
 * one-worker-pair-per-page duplication as deliberate (each page is its own
 * lazily loaded chunk), and this keeps the site running the exact code
 * this folder's own tests cover, never another tool's package (D-02
 * applies to pages; this lib file stays neutral too).
 *
 * A close copy of that established worker shape otherwise: this file only
 * owns the message protocol back to the page. All hashing logic lives in
 * the tool package.
 */
import { htpasswdLine } from '@fodt/htaccess-generator';

export interface HtpasswdJobMessage {
  type: 'htpasswd-job';
  user: string;
  password: string;
  cost: number;
}

export interface HtpasswdDoneMessage {
  type: 'htpasswd-done';
  /** The finished `user:hash` line and any warnings. Never the password. */
  line: string;
  warnings: string[];
}

export interface HtpasswdErrorMessage {
  type: 'htpasswd-error';
  /** A plain description. Never the password. */
  message: string;
}

export type HtpasswdWorkerMessage = HtpasswdDoneMessage | HtpasswdErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library but not the
 * worker library (see `hash-file.worker.ts`'s identical note), so `self`
 * resolves to a window-shaped type here rather than the worker global it
 * actually is at runtime. Narrowing once into this small locally declared
 * shape sidesteps the mismatch; nothing below assigns through
 * `self.onmessage` or touches the raw global directly.
 */
interface WorkerGlobal {
  postMessage(message: HtpasswdWorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<HtpasswdJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

async function handleJob(job: HtpasswdJobMessage): Promise<void> {
  try {
    const result = await htpasswdLine(job.user, job.password, job.cost);
    workerGlobal.postMessage({ type: 'htpasswd-done', line: result.line, warnings: result.warnings });
  } catch (err) {
    workerGlobal.postMessage({
      type: 'htpasswd-error',
      message: err instanceof Error ? err.message : 'The background task failed for an unknown reason.',
    });
  }
}

workerGlobal.addEventListener('message', (event) => {
  void handleJob(event.data);
});
