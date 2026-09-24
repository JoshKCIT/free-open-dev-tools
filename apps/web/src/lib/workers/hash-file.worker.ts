/**
 * The first background worker in this project. Reads a picked file in fixed
 * chunks and advances every selected algorithm over each chunk in a single
 * pass, so the tab that constructed this worker stays responsive and the
 * file is never read twice. All logic that actually hashes bytes lives in
 * the tool package (@fodt/hash-file); this file only owns reading a file in
 * slices and the message protocol back to the page.
 */
import {
  createHashers,
  updateHashers,
  finishHashers,
  type Algorithm,
  type OutputFormat,
  type FileHashResult,
} from '@fodt/hash-file';

/** One message the page sends to start a run. */
export interface HashFileJobMessage {
  type: 'hash-file-job';
  file: File;
  algorithms: Algorithm[];
  format: OutputFormat;
  /** Bytes read per slice. Always supplied by the page; see run-in-worker.ts's own default. */
  chunkSize: number;
}

export interface HashFileProgressMessage {
  type: 'hash-file-progress';
  bytesRead: number;
  totalBytes: number;
}

export interface HashFileDoneMessage {
  type: 'hash-file-done';
  results: FileHashResult[];
}

export interface HashFileErrorMessage {
  type: 'hash-file-error';
  /** A plain description. Never the file's own contents. */
  message: string;
}

export type HashFileWorkerMessage = HashFileProgressMessage | HashFileDoneMessage | HashFileErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the
 * browser types tool pages need) but not the worker library, so
 * TypeScript resolves the ambient global in this file to a window-shaped
 * global rather than the worker's own global scope it actually is at
 * runtime. Assigning a handler directly onto that global's own message
 * property inherits that same wrong shape and does not typecheck cleanly
 * either. Narrowing once into this small locally declared shape sidesteps
 * the mismatch instead: everything below goes through `workerGlobal`,
 * never through the raw global directly, and never through a direct
 * property assignment for the message handler -- that is exactly the form
 * this narrowing exists to avoid.
 */
interface WorkerGlobal {
  postMessage(message: HashFileWorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<HashFileJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

/**
 * 8 MiB: large enough that the per-chunk overhead (one microtask, one
 * postMessage progress event) is negligible next to the hashing work
 * itself, small enough that one chunk is a reasonable allocation even on a
 * constrained device. The page-side helper owns the production value and
 * always supplies it explicitly; this constant exists only as a defensive
 * fallback if a caller ever omits chunkSize entirely.
 */
const FALLBACK_CHUNK_SIZE = 8 * 1024 * 1024;

async function handleJob(job: HashFileJobMessage): Promise<void> {
  try {
    const state = createHashers(job.algorithms);
    const total = job.file.size;
    const chunkSize = job.chunkSize > 0 ? job.chunkSize : FALLBACK_CHUNK_SIZE;

    let offset = 0;
    while (offset < total) {
      const end = Math.min(offset + chunkSize, total);
      const slice = job.file.slice(offset, end);
      const buffer = await slice.arrayBuffer();
      updateHashers(state, new Uint8Array(buffer));
      offset = end;
      workerGlobal.postMessage({ type: 'hash-file-progress', bytesRead: offset, totalBytes: total });
    }

    const results = finishHashers(state, job.format);
    workerGlobal.postMessage({ type: 'hash-file-done', results });
  } catch (err) {
    workerGlobal.postMessage({
      type: 'hash-file-error',
      message: err instanceof Error ? err.message : 'The background task failed for an unknown reason.',
    });
  }
}

workerGlobal.addEventListener('message', (event) => {
  void handleJob(event.data);
});
