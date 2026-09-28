/**
 * Runs one data-convert job and posts back its result or its error. Mirrors
 * yaml-formatter.worker.ts's shape: a single synchronous `convertData` call
 * has no point partway through where it could report progress, and this
 * worker cannot report its own timeout either -- see
 * run-data-convert-in-worker.ts's own comment for why the page, not this
 * file, owns the time limit.
 */
import { convertData, DataConvertError, type ConvertOptions, type ConvertResult } from '@fodt/data-convert';

export interface DataConvertJobMessage {
  type: 'data-convert-job';
  source: string;
  options: ConvertOptions;
}

export interface DataConvertDoneMessage {
  type: 'data-convert-done';
  result: ConvertResult;
}

export interface DataConvertErrorMessage {
  type: 'data-convert-error';
  message: string;
  line?: number;
  column?: number;
  path?: string;
}

export type DataConvertWorkerMessage = DataConvertDoneMessage | DataConvertErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the
 * browser types tool pages need) but not the worker library, so
 * TypeScript resolves the ambient global in this file to a window-shaped
 * global rather than the worker's own global scope it actually is at
 * runtime. Narrowing once into this small locally declared shape
 * sidesteps the mismatch, the same pattern yaml-formatter.worker.ts uses.
 */
interface WorkerGlobal {
  postMessage(message: DataConvertWorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<DataConvertJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

function handleJob(job: DataConvertJobMessage): void {
  try {
    const result = convertData(job.source, job.options);
    workerGlobal.postMessage({ type: 'data-convert-done', result });
  } catch (err) {
    if (err instanceof DataConvertError) {
      workerGlobal.postMessage({
        type: 'data-convert-error',
        message: err.message,
        line: err.line,
        column: err.column,
        path: err.path,
      });
      return;
    }
    workerGlobal.postMessage({
      type: 'data-convert-error',
      message: err instanceof Error ? err.message : 'The background task failed for an unknown reason.',
    });
  }
}

workerGlobal.addEventListener('message', (event) => {
  handleJob(event.data);
});
