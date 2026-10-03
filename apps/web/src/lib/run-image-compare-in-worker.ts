/**
 * The page-side helpers of Image Diff & Compare: they turn a picked image file into RGBA pixels on the page thread,
 * start the comparison worker, wait for it to report that it is ready, post the two pictures to it, race the run
 * against a fixed time limit (terminating the worker unconditionally when a limit wins), and turn the difference pixels
 * into a PNG on a page canvas.
 *
 * Imports the worker with the build-time inlining suffix, not the URL-and-constructor form -- see
 * run-jsonpath-in-worker.ts's own comment for why that line is load-bearing for the privacy harness.
 *
 * A close copy of run-key-converter-in-worker.ts, not a shared helper -- the same reason that file gives for its own
 * duplication. Every run gets a NEW worker, so no run ever inherits anything from the previous one. Starting one costs
 * a few tens of milliseconds.
 *
 * The handshake exists because every worker on the site is a module worker (apps/web/vite.config.ts), and a module
 * whose evaluation is still running drops a message posted to it. The worker says `image-compare-ready` as the last
 * statement of its module; the job is posted only then. Two limits follow from that. A worker that never says ready is
 * stopped after 10 seconds with its own message, so a tab whose worker cannot start does not wait forever. The 20
 * second run limit starts when the job is posted, not when the worker is created, so a slow start is never counted
 * against the visitor's pictures.
 *
 * The run limit is 20 seconds. Comparing 16 megapixels took 0.2 to 0.3 seconds in the tested engines, so 20 seconds is
 * many times the slowest measured run and still short enough that nobody waits on a run that never answers. The page
 * owns the limit because the worker is inside one engine call when it matters, and terminate() is the only real way to
 * stop it.
 *
 * Both pictures go in as buffers, transferred rather than copied (three buffers of 16 megapixels are 192 MB, so a copy
 * would double that); the difference pixels come back the same way. Nothing is fetched, stored, logged or turned into
 * an address here. The canvases used are local variables never appended to the document, so a picked image is never
 * shown except as the page's own difference picture.
 */
import ImageCompareWorker from './workers/image-compare.worker.ts?worker&inline';
import type { ImageCompareWorkerMessage } from './workers/image-compare.worker';
import type { RunContext } from './tool-ui';

export const IMAGE_COMPARE_TIME_LIMIT_MS = 20000;

export const IMAGE_COMPARE_TIME_LIMIT_MESSAGE =
  'Stopped after 20 seconds: comparing these images took too long. Try smaller images.';

export const IMAGE_COMPARE_START_LIMIT_MS = 10000;

export const IMAGE_COMPARE_START_LIMIT_MESSAGE =
  'The background task did not start within 10 seconds. Reload the page and try again.';

const NOT_STARTED_MESSAGE = 'The background task could not start.';

const STOPPED_MESSAGE = 'The background task stopped unexpectedly.';

const DECODE_FAILED_MESSAGE = 'This browser could not decode this image.';

const SURFACE_MESSAGE = 'This browser could not provide a 2D drawing surface for this image.';

const ENCODE_FAILED_MESSAGE = 'This browser could not encode the difference image.';

export class ImageCompareRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageCompareRunError';
  }
}

export interface DecodedPixels {
  /** RGBA, 4 bytes per pixel, a whole array (its buffer is exactly this long and can be transferred). */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Decodes an image file to RGBA pixels on the page thread, as this browser decodes it, with the photo's own orientation
 * applied (`imageOrientation: 'from-image'`). The caller has already checked the file's size and header.
 */
export async function decodeToPixels(file: File): Promise<DecodedPixels> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ImageCompareRunError(DECODE_FAILED_MESSAGE);
  }
  try {
    const width = bitmap.width;
    const height = bitmap.height;
    const canvas = document.createElement('canvas'); // never appended to the document
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new ImageCompareRunError(SURFACE_MESSAGE);
    context.drawImage(bitmap, 0, 0);
    return { data: context.getImageData(0, 0, width, height).data, width, height };
  } catch (err) {
    if (err instanceof ImageCompareRunError) throw err;
    throw new ImageCompareRunError(DECODE_FAILED_MESSAGE);
  } finally {
    bitmap.close();
  }
}

/** Encodes RGBA pixels as a PNG on one local canvas that is never appended to the document. */
export async function pixelsToPng(rgba: Uint8ClampedArray, width: number, height: number): Promise<Uint8Array> {
  const canvas = document.createElement('canvas'); // never appended to the document
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new ImageCompareRunError(SURFACE_MESSAGE);
  context.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob || blob.type !== 'image/png') throw new ImageCompareRunError(ENCODE_FAILED_MESSAGE);
  return new Uint8Array(await blob.arrayBuffer());
}

export interface CompareJob {
  a: Uint8ClampedArray;
  b: Uint8ClampedArray;
  width: number;
  height: number;
  threshold: number;
  includeAA: boolean;
}

export interface CompareOutcome {
  differing: number;
  total: number;
  diff: Uint8ClampedArray;
}

/**
 * Runs one comparison in a new background worker, resolving with the count, the total and the difference pixels. Both
 * input buffers are transferred, so the arrays in `job` are empty afterwards. Settlement is the point of this function
 * -- see run-jsonpath-in-worker.ts's own comment on the guarded `settle` closure this copies wholesale, covering
 * success, an application error, a native worker failure, an undeliverable message, an abort, an already-aborted
 * signal, the start limit and the time limit itself. Whichever of those comes first decides the outcome; `settle` runs
 * once, clears both timers and terminates the worker once.
 */
export function compareInWorker(job: CompareJob, ctx: RunContext): Promise<CompareOutcome> {
  if (ctx.signal.aborted) {
    return Promise.reject(new ImageCompareRunError('The run was cancelled before it started.'));
  }

  return new Promise<CompareOutcome>((resolve, reject) => {
    const worker = new ImageCompareWorker();
    let settled = false;
    let runTimer: ReturnType<typeof setTimeout> | undefined;
    // Whether the job has been posted. A worker that fails after that did start, so it is not reported as unable to.
    let posted = false;
    const failedMessage = () => (posted ? STOPPED_MESSAGE : NOT_STARTED_MESSAGE);

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
    };

    type Outcome = { ok: true; value: CompareOutcome } | { ok: false; error: Error };

    const settle = (outcome: Outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(startTimer);
      clearTimeout(runTimer);
      try {
        removeListeners();
      } finally {
        worker.terminate();
      }
      if (outcome.ok) resolve(outcome.value);
      else reject(outcome.error);
    };

    const onMessage = (event: MessageEvent<ImageCompareWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'image-compare-ready') {
        // The worker is listening. Only now does the run exist: the start timer has done its job, and the time limit
        // begins at the moment the job is posted.
        clearTimeout(startTimer);
        runTimer = setTimeout(() => {
          settle({ ok: false, error: new ImageCompareRunError(IMAGE_COMPARE_TIME_LIMIT_MESSAGE) });
        }, IMAGE_COMPARE_TIME_LIMIT_MS);
        try {
          const a = job.a.buffer as ArrayBuffer;
          const b = job.b.buffer as ArrayBuffer;
          worker.postMessage(
            {
              type: 'image-compare-job',
              a,
              b,
              width: job.width,
              height: job.height,
              threshold: job.threshold,
              includeAA: job.includeAA,
            },
            [a, b],
          );
          posted = true;
        } catch {
          settle({ ok: false, error: new ImageCompareRunError(NOT_STARTED_MESSAGE) });
        }
      } else if (data.type === 'image-compare-done') {
        settle({
          ok: true,
          value: { differing: data.differing, total: data.total, diff: new Uint8ClampedArray(data.diff) },
        });
      } else {
        settle({ ok: false, error: new ImageCompareRunError(data.message) });
      }
    };

    const onNativeError = () => {
      settle({ ok: false, error: new ImageCompareRunError(failedMessage()) });
    };

    const onMessageError = () => {
      settle({ ok: false, error: new ImageCompareRunError(failedMessage()) });
    };

    const onAbort = () => {
      settle({ ok: false, error: new ImageCompareRunError('The run was cancelled.') });
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onNativeError);
    worker.addEventListener('messageerror', onMessageError);
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    const startTimer = setTimeout(() => {
      settle({ ok: false, error: new ImageCompareRunError(IMAGE_COMPARE_START_LIMIT_MESSAGE) });
    }, IMAGE_COMPARE_START_LIMIT_MS);
  });
}
