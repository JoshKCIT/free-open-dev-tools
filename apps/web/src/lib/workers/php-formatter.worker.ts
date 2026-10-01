/**
 * Runs one PHP-format job and posts back its result or its error. Every
 * php-formatter run goes through this worker (see
 * run-php-formatter-in-worker.ts's own comment), and every run gets a new
 * one, so the formatter starts clean each time.
 *
 * The formatter is Prettier with its PHP plugin. Both are plain JavaScript
 * that the build writes into this worker's own source, inside the page's own
 * chunk, so nothing is fetched while the page runs and there is no binary to
 * carry. Only the browser-safe entries of both packages are used (see
 * tools/php-formatter/src/index.ts). Formatting is asynchronous, so the
 * job handler awaits it, as the Markdown formatter's worker does.
 *
 * This worker cannot report its own timeout: it may be stuck inside one
 * long synchronous parse, so the page owns the limit and terminates it.
 */
import { formatPhp, PhpFormatterError, type FormatPhpOptions, type FormatPhpResult } from '@fodt/php-formatter';

export interface PhpFormatterJobMessage {
  type: 'php-formatter-job';
  source: string;
  options: FormatPhpOptions;
}

export interface PhpFormatterDoneMessage {
  type: 'php-formatter-done';
  result: FormatPhpResult;
}

export interface PhpFormatterErrorMessage {
  type: 'php-formatter-error';
  message: string;
  line?: number;
  column?: number;
}

export type PhpFormatterWorkerMessage = PhpFormatterDoneMessage | PhpFormatterErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the
 * browser types tool pages need) but not the worker library, so
 * TypeScript resolves the ambient global in this file to a window-shaped
 * global rather than the worker's own global scope it actually is at
 * runtime. Narrowing once into this small locally declared shape
 * sidesteps the mismatch, the same pattern markdown-formatter.worker.ts uses.
 */
interface WorkerGlobal {
  postMessage(message: PhpFormatterWorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<PhpFormatterJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

async function handleJob(job: PhpFormatterJobMessage): Promise<void> {
  try {
    const result = (await formatPhp(job.source, job.options)) ?? { output: '', inputBytes: 0, outputBytes: 0 };
    workerGlobal.postMessage({ type: 'php-formatter-done', result });
  } catch (err) {
    if (err instanceof PhpFormatterError) {
      workerGlobal.postMessage({
        type: 'php-formatter-error',
        message: err.message,
        line: err.line,
        column: err.column,
      });
      return;
    }
    workerGlobal.postMessage({
      type: 'php-formatter-error',
      message: err instanceof Error && err.message ? err.message : 'The background task failed for an unknown reason.',
    });
  }
}

workerGlobal.addEventListener('message', (event) => {
  void handleJob(event.data);
});
