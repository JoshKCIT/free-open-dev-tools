/**
 * Runs one schema-validation job and posts back its result or its error.
 * Mirrors jsonpath.worker.ts's shape (plan 04-03): no progress message (a
 * synchronous Ajv compile plus one validate call has no point partway
 * through where it could report how far along it is), and this worker
 * cannot report its own timeout either -- see
 * run-json-schema-in-worker.ts's own comment for why the page, not this
 * file, owns the time limit.
 */
import { validateJson, SchemaValidatorError, type ValidateJsonResult } from '@fodt/json-schema-validator';

/** One message the page sends to start a run. */
export interface SchemaJobMessage {
  type: 'json-schema-job';
  schemaText: string;
  dataText: string;
  draft: 'auto' | 'draft-07' | '2020-12';
  checkFormats: boolean;
}

export interface SchemaDoneMessage {
  type: 'json-schema-done';
  result: ValidateJsonResult;
}

export interface SchemaErrorMessage {
  type: 'json-schema-error';
  kind: 'schema-json' | 'data-json' | 'schema' | 'draft' | 'unknown';
  message: string;
  line?: number;
  column?: number;
}

export type SchemaWorkerMessage = SchemaDoneMessage | SchemaErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the
 * browser types tool pages need) but not the worker library, so
 * TypeScript resolves the ambient global in this file to a window-shaped
 * global rather than the worker's own global scope it actually is at
 * runtime. Narrowing once into this small locally declared shape
 * sidesteps the mismatch, the same pattern regex-tester.worker.ts and
 * jsonpath.worker.ts use.
 */
interface WorkerGlobal {
  postMessage(message: SchemaWorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<SchemaJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

function handleJob(job: SchemaJobMessage): void {
  try {
    const result = validateJson(job.schemaText, job.dataText, { draft: job.draft, checkFormats: job.checkFormats });
    workerGlobal.postMessage({ type: 'json-schema-done', result });
  } catch (err) {
    if (err instanceof SchemaValidatorError) {
      workerGlobal.postMessage({
        type: 'json-schema-error',
        kind: err.kind,
        message: err.message,
        line: err.line,
        column: err.column,
      });
      return;
    }
    workerGlobal.postMessage({
      type: 'json-schema-error',
      kind: 'unknown',
      message: err instanceof Error ? err.message : 'The background task failed for an unknown reason.',
    });
  }
}

workerGlobal.addEventListener('message', (event) => {
  handleJob(event.data);
});
