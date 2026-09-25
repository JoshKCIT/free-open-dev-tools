/**
 * The page-side helper that starts the YAML formatting/check worker and
 * races it against a fixed time limit, terminating it unconditionally if
 * that limit wins.
 *
 * Imports the worker with the build-time inlining suffix, not the
 * URL-and-constructor form -- see run-jsonpath-in-worker.ts's own comment
 * for why that line is load-bearing for the privacy harness.
 *
 * A close copy of run-ts-to-js-in-worker.ts, not a shared helper -- same
 * reason that file gives for its own duplication (and that one gives for
 * run-jsonpath-in-worker.ts before it). Measured this session (orchestrator
 * amendment, 2026-09-25): the installed yaml 2.9.1 checks duplicate mapping
 * keys by scanning the whole mapping for every new key it composes, so a
 * flat mapping's parse time grows quadratically with its key count -- about
 * 200ms at 5,000 keys, 550ms at 10,000, 1.8s at 20,000 and 6.8s at 40,000,
 * measured directly against the installed package. A realistic document
 * (nested, not one huge flat mapping) stays far under the limit, since the
 * quadratic cost is per-mapping, not per-document. `formatYaml` is, once
 * started, a single synchronous, un-interruptible call, exactly the same
 * category of runaway main-thread work `run-jsonpath-in-worker.ts` exists
 * for, so the same settle-once/terminate-on-timeout contract applies here.
 */
import YamlFormatterWorker from './workers/yaml-formatter.worker.ts?worker&inline';
import type { YamlFormatterJobMessage, YamlFormatterWorkerMessage } from './workers/yaml-formatter.worker';
import type { FormatYamlResult } from '@fodt/yaml-formatter';
import type { RunContext } from './tool-ui';

/** The exact value this file enforces, same register as the regex, jsonpath and ts-to-js workers' own 1.5 second limit. */
export const YAML_FORMATTER_TIME_LIMIT_MS = 1500;

export const YAML_FORMATTER_TIME_LIMIT_MESSAGE =
  'Stopped after 1.5 seconds: this document took too long to check for duplicate keys. Try a smaller document.';

export class YamlFormatterRunError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'YamlFormatterRunError';
    this.line = detail.line;
    this.column = detail.column;
  }
}

/**
 * Runs one formatting/check job in the background worker, resolving with
 * its result. Settlement is the point of this function -- see
 * run-jsonpath-in-worker.ts's own comment on the guarded `settle` closure
 * this copies wholesale, covering success, an application error, a native
 * worker failure, an undeliverable message, an abort, an already-aborted
 * signal, and the time limit itself.
 */
export function yamlFormatterInWorker(job: YamlFormatterJobMessage, ctx: RunContext): Promise<FormatYamlResult> {
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<FormatYamlResult>((resolve, reject) => {
    const worker = new YamlFormatterWorker();
    let settled = false;

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
    };

    type Outcome = { ok: true; value: FormatYamlResult } | { ok: false; error: Error };

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

    const onMessage = (event: MessageEvent<YamlFormatterWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'yaml-formatter-done') settle({ ok: true, value: data.result });
      else
        settle({ ok: false, error: new YamlFormatterRunError(data.message, { line: data.line, column: data.column }) });
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
      settle({ ok: false, error: new Error(YAML_FORMATTER_TIME_LIMIT_MESSAGE) });
    }, YAML_FORMATTER_TIME_LIMIT_MS);

    try {
      worker.postMessage(job);
    } catch {
      settle({ ok: false, error: new Error('The background task could not start.') });
    }
  });
}
