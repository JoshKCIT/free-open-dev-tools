/**
 * Runs one XML Schema validation and posts back its result or its error.
 * Every xsd-validator run goes through this worker (see
 * run-xsd-validator-in-worker.ts's own comment), and every run gets a new
 * one, so the engine and every document it parsed start clean each time and
 * nothing is kept once the run ends.
 *
 * The engine is libxml2 compiled to WebAssembly by libxml2-wasm. The package
 * carries its WebAssembly inside its own JavaScript and awaits it at the top
 * level of its module, so this worker is built as a module worker and the
 * engine is imported here, by a relative path into the tool folder's
 * installed copy (the package is declared only in that folder, so a bare
 * import would not resolve from here; the path is five levels up from
 * lib/workers to the repository root). The tool folder itself imports only
 * the engine's types, so the engine lands in this worker's source and in no
 * page chunk. This is the browser entry: the Node entry and the input
 * provider that could read files are never imported.
 *
 * This worker posts `xsd-validator-ready` as the very last statement of the
 * module. Module evaluation does not finish until the import above has
 * finished awaiting the engine, and the page posts the job only when it has
 * seen that message, so a job can never reach a worker that has not finished
 * starting. The worker cannot report its own timeout: it may be stuck inside
 * one synchronous engine call, so the page owns the limit and terminates it.
 */
import * as libxml2 from '../../../../../tools/xsd-validator/node_modules/libxml2-wasm/lib/index.mjs';
import {
  validateXml,
  XsdValidatorError,
  type NotLoadedReference,
  type XsdIssue,
  type XsdValidationResult,
} from '@fodt/xsd-validator';

export interface XsdValidatorJobMessage {
  type: 'xsd-validator-job';
  schema: string;
  xml: string;
  showWarnings: boolean;
}

export interface XsdValidatorReadyMessage {
  type: 'xsd-validator-ready';
}

export interface XsdValidatorDoneMessage {
  type: 'xsd-validator-done';
  result: XsdValidationResult | null;
}

export interface XsdValidatorErrorMessage {
  type: 'xsd-validator-error';
  message: string;
  part?: 'schema' | 'document';
  line?: number;
  column?: number;
  issues?: XsdIssue[];
  notLoaded?: NotLoadedReference[];
}

export type XsdValidatorWorkerMessage = XsdValidatorReadyMessage | XsdValidatorDoneMessage | XsdValidatorErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the
 * browser types tool pages need) but not the worker library, so
 * TypeScript resolves the ambient global in this file to a window-shaped
 * global rather than the worker's own global scope it actually is at
 * runtime. Narrowing once into this small locally declared shape
 * sidesteps the mismatch, the same pattern the other workers use.
 */
interface WorkerGlobal {
  postMessage(message: XsdValidatorWorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<XsdValidatorJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

const MEMORY_MESSAGE = 'The document or schema needed more memory than this tab could give.';

function failureMessage(err: unknown): string {
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (/RuntimeError|Aborted|memory|allocation|Invalid array length/i.test(text)) return MEMORY_MESSAGE;
  return err instanceof Error && err.message ? err.message : 'The background task failed for an unknown reason.';
}

function handleJob(job: XsdValidatorJobMessage): void {
  try {
    const result = validateXml(libxml2, job.schema, job.xml, { showWarnings: job.showWarnings });
    workerGlobal.postMessage({ type: 'xsd-validator-done', result });
  } catch (err) {
    if (err instanceof XsdValidatorError) {
      workerGlobal.postMessage({
        type: 'xsd-validator-error',
        message: err.message,
        part: err.part,
        line: err.line,
        column: err.column,
        issues: err.issues,
        notLoaded: err.notLoaded,
      });
    } else {
      workerGlobal.postMessage({ type: 'xsd-validator-error', message: failureMessage(err) });
    }
  }
}

workerGlobal.addEventListener('message', (event) => {
  handleJob(event.data);
});

// Last statement of the module: the engine has finished loading and the listener above exists, so a job posted now
// cannot be lost.
workerGlobal.postMessage({ type: 'xsd-validator-ready' });
