/**
 * Runs one spreadsheet conversion and posts back its result or its error. Every spreadsheet-converter run goes through
 * this worker (see run-spreadsheet-converter-in-worker.ts's own comment), and every run gets a new one, so the file's
 * bytes and everything built from them start clean each time and nothing is kept once the run ends.
 *
 * Unlike the engine-backed workers, this one carries no WebAssembly: the reader and the writer are this tool's own
 * code over a zip library, bundled with it, so there is nothing to embed or locate and nothing to fetch.
 *
 * This worker posts `spreadsheet-converter-ready` as the very last statement of the module, after its message listener
 * exists. The page posts the job only when it has seen that message, so a job can never reach a worker that has not
 * finished starting (a module worker drops a message that arrives before its evaluation is over). The worker cannot
 * report its own timeout: it may be inside one long synchronous scan, so the page owns the limit and terminates it.
 */
import {
  convertSpreadsheet,
  SpreadsheetConverterError,
  type ConvertJob,
  type ConvertResult,
} from '@fodt/spreadsheet-converter';

export interface SpreadsheetConverterJobMessage {
  type: 'spreadsheet-converter-job';
  job: ConvertJob;
}

export interface SpreadsheetConverterReadyMessage {
  type: 'spreadsheet-converter-ready';
}

export interface SpreadsheetConverterDoneMessage {
  type: 'spreadsheet-converter-done';
  result: ConvertResult;
}

export interface SpreadsheetConverterErrorMessage {
  type: 'spreadsheet-converter-error';
  message: string;
  line?: number;
  column?: number;
}

export type SpreadsheetConverterWorkerMessage =
  SpreadsheetConverterReadyMessage | SpreadsheetConverterDoneMessage | SpreadsheetConverterErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the browser types tool pages need) but not the worker
 * library, so TypeScript resolves the ambient global in this file to a window-shaped global rather than the worker's
 * own global scope it actually is at runtime. Narrowing once into this small locally declared shape sidesteps the
 * mismatch, the same pattern go-formatter.worker.ts uses.
 */
interface WorkerGlobal {
  postMessage(message: SpreadsheetConverterWorkerMessage, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<SpreadsheetConverterJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

const MEMORY_MESSAGE = 'The file or the result needed more memory than this tab could give.';

/** The converter's own plain sentence for an expected failure; a memory failure is named as running out of memory. */
function failure(err: unknown): SpreadsheetConverterErrorMessage {
  if (err instanceof SpreadsheetConverterError) {
    return {
      type: 'spreadsheet-converter-error',
      message: err.message,
      ...(err.line !== undefined ? { line: err.line } : {}),
      ...(err.column !== undefined ? { column: err.column } : {}),
    };
  }
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (/RangeError|Invalid (array|string) length|allocation|memory/i.test(text)) {
    return { type: 'spreadsheet-converter-error', message: MEMORY_MESSAGE };
  }
  return {
    type: 'spreadsheet-converter-error',
    message: err instanceof Error && err.message ? err.message : 'The background task failed for an unknown reason.',
  };
}

function handleJob(message: SpreadsheetConverterJobMessage): void {
  try {
    const result = convertSpreadsheet(message.job);
    workerGlobal.postMessage(
      { type: 'spreadsheet-converter-done', result },
      result.direction === 'text-to-xlsx' ? [result.bytes.buffer as ArrayBuffer] : [],
    );
  } catch (err) {
    workerGlobal.postMessage(failure(err));
  }
}

workerGlobal.addEventListener('message', (event) => {
  handleJob(event.data);
});

// Last statement of the module: the listener above exists, so a job posted now cannot be lost.
workerGlobal.postMessage({ type: 'spreadsheet-converter-ready' });
