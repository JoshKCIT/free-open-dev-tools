/**
 * Runs one search and posts back its result or its error. Every hex-viewer search goes through this worker (see
 * run-hex-viewer-in-worker.ts's own comment), and every search gets a new one, so nothing read from the file is kept
 * once the search ends. Only searching happens here: viewing reads one slice of the file on the page.
 *
 * The worker streams the file: `file.stream()` hands over the file in chunks, `searchChunks` looks at each one and
 * keeps only the few bytes that could start a match across a chunk boundary, so the memory used stays flat for a file of
 * any size. There is no WebAssembly and nothing to fetch.
 *
 * This worker posts `hex-viewer-ready` as the very last statement of the module, after its message listener exists. The
 * page posts the job only when it has seen that message, so a job can never reach a worker that has not finished
 * starting (a module worker drops a message that arrives before its evaluation is over). The worker cannot report its
 * own timeout: it may be inside a long scan, so the page owns the limit and terminates it.
 */
import { HexViewerError, searchChunks, type SearchResult } from '@fodt/hex-viewer';
import { hexViewerUnknownFailure } from '../hex-viewer-failure';

export type HexViewerJob =
  | { kind: 'file'; file: File; needle: Uint8Array; matchCase: boolean }
  | { kind: 'bytes'; bytes: Uint8Array; needle: Uint8Array; matchCase: boolean };

export interface HexViewerJobMessage {
  type: 'hex-viewer-job';
  job: HexViewerJob;
}

export interface HexViewerReadyMessage {
  type: 'hex-viewer-ready';
}

export interface HexViewerDoneMessage {
  type: 'hex-viewer-done';
  result: SearchResult;
}

export interface HexViewerErrorMessage {
  type: 'hex-viewer-error';
  message: string;
}

export type HexViewerWorkerMessage = HexViewerReadyMessage | HexViewerDoneMessage | HexViewerErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the browser types tool pages need) but not the worker
 * library, so TypeScript resolves the ambient global in this file to a window-shaped global rather than the worker's
 * own global scope it actually is at runtime. Narrowing once into this small locally declared shape sidesteps the
 * mismatch, the same pattern go-formatter.worker.ts uses.
 */
interface WorkerGlobal {
  postMessage(message: HexViewerWorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<HexViewerJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

/** The chunks of a file, read one at a time from its stream. */
async function* chunksOfFile(file: File): AsyncGenerator<Uint8Array> {
  const reader = file.stream().getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/** The pasted bytes as one chunk. */
async function* chunksOfBytes(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}

/**
 * The viewer's own plain sentence for an expected failure. Any other error gets one fixed sentence from
 * hex-viewer-failure.ts, never the error's own text (a picked file that changed makes the browser's read fail with its
 * own words).
 */
function failure(err: unknown, kind: 'file' | 'bytes' | undefined): HexViewerErrorMessage {
  if (err instanceof HexViewerError) return { type: 'hex-viewer-error', message: err.message };
  return { type: 'hex-viewer-error', message: hexViewerUnknownFailure(err, kind) };
}

async function handleJob(message: HexViewerJobMessage): Promise<void> {
  try {
    const { job } = message;
    const chunks = job.kind === 'file' ? chunksOfFile(job.file) : chunksOfBytes(job.bytes);
    const result = await searchChunks(chunks, job.needle, { matchCase: job.matchCase });
    workerGlobal.postMessage({ type: 'hex-viewer-done', result });
  } catch (err) {
    workerGlobal.postMessage(failure(err, message?.job?.kind));
  }
}

workerGlobal.addEventListener('message', (event) => {
  void handleJob(event.data);
});

// Last statement of the module: the listener above exists, so a job posted now cannot be lost.
workerGlobal.postMessage({ type: 'hex-viewer-ready' });
