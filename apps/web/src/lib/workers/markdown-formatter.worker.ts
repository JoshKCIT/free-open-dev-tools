/**
 * Runs one Markdown-format job and posts back its result or its error.
 * Every markdown-formatter run goes through this worker (see
 * run-markdown-formatter-in-worker.ts's own comment): unlike js-formatter
 * or ts-to-js, where only one risky combination needs a worker, a realistic
 * 180KB Markdown document already measured about 1.1 seconds in Node (the
 * mdx parser 841ms of that), and growth on adversarial shapes a paste can
 * contain (long link-opening-bracket chains, deeply nested block quotes,
 * very wide tables) is clearly super-linear -- there is no cheap way to
 * tell a slow shape from a fast one before formatting starts. Mirrors
 * js-formatter.worker.ts's shape: no progress message, since one
 * synchronous `formatMarkdown` call has no point partway through where it
 * could report how far along it is, and this worker cannot report its own
 * timeout either -- the page owns that.
 */
import {
  formatMarkdown,
  MarkdownFormatterError,
  type FormatMarkdownOptions,
  type FormatMarkdownResult,
} from '@fodt/markdown-formatter';

export interface MarkdownFormatterJobMessage {
  type: 'markdown-formatter-job';
  source: string;
  options: FormatMarkdownOptions;
}

export interface MarkdownFormatterDoneMessage {
  type: 'markdown-formatter-done';
  result: FormatMarkdownResult;
}

export interface MarkdownFormatterErrorMessage {
  type: 'markdown-formatter-error';
  message: string;
  line?: number;
  column?: number;
}

export type MarkdownFormatterWorkerMessage = MarkdownFormatterDoneMessage | MarkdownFormatterErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the
 * browser types tool pages need) but not the worker library, so
 * TypeScript resolves the ambient global in this file to a window-shaped
 * global rather than the worker's own global scope it actually is at
 * runtime. Narrowing once into this small locally declared shape
 * sidesteps the mismatch, the same pattern js-formatter.worker.ts uses.
 */
interface WorkerGlobal {
  postMessage(message: MarkdownFormatterWorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<MarkdownFormatterJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

async function handleJob(job: MarkdownFormatterJobMessage): Promise<void> {
  try {
    const result = await formatMarkdown(job.source, job.options);
    workerGlobal.postMessage({ type: 'markdown-formatter-done', result });
  } catch (err) {
    if (err instanceof MarkdownFormatterError) {
      workerGlobal.postMessage({
        type: 'markdown-formatter-error',
        message: err.message,
        line: err.line,
        column: err.column,
      });
      return;
    }
    workerGlobal.postMessage({
      type: 'markdown-formatter-error',
      message: err instanceof Error ? err.message : 'The background task failed for an unknown reason.',
    });
  }
}

workerGlobal.addEventListener('message', (event) => {
  void handleJob(event.data);
});
