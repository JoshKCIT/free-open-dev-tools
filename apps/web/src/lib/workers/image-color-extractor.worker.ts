/**
 * Reads a picked file's header, refuses it before any real decoding if the
 * header check fails, and otherwise decodes it with the browser's own
 * image decoder, downscales it onto a canvas and extracts its dominant
 * colours -- all inside this worker, so the tab that constructed it stays
 * responsive and the file is never sent anywhere. All logic that checks a
 * header or quantises pixels lives in the tool package
 * (@fodt/image-color-extractor); this file only owns reading the file,
 * decoding it with browser APIs the package itself never names, and the
 * message protocol back to the page.
 *
 * Engine fallback (measured this session, not merely `[ASSUMED]`):
 * this worker's own browser decoder is available in every tested engine's
 * worker, but this project's tested WebKit build has no `OffscreenCanvas`
 * anywhere at all -- not in a worker, and, confirmed directly, not on the
 * main thread either. When this worker's own `OffscreenCanvas` check
 * fails, it hands the already-decoded bitmap to the page thread instead of
 * drawing it itself; the page (`run-image-color-extractor-in-worker.ts`)
 * finishes the drawing and sampling step there. See that file for why this
 * is still never a *visible* image: the canvas it draws into is never
 * inserted into the document.
 */
import {
  sniffImage,
  extractFromPixels,
  ImageColorError,
  type ImageFormat,
  type QuantizedColor,
} from '@fodt/image-color-extractor';

/** How many header bytes are read before any real decoding is attempted -- matches the package's own MAX_HEADER_BYTES intent without importing a browser-facing constant into the pure package. */
const HEADER_BYTES_TO_READ = 64 * 1024;

/** Neither the width nor the height of the canvas used for sampling ever exceeds this many pixels on its long side. */
export const MAX_CANVAS_LONG_SIDE = 256;

export interface ImageColorExtractorJobMessage {
  type: 'image-color-extractor-job';
  file: File;
  count: number;
  ignoreTransparent: boolean;
}

export interface ImageColorExtractorDoneMessage {
  type: 'image-color-extractor-done';
  format: ImageFormat;
  /** The image's own reported dimensions (from its header), not the downscaled sampling canvas. */
  width: number;
  height: number;
  fileSize: number;
  colors: QuantizedColor[];
  sampled: number;
}

export interface ImageColorExtractorErrorMessage {
  type: 'image-color-extractor-error';
  /** A plain description. Never the file's own contents. */
  message: string;
}

/**
 * Sent only when this worker has no `OffscreenCanvas` to draw with. The
 * decoded bitmap is transferred (not cloned, and not decoded again) so the
 * page thread can finish the one drawing-and-sampling step this worker
 * could not do itself.
 */
export interface ImageColorExtractorNeedsPageCanvasMessage {
  type: 'image-color-extractor-needs-page-canvas';
  bitmap: ImageBitmap;
  format: ImageFormat;
  width: number;
  height: number;
  fileSize: number;
  count: number;
  ignoreTransparent: boolean;
}

export type ImageColorExtractorWorkerMessage =
  ImageColorExtractorDoneMessage | ImageColorExtractorErrorMessage | ImageColorExtractorNeedsPageCanvasMessage;

/**
 * This project's tsconfig gives every file the DOM library but not the
 * worker library (see `hash-file.worker.ts`'s own identical note), so this
 * narrowing sidesteps the ambient global's wrong (window-shaped) type
 * rather than fighting it with a direct property assignment.
 */
interface WorkerGlobal {
  postMessage(message: ImageColorExtractorWorkerMessage, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<ImageColorExtractorJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

export function targetCanvasSize(
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

function hasOffscreenCanvas(): boolean {
  return typeof OffscreenCanvas !== 'undefined';
}

async function handleJob(job: ImageColorExtractorJobMessage): Promise<void> {
  let bitmap: ImageBitmap | undefined;
  let transferredOwnership = false;
  try {
    const headerSlice = job.file.slice(0, HEADER_BYTES_TO_READ);
    const headerBuffer = await headerSlice.arrayBuffer();
    const sniffed = sniffImage(new Uint8Array(headerBuffer), job.file.size);

    // The header passed every check above; only now is the file actually decoded.
    bitmap = await createImageBitmap(job.file);

    if (!hasOffscreenCanvas()) {
      const forThePage = bitmap;
      transferredOwnership = true;
      workerGlobal.postMessage(
        {
          type: 'image-color-extractor-needs-page-canvas',
          bitmap: forThePage,
          format: sniffed.type,
          width: sniffed.width,
          height: sniffed.height,
          fileSize: job.file.size,
          count: job.count,
          ignoreTransparent: job.ignoreTransparent,
        },
        [forThePage],
      );
      return;
    }

    const { targetWidth, targetHeight, downscaling } = targetCanvasSize(bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImageColorError('This browser could not provide a 2D drawing surface for this image.');
    // Smoothing helps when actually downscaling (it averages source pixels
    // into each destination pixel, which is what this tool wants for
    // colour sampling); it is switched off when no scaling happens at all,
    // since there is nothing to smooth and off is the more faithful default.
    ctx.imageSmoothingEnabled = downscaling;
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    const { data } = ctx.getImageData(0, 0, targetWidth, targetHeight);

    const { colors, sampled } = extractFromPixels(data, targetWidth, targetHeight, {
      count: job.count,
      ignoreTransparent: job.ignoreTransparent,
    });

    workerGlobal.postMessage({
      type: 'image-color-extractor-done',
      format: sniffed.type,
      width: sniffed.width,
      height: sniffed.height,
      fileSize: job.file.size,
      colors,
      sampled,
    });
  } catch (err) {
    workerGlobal.postMessage({
      type: 'image-color-extractor-error',
      message:
        err instanceof ImageColorError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'This image could not be read for an unknown reason.',
    });
  } finally {
    if (!transferredOwnership) bitmap?.close();
  }
}

workerGlobal.addEventListener('message', (event) => {
  void handleJob(event.data);
});
