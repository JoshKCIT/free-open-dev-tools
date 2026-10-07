/**
 * Reads one email message and posts back its analysis, or an error. Every run of the email viewer goes through this
 * worker (see run-eml-viewer-in-worker.ts's own comment), and every run gets a new one. Reading up to 25 MiB, decoding
 * its parts and hashing its attachments is real work that nothing can interrupt part way, so it runs here, where the page
 * can stop it for real with terminate().
 *
 * The worker imports one function and its error class from the tool package, `analyzeMessage`. It never imports the HTML
 * preview or the sanitiser: those need a document, which a worker does not have, and the page runs them on the main
 * thread after the analysis comes back. Nothing is fetched, stored or logged here. The analysis comes back with the
 * attachment buffers handed over rather than copied; an error carries a fixed sentence and the part it is about, never any
 * text of the message.
 *
 * This worker posts `eml-viewer-ready` as the very last statement of the module, after its message listener exists. The
 * page posts the job only when it has seen that message, so a job can never reach a worker that has not finished
 * starting (a module worker drops a message that arrives before its evaluation is over). The worker cannot report its
 * own timeout: it may be stuck inside one call, so the page owns the limit and terminates it.
 */
import { EmlViewerError, analyzeMessage, type EmlAnalysis, type EmlViewerPart } from '@fodt/eml-viewer';

export interface EmlViewerJobMessage {
  type: 'eml-viewer-job';
  /** A picked file, read here. Exactly one of file and bytes is set. */
  file?: File;
  /** A pasted message, already encoded. */
  bytes?: Uint8Array;
}

export interface EmlViewerReadyMessage {
  type: 'eml-viewer-ready';
}

export interface EmlViewerDoneMessage {
  type: 'eml-viewer-done';
  result: EmlAnalysis;
}

export interface EmlViewerErrorMessage {
  type: 'eml-viewer-error';
  message: string;
  part?: EmlViewerPart;
}

export type EmlViewerWorkerMessage = EmlViewerReadyMessage | EmlViewerDoneMessage | EmlViewerErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the browser types tool pages need) but not the worker
 * library, so TypeScript resolves the ambient global in this file to a window-shaped global rather than the worker's
 * own global scope it actually is at runtime. Narrowing once into this small locally declared shape sidesteps the
 * mismatch, the same pattern the other workers use.
 */
interface WorkerGlobal {
  postMessage(message: EmlViewerWorkerMessage, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<EmlViewerJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

/** A fixed sentence and the error's own name. The package's refusals carry plain messages that hold no message text. */
function describe(err: unknown): EmlViewerErrorMessage {
  if (err instanceof EmlViewerError) {
    return { type: 'eml-viewer-error', message: err.message, part: err.part };
  }
  const name = err instanceof Error && err.name !== '' ? err.name : 'Error';
  return { type: 'eml-viewer-error', message: `The background task could not read this message (${name}).` };
}

/** The buffers of the attachments and inline images, each once, so they are handed over and not copied. */
function transferList(result: EmlAnalysis): Transferable[] {
  const buffers = new Set<ArrayBuffer>();
  const add = (bytes: Uint8Array): void => {
    // Only a buffer the array owns whole is handed over; a view onto a larger buffer is copied by the clone instead.
    if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer) {
      buffers.add(bytes.buffer);
    }
  };
  for (const attachment of result.attachments) add(attachment.bytes);
  for (const part of result.cidParts) add(part.bytes);
  return Array.from(buffers);
}

async function handleJob(job: EmlViewerJobMessage): Promise<void> {
  try {
    const bytes =
      job.file !== undefined ? new Uint8Array(await job.file.arrayBuffer()) : (job.bytes ?? new Uint8Array(0));
    const result = await analyzeMessage(bytes);
    workerGlobal.postMessage({ type: 'eml-viewer-done', result }, transferList(result));
  } catch (err) {
    workerGlobal.postMessage(describe(err));
  }
}

workerGlobal.addEventListener('message', (event) => {
  void handleJob(event.data);
});

// Last statement of the module: the listener above exists, so a job posted now cannot be lost.
workerGlobal.postMessage({ type: 'eml-viewer-ready' });
