/**
 * The page-side helper that starts the image-to-PDF worker, forwards its
 * progress to the run context, enforces a stall limit, turns an abort into
 * a real stop, and finishes a GIF/WebP/BMP-to-PNG conversion on the page
 * thread when the worker has no `OffscreenCanvas` at all (the WebKit
 * fallback `run-image-converter-in-worker.ts` already established).
 */
import ImageToPdfWorker from './workers/image-to-pdf.worker.ts?worker&inline';
import type { ImageToPdfWorkerMessage, ImageToPdfJobMessage } from './workers/image-to-pdf.worker';
import type { ImagesToPdfOptions } from '@fodt/image-to-pdf';
import type { RunContext } from './tool-ui';

export const IMAGE_TO_PDF_STALL_LIMIT_MS = 20_000;

declare global {
  interface Window {
    __FODT_IMAGE_TO_PDF_TEST_CHUNK_SIZE__?: number;
    __FODT_IMAGE_TO_PDF_TEST_STALL_MS__?: number;
    __FODT_IMAGE_TO_PDF_TEST_HOOKS__?: { runImageToPdfInWorker: typeof runImageToPdfInWorker };
  }
}

function currentChunkSize(): number {
  const testValue = typeof window !== 'undefined' ? window.__FODT_IMAGE_TO_PDF_TEST_CHUNK_SIZE__ : undefined;
  return typeof testValue === 'number' && testValue > 0 ? testValue : 4 * 1024 * 1024;
}

function currentStallLimitMs(): number {
  const testValue = typeof window !== 'undefined' ? window.__FODT_IMAGE_TO_PDF_TEST_STALL_MS__ : undefined;
  return typeof testValue === 'number' && testValue > 0 ? testValue : IMAGE_TO_PDF_STALL_LIMIT_MS;
}

export interface ImageToPdfRunResult {
  bytes: Uint8Array;
  pages: { name: string; pageWidth: number; pageHeight: number; placedAt: string; note?: string }[];
  warnings: string[];
}

/**
 * Draws an already-decoded bitmap on the page thread and encodes it to PNG
 * -- the fallback for an engine with no `OffscreenCanvas` anywhere. The
 * canvas here is a plain local variable, never appended to the document, so
 * the picked image is still never shown.
 */
async function convertBitmapOnPageThread(bitmap: ImageBitmap): Promise<ArrayBuffer> {
  try {
    const canvas = document.createElement('canvas'); // never appended to the document
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser could not provide a 2D drawing surface for this image.');
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('This browser could not encode this image as PNG.'))),
        'image/png',
      );
    });
    if (blob.type !== 'image/png') {
      throw new Error('This browser could not encode this image as PNG.');
    }
    return await blob.arrayBuffer();
  } finally {
    bitmap.close();
  }
}

export function runImageToPdfInWorker(
  files: File[],
  options: ImagesToPdfOptions,
  ctx: RunContext,
): Promise<ImageToPdfRunResult> {
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<ImageToPdfRunResult>((resolve, reject) => {
    const worker = new ImageToPdfWorker();
    let settled = false;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
      if (stallTimer) clearTimeout(stallTimer);
    };

    type Outcome = { ok: true; value: ImageToPdfRunResult } | { ok: false; error: Error };

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
            `Stopped: no progress for ${Math.round(limit / 1000)} seconds. These files are taking too long to process.`,
          ),
        });
      }, limit);
    };

    const onMessage = (event: MessageEvent<ImageToPdfWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'image-to-pdf-progress') {
        resetStallTimer();
        ctx.onProgress?.(data.fraction, data.detail);
      } else if (data.type === 'image-to-pdf-done') {
        settle({ ok: true, value: { bytes: new Uint8Array(data.bytes), pages: data.pages, warnings: data.warnings } });
      } else if (data.type === 'image-to-pdf-error') {
        settle({ ok: false, error: new Error(data.message) });
      } else if (data.type === 'image-to-pdf-needs-page-canvas') {
        resetStallTimer();
        const { bitmap, requestId } = data;
        convertBitmapOnPageThread(bitmap)
          .then((bytes) => {
            if (!settled) worker.postMessage({ type: 'image-to-pdf-page-canvas-result', requestId, bytes }, [bytes]);
          })
          .catch((err: unknown) => {
            if (!settled) {
              worker.postMessage({
                type: 'image-to-pdf-page-canvas-result',
                requestId,
                error: err instanceof Error ? err.message : 'This image could not be converted.',
              });
            }
          });
      }
    };

    const onNativeError = () => settle({ ok: false, error: new Error('The background task could not start.') });
    const onMessageError = () => settle({ ok: false, error: new Error('The background task could not start.') });
    const onAbort = () => settle({ ok: false, error: new Error('The run was cancelled.') });

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onNativeError);
    worker.addEventListener('messageerror', onMessageError);
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    resetStallTimer();

    const job: ImageToPdfJobMessage = { type: 'image-to-pdf-job', files, options, chunkSize: currentChunkSize() };
    try {
      worker.postMessage(job);
    } catch {
      settle({ ok: false, error: new Error('The background task could not start.') });
    }
  });
}

if (typeof window !== 'undefined') {
  window.__FODT_IMAGE_TO_PDF_TEST_HOOKS__ = { runImageToPdfInWorker };
}
