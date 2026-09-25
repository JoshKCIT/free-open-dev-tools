/**
 * Runs one YAML formatting/check job and posts back its result or its
 * error. Mirrors ts-to-js.worker.ts's shape: a single synchronous
 * `formatYaml` call has no point partway through where it could report
 * progress, and this worker cannot report its own timeout either -- see
 * run-yaml-formatter-in-worker.ts's own comment for why the page, not this
 * file, owns the time limit.
 */
import { formatYaml, YamlFormatterError, type FormatYamlOptions, type FormatYamlResult } from '@fodt/yaml-formatter';

export interface YamlFormatterJobMessage {
  type: 'yaml-formatter-job';
  source: string;
  options: FormatYamlOptions;
}

export interface YamlFormatterDoneMessage {
  type: 'yaml-formatter-done';
  result: FormatYamlResult;
}

export interface YamlFormatterErrorMessage {
  type: 'yaml-formatter-error';
  message: string;
  line?: number;
  column?: number;
}

export type YamlFormatterWorkerMessage = YamlFormatterDoneMessage | YamlFormatterErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the
 * browser types tool pages need) but not the worker library, so
 * TypeScript resolves the ambient global in this file to a window-shaped
 * global rather than the worker's own global scope it actually is at
 * runtime. Narrowing once into this small locally declared shape
 * sidesteps the mismatch, the same pattern ts-to-js.worker.ts uses.
 */
interface WorkerGlobal {
  postMessage(message: YamlFormatterWorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<YamlFormatterJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

function handleJob(job: YamlFormatterJobMessage): void {
  try {
    const result = formatYaml(job.source, job.options);
    workerGlobal.postMessage({ type: 'yaml-formatter-done', result });
  } catch (err) {
    if (err instanceof YamlFormatterError) {
      workerGlobal.postMessage({
        type: 'yaml-formatter-error',
        message: err.message,
        line: err.line,
        column: err.column,
      });
      return;
    }
    workerGlobal.postMessage({
      type: 'yaml-formatter-error',
      message: err instanceof Error ? err.message : 'The background task failed for an unknown reason.',
    });
  }
}

workerGlobal.addEventListener('message', (event) => {
  handleJob(event.data);
});
