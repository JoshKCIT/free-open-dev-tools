/**
 * The page-side helper that starts the markdown-formatter worker and races
 * it against a fixed time limit, terminating it unconditionally if that
 * limit wins.
 *
 * Imports the worker with the build-time inlining suffix, not the
 * URL-and-constructor form -- see run-jsonpath-in-worker.ts's own comment
 * for why that line is load-bearing for the privacy harness.
 *
 * A close copy of run-js-formatter-in-worker.ts, not a shared helper --
 * same reason that file gives for its own duplication. Every run goes
 * through this worker (unlike js-formatter, where only one combination
 * does): a realistic 180KB Markdown document already measured about 1.1
 * seconds in Node (the mdx parser alone 841ms of that), and this session
 * measured clearly super-linear growth on shapes a paste can plausibly
 * contain -- the text `[a](` repeated 20,000 times took 3.5s in Node and
 * 50,000 times 19.2s; `[` x 50,000 then `]` x 50,000 measured 12.5-24s
 * uncapped directly against installed chromium, firefox and webkit (this
 * session, bypassing the worker's own limit to get a real number); a list
 * nested 500 levels deep took 4.1s then a stack overflow at 2,000 levels; a
 * 5,000-row table took 3.2s. There is no cheap way to tell a slow shape
 * from a fast one before formatting runs, so every run is routed through
 * the worker.
 *
 * The limit is 5 seconds, not the 3 seconds this package first shipped
 * with: a realistic 180KB document measured 577ms (chromium), 2,251ms
 * (firefox) and 867ms (webkit) running uncapped and alone, but this
 * project's own four-browser-project Playwright run drives many worker
 * jobs at once on one machine, and under that real contention the same
 * document's wall-clock time crossed 3 seconds on firefox and webkit
 * (confirmed by rerunning the failing spec in isolation, where it passed
 * every time -- the same CPU-contention pattern this project's yaml-formatter
 * e2e spec already documents). 5 seconds is more than twice the worst
 * uncapped measurement (2,251ms) and stays far below every measured
 * pathological shape's own real duration.
 */
import MarkdownFormatterWorker from './workers/markdown-formatter.worker.ts?worker&inline';
import type { MarkdownFormatterJobMessage, MarkdownFormatterWorkerMessage } from './workers/markdown-formatter.worker';
import type { FormatMarkdownResult } from '@fodt/markdown-formatter';
import type { RunContext } from './tool-ui';

export const MARKDOWN_FORMATTER_TIME_LIMIT_MS = 5000;

export const MARKDOWN_FORMATTER_TIME_LIMIT_MESSAGE =
  'Stopped after 5 seconds: this document took too long to format. Try a smaller file.';

export class MarkdownFormatterRunError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, line?: number, column?: number) {
    super(message);
    this.name = 'MarkdownFormatterRunError';
    this.line = line;
    this.column = column;
  }
}

/**
 * Runs one Markdown-format job in the background worker, resolving with
 * its result. Settlement is the point of this function -- see
 * run-jsonpath-in-worker.ts's own comment on the guarded `settle` closure
 * this copies wholesale, covering success, an application error, a native
 * worker failure, an undeliverable message, an abort, an already-aborted
 * signal, and the time limit itself.
 */
export function markdownFormatterInWorker(
  job: MarkdownFormatterJobMessage,
  ctx: RunContext,
): Promise<FormatMarkdownResult> {
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<FormatMarkdownResult>((resolve, reject) => {
    const worker = new MarkdownFormatterWorker();
    let settled = false;

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
    };

    type Outcome = { ok: true; value: FormatMarkdownResult } | { ok: false; error: Error };

    const settle = (outcome: Outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        removeListeners();
      } finally {
        worker.terminate();
      }
      if (outcome.ok) resolve(outcome.value);
      else reject(outcome.error);
    };

    const onMessage = (event: MessageEvent<MarkdownFormatterWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'markdown-formatter-done') settle({ ok: true, value: data.result });
      else settle({ ok: false, error: new MarkdownFormatterRunError(data.message, data.line, data.column) });
    };

    const onNativeError = () => {
      settle({ ok: false, error: new Error('The background task could not start.') });
    };

    const onMessageError = () => {
      settle({ ok: false, error: new Error('The background task could not start.') });
    };

    const onAbort = () => {
      settle({ ok: false, error: new Error('The run was cancelled.') });
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onNativeError);
    worker.addEventListener('messageerror', onMessageError);
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    const timer = setTimeout(() => {
      settle({ ok: false, error: new Error(MARKDOWN_FORMATTER_TIME_LIMIT_MESSAGE) });
    }, MARKDOWN_FORMATTER_TIME_LIMIT_MS);

    try {
      worker.postMessage(job);
    } catch {
      settle({ ok: false, error: new Error('The background task could not start.') });
    }
  });
}
