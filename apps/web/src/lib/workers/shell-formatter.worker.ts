/**
 * Runs one Shell-format job and posts back its result or its error. Every
 * shell-formatter run goes through this worker (see
 * run-shell-formatter-in-worker.ts's own comment), and every run gets a new
 * one, so the engine starts clean each time.
 *
 * The engine is shfmt, the formatter of the mvdan/sh parser, compiled to WebAssembly. Its bytes
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
  formatShell,
  ShellFormatterError,
  type FormatShellOptions,
  type FormatShellResult,
} from '@fodt/shell-formatter';
import wasmDataUrl from '../../../../../tools/shell-formatter/node_modules/@wasm-fmt/shfmt/shfmt.wasm?url&inline';

export interface ShellFormatterJobMessage {
  type: 'shell-formatter-job';
  source: string;
  options: FormatShellOptions;
}

export interface ShellFormatterDoneMessage {
  type: 'shell-formatter-done';
  result: FormatShellResult;
}

export interface ShellFormatterErrorMessage {
  type: 'shell-formatter-error';
  message: string;
  line?: number;
  column?: number;
}

export type ShellFormatterWorkerMessage = ShellFormatterDoneMessage | ShellFormatterErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the
 * browser types tool pages need) but not the worker library, so
 * TypeScript resolves the ambient global in this file to a window-shaped
 * global rather than the worker's own global scope it actually is at
 * runtime. Narrowing once into this small locally declared shape
 * sidesteps the mismatch, the same pattern markdown-formatter.worker.ts uses.
 */
interface WorkerGlobal {
  postMessage(message: ShellFormatterWorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<ShellFormatterJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

function bytesFromDataUrl(url: string): Uint8Array {
  const binary = atob(url.slice(url.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

let engineReady = false;

function handleJob(job: ShellFormatterJobMessage): void {
  try {
    if (!engineReady) {
      loadEngine(bytesFromDataUrl(wasmDataUrl));
      engineReady = true;
    }
    const result = formatShell(job.source, job.options) ?? { output: '', inputBytes: 0, outputBytes: 0 };
    workerGlobal.postMessage({ type: 'shell-formatter-done', result });
  } catch (err) {
    if (err instanceof ShellFormatterError) {
      workerGlobal.postMessage({
        type: 'shell-formatter-error',
        message: err.message,
        line: err.line,
        column: err.column,
      });
      return;
    }
    workerGlobal.postMessage({
      type: 'shell-formatter-error',
      message: err instanceof Error && err.message ? err.message : 'The background task failed for an unknown reason.',
    });
  }
}

workerGlobal.addEventListener('message', (event) => {
  handleJob(event.data);
});
