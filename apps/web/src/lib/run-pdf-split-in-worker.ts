/**
 * The page-side helper that starts the PDF-organising worker, forwards its
 * progress to the run context, enforces a stall limit and turns an abort
 * into a real stop. A close copy of `run-pdf-merge-in-worker.ts`'s own
 * settle-once-plus-stall-limit contract (BQ).
 */
import PdfSplitWorker from './workers/pdf-split.worker.ts?worker&inline';
import type { PdfSplitWorkerMessage, PdfSplitJobMessage } from './workers/pdf-split.worker';
import type { OrganizeOperation } from '@fodt/pdf-split';
import type { RunContext } from './tool-ui';

export const PDF_SPLIT_STALL_LIMIT_MS = 20_000;

declare global {
  interface Window {
    __FODT_PDF_SPLIT_TEST_CHUNK_SIZE__?: number;
    __FODT_PDF_SPLIT_TEST_STALL_MS__?: number;
    __FODT_PDF_SPLIT_TEST_STEP_DELAY_MS__?: number;
    __FODT_PDF_SPLIT_TEST_HOOKS__?: { runPdfSplitInWorker: typeof runPdfSplitInWorker };
  }
}

function currentChunkSize(): number {
  const testValue = typeof window !== 'undefined' ? window.__FODT_PDF_SPLIT_TEST_CHUNK_SIZE__ : undefined;
  return typeof testValue === 'number' && testValue > 0 ? testValue : 4 * 1024 * 1024;
}

function currentStallLimitMs(): number {
  const testValue = typeof window !== 'undefined' ? window.__FODT_PDF_SPLIT_TEST_STALL_MS__ : undefined;
  return typeof testValue === 'number' && testValue > 0 ? testValue : PDF_SPLIT_STALL_LIMIT_MS;
}

function currentTestStepDelayMs(): number | undefined {
  const testValue = typeof window !== 'undefined' ? window.__FODT_PDF_SPLIT_TEST_STEP_DELAY_MS__ : undefined;
  return typeof testValue === 'number' && testValue > 0 ? testValue : undefined;
}

export class PdfSplitRunError extends Error {
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'PdfSplitRunError';
    this.position = position;
  }
}

export interface PdfSplitRunResult {
  files: { name: string; bytes: Uint8Array; pages: number[] }[];
  warnings: string[];
  sourcePageCount: number;
}

export function runPdfSplitInWorker(
  file: File,
  operation: OrganizeOperation,
  ctx: RunContext,
): Promise<PdfSplitRunResult> {
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<PdfSplitRunResult>((resolve, reject) => {
    const worker = new PdfSplitWorker();
    let settled = false;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
      if (stallTimer) clearTimeout(stallTimer);
    };

    type Outcome = { ok: true; value: PdfSplitRunResult } | { ok: false; error: Error };

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
            `Stopped: no progress for ${Math.round(limit / 1000)} seconds. This file is taking too long to process.`,
          ),
        });
      }, limit);
    };

    const onMessage = (event: MessageEvent<PdfSplitWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'pdf-split-progress') {
        resetStallTimer();
        ctx.onProgress?.(data.fraction, data.detail);
      } else if (data.type === 'pdf-split-done') {
        settle({
          ok: true,
          value: {
            files: data.files.map((f) => ({ name: f.name, bytes: new Uint8Array(f.bytes), pages: f.pages })),
            warnings: data.warnings,
            sourcePageCount: data.sourcePageCount,
          },
        });
      } else if (data.type === 'pdf-split-error') {
        settle({ ok: false, error: new PdfSplitRunError(data.message, data.position) });
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

    const job: PdfSplitJobMessage = {
      type: 'pdf-split-job',
      file,
      operation,
      chunkSize: currentChunkSize(),
      testStepDelayMs: currentTestStepDelayMs(),
    };
    try {
      worker.postMessage(job);
    } catch {
      settle({ ok: false, error: new Error('The background task could not start.') });
    }
  });
}

if (typeof window !== 'undefined') {
  window.__FODT_PDF_SPLIT_TEST_HOOKS__ = { runPdfSplitInWorker };
}
