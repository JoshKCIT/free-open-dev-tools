/**
 * Runs one csv-viewer job (detect, sort, filter) and posts back its result
 * or its error. Like regex-tester.worker.ts, this worker posts no progress
 * message: a synchronous parse/sort/filter pass has no point partway
 * through where it could report how far along it is.
 *
 * This worker cannot report its own timeout either -- see
 * run-csv-viewer-in-worker.ts's own comment for why the page, not this
 * file, owns the time limit.
 */
import { viewCsv, CsvViewerError, type ViewCsvOptions, type ViewCsvResult } from '@fodt/csv-viewer';

export interface CsvViewerJob {
  text: string;
  options: ViewCsvOptions;
}

/** One message the page sends to start a run. */
export interface CsvViewerJobMessage {
  type: 'csv-viewer-job';
  job: CsvViewerJob;
}

export interface CsvViewerDoneMessage {
  type: 'csv-viewer-done';
  result: ViewCsvResult;
}

export interface CsvViewerErrorMessage {
  type: 'csv-viewer-error';
  /** The CsvViewerError's own message when the job failed on purpose; a fixed sentence otherwise. */
  message: string;
  line?: number;
  column?: number;
}

export type CsvViewerWorkerMessage = CsvViewerDoneMessage | CsvViewerErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the
 * browser types tool pages need) but not the worker library, so
 * TypeScript resolves the ambient global in this file to a window-shaped
 * global rather than the worker's own global scope it actually is at
 * runtime. Narrowing once into this small locally declared shape
 * sidesteps the mismatch, matching regex-tester.worker.ts's own pattern.
 */
interface WorkerGlobal {
  postMessage(message: CsvViewerWorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<CsvViewerJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

function handleJob(job: CsvViewerJob): void {
  try {
    const result = viewCsv(job.text, job.options);
    workerGlobal.postMessage({ type: 'csv-viewer-done', result });
  } catch (err) {
    if (err instanceof CsvViewerError) {
      workerGlobal.postMessage({ type: 'csv-viewer-error', message: err.message, line: err.line, column: err.column });
    } else {
      workerGlobal.postMessage({
        type: 'csv-viewer-error',
        message: err instanceof Error ? err.message : 'The background task failed for an unknown reason.',
      });
    }
  }
}

workerGlobal.addEventListener('message', (event) => {
  handleJob(event.data.job);
});
