/**
 * Runs one JSON Schema Generator job whose samples are YAML and posts back its result or its error. Only YAML goes
 * through this worker (see run-json-schema-generator-in-worker.ts's own comment): the YAML package checks a mapping's
 * keys for duplicates by scanning the whole mapping for every new key, so reading a mapping with tens of thousands of
 * keys takes seconds on the page, and a worker is the one place that can be stopped. JSON and XML samples are read on
 * the page.
 *
 * Every run gets a new worker, so nothing from a sample is kept once the run ends. There is no WebAssembly and nothing
 * to fetch.
 *
 * This worker posts `json-schema-generator-ready` as the very last statement of the module, after its message listener
 * exists. The page posts the job only when it has seen that message, so a job can never reach a worker that has not
 * finished starting (a module worker drops a message that arrives before its evaluation is over). The worker cannot
 * report its own timeout: it may be inside one long synchronous call, so the page owns the limit and terminates it.
 */
import {
  generateSchema,
  SchemaGeneratorError,
  type GenerateSchemaOptions,
  type GenerateSchemaResult,
} from '@fodt/json-schema-generator';

export interface JsonSchemaGeneratorJobMessage {
  type: 'json-schema-generator-job';
  samples: string;
  options: GenerateSchemaOptions;
}

export interface JsonSchemaGeneratorReadyMessage {
  type: 'json-schema-generator-ready';
}

export interface JsonSchemaGeneratorDoneMessage {
  type: 'json-schema-generator-done';
  result: GenerateSchemaResult;
}

export interface JsonSchemaGeneratorErrorMessage {
  type: 'json-schema-generator-error';
  message: string;
  line?: number;
  column?: number;
}

export type JsonSchemaGeneratorWorkerMessage =
  JsonSchemaGeneratorReadyMessage | JsonSchemaGeneratorDoneMessage | JsonSchemaGeneratorErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the browser types tool pages need) but not the worker
 * library, so TypeScript resolves the ambient global in this file to a window-shaped global rather than the worker's
 * own global scope it actually is at runtime. Narrowing once into this small locally declared shape sidesteps the
 * mismatch, the same pattern go-formatter.worker.ts uses.
 */
interface WorkerGlobal {
  postMessage(message: JsonSchemaGeneratorWorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<JsonSchemaGeneratorJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

const MEMORY_MESSAGE = 'The samples needed more memory than this tab could give.';

/** The tool's own plain sentence for an expected failure; a memory failure is named as running out of memory. */
function failure(err: unknown): JsonSchemaGeneratorErrorMessage {
  if (err instanceof SchemaGeneratorError) {
    return {
      type: 'json-schema-generator-error',
      message: err.message,
      ...(err.line !== undefined ? { line: err.line } : {}),
      ...(err.column !== undefined ? { column: err.column } : {}),
    };
  }
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (/RangeError|Invalid (array|string) length|allocation|memory/i.test(text)) {
    return { type: 'json-schema-generator-error', message: MEMORY_MESSAGE };
  }
  return {
    type: 'json-schema-generator-error',
    message: err instanceof Error && err.message ? err.message : 'The background task failed for an unknown reason.',
  };
}

function handleJob(message: JsonSchemaGeneratorJobMessage): void {
  try {
    const result = generateSchema(message.samples, message.options);
    workerGlobal.postMessage({ type: 'json-schema-generator-done', result });
  } catch (err) {
    workerGlobal.postMessage(failure(err));
  }
}

workerGlobal.addEventListener('message', (event) => {
  handleJob(event.data);
});

// Last statement of the module: the listener above exists, so a job posted now cannot be lost.
workerGlobal.postMessage({ type: 'json-schema-generator-ready' });
