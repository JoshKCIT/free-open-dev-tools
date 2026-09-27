/**
 * Reads a picked image's header, refuses it before any real decoding if the
 * header check or the planned output size fails, and otherwise decodes it
 * with the browser's own image decoder, draws it at the planned size and
 * encodes it to the requested format -- all inside this worker, so the tab
 * that constructed it stays responsive and the file is never sent anywhere.
 * All logic that plans a conversion or interprets an encode result lives in
 * the tool package (@fodt/image-converter); this file only owns decoding,
 * drawing and encoding with browser APIs the package itself never names,
 * and the message protocol back to the page.
 *
 * Engine fallback (measured this session, matching 08-09's identical
 * `image-color-extractor` finding, not merely assumed): this project's
 * tested WebKit build has no `OffscreenCanvas` anywhere at all, including in
 * a worker. When this worker's own `OffscreenCanvas` check fails, it hands
 * the already-decoded bitmap and the rest of the plan to the page thread
 * instead of drawing and encoding itself; the page
 * (`run-image-converter-in-worker.ts`) finishes the drawing and encoding
 * step there, on a canvas that is never inserted into the document, so a
 * picked image is still never shown, independent of which canvas class a
 * given engine happens to support. The same fallback applies to the
 * capability probe: an engine with no `OffscreenCanvas` in a worker asks the
 * page to probe on its own thread instead, which every tested engine's
 * plain `<canvas>` element can do.
 */
import {
  planConversion,
  outputFileName,
  interpretEncodeResult,
  OUTPUT_FORMATS,
  ImageConverterError,
  FileSignatureError,
  MAX_HEADER_BYTES,
  planSize,
  largestFittingSize,
  MAX_OUTPUT_PIXELS,
  type ConvertOptions,
  type FileKind,
  type OutputFormatId,
} from '@fodt/image-converter';

export interface ImageConverterProbeMessage {
  type: 'image-converter-probe';
}

export interface ImageConverterJobMessage {
  type: 'image-converter-job';
  bytes: ArrayBuffer;
  fileName: string;
  options: ConvertOptions;
  /**
   * A test-only affordance: an artificial pause after each of the three
   * progress stages (decode, draw, encode), so the browser test suite can
   * reliably observe an in-flight run and click Cancel before a real
   * conversion -- which finishes in well under a second even at this
   * project's own measured 40,000,000-pixel ceiling -- would otherwise ever
   * give it the chance to. Absent (every real run), this changes nothing.
   */
  testStepDelayMs?: number;
}

export type ImageConverterInboundMessage = ImageConverterProbeMessage | ImageConverterJobMessage;

export interface ImageConverterProbeDoneMessage {
  type: 'image-converter-probe-done';
  /** Requested media type to the media type a real encode of a 2 by 2 canvas actually returned. */
  results: Record<string, string>;
}

/** Sent only when this worker has no `OffscreenCanvas` to probe with. */
export interface ImageConverterProbeNeedsPageMessage {
  type: 'image-converter-probe-needs-page';
}

export interface ImageConverterProgressMessage {
  type: 'image-converter-progress';
  fraction: number;
  detail: string;
}

export interface ImageConverterDoneMessage {
  type: 'image-converter-done';
  bytes: ArrayBuffer;
  mediaType: string;
  fileName: string;
  sourceKind: FileKind;
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  warnings: string[];
}

export interface ImageConverterErrorMessage {
  type: 'image-converter-error';
  /** A plain description. Never the file's own contents. */
  message: string;
}

/**
 * Sent only when this worker has no `OffscreenCanvas` to draw with. The
 * decoded bitmap is transferred (not cloned, and not decoded again) so the
 * page thread can finish the one drawing-and-encoding step this worker
 * could not do itself.
 */
export interface ImageConverterNeedsPageCanvasMessage {
  type: 'image-converter-needs-page-canvas';
  bitmap: ImageBitmap;
  fileName: string;
  sourceKind: FileKind;
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  format: OutputFormatId;
  mediaType: string;
  qualityFraction: number;
  background: string;
  warnings: string[];
  /** Forwarded from the job message; see its own doc comment. */
  testStepDelayMs?: number;
}

export type ImageConverterWorkerMessage =
  | ImageConverterProbeDoneMessage
  | ImageConverterProbeNeedsPageMessage
  | ImageConverterProgressMessage
  | ImageConverterDoneMessage
  | ImageConverterErrorMessage
  | ImageConverterNeedsPageCanvasMessage;

/**
 * This project's tsconfig gives every file the DOM library but not the
 * worker library (see `hash-file.worker.ts`'s own identical note), so this
 * narrowing sidesteps the ambient global's wrong (window-shaped) type
 * rather than fighting it with a direct property assignment.
 */
interface WorkerGlobal {
  postMessage(message: ImageConverterWorkerMessage, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<ImageConverterInboundMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

function hasOffscreenCanvas(): boolean {
  return typeof OffscreenCanvas !== 'undefined';
}

const MEDIA_TYPES: Record<FileKind, string | undefined> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  pdf: undefined,
  zip: undefined,
  gzip: undefined,
  tar: undefined,
};

async function handleProbe(): Promise<void> {
  if (!hasOffscreenCanvas()) {
    workerGlobal.postMessage({ type: 'image-converter-probe-needs-page' });
    return;
  }
  const canvas = new OffscreenCanvas(2, 2);
  const ctx = canvas.getContext('2d');
  const results: Record<string, string> = {};
  if (ctx) {
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 2, 2);
    for (const format of OUTPUT_FORMATS) {
      try {
        const blob = await canvas.convertToBlob({ type: format.mediaType });
        results[format.mediaType] = blob.type;
      } catch {
        results[format.mediaType] = '';
      }
    }
  }
  workerGlobal.postMessage({ type: 'image-converter-probe-done', results });
}

function encodeFailureMessage(requestedFormatId: OutputFormatId, substitutedType: string): string {
  const requested = OUTPUT_FORMATS.find((f) => f.id === requestedFormatId);
  const substituted = OUTPUT_FORMATS.find((f) => f.mediaType === substitutedType);
  const requestedLabel = requested?.label ?? requestedFormatId.toUpperCase();
  const substitutedLabel = substituted?.label ?? substitutedType;
  return `This browser cannot write ${requestedLabel} images. It would have given you a ${substitutedLabel} file instead, so nothing was written.`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleJob(job: ImageConverterJobMessage): Promise<void> {
  let bitmap: ImageBitmap | undefined;
  let transferredOwnership = false;
  const stepDelay = job.testStepDelayMs;
  try {
    const headerBytes = new Uint8Array(job.bytes, 0, Math.min(job.bytes.byteLength, MAX_HEADER_BYTES));
    const plan = planConversion(headerBytes, job.fileName, job.options);

    const blob = new Blob([job.bytes], { type: MEDIA_TYPES[plan.sourceKind] ?? '' });
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    workerGlobal.postMessage({ type: 'image-converter-progress', fraction: 1 / 3, detail: 'Decoded' });
    if (stepDelay) await sleep(stepDelay);

    // A JPEG's own SOF marker (what planConversion's header check reads)
    // always states its raw encoded rectangle, never an EXIF-rotated
    // display size; `imageOrientation: 'from-image'` above already swapped
    // `bitmap.width`/`bitmap.height` for an orientation that rotates 90
    // degrees (EXIF values 5 to 8). When that happened, the plan's own
    // target size (computed from the un-rotated header dimensions) is
    // wrong, so it is replanned here against the bitmap's own real,
    // already-corrected size before anything is drawn.
    let sourceWidth = plan.sourceWidth;
    let sourceHeight = plan.sourceHeight;
    let targetWidth = plan.targetWidth;
    let targetHeight = plan.targetHeight;
    let warnings = plan.warnings;
    if (bitmap.width !== plan.sourceWidth || bitmap.height !== plan.sourceHeight) {
      sourceWidth = bitmap.width;
      sourceHeight = bitmap.height;
      const resized = planSize({ width: sourceWidth, height: sourceHeight }, job.options.resize);
      targetWidth = resized.width;
      targetHeight = resized.height;
      warnings = [...warnings, ...resized.warnings];
      if (targetWidth * targetHeight > MAX_OUTPUT_PIXELS) {
        const largest = largestFittingSize(targetWidth, targetHeight, MAX_OUTPUT_PIXELS);
        throw new ImageConverterError(
          `Could not convert '${job.fileName}': the requested output is ${targetWidth} by ${targetHeight} pixels, ` +
            `above this browser's own ${MAX_OUTPUT_PIXELS.toLocaleString('en-US')}-pixel limit. The largest size ` +
            `that fits is ${largest.width} by ${largest.height}.`,
        );
      }
    }

    if (!hasOffscreenCanvas()) {
      const forThePage = bitmap;
      transferredOwnership = true;
      workerGlobal.postMessage(
        {
          type: 'image-converter-needs-page-canvas',
          bitmap: forThePage,
          fileName: job.fileName,
          sourceKind: plan.sourceKind,
          sourceWidth,
          sourceHeight,
          targetWidth,
          targetHeight,
          format: plan.format,
          mediaType: plan.mediaType,
          qualityFraction: plan.qualityFraction,
          background: plan.background,
          warnings,
          testStepDelayMs: stepDelay,
        },
        [forThePage],
      );
      return;
    }

    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImageConverterError('This browser could not provide a 2D drawing surface for this image.');
    ctx.imageSmoothingQuality = 'high';
    if (plan.format === 'jpeg') {
      // JPEG has no transparency of its own: paint the chosen background
      // first so a transparent source composites onto it, matching the
      // warning planConversion already added to the plan.
      ctx.fillStyle = plan.background;
      ctx.fillRect(0, 0, targetWidth, targetHeight);
    }
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    workerGlobal.postMessage({ type: 'image-converter-progress', fraction: 2 / 3, detail: 'Resized' });
    if (stepDelay) await sleep(stepDelay);

    const encodeOptions =
      plan.format === 'png' ? { type: plan.mediaType } : { type: plan.mediaType, quality: plan.qualityFraction };
    const outputBlob = await canvas.convertToBlob(encodeOptions);
    workerGlobal.postMessage({ type: 'image-converter-progress', fraction: 1, detail: 'Encoded' });
    if (stepDelay) await sleep(stepDelay);

    const interpretation = interpretEncodeResult(plan.mediaType, outputBlob.type);
    if (!interpretation.ok) {
      throw new ImageConverterError(encodeFailureMessage(plan.format, interpretation.substitutedType!));
    }

    const outputBytes = await outputBlob.arrayBuffer();
    workerGlobal.postMessage(
      {
        type: 'image-converter-done',
        bytes: outputBytes,
        mediaType: plan.mediaType,
        fileName: outputFileName(job.fileName, plan.format),
        sourceKind: plan.sourceKind,
        sourceWidth,
        sourceHeight,
        width: targetWidth,
        height: targetHeight,
        warnings,
      },
      [outputBytes],
    );
  } catch (err) {
    workerGlobal.postMessage({
      type: 'image-converter-error',
      message:
        err instanceof ImageConverterError || err instanceof FileSignatureError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'This image could not be converted for an unknown reason.',
    });
  } finally {
    if (!transferredOwnership) bitmap?.close();
  }
}

workerGlobal.addEventListener('message', (event) => {
  if (event.data.type === 'image-converter-probe') {
    void handleProbe();
  } else {
    void handleJob(event.data);
  }
});
