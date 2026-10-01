/**
 * Runs one SQLite job and posts back its result or its error. Every
 * sqlite-viewer run goes through this worker (see
 * run-sqlite-viewer-in-worker.ts's own comment), and every run gets a new
 * one, so the engine and the in-memory copy of the database start clean
 * each time and nothing is kept once the run ends.
 *
 * The engine is SQLite compiled to WebAssembly by sql.js. Its bytes travel
 * inside this worker as a data URL, written into the page's own chunk at
 * build time by the `?url&inline` query, so nothing is fetched while the
 * page runs -- a blob worker could not resolve a relative address anyway.
 * The import is a relative path into the tool folder's installed copy of
 * the package, because the package is declared only in that folder and a
 * bare import would not resolve from here. The path is five levels up from
 * lib/workers to the repository root.
 *
 * This worker posts `sqlite-viewer-ready` as the very last statement of the
 * module, after its message listener exists. The page posts the job only
 * when it has seen that message, so a job can never reach a worker that has
 * not finished starting (a module worker drops a message that arrives before
 * its evaluation is over). The worker cannot report its own timeout: it may
 * be stuck inside one synchronous engine call, so the page owns the limit
 * and terminates it.
 */
import {
  loadEngine,
  runSqlite,
  SqliteViewerError,
  type SqliteRunOptions,
  type SqliteRunResult,
} from '@fodt/sqlite-viewer';
import wasmDataUrl from '../../../../../tools/sqlite-viewer/node_modules/sql.js/dist/sql-wasm-browser.wasm?url&inline';

export interface SqliteViewerJobMessage {
  type: 'sqlite-viewer-job';
  bytes: Uint8Array | null;
  sql: string;
  options: SqliteRunOptions;
}

export interface SqliteViewerReadyMessage {
  type: 'sqlite-viewer-ready';
}

export interface SqliteViewerDoneMessage {
  type: 'sqlite-viewer-done';
  result: SqliteRunResult;
}

export interface SqliteViewerErrorMessage {
  type: 'sqlite-viewer-error';
  message: string;
}

export type SqliteViewerWorkerMessage = SqliteViewerReadyMessage | SqliteViewerDoneMessage | SqliteViewerErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the
 * browser types tool pages need) but not the worker library, so
 * TypeScript resolves the ambient global in this file to a window-shaped
 * global rather than the worker's own global scope it actually is at
 * runtime. Narrowing once into this small locally declared shape
 * sidesteps the mismatch, the same pattern go-formatter.worker.ts uses.
 */
interface WorkerGlobal {
  postMessage(message: SqliteViewerWorkerMessage, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<SqliteViewerJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

const MEMORY_MESSAGE = 'The database or query needed more memory than this tab could give.';

function bytesFromDataUrl(url: string): Uint8Array {
  const binary = atob(url.slice(url.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** SQLite's own message for an engine error; a trap or an allocation failure is named as running out of memory. */
function describe(err: unknown): string {
  if (err instanceof SqliteViewerError) return err.message;
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (/RuntimeError|Aborted|memory|allocation|Invalid array length/i.test(text)) return MEMORY_MESSAGE;
  return err instanceof Error && err.message ? err.message : 'The background task failed for an unknown reason.';
}

let engineReady = false;

async function handleJob(job: SqliteViewerJobMessage): Promise<void> {
  try {
    if (!engineReady) {
      await loadEngine(bytesFromDataUrl(wasmDataUrl));
      engineReady = true;
    }
    const result = runSqlite(job.bytes, job.sql, job.options);
    workerGlobal.postMessage(
      { type: 'sqlite-viewer-done', result },
      result.database ? [result.database.buffer as ArrayBuffer] : [],
    );
  } catch (err) {
    workerGlobal.postMessage({ type: 'sqlite-viewer-error', message: describe(err) });
  }
}

workerGlobal.addEventListener('message', (event) => {
  void handleJob(event.data);
});

// Last statement of the module: the listener above exists, so a job posted now cannot be lost.
workerGlobal.postMessage({ type: 'sqlite-viewer-ready' });
