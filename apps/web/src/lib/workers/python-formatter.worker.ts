/**
 * Runs one Python-format job and posts back its result or its error. Every
 * python-formatter run goes through this worker (see
 * run-python-formatter-in-worker.ts's own comment), and every run gets a new
 * one, so the engine starts clean each time.
 *
 * The engine is the Ruff formatter compiled to WebAssembly. Its bytes
 * travel inside this worker as a data URL, written into the page's own
 * chunk at build time by the `?url&inline` query, so nothing is fetched
 * while the page runs -- a blob worker could not resolve a relative address
 * anyway. The import is a relative path into the tool folder's installed
 * copy of the package, because the package is declared only in that folder
 * and a bare import would not resolve from here. The path is five levels up
 * from lib/workers to the repository root.
 *
 * This worker cannot report its own timeout: it may be stuck inside one
 * synchronous engine call, so the page owns the limit and terminates it.
 */
import {
  loadEngine,
  formatPython,
  PythonFormatterError,
  type FormatPythonOptions,
  type FormatPythonResult,
} from '@fodt/python-formatter';
import wasmDataUrl from '../../../../../tools/python-formatter/node_modules/@wasm-fmt/ruff_fmt/ruff_fmt_bg.wasm?url&inline';

export interface PythonFormatterJobMessage {
  type: 'python-formatter-job';
  source: string;
  options: FormatPythonOptions;
}

export interface PythonFormatterDoneMessage {
  type: 'python-formatter-done';
  result: FormatPythonResult;
}

export interface PythonFormatterErrorMessage {
  type: 'python-formatter-error';
  message: string;
  line?: number;
  column?: number;
}

export type PythonFormatterWorkerMessage = PythonFormatterDoneMessage | PythonFormatterErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the
 * browser types tool pages need) but not the worker library, so
 * TypeScript resolves the ambient global in this file to a window-shaped
 * global rather than the worker's own global scope it actually is at
 * runtime. Narrowing once into this small locally declared shape
 * sidesteps the mismatch, the same pattern markdown-formatter.worker.ts uses.
 */
interface WorkerGlobal {
  postMessage(message: PythonFormatterWorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<PythonFormatterJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

function bytesFromDataUrl(url: string): Uint8Array {
  const binary = atob(url.slice(url.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

let engineReady = false;

function handleJob(job: PythonFormatterJobMessage): void {
  try {
    if (!engineReady) {
      loadEngine(bytesFromDataUrl(wasmDataUrl));
      engineReady = true;
    }
    const result = formatPython(job.source, job.options) ?? { output: '', inputBytes: 0, outputBytes: 0 };
    workerGlobal.postMessage({ type: 'python-formatter-done', result });
  } catch (err) {
    if (err instanceof PythonFormatterError) {
      workerGlobal.postMessage({
        type: 'python-formatter-error',
        message: err.message,
        line: err.line,
        column: err.column,
      });
      return;
    }
    workerGlobal.postMessage({
      type: 'python-formatter-error',
      message: err instanceof Error && err.message ? err.message : 'The background task failed for an unknown reason.',
    });
  }
}

workerGlobal.addEventListener('message', (event) => {
  handleJob(event.data);
});
