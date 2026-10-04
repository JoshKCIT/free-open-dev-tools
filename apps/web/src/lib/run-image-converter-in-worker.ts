/**
 * The page-side helper that probes what this browser can really encode,
 * starts the image-conversion worker, forwards its progress to the run
 * context, enforces a stall limit and turns an abort into a real stop.
 *
 * A close copy of `run-in-worker.ts`'s settle contract (this project's
 * first worker page, `hash-file`), because that contract already covers
 * every way a background job can end -- success, an application-level
 * error the worker reports on purpose, a native worker failure, a message
 * that could not be delivered, an abort, and a signal already aborted
 * before this function was even called -- plus a stall limit reset on
 * every progress message, per this phase's own shared worker procedure
 * (BQ): a large legitimate conversion can take real time, so this is a
 * no-progress-for-20-seconds stall limit, not a fixed total time limit.
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
import ImageConverterWorker from './workers/image-converter.worker.ts?worker&inline';
import type {
  ImageConverterWorkerMessage,
  ImageConverterNeedsPageCanvasMessage,
} from './workers/image-converter.worker';
import {
  formatInfo,
  interpretEncodeResult,
  outputFileName,
  FILE_TOO_LARGE_MESSAGE,
  MAX_INPUT_BYTES,
  OUTPUT_FORMATS,
  planEdits,
  type ConvertOptions,
  type FileKind,
  type ImageEdits,
  type OutputFormatId,
} from '@fodt/image-converter';
import type { RunContext } from './tool-ui';

/**
 * At least 20,000 ms and at least three times the slowest single encode this
 * project measured: the slowest real encode across every tested engine (a
 * 40,000,000-pixel PNG on this project's tested WebKit build, taken through
 * its own page-thread fallback since that engine has no `OffscreenCanvas` in
 * a worker at all) was under one second, so the 20-second floor this
 * phase's shared procedure sets is already generous well beyond three times
 * that measurement.
 */
export const IMAGE_CONVERTER_STALL_LIMIT_MS = 20_000;

/**
 * A test-only affordance, read only when the browser test suite sets it
 * before the page loads, exactly like `hash-file`'s own
 * `__FODT_HASH_FILE_TEST_CHUNK_SIZE__`. It shortens the stall limit so a
 * forced-stop scenario can be proven in well under a second instead of
 * waiting out the real twenty-second production limit. Absent -- every real
 * visit -- this changes nothing.
 */
declare global {
  interface Window {
    __FODT_IMAGE_CONVERTER_TEST_STALL_MS__?: number;
    /**
     * An artificial pause the worker inserts after each of its three
     * progress stages, only ever set by the browser test suite before the
     * page loads. A real conversion finishes in well under a second even at
     * this project's own measured pixel ceiling, which would never leave a
     * test enough time to observe an in-flight run or click Cancel without
     * this. Absent -- every real visit -- this changes nothing.
     */
    __FODT_IMAGE_CONVERTER_TEST_STEP_DELAY_MS__?: number;
    __FODT_IMAGE_CONVERTER_TEST_HOOKS__?: {
      probeEncodersInWorker: typeof probeEncodersInWorker;
      convertImageInWorker: typeof convertImageInWorker;
    };
  }
}

function currentStallLimitMs(): number {
  const testValue = typeof window !== 'undefined' ? window.__FODT_IMAGE_CONVERTER_TEST_STALL_MS__ : undefined;
  return typeof testValue === 'number' && testValue > 0 ? testValue : IMAGE_CONVERTER_STALL_LIMIT_MS;
}

function currentTestStepDelayMs(): number | undefined {
  const testValue = typeof window !== 'undefined' ? window.__FODT_IMAGE_CONVERTER_TEST_STEP_DELAY_MS__ : undefined;
  return typeof testValue === 'number' && testValue > 0 ? testValue : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function encodeFailureMessage(requestedFormatId: OutputFormatId, substitutedType: string): string {
  const requested = OUTPUT_FORMATS.find((f) => f.id === requestedFormatId);
  const substituted = OUTPUT_FORMATS.find((f) => f.mediaType === substitutedType);
  const requestedLabel = requested?.label ?? requestedFormatId.toUpperCase();
  const substitutedLabel = substituted?.label ?? substitutedType;
  return `This browser cannot write ${requestedLabel} images. It would have given you a ${substitutedLabel} file instead, so nothing was written.`;
}

/**
 * Probes a plain `<canvas>` element on the page thread -- the fallback for
 * an engine with no `OffscreenCanvas` in a worker at all. The canvas this
 * function draws into is a local variable never appended to the document.
 */
function probeOnPageThread(): Promise<Record<string, string>> {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;
  const ctx = canvas.getContext('2d');
  const results: Record<string, string> = {};
  if (!ctx) return Promise.resolve(results);
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, 2, 2);

  const toBlobP = (type: string): Promise<Blob> =>
    new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('null blob'))), type);
    });

  return (async () => {
    for (const format of OUTPUT_FORMATS) {
      try {
        const blob = await toBlobP(format.mediaType);
        results[format.mediaType] = blob.type;
      } catch {
        results[format.mediaType] = '';
      }
    }
    return results;
  })();
}

/**
 * Draws an already-decoded bitmap and encodes it on the page thread -- the
 * fallback for an engine with no `OffscreenCanvas` anywhere, confirmed
 * necessary for this project's own tested WebKit build (see the worker's
 * own header comment). `document.createElement('canvas')` is used only
 * when `OffscreenCanvas` itself is unavailable on the main thread too;
 * either way the canvas this function draws into is a plain local
 * variable, never appended to the document, so the picked image is still
 * never shown -- the one property this tool actually requires, independent
 * of which canvas class happens to provide it on a given engine.
 */
async function finishOnPageThread(data: ImageConverterNeedsPageCanvasMessage): Promise<ConvertImageResult> {
  const { bitmap } = data;
  try {
    const hasOffscreen = typeof OffscreenCanvas !== 'undefined';
    let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    let toBlob: (type: string, quality?: number) => Promise<Blob>;

    if (hasOffscreen) {
      const canvas = new OffscreenCanvas(data.targetWidth, data.targetHeight);
      ctx = canvas.getContext('2d');
      toBlob = (type, quality) => canvas.convertToBlob(quality === undefined ? { type } : { type, quality });
    } else {
      const canvas = document.createElement('canvas'); // never appended to the document
      canvas.width = data.targetWidth;
      canvas.height = data.targetHeight;
      ctx = canvas.getContext('2d');
      toBlob = (type, quality) =>
        new Promise((resolve, reject) => {
          const cb = (b: Blob | null) =>
            b ? resolve(b) : reject(new Error('This browser could not encode the image.'));
          if (quality === undefined) canvas.toBlob(cb, type);
          else canvas.toBlob(cb, type, quality);
        });
    }
    if (!ctx) throw new Error('This browser could not provide a 2D drawing surface for this image.');
    ctx.imageSmoothingQuality = 'high';
    if (data.format === 'jpeg') {
      ctx.fillStyle = data.background;
      ctx.fillRect(0, 0, data.targetWidth, data.targetHeight);
    }
    ctx.drawImage(
      (data.edits ? drawEdited(bitmap, data.edits) : undefined) ?? bitmap,
      0,
      0,
      data.targetWidth,
      data.targetHeight,
    );
    // See the worker's own `testStepDelayMs` doc comment: an engine with no
    // `OffscreenCanvas` anywhere finishes this whole step here rather than
    // in the worker, so the same artificial test-only pause is honoured on
    // this path too, or a browser test could never observe an in-flight run
    // long enough to click Cancel on this engine.
    if (data.testStepDelayMs) await sleep(data.testStepDelayMs);

    const blob = await toBlob(data.mediaType, data.format === 'png' ? undefined : data.qualityFraction);
    const interpretation = interpretEncodeResult(data.mediaType, blob.type);
    if (!interpretation.ok) {
      throw new Error(encodeFailureMessage(data.format, interpretation.substitutedType!));
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    return {
      bytes,
      mediaType: data.mediaType,
      fileName: outputFileName(data.fileName, data.format),
      sourceKind: data.sourceKind,
      sourceWidth: data.sourceWidth,
      sourceHeight: data.sourceHeight,
      width: data.targetWidth,
      height: data.targetHeight,
      warnings: data.warnings,
    };
  } finally {
    bitmap.close();
  }
}

/**
 * Draws the cropped, turned and mirrored picture onto a canvas of the edited size (never attached to the document),
 * from the plan `planEdits` makes: the same function, on the same decoded size, as the worker's own drawing site.
 * Returns nothing when the edits change nothing, so the plain path is used. Every transform number is a whole number,
 * so each pixel is copied to its place and smoothing is off.
 */
function drawEdited(bitmap: ImageBitmap, edits: ImageEdits): CanvasImageSource | undefined {
  const plan = planEdits(bitmap.width, bitmap.height, edits);
  if (plan.identity) return undefined;
  let canvas: OffscreenCanvas | HTMLCanvasElement;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(plan.width, plan.height);
  } else {
    canvas = document.createElement('canvas');
    canvas.width = plan.width;
    canvas.height = plan.height;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not provide a 2D drawing surface for this image.');
  ctx.imageSmoothingEnabled = false;
  const [a, b, c, d, e, f] = plan.transform;
  ctx.setTransform(a, b, c, d, e, f);
  ctx.drawImage(
    bitmap,
    plan.source.x,
    plan.source.y,
    plan.source.width,
    plan.source.height,
    0,
    0,
    plan.source.width,
    plan.source.height,
  );
  return canvas;
}

/**
 * Encodes a canvas the page drew itself (the SVG path) to the chosen format and returns the file bytes. A canvas that
 * is never attached to the document is used by the caller; for JPEG, which has no transparency, the canvas is first
 * laid over the background colour. The same media-type check as every other encode in this file refuses a browser that
 * would hand back another format under the requested name.
 */
export async function encodeCanvasOnPage(
  canvas: HTMLCanvasElement,
  format: OutputFormatId,
  qualityFraction: number,
  background: string,
): Promise<{ bytes: Uint8Array; mediaType: string }> {
  const info = formatInfo(format);
  let surface = canvas;
  if (format === 'jpeg') {
    const flat = document.createElement('canvas'); // never appended to the document
    flat.width = canvas.width;
    flat.height = canvas.height;
    const flatContext = flat.getContext('2d');
    if (!flatContext) throw new Error('This browser could not provide a 2D drawing surface for this image.');
    flatContext.fillStyle = background;
    flatContext.fillRect(0, 0, flat.width, flat.height);
    flatContext.drawImage(canvas, 0, 0);
    surface = flat;
  }
  const blob = await new Promise<Blob>((resolve, reject) => {
    const done = (b: Blob | null) => (b ? resolve(b) : reject(new Error('This browser could not encode the image.')));
    if (format === 'png') surface.toBlob(done, info.mediaType);
    else surface.toBlob(done, info.mediaType, qualityFraction);
  });
  const interpretation = interpretEncodeResult(info.mediaType, blob.type);
  if (!interpretation.ok) throw new Error(encodeFailureMessage(format, interpretation.substitutedType!));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mediaType: info.mediaType };
}

/** Cached for the lifetime of the page: the answer never changes between runs, and probing again on every run would waste a worker round trip. */
let cachedProbe: Promise<Record<OutputFormatId, boolean>> | null = null;

function toWritableMap(results: Record<string, string>): Record<OutputFormatId, boolean> {
  const out = {} as Record<OutputFormatId, boolean>;
  for (const format of OUTPUT_FORMATS) {
    const returned = results[format.mediaType];
    out[format.id] = returned !== undefined && returned !== '' && interpretEncodeResult(format.mediaType, returned).ok;
  }
  return out;
}

/**
 * Reports which of the four output formats this browser can really write,
 * judged by the media type a real encode of a tiny canvas actually returns.
 * Cached per page session: call this as many times as convenient, it only
 * ever probes once.
 */
export function probeEncodersInWorker(): Promise<Record<OutputFormatId, boolean>> {
  if (cachedProbe) return cachedProbe;
  cachedProbe = new Promise<Record<OutputFormatId, boolean>>((resolve) => {
    const worker = new ImageConverterWorker();
    let settled = false;
    const finish = (results: Record<string, string>) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      resolve(toWritableMap(results));
    };
    worker.addEventListener('message', (event: MessageEvent<ImageConverterWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'image-converter-probe-done') {
        finish(data.results);
      } else if (data.type === 'image-converter-probe-needs-page') {
        probeOnPageThread()
          .then(finish)
          .catch(() => finish({}));
      }
    });
    worker.addEventListener('error', () =>
      probeOnPageThread()
        .then(finish)
        .catch(() => finish({})),
    );
    worker.addEventListener('messageerror', () =>
      probeOnPageThread()
        .then(finish)
        .catch(() => finish({})),
    );
    try {
      worker.postMessage({ type: 'image-converter-probe' });
    } catch {
      probeOnPageThread()
        .then(finish)
        .catch(() => finish({}));
    }
  });
  return cachedProbe;
}

export interface ConvertImageResult {
  bytes: Uint8Array;
  mediaType: string;
  fileName: string;
  sourceKind: FileKind;
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  warnings: string[];
}

/**
 * Converts a picked file in the background worker, resolving with the
 * output bytes, its media type and dimensions, and the download file name.
 *
 * Settlement is the point of this function: it resolves or rejects exactly
 * once, through the single guarded `settle` closure below, covering
 * success, an application-level error, a native worker failure, an
 * undeliverable message, an abort, a signal already aborted before this
 * function was called, and a stall (no progress message for the current
 * stall limit) -- every path terminates the worker and removes every
 * listener and timer this function registered.
 */
export function convertImageInWorker(
  file: File,
  options: ConvertOptions,
  ctx: RunContext,
): Promise<ConvertImageResult> {
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }
  // The file's own reported size is checked before anything is read, so a huge file is never copied into memory.
  if (file.size > MAX_INPUT_BYTES) {
    return Promise.reject(new Error(FILE_TOO_LARGE_MESSAGE));
  }

  return new Promise<ConvertImageResult>((resolve, reject) => {
    const worker = new ImageConverterWorker();
    let settled = false;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
      if (stallTimer) clearTimeout(stallTimer);
    };

    type Outcome = { ok: true; value: ConvertImageResult } | { ok: false; error: Error };

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

    const resetStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      const limit = currentStallLimitMs();
      stallTimer = setTimeout(() => {
        settle({
          ok: false,
          error: new Error(
            `Stopped: no progress for ${Math.round(limit / 1000)} seconds. This image is taking too long to convert.`,
          ),
        });
      }, limit);
    };

    const onMessage = (event: MessageEvent<ImageConverterWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'image-converter-progress') {
        resetStallTimer();
        ctx.onProgress?.(data.fraction, data.detail);
      } else if (data.type === 'image-converter-done') {
        settle({
          ok: true,
          value: {
            bytes: new Uint8Array(data.bytes),
            mediaType: data.mediaType,
            fileName: data.fileName,
            sourceKind: data.sourceKind,
            sourceWidth: data.sourceWidth,
            sourceHeight: data.sourceHeight,
            width: data.width,
            height: data.height,
            warnings: data.warnings,
          },
        });
      } else if (data.type === 'image-converter-error') {
        settle({ ok: false, error: new Error(data.message) });
      } else if (data.type === 'image-converter-needs-page-canvas') {
        finishOnPageThread(data)
          .then((value) => settle({ ok: true, value }))
          .catch((err) => settle({ ok: false, error: err instanceof Error ? err : new Error(String(err)) }));
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

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onNativeError);
    worker.addEventListener('messageerror', onMessageError);
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    resetStallTimer(); // the clock starts immediately, not only after the first progress message

    file
      .arrayBuffer()
      .then((bytes) => {
        if (settled) return;
        try {
          worker.postMessage(
            {
              type: 'image-converter-job',
              bytes,
              fileName: file.name,
              options,
              testStepDelayMs: currentTestStepDelayMs(),
            },
            [bytes],
          );
        } catch {
          // postMessage throws synchronously when its argument cannot be
          // structured-cloned. The same fixed message as every other native
          // startup failure path, matching hash-file's own precedent.
          settle({ ok: false, error: new Error('The background task could not start.') });
        }
      })
      .catch(() => {
        settle({ ok: false, error: new Error(`Could not read '${file.name}'.`) });
      });
  });
}

if (typeof window !== 'undefined') {
  window.__FODT_IMAGE_CONVERTER_TEST_HOOKS__ = { probeEncodersInWorker, convertImageInWorker };
}
