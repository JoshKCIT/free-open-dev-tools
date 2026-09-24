/**
 * The second background worker in this project (the first is
 * `hash-file.worker.ts`, plan 02-10). Runs one bcrypt hash or verify job at
 * a cost slow enough to freeze the tab if run on the main thread. All logic
 * that actually calls bcrypt lives in the tool package (@fodt/bcrypt); this
 * file only owns the message protocol back to the page and forwarding the
 * package's own per-round progress callback.
 *
 * A close copy of `hash-file.worker.ts`'s structure, not an extension of
 * it. Written as a second pair of files rather than sharing one helper
 * with `run-in-worker.ts`, because each tool page is its own lazily loaded
 * chunk (`registry.ts:24`) -- one shared helper importing both inlined
 * workers would put the whole of each into the other's chunk. A copy of
 * about forty lines is a better trade than doubling two pages' download
 * size. Deliberate duplication, not an oversight.
 */
import { hashPassword, verifyPassword, type HashReport, type VerifyReport } from '@fodt/bcrypt';

/** One message the page sends to start a hash or a verify. */
export type BcryptJobMessage =
  | { type: 'bcrypt-job'; operation: 'hash'; password: string; cost: number }
  | { type: 'bcrypt-job'; operation: 'verify'; password: string; hash: string };

export interface BcryptProgressMessage {
  type: 'bcrypt-progress';
  fraction: number;
}

export interface BcryptDoneMessage {
  type: 'bcrypt-done';
  operation: 'hash' | 'verify';
  /**
   * The package's own report, carried across the worker boundary
   * unchanged. `VerifyReport.outcome` stays three-valued
   * (`'correct' | 'incorrect' | 'cannot-check'`) here -- this message never
   * collapses it to a boolean. Reducing it anywhere on this path is exactly
   * how a `cannot-check` report turns back into the forbidden "incorrect"
   * answer while every package test stays green.
   */
  report: HashReport | VerifyReport;
}

export interface BcryptErrorMessage {
  type: 'bcrypt-error';
  /** A plain description. Never the password. */
  message: string;
}

export type BcryptWorkerMessage = BcryptProgressMessage | BcryptDoneMessage | BcryptErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library but not the
 * worker library (see `hash-file.worker.ts`'s identical note), so `self`
 * resolves to a window-shaped type here rather than the worker global it
 * actually is at runtime. Narrowing once into this small locally declared
 * shape sidesteps the mismatch; nothing below assigns through
 * `self.onmessage` or touches the raw global directly.
 */
interface WorkerGlobal {
  postMessage(message: BcryptWorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<BcryptJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

async function handleJob(job: BcryptJobMessage): Promise<void> {
  try {
    const onProgress = (fraction: number) => {
      workerGlobal.postMessage({ type: 'bcrypt-progress', fraction });
    };

    if (job.operation === 'hash') {
      const report = await hashPassword(job.password, job.cost, { onProgress });
      workerGlobal.postMessage({ type: 'bcrypt-done', operation: 'hash', report });
    } else {
      const report = await verifyPassword(job.password, job.hash, { onProgress });
      workerGlobal.postMessage({ type: 'bcrypt-done', operation: 'verify', report });
    }
  } catch (err) {
    workerGlobal.postMessage({
      type: 'bcrypt-error',
      message: err instanceof Error ? err.message : 'The background task failed for an unknown reason.',
    });
  }
}

workerGlobal.addEventListener('message', (event) => {
  void handleJob(event.data);
});
