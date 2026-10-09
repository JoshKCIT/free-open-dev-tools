/**
 * Reads every picked image in fixed-size slices (progress per slice),
 * converts GIF, WebP and BMP inputs to PNG with the browser's own decoder
 * and canvas (the encoded `Blob`'s own `type` is checked, since an
 * engine can silently substitute a different format rather than fail), and
 * places the result with `@fodt/image-to-pdf` -- all inside this worker, so
 * the tab that constructed it stays responsive and the files are never sent
 * anywhere.
 *
 * Engine fallback (matching 08-09's `image-color-extractor` and 09-03's
 * `image-converter` identical finding, not merely assumed): this project's
 * tested WebKit build has no `OffscreenCanvas` anywhere at all, including
 * in a worker. When this worker's own `OffscreenCanvas` check fails, it
 * hands the already-decoded bitmap to the page thread instead
 * (`run-image-to-pdf-in-worker.ts` finishes the conversion there, on a
 * canvas that is never inserted into the document).
 */
import {
  imagesToPdf,
  assertFileKind,
  ImageToPdfError,
  FileSignatureError,
  type ImagesToPdfOptions,
  type ImageInput,
} from '@fodt/image-to-pdf';

const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 100_000_000;

export interface ImageToPdfJobMessage {
  type: 'image-to-pdf-job';
  files: File[];
  options: ImagesToPdfOptions;
  chunkSize: number;
}

export type ImageToPdfInboundMessage = ImageToPdfJobMessage;

export interface ImageToPdfProgressMessage {
  type: 'image-to-pdf-progress';
  fraction: number;
  detail: string;
}

export interface ImageToPdfDoneMessage {
  type: 'image-to-pdf-done';
  bytes: ArrayBuffer;
  pages: { name: string; pageWidth: number; pageHeight: number; placedAt: string; note?: string }[];
  warnings: string[];
}

export interface ImageToPdfErrorMessage {
  type: 'image-to-pdf-error';
  message: string;
}

/** Sent only when this worker has no `OffscreenCanvas` to convert with. */
export interface ImageToPdfNeedsPageCanvasMessage {
  type: 'image-to-pdf-needs-page-canvas';
  bitmap: ImageBitmap;
  requestId: number;
}

/** The page's own reply to `ImageToPdfNeedsPageCanvasMessage`, matched by `requestId`. */
export interface ImageToPdfPageCanvasResultMessage {
  type: 'image-to-pdf-page-canvas-result';
  requestId: number;
  bytes?: ArrayBuffer;
  error?: string;
}

export type ImageToPdfWorkerMessage =
  ImageToPdfProgressMessage | ImageToPdfDoneMessage | ImageToPdfErrorMessage | ImageToPdfNeedsPageCanvasMessage;

type ImageToPdfWorkerInbound = ImageToPdfInboundMessage | ImageToPdfPageCanvasResultMessage;

interface WorkerGlobal {
  postMessage(message: ImageToPdfWorkerMessage, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<ImageToPdfWorkerInbound>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

const FALLBACK_CHUNK_SIZE = 4 * 1024 * 1024;

async function readFileInSlices(
  file: File,
  chunkSize: number,
  onProgress: (fraction: number, detail: string) => void,
): Promise<Uint8Array> {
  const total = file.size;
  const out = new Uint8Array(total);
  let offset = 0;
  while (offset < total) {
    const end = Math.min(offset + chunkSize, total);
    const reader = file.slice(offset, end).stream().getReader();
    let sliceOffset = offset;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out.set(value, sliceOffset);
      sliceOffset += value.length;
    }
    offset = end;
    const fraction = total === 0 ? 1 : offset / total;
    onProgress(fraction, `${Math.round(fraction * 100)}% of ${file.name} read`);
  }
  return out;
}

let nextRequestId = 1;
const pending = new Map<number, { resolve: (bytes: Uint8Array) => void; reject: (err: Error) => void }>();

workerGlobal.addEventListener('message', (event) => {
  const data = event.data;
  if (data.type === 'image-to-pdf-page-canvas-result') {
    const waiter = pending.get(data.requestId);
    if (!waiter) return;
    pending.delete(data.requestId);
    if (data.error) waiter.reject(new Error(data.error));
    else waiter.resolve(new Uint8Array(data.bytes!));
  }
});

/** Asks the page thread to convert an already-decoded bitmap to PNG (the WebKit-no-OffscreenCanvas fallback). */
function convertOnPageThread(bitmap: ImageBitmap): Promise<Uint8Array> {
  const requestId = nextRequestId++;
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    workerGlobal.postMessage({ type: 'image-to-pdf-needs-page-canvas', bitmap, requestId }, [bitmap]);
  });
}

/**
 * Converts a GIF, WebP or BMP image to PNG with `createImageBitmap` and a
 * canvas. `OffscreenCanvas`, when this worker has one, does the drawing and
 * encoding here; otherwise the already-decoded bitmap is handed to the page
 * thread (`convertOnPageThread`), never drawn or shown anywhere either way.
 */
async function convertToPng(bytes: Uint8Array, mimeType: string): Promise<Uint8Array> {
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([arrayBuffer], { type: mimeType });
  const bitmap = await createImageBitmap(blob);
  if (typeof OffscreenCanvas === 'undefined') {
    return convertOnPageThread(bitmap);
  }
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser could not provide a 2D drawing surface for this image.');
    ctx.drawImage(bitmap, 0, 0);
    const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
    // An engine can silently substitute a different format rather
    // than fail; the returned Blob's own `type` is what tells the truth.
    if (pngBlob.type !== 'image/png') {
      throw new Error('This browser could not encode this image as PNG.');
    }
    return new Uint8Array(await pngBlob.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

const MIME_BY_KIND: Record<string, string> = { gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };

async function handleJob(job: ImageToPdfJobMessage): Promise<void> {
  try {
    const totalBytes = job.files.reduce((sum, f) => sum + f.size, 0) || 1;
    let bytesReadSoFar = 0;
    const inputs: ImageInput[] = [];
    for (const file of job.files) {
      const bytes = await readFileInSlices(file, job.chunkSize, (fraction) => {
        const overall = ((bytesReadSoFar + fraction * file.size) / totalBytes) * 0.6;
        workerGlobal.postMessage({ type: 'image-to-pdf-progress', fraction: overall, detail: `Reading ${file.name}` });
      });
      bytesReadSoFar += file.size;

      const sniff = assertFileKind(bytes, ['png', 'jpeg', 'gif', 'webp', 'bmp'], {
        maxBytes: MAX_IMAGE_BYTES,
        maxPixels: MAX_IMAGE_PIXELS,
      });

      if (sniff.kind === 'png' || sniff.kind === 'jpeg') {
        inputs.push({ name: file.name, bytes, kind: sniff.kind });
      } else {
        workerGlobal.postMessage({ type: 'image-to-pdf-progress', fraction: 0.6, detail: `Converting ${file.name}` });
        const pngBytes = await convertToPng(bytes, MIME_BY_KIND[sniff.kind]!);
        inputs.push({ name: file.name, bytes: pngBytes, kind: 'png', convertedFrom: sniff.kind });
      }
    }

    const result = await imagesToPdf(inputs, job.options, {
      onProgress: (fraction, detail) => {
        workerGlobal.postMessage({ type: 'image-to-pdf-progress', fraction: 0.6 + fraction * 0.4, detail });
      },
    });

    const owned = result.bytes.buffer.slice(
      result.bytes.byteOffset,
      result.bytes.byteOffset + result.bytes.byteLength,
    ) as ArrayBuffer;
    workerGlobal.postMessage(
      { type: 'image-to-pdf-done', bytes: owned, pages: result.pages, warnings: result.warnings },
      [owned],
    );
  } catch (err) {
    const message =
      err instanceof ImageToPdfError || err instanceof FileSignatureError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'These images could not be placed into a PDF for an unknown reason.';
    workerGlobal.postMessage({ type: 'image-to-pdf-error', message });
  }
}

workerGlobal.addEventListener('message', (event) => {
  if (event.data.type !== 'image-to-pdf-job') return;
  const job = event.data;
  void handleJob({ ...job, chunkSize: job.chunkSize > 0 ? job.chunkSize : FALLBACK_CHUNK_SIZE });
});
