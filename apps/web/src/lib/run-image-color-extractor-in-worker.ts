/**
 * The page-side helper that starts the image colour extraction worker,
 * enforces a page-side time limit and turns an abort into a real stop.
 *
 * A close copy of `run-in-worker.ts`'s settle contract (this project's
 * first worker page, `hash-file`), because that contract already covers
 * every way a background job can end -- success, an application-level
 * error the worker reports on purpose, a native worker failure, a message
 * that could not be delivered, an abort, and a signal already aborted
 * before this function was even called -- and this page adds exactly one
 * more way to end: a forced stop when the worker takes too long, which the
 * worker's own header check and pixel limit make rare but not impossible
 * (a large image right at the pixel ceiling, or a slow device).
 *
 * Imports the worker with the build-time inlining suffix, not the
 * URL-and-constructor form, for the same reason `run-in-worker.ts`
 * documents: the default form emits the worker as a separately fetched
 * file, and because the worker is constructed when the visitor presses
 * Run, that fetch would land inside the window the privacy harness
 * records, where it is an offending request. The inlining form embeds the
 * worker's code in the page chunk and constructs it from an object URL,
 * which the harness's existing filter already excludes.
 */
import ImageColorExtractorWorker from './workers/image-color-extractor.worker.ts?worker&inline';
import type {
  ImageColorExtractorJobMessage,
  ImageColorExtractorWorkerMessage,
  ImageColorExtractorNeedsPageCanvasMessage,
} from './workers/image-color-extractor.worker';
import { extractFromPixels, type ImageFormat, type QuantizedColor } from '@fodt/image-color-extractor';
import type { RunContext } from './tool-ui';

/**
 * Duplicated from `image-color-extractor.worker.ts` rather than imported:
 * that file is a worker entry module whose top level registers a `message`
 * listener on `self` (which aliases `window` on the main thread too), so a
 * normal (non-`?worker`) import of it here would attach that listener to
 * the page by accident. Two constants and one small pure function are a
 * smaller cost than that.
 */
const MAX_CANVAS_LONG_SIDE = 256;

function targetCanvasSize(
  width: number,
  height: number,
): { targetWidth: number; targetHeight: number; downscaling: boolean } {
  const longSide = Math.max(width, height);
  if (longSide <= MAX_CANVAS_LONG_SIDE) {
    return { targetWidth: width, targetHeight: height, downscaling: false };
  }
  const scale = MAX_CANVAS_LONG_SIDE / longSide;
  return {
    targetWidth: Math.max(1, Math.round(width * scale)),
    targetHeight: Math.max(1, Math.round(height * scale)),
    downscaling: true,
  };
}

/**
 * Draws an already-decoded bitmap and extracts its colours on the page
 * thread -- the fallback for an engine with no `OffscreenCanvas` anywhere,
 * confirmed necessary for this project's own tested WebKit build (see the
 * worker's own header comment). `document.createElement('canvas')` is used
 * only when `OffscreenCanvas` itself is unavailable on the main thread
 * too; either way the canvas this function draws into is a plain local
 * variable, never appended to the document, so the picked image is still
 * never shown -- the one property D-115 actually requires, independent of
 * which canvas class happens to provide it on a given engine.
 */
function finishOnPageThread(
  data: ImageColorExtractorNeedsPageCanvasMessage,
): Pick<ExtractColorsResult, 'colors' | 'sampled'> {
  const { bitmap } = data;
  try {
    const { targetWidth, targetHeight, downscaling } = targetCanvasSize(bitmap.width, bitmap.height);
    let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(targetWidth, targetHeight);
      ctx = canvas.getContext('2d');
    } else {
      const canvas = document.createElement('canvas'); // never appended to the document
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      ctx = canvas.getContext('2d');
    }
    if (!ctx) throw new Error('This browser could not provide a 2D drawing surface for this image.');
    ctx.imageSmoothingEnabled = downscaling;
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    const { data: pixels } = ctx.getImageData(0, 0, targetWidth, targetHeight);
    return extractFromPixels(pixels, targetWidth, targetHeight, {
      count: data.count,
      ignoreTransparent: data.ignoreTransparent,
    });
  } finally {
    bitmap.close();
  }
}

/**
 * The page-side time limit. Chosen generously above the realistic run time
 * this project measured for a large, still-within-limit image (see the
 * plan's own "Measured per-engine behaviour" note), while still bounding
 * how long a visitor can be left waiting before the run is stopped for
 * them automatically.
 */
export const IMAGE_TIME_LIMIT_MS = 10_000;

/** The fixed prefix every time-limit rejection message starts with, so a browser test can match on it without hard-coding the exact duration wording twice. */
export const IMAGE_TIME_LIMIT_MESSAGE = `Stopped after ${IMAGE_TIME_LIMIT_MS / 1000} seconds: this image is taking too long to decode and quantise.`;

export interface ExtractColorsResult {
  type: ImageFormat;
  width: number;
  height: number;
  fileSize: number;
  colors: QuantizedColor[];
  sampled: number;
}

/**
 * A test-only affordance, read only when the browser test suite sets it
 * before the page loads, exactly like `hash-file`'s own
 * `__FODT_HASH_FILE_TEST_CHUNK_SIZE__`. It shortens the time limit so a
 * forced-stop scenario can be proven in well under a second instead of
 * waiting out the real ten-second production limit. Absent -- every real
 * visit -- this changes nothing.
 */
declare global {
  interface Window {
    __FODT_IMAGE_COLOR_EXTRACTOR_TEST_TIME_LIMIT_MS__?: number;
  }
}

function currentTimeLimitMs(): number {
  const testValue =
    typeof window !== 'undefined' ? window.__FODT_IMAGE_COLOR_EXTRACTOR_TEST_TIME_LIMIT_MS__ : undefined;
  return typeof testValue === 'number' && testValue > 0 ? testValue : IMAGE_TIME_LIMIT_MS;
}

/**
 * Extracts a picked file's dominant colours in the background worker,
 * resolving with the sniffed format, its dimensions, the file's size and
 * the extracted palette.
 *
 * Settlement is the point of this function: it resolves or rejects exactly
 * once, through the single guarded `settle` closure below, covering
 * success, an application-level error, a native worker failure, an
 * undeliverable message, an abort, a signal already aborted before this
 * function was called, and the time limit expiring -- every path
 * terminates the worker and removes every listener and timer this
 * function registered.
 */
export function extractColorsInWorker(
  file: File,
  options: { count: number; ignoreTransparent: boolean },
  ctx: RunContext,
): Promise<ExtractColorsResult> {
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<ExtractColorsResult>((resolve, reject) => {
    const worker = new ImageColorExtractorWorker();
    let settled = false;

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
      clearTimeout(timer);
    };

    type Outcome = { ok: true; value: ExtractColorsResult } | { ok: false; error: Error };

    const settle = (outcome: Outcome) => {
      if (settled) return;
      settled = true;
      try {
        removeListeners();
      } finally {
        worker.terminate();
      }
      if (outcome.ok) resolve(outcome.value);
      else reject(outcome.error);
    };

    const onMessage = (event: MessageEvent<ImageColorExtractorWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'image-color-extractor-done') {
        settle({
          ok: true,
          value: {
            type: data.format,
            width: data.width,
            height: data.height,
            fileSize: data.fileSize,
            colors: data.colors,
            sampled: data.sampled,
          },
        });
      } else if (data.type === 'image-color-extractor-error') {
        settle({ ok: false, error: new Error(data.message) });
      } else if (data.type === 'image-color-extractor-needs-page-canvas') {
        try {
          const { colors, sampled } = finishOnPageThread(data);
          settle({
            ok: true,
            value: {
              type: data.format,
              width: data.width,
              height: data.height,
              fileSize: data.fileSize,
              colors,
              sampled,
            },
          });
        } catch (err) {
          settle({ ok: false, error: err instanceof Error ? err : new Error(String(err)) });
        }
      }
    };

    // Native worker failure: the worker throws while its module is
    // initialising, so it never gets to post anything of its own.
    const onNativeError = () => {
      settle({ ok: false, error: new Error('The background task could not start.') });
    };

    // A message could not be delivered in either direction.
    const onMessageError = () => {
      settle({ ok: false, error: new Error('The background task could not start.') });
    };

    const onAbort = () => {
      settle({ ok: false, error: new Error('The run was cancelled.') });
    };

    const onTimeLimit = () => {
      settle({ ok: false, error: new Error(IMAGE_TIME_LIMIT_MESSAGE) });
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onNativeError);
    worker.addEventListener('messageerror', onMessageError);
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(onTimeLimit, currentTimeLimitMs());

    const job: ImageColorExtractorJobMessage = {
      type: 'image-color-extractor-job',
      file,
      count: options.count,
      ignoreTransparent: options.ignoreTransparent,
    };
    try {
      worker.postMessage(job);
    } catch {
      // postMessage throws synchronously when its argument cannot be
      // structured-cloned. The same fixed message as every other native
      // startup failure path, matching hash-file's own precedent.
      settle({ ok: false, error: new Error('The background task could not start.') });
    }
  });
}
