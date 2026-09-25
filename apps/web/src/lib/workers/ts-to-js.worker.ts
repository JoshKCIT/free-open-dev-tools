/**
 * Runs one type-stripping job and posts back its result or its error.
 * Mirrors jsonpath.worker.ts's shape: no progress message (a single
 * synchronous `transpileModule` call has no point partway through where it
 * could report how far along it is), and this worker cannot report its own
 * timeout either -- see run-ts-to-js-in-worker.ts's own comment for why the
 * page, not this file, owns the time limit.
 */
import { stripTypes, TsToJsError, type StripTypesOptions, type StripTypesResult } from '@fodt/ts-to-js';

export interface TsToJsJobMessage {
  type: 'ts-to-js-job';
  source: string;
  options: StripTypesOptions;
}

export interface TsToJsDoneMessage {
  type: 'ts-to-js-done';
  result: StripTypesResult;
}

export interface TsToJsErrorMessage {
  type: 'ts-to-js-error';
  message: string;
}

export type TsToJsWorkerMessage = TsToJsDoneMessage | TsToJsErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the
 * browser types tool pages need) but not the worker library, so
 * TypeScript resolves the ambient global in this file to a window-shaped
 * global rather than the worker's own global scope it actually is at
 * runtime. Narrowing once into this small locally declared shape
 * sidesteps the mismatch, the same pattern jsonpath.worker.ts uses.
 */
interface WorkerGlobal {
  postMessage(message: TsToJsWorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<TsToJsJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

function handleJob(job: TsToJsJobMessage): void {
  try {
    const result = stripTypes(job.source, job.options);
    workerGlobal.postMessage({ type: 'ts-to-js-done', result });
  } catch (err) {
    if (err instanceof TsToJsError) {
      workerGlobal.postMessage({ type: 'ts-to-js-error', message: err.message });
      return;
    }
    workerGlobal.postMessage({
      type: 'ts-to-js-error',
      message: err instanceof Error ? err.message : 'The background task failed for an unknown reason.',
    });
  }
}

workerGlobal.addEventListener('message', (event) => {
  handleJob(event.data);
});
