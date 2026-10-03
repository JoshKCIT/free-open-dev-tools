/**
 * The page-side helper that starts the QR Code & Barcode Reader's worker, waits for it to report that it is ready,
 * posts a picture to it, and races each read against a fixed time limit, terminating the worker unconditionally when a
 * limit wins. It also turns a picked image file into RGBA pixels on the page thread, and opens a reader session that
 * keeps one worker for many camera frames.
 *
 * Imports the worker with the build-time inlining suffix, not the URL-and-constructor form -- see
 * run-jsonpath-in-worker.ts's own comment for why that line is load-bearing for the privacy harness.
 *
 * A close copy of run-key-converter-in-worker.ts, not a shared helper -- the same reason that file gives for its own
 * duplication. Every run gets a NEW worker (a camera session gets one for the whole session), so no run ever inherits
 * anything from the previous one. Starting one costs a few tens of milliseconds, plus the time the engine needs to
 * prepare itself.
 *
 * The handshake exists because every worker on the site is a module worker (apps/web/vite.config.ts), and a module
 * whose evaluation is still running drops a message posted to it. The worker says `qr-barcode-reader-ready` as the last
 * statement of its module; a picture is posted only then. Two limits follow from that. A worker that never says ready
 * is stopped after 10 seconds with its own message, so a tab whose worker cannot start does not wait forever. The 20
 * second run limit starts when a picture is posted, not when the worker is created, so a slow start is never counted
 * against the visitor's image.
 *
 * The run limit is 20 seconds. Reading a 12 megapixel picture took 0.5 to 0.9 seconds and a 48 megapixel one at most
 * 3.4 seconds in every tested engine, so 20 seconds is several times the slowest measured read and still short enough
 * that nobody waits on a read that never arrives. The page owns the limit because the worker is inside one engine call
 * when it matters, and terminate() is the only real way to stop it.
 *
 * Only RGBA pixels go in, transferred; only the results or a fixed sentence come back. Nothing is fetched, stored,
 * logged or turned into an address here.
 */
import QrBarcodeReaderWorker from './workers/qr-barcode-reader.worker.ts?worker&inline';
import type { QrBarcodeReaderWorkerMessage } from './workers/qr-barcode-reader.worker';
import type { CodeResult, ImagePixels } from '@fodt/qr-barcode-reader';
import type { RunContext } from './tool-ui';

export const QR_BARCODE_READER_TIME_LIMIT_MS = 20000;

export const QR_BARCODE_READER_TIME_LIMIT_MESSAGE =
  'Stopped after 20 seconds: reading this image took too long. Try a smaller image.';

export const QR_BARCODE_READER_START_LIMIT_MS = 10000;

export const QR_BARCODE_READER_START_LIMIT_MESSAGE =
  'The background task did not start within 10 seconds. Reload the page and try again.';

const NOT_STARTED_MESSAGE = 'The background task could not start.';

const STOPPED_MESSAGE = 'The background task stopped unexpectedly.';

const DECODE_FAILED_MESSAGE = 'This browser could not decode this image.';

export class QrBarcodeReaderRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QrBarcodeReaderRunError';
  }
}

/**
 * Decodes an image file to RGBA pixels on the page thread. The canvas used is a local variable never appended to the
 * document, so the picked image is never shown. `createImageBitmap` is asked to apply the image's own orientation. A
 * `maxWidth` scales a wider picture down, keeping its shape. The caller has already checked the file's size and header.
 */
export async function imagePixelsFromFile(file: File, maxWidth?: number): Promise<ImagePixels> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new QrBarcodeReaderRunError(DECODE_FAILED_MESSAGE);
  }
  try {
    let width = bitmap.width;
    let height = bitmap.height;
    if (maxWidth !== undefined && width > maxWidth) {
      height = Math.max(1, Math.round((height * maxWidth) / width));
      width = maxWidth;
    }
    const canvas = document.createElement('canvas'); // never appended to the document
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context)
      throw new QrBarcodeReaderRunError('This browser could not provide a 2D drawing surface for this image.');
    context.drawImage(bitmap, 0, 0, width, height);
    return { data: context.getImageData(0, 0, width, height).data, width, height };
  } catch (err) {
    if (err instanceof QrBarcodeReaderRunError) throw err;
    throw new QrBarcodeReaderRunError(DECODE_FAILED_MESSAGE);
  } finally {
    bitmap.close();
  }
}

/** One worker that reads one picture at a time. `close` ends it; any read still running is stopped. */
export interface ReaderSession {
  read(pixels: ImagePixels): Promise<CodeResult[]>;
  close(): void;
}

/**
 * Starts a new worker and resolves with a session once the worker has said it is ready. Settlement is the point of
 * this function -- see run-jsonpath-in-worker.ts's own comment on the guarded `finish` closure this copies in shape,
 * covering a result, an application error, a native worker failure, an undeliverable message, an abort, an
 * already-aborted signal, the start limit and the run limit. Whichever of those comes first decides the outcome;
 * `finish` runs once, clears both timers and terminates the worker once.
 */
export function openReaderSession(ctx: RunContext): Promise<ReaderSession> {
  if (ctx.signal.aborted) {
    return Promise.reject(new QrBarcodeReaderRunError('The run was cancelled before it started.'));
  }

  return new Promise<ReaderSession>((resolve, reject) => {
    const worker = new QrBarcodeReaderWorker();
    let finished = false;
    // Why the worker ended, for a read asked for afterwards.
    let endedWith: Error | null = null;
    let ready = false;
    let runTimer: ReturnType<typeof setTimeout> | undefined;
    // Whether a picture has been posted. A worker that fails after that did start, so it is not reported as unable to.
    let posted = false;
    let pending: { resolve: (results: CodeResult[]) => void; reject: (error: Error) => void } | null = null;
    const failedMessage = () => (posted ? STOPPED_MESSAGE : NOT_STARTED_MESSAGE);

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
    };

    const finish = (error: Error) => {
      if (finished) return;
      finished = true;
      endedWith = error;
      clearTimeout(startTimer);
      clearTimeout(runTimer);
      try {
        removeListeners();
      } finally {
        worker.terminate();
      }
      const waiting = pending;
      pending = null;
      if (waiting) waiting.reject(error);
      else if (!ready) reject(error);
    };

    const onMessage = (event: MessageEvent<QrBarcodeReaderWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'qr-barcode-reader-ready') {
        // The worker is listening. Only now does a read exist: the start timer has done its job, and the time limit
        // of each read begins at the moment its picture is posted.
        clearTimeout(startTimer);
        ready = true;
        resolve(session);
      } else if (data.type === 'qr-barcode-reader-done') {
        clearTimeout(runTimer);
        const waiting = pending;
        pending = null;
        waiting?.resolve(data.results);
      } else {
        clearTimeout(runTimer);
        const waiting = pending;
        pending = null;
        waiting?.reject(new QrBarcodeReaderRunError(data.message));
      }
    };

    const onNativeError = () => finish(new QrBarcodeReaderRunError(failedMessage()));
    const onMessageError = () => finish(new QrBarcodeReaderRunError(failedMessage()));
    const onAbort = () => finish(new QrBarcodeReaderRunError('The run was cancelled.'));

    const session: ReaderSession = {
      read(pixels) {
        if (finished) return Promise.reject(endedWith ?? new QrBarcodeReaderRunError('The background task has ended.'));
        if (pending) return Promise.reject(new QrBarcodeReaderRunError('A read is already running.'));
        return new Promise<CodeResult[]>((resolveRead, rejectRead) => {
          pending = { resolve: resolveRead, reject: rejectRead };
          runTimer = setTimeout(() => {
            finish(new QrBarcodeReaderRunError(QR_BARCODE_READER_TIME_LIMIT_MESSAGE));
          }, QR_BARCODE_READER_TIME_LIMIT_MS);
          try {
            const buffer = pixels.data.buffer as ArrayBuffer;
            worker.postMessage(
              { type: 'qr-barcode-reader-job', data: buffer, width: pixels.width, height: pixels.height },
              [buffer],
            );
            posted = true;
          } catch {
            finish(new QrBarcodeReaderRunError(NOT_STARTED_MESSAGE));
          }
        });
      },
      close() {
        finish(new QrBarcodeReaderRunError('The run was cancelled.'));
      },
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onNativeError);
    worker.addEventListener('messageerror', onMessageError);
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    const startTimer = setTimeout(() => {
      finish(new QrBarcodeReaderRunError(QR_BARCODE_READER_START_LIMIT_MESSAGE));
    }, QR_BARCODE_READER_START_LIMIT_MS);
  });
}

/**
 * Reads the codes in one picture in a new background worker, resolving with every code found (none is an empty list).
 * The worker is ended whether the read succeeds, fails or is stopped.
 */
export async function readCodesInWorker(pixels: ImagePixels, ctx: RunContext): Promise<CodeResult[]> {
  const session = await openReaderSession(ctx);
  try {
    return await session.read(pixels);
  } finally {
    session.close();
  }
}
