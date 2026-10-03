/**
 * Compares two pictures pixel by pixel and posts back the count, the total and the difference picture, or an error.
 * Every run of Image Diff & Compare goes through this worker (see run-image-compare-in-worker.ts's own comment), and
 * every run gets a new one, so nothing is kept once the work ends.
 *
 * The page decodes both pictures to RGBA pixels (a worker cannot read pixels from a canvas in every browser) and passes
 * them here as two buffers, transferred rather than copied; the difference picture goes back the same way. The engine is
 * pixelmatch, imported through the tool package. It is plain script with nothing to load, so there is nothing to prepare
 * before the ready message.
 *
 * This worker posts `image-compare-ready` as the very last statement of the module, after its message listener exists.
 * The page posts a job only when it has seen that message, so a job can never reach a worker that has not finished
 * starting (a module worker drops a message that arrives before its evaluation is over). The worker cannot report its
 * own timeout: it may be stuck inside one engine call, so the page owns the limit and terminates it.
 *
 * Only the numbers and the difference pixels or a fixed sentence and the error's own name come back, never any input
 * pixel of the two pictures and never any file name.
 */
import { compareImages, ImageCompareError } from '@fodt/image-compare';

export interface ImageCompareJobMessage {
  type: 'image-compare-job';
  /** RGBA pixels of the first picture, `width * height * 4` bytes, transferred. */
  a: ArrayBuffer;
  /** RGBA pixels of the second picture, the same size, transferred. */
  b: ArrayBuffer;
  width: number;
  height: number;
  threshold: number;
  includeAA: boolean;
}

export interface ImageCompareReadyMessage {
  type: 'image-compare-ready';
}

export interface ImageCompareDoneMessage {
  type: 'image-compare-done';
  differing: number;
  total: number;
  /** RGBA pixels of the difference picture, transferred. */
  diff: ArrayBuffer;
}

export interface ImageCompareErrorMessage {
  type: 'image-compare-error';
  message: string;
}

export type ImageCompareWorkerMessage = ImageCompareReadyMessage | ImageCompareDoneMessage | ImageCompareErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the browser types tool pages need) but not the worker
 * library, so TypeScript resolves the ambient global in this file to a window-shaped global rather than the worker's
 * own global scope it actually is at runtime. Narrowing once into this small locally declared shape sidesteps the
 * mismatch, the same pattern the other workers use.
 */
interface WorkerGlobal {
  postMessage(message: ImageCompareWorkerMessage, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<ImageCompareJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

/** A fixed sentence and the error's own name. The package's own errors carry plain messages that hold no pixels. */
function describe(err: unknown): string {
  if (err instanceof ImageCompareError) return err.message;
  const name = err instanceof Error && err.name !== '' ? err.name : 'Error';
  return `The background task could not compare these images (${name}).`;
}

function handleJob(job: ImageCompareJobMessage): void {
  try {
    const result = compareImages(new Uint8ClampedArray(job.a), new Uint8ClampedArray(job.b), job.width, job.height, {
      threshold: job.threshold,
      includeAA: job.includeAA,
    });
    const diff = result.diff.buffer as ArrayBuffer;
    workerGlobal.postMessage({ type: 'image-compare-done', differing: result.differing, total: result.total, diff }, [
      diff,
    ]);
  } catch (err) {
    workerGlobal.postMessage({ type: 'image-compare-error', message: describe(err) });
  }
}

workerGlobal.addEventListener('message', (event) => {
  handleJob(event.data);
});

// Last statement of the module: the listener above exists, so a job posted now cannot be lost.
workerGlobal.postMessage({ type: 'image-compare-ready' });
