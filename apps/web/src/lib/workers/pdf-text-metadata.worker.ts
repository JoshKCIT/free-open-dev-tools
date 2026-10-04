/**
 * Removes the metadata from one PDF and posts back the copy and a report of what was removed, or an error. Every removal
 * of the PDF Text Extractor & Metadata Remover goes through this worker (see run-pdf-text-metadata-in-worker.ts's own
 * comment), and every removal gets a new one, so nothing of an earlier file is ever kept.
 *
 * It imports the strip module of the tool folder by relative path (five levels up from lib/workers to the repository
 * root), not the package index: the index re-exports PDF.js for the page, `pdfjs-dist` declares no `sideEffects`, and
 * bundling it here would put megabytes of reader into a worker that only rewrites a file with pdf-lib.
 *
 * This worker posts `pdf-text-metadata-ready` as the very last statement of the module, after its message listener exists.
 * The page posts the job only when it has seen that message, so a job can never reach a worker that has not finished
 * starting (a module worker drops a message that arrives before its evaluation is over). The worker cannot report its own
 * timeout: it may be inside one long call, so the page owns the limit and terminates it.
 *
 * The worker also reloads the copy with pdf-lib and lists anything the copy still holds (`findMetadataLeft`) before it posts
 * the result, so that check runs here, inside the page's 20 second limit and off the page's thread, and the page only reads
 * the list. The streams of the copy are not counted again: they were counted when the original was.
 *
 * The job carries the file's bytes, transferred rather than copied; the copy comes back the same way. An error carries a
 * fixed sentence (and the kind of refusal), or the error's own name, never any byte or text of the file.
 */
import {
  PdfToolError,
  findMetadataLeft,
  stripMetadata,
  type StripReport,
} from '../../../../../tools/pdf-text-metadata/src/strip';

export interface PdfTextMetadataJobMessage {
  type: 'pdf-text-metadata-job';
  bytes: ArrayBuffer;
}

export interface PdfTextMetadataReadyMessage {
  type: 'pdf-text-metadata-ready';
}

export interface PdfTextMetadataDoneMessage {
  type: 'pdf-text-metadata-done';
  bytes: ArrayBuffer;
  report: StripReport;
  /** What the copy still holds after removal (an empty list means none); each line names an entry or an object, never any text. */
  left: string[];
}

export interface PdfTextMetadataErrorMessage {
  type: 'pdf-text-metadata-error';
  message: string;
  /** The kind of a refusal from the package (`encrypted`, `damaged`), when it is one. */
  kind?: string;
}

export type PdfTextMetadataWorkerMessage =
  PdfTextMetadataReadyMessage | PdfTextMetadataDoneMessage | PdfTextMetadataErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the browser types tool pages need) but not the worker
 * library, so TypeScript resolves the ambient global in this file to a window-shaped global rather than the worker's own
 * global scope it actually is at runtime. Narrowing once into this small locally declared shape sidesteps the mismatch,
 * the same pattern the other workers use.
 */
interface WorkerGlobal {
  postMessage(message: PdfTextMetadataWorkerMessage, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<PdfTextMetadataJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

async function handleJob(job: PdfTextMetadataJobMessage): Promise<void> {
  try {
    const { bytes, report } = await stripMetadata(new Uint8Array(job.bytes));
    const left = await findMetadataLeft(bytes, { skipExpansionCheck: true });
    // Only a buffer the copy fills exactly can be handed over whole; any other is copied first.
    const buffer = (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice())
      .buffer as ArrayBuffer;
    workerGlobal.postMessage({ type: 'pdf-text-metadata-done', bytes: buffer, report, left }, [buffer]);
  } catch (err) {
    if (err instanceof PdfToolError) {
      workerGlobal.postMessage({ type: 'pdf-text-metadata-error', message: err.message, kind: err.kind });
      return;
    }
    const name = err instanceof Error && err.name !== '' ? err.name : 'Error';
    workerGlobal.postMessage({
      type: 'pdf-text-metadata-error',
      message: `The background task could not remove the metadata (${name}).`,
    });
  }
}

workerGlobal.addEventListener('message', (event) => {
  void handleJob(event.data);
});

// Last statement of the module: the listener above exists, so a job posted now cannot be lost.
workerGlobal.postMessage({ type: 'pdf-text-metadata-ready' });
