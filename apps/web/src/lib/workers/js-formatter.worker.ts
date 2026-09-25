/**
 * Runs one TypeScript-minify job and posts back its result or its error.
 * Only the TypeScript + minify combination is risky enough to need a
 * worker (see run-js-formatter-in-worker.ts's own comment); this worker
 * always calls `formatJs` with `language: 'typescript', mode: 'minify'`.
 * Mirrors ts-to-js.worker.ts's shape: no progress message, since a single
 * synchronous `ts.transpileModule` call followed by `terser.minify` has no
 * point partway through where it could report how far along it is, and
 * this worker cannot report its own timeout either -- the page owns that.
 */
import { formatJs, JsFormatterError, type FormatJsOptions, type FormatJsResult } from '@fodt/js-formatter';

export interface JsFormatterJobMessage {
  type: 'js-formatter-job';
  source: string;
  options: FormatJsOptions;
}

export interface JsFormatterDoneMessage {
  type: 'js-formatter-done';
  result: FormatJsResult;
}

export interface JsFormatterErrorMessage {
  type: 'js-formatter-error';
  message: string;
  line?: number;
  column?: number;
}

export type JsFormatterWorkerMessage = JsFormatterDoneMessage | JsFormatterErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the
 * browser types tool pages need) but not the worker library, so
 * TypeScript resolves the ambient global in this file to a window-shaped
 * global rather than the worker's own global scope it actually is at
 * runtime. Narrowing once into this small locally declared shape
 * sidesteps the mismatch, the same pattern ts-to-js.worker.ts uses.
 */
interface WorkerGlobal {
  postMessage(message: JsFormatterWorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<JsFormatterJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

async function handleJob(job: JsFormatterJobMessage): Promise<void> {
  try {
    const result = await formatJs(job.source, job.options);
    workerGlobal.postMessage({ type: 'js-formatter-done', result });
  } catch (err) {
    if (err instanceof JsFormatterError) {
      workerGlobal.postMessage({
        type: 'js-formatter-error',
        message: err.message,
        line: err.line,
        column: err.column,
      });
      return;
    }
    workerGlobal.postMessage({
      type: 'js-formatter-error',
      message: err instanceof Error ? err.message : 'The background task failed for an unknown reason.',
    });
  }
}

workerGlobal.addEventListener('message', (event) => {
  void handleJob(event.data);
});
