/**
 * Reads the QR codes and barcodes in one picture and posts back what it found, or an error. Every run of the QR Code &
 * Barcode Reader goes through this worker (see run-qr-barcode-reader-in-worker.ts's own comment), and every run, or
 * every camera session, gets a new one, so the engine starts clean each time and nothing is kept once the work ends.
 *
 * The engine is zxing-cpp compiled to WebAssembly by zxing-wasm. Its bytes travel inside this worker as a data URL,
 * written into the page's own chunk at build time by the `?url&inline` query, so nothing is fetched while the page
 * runs -- a blob worker could not resolve a relative address anyway. The import is a relative path into the tool
 * folder's installed copy of the package, because the package is declared only in that folder and a bare import would
 * not resolve from here. The path is five levels up from lib/workers to the repository root. The bytes are decoded
 * with `atob`, never fetched.
 *
 * The engine is prepared before the ready message, so the time it takes counts against the page's 10 second start
 * limit and never against the run limit.
 *
 * This worker posts `qr-barcode-reader-ready` as the very last statement of the module, after its message listener
 * exists. The page posts a job only when it has seen that message, so a job can never reach a worker that has not
 * finished starting (a module worker drops a message that arrives before its evaluation is over). The worker cannot
 * report its own timeout: it may be stuck inside one engine call, so the page owns the limit and terminates it.
 *
 * A job carries the picture as RGBA pixels, transferred rather than copied. Only the results or a fixed sentence and
 * the error's own name come back, never any pixel and never any decoded text inside a message.
 */
import { CodeReaderError, prepareReader, readCodes, type CodeResult } from '@fodt/qr-barcode-reader';
import wasmDataUrl from '../../../../../tools/qr-barcode-reader/node_modules/zxing-wasm/dist/reader/zxing_reader.wasm?url&inline';

export interface QrBarcodeReaderJobMessage {
  type: 'qr-barcode-reader-job';
  /** RGBA pixels, `width * height * 4` bytes, transferred. */
  data: ArrayBuffer;
  width: number;
  height: number;
}

export interface QrBarcodeReaderReadyMessage {
  type: 'qr-barcode-reader-ready';
}

export interface QrBarcodeReaderDoneMessage {
  type: 'qr-barcode-reader-done';
  results: CodeResult[];
}

export interface QrBarcodeReaderErrorMessage {
  type: 'qr-barcode-reader-error';
  message: string;
}

export type QrBarcodeReaderWorkerMessage =
  QrBarcodeReaderReadyMessage | QrBarcodeReaderDoneMessage | QrBarcodeReaderErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the browser types tool pages need) but not the worker
 * library, so TypeScript resolves the ambient global in this file to a window-shaped global rather than the worker's
 * own global scope it actually is at runtime. Narrowing once into this small locally declared shape sidesteps the
 * mismatch, the same pattern the other workers use.
 */
interface WorkerGlobal {
  postMessage(message: QrBarcodeReaderWorkerMessage, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<QrBarcodeReaderJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

function bytesFromDataUrl(url: string): ArrayBuffer {
  const binary = atob(url.slice(url.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** A fixed sentence and the error's own name. The package's own errors carry plain messages that hold no content. */
function describe(err: unknown): string {
  if (err instanceof CodeReaderError) return err.message;
  const name = err instanceof Error && err.name !== '' ? err.name : 'Error';
  return `The background task could not read this image (${name}).`;
}

// Prepared here, before the ready message, so a slow load is part of the start and not of the run. A failed
// preparation is kept and reported as the answer to the job, with the same message the run would have given.
let engineFailed = false;
let engineFailure: unknown;
try {
  await prepareReader(bytesFromDataUrl(wasmDataUrl));
} catch (err) {
  engineFailed = true;
  engineFailure = err;
}

async function handleJob(job: QrBarcodeReaderJobMessage): Promise<void> {
  try {
    if (engineFailed) throw engineFailure;
    const results = await readCodes({ data: new Uint8ClampedArray(job.data), width: job.width, height: job.height });
    workerGlobal.postMessage({ type: 'qr-barcode-reader-done', results });
  } catch (err) {
    workerGlobal.postMessage({ type: 'qr-barcode-reader-error', message: describe(err) });
  }
}

workerGlobal.addEventListener('message', (event) => {
  void handleJob(event.data);
});

// Last statement of the module: the listener above exists, so a job posted now cannot be lost.
workerGlobal.postMessage({ type: 'qr-barcode-reader-ready' });
