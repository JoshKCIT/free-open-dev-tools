/**
 * The page-side helper that starts the PDF-merging worker, forwards its
 * progress to the run context, enforces a stall limit and turns an abort
 * into a real stop. A close copy of `run-exif-viewer-in-worker.ts`'s own
 * settle-once-plus-stall-limit contract (BQ).
 *
 * Imports the worker with the build-time inlining suffix, not the
 * URL-and-constructor form, for the same reason `run-in-worker.ts`
 * documents: the default form emits the worker as a separately fetched
 * file, and because the worker is constructed when the visitor presses Run,
 * that fetch would land inside the window the privacy harness records.
 */
import PdfMergeWorker from './workers/pdf-merge.worker.ts?worker&inline';
import type { PdfMergeWorkerMessage, PdfMergeJobMessage } from './workers/pdf-merge.worker';
import type { MergeOptions, MergePart } from '@fodt/pdf-merge';
import type { RunContext } from './tool-ui';

/** Carries the page-list position back to the page, when the worker's error named one (a PdfMergeError). */
export class PdfMergeRunError extends Error {
  readonly fileName?: string;
  readonly position?: number;
  constructor(message: string, fileName?: string, position?: number) {
    super(message);
    this.name = 'PdfMergeRunError';
    this.fileName = fileName;
    this.position = position;
  }
}

/** 20,000 ms, this phase's own shared floor (BQ). */
export const PDF_MERGE_STALL_LIMIT_MS = 20_000;

declare global {
  interface Window {
    __FODT_PDF_MERGE_TEST_CHUNK_SIZE__?: number;
    __FODT_PDF_MERGE_TEST_STALL_MS__?: number;
    __FODT_PDF_MERGE_TEST_HOOKS__?: { runPdfMergeInWorker: typeof runPdfMergeInWorker };
  }
}

function currentChunkSize(): number {
  const testValue = typeof window !== 'undefined' ? window.__FODT_PDF_MERGE_TEST_CHUNK_SIZE__ : undefined;
  return typeof testValue === 'number' && testValue > 0 ? testValue : 4 * 1024 * 1024;
}

function currentStallLimitMs(): number {
  const testValue = typeof window !== 'undefined' ? window.__FODT_PDF_MERGE_TEST_STALL_MS__ : undefined;
  return typeof testValue === 'number' && testValue > 0 ? testValue : PDF_MERGE_STALL_LIMIT_MS;
}

export interface PdfMergeRunResult {
  bytes: Uint8Array;
  pageCount: number;
  parts: MergePart[];
  warnings: string[];
}

export function runPdfMergeInWorker(
  files: File[],
  pages: string[],
  options: MergeOptions,
  ctx: RunContext,
): Promise<PdfMergeRunResult> {
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<PdfMergeRunResult>((resolve, reject) => {
    const worker = new PdfMergeWorker();
    let settled = false;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
      if (stallTimer) clearTimeout(stallTimer);
    };

    type Outcome = { ok: true; value: PdfMergeRunResult } | { ok: false; error: Error };

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

    const onMessage = (event: MessageEvent<PdfMergeWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'pdf-merge-progress') {
        resetStallTimer();
        ctx.onProgress?.(data.fraction, data.detail);
      } else if (data.type === 'pdf-merge-done') {
        settle({
          ok: true,
          value: {
            bytes: new Uint8Array(data.bytes),
            pageCount: data.pageCount,
            parts: data.parts,
            warnings: data.warnings,
          },
        });
      } else if (data.type === 'pdf-merge-error') {
        settle({ ok: false, error: new PdfMergeRunError(data.message, data.fileName, data.position) });
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

    const job: PdfMergeJobMessage = { type: 'pdf-merge-job', files, pages, options, chunkSize: currentChunkSize() };
    try {
      worker.postMessage(job);
    } catch {
      settle({ ok: false, error: new Error('The background task could not start.') });
    }
  });
}

if (typeof window !== 'undefined') {
  window.__FODT_PDF_MERGE_TEST_HOOKS__ = { runPdfMergeInWorker };
}
