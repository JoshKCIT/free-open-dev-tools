/**
 * The page-side helper that starts the archive worker, forwards its
 * progress to the run context, enforces a stall limit and turns an abort
 * into a real stop. A close copy of `run-pdf-split-in-worker.ts`'s own
 * settle-once-plus-stall-limit contract (BQ).
 */
import ArchiveToolkitWorker from './workers/archive-toolkit.worker.ts?worker&inline';
import type {
  ArchiveToolkitWorkerMessage,
  ArchiveToolkitExtractJobMessage,
  ArchiveToolkitCreateJobMessage,
} from './workers/archive-toolkit.worker';
import type { ArchiveLimits } from '@fodt/archive-toolkit';
import type { RunContext } from './tool-ui';

export const ARCHIVE_TOOLKIT_STALL_LIMIT_MS = 20_000;

declare global {
  interface Window {
    __FODT_ARCHIVE_TOOLKIT_TEST_LIMITS__?: ArchiveLimits;
    __FODT_ARCHIVE_TOOLKIT_TEST_CHUNK_SIZE__?: number;
    __FODT_ARCHIVE_TOOLKIT_TEST_STALL_MS__?: number;
    __FODT_ARCHIVE_TOOLKIT_TEST_STEP_DELAY_MS__?: number;
    __FODT_ARCHIVE_TOOLKIT_TEST_HOOKS__?: {
      extractArchiveInWorker: typeof extractArchiveInWorker;
      createZipInWorker: typeof createZipInWorker;
    };
  }
}

function currentStallLimitMs(): number {
  const testValue = typeof window !== 'undefined' ? window.__FODT_ARCHIVE_TOOLKIT_TEST_STALL_MS__ : undefined;
  return typeof testValue === 'number' && testValue > 0 ? testValue : ARCHIVE_TOOLKIT_STALL_LIMIT_MS;
}

export class ArchiveToolkitRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveToolkitRunError';
  }
}

export interface ArchiveExtractRunResult {
  kind: 'zip' | 'tar' | 'gzip';
  entries: {
    path: string;
    type: string;
    size: number;
    packedSize?: number;
    modified?: string;
    linkTarget?: string;
    status: string;
    reason?: string;
  }[];
  files: { name: string; bytes: Uint8Array }[];
  warnings: string[];
}

export interface ArchiveCreateRunResult {
  zipName: string;
  bytes: Uint8Array;
  entries: { name: string; size: number; packedSize: number; modified: string }[];
}

/** Settles exactly once over the five listeners `run-in-worker.ts` established (message, error, messageerror, abort, a synchronous postMessage throw), plus a stall timer reset on every progress tick. */
function runWorkerJob<TDone extends ArchiveToolkitWorkerMessage, TResult>(
  job: ArchiveToolkitExtractJobMessage | ArchiveToolkitCreateJobMessage,
  ctx: RunContext,
  isDone: (message: ArchiveToolkitWorkerMessage) => message is TDone,
  toResult: (message: TDone) => TResult,
): Promise<TResult> {
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<TResult>((resolve, reject) => {
    const worker = new ArchiveToolkitWorker();
    let settled = false;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
      if (stallTimer) clearTimeout(stallTimer);
    };

    type Outcome = { ok: true; value: TResult } | { ok: false; error: Error };

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

    const onMessage = (event: MessageEvent<ArchiveToolkitWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'archive-toolkit-progress') {
        resetStallTimer();
        ctx.onProgress?.(data.fraction, data.detail);
      } else if (isDone(data)) {
        settle({ ok: true, value: toResult(data) });
      } else if (data.type === 'archive-toolkit-error') {
        settle({ ok: false, error: new ArchiveToolkitRunError(data.message) });
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

    try {
      worker.postMessage(job);
    } catch {
      settle({ ok: false, error: new Error('The background task could not start.') });
    }
  });
}

function isExtractDone(
  message: ArchiveToolkitWorkerMessage,
): message is Extract<ArchiveToolkitWorkerMessage, { type: 'archive-toolkit-extract-done' }> {
  return message.type === 'archive-toolkit-extract-done';
}

function isCreateDone(
  message: ArchiveToolkitWorkerMessage,
): message is Extract<ArchiveToolkitWorkerMessage, { type: 'archive-toolkit-create-done' }> {
  return message.type === 'archive-toolkit-create-done';
}

export function extractArchiveInWorker(file: File, ctx: RunContext): Promise<ArchiveExtractRunResult> {
  const testLimits = typeof window !== 'undefined' ? window.__FODT_ARCHIVE_TOOLKIT_TEST_LIMITS__ : undefined;
  const testChunkSize = typeof window !== 'undefined' ? window.__FODT_ARCHIVE_TOOLKIT_TEST_CHUNK_SIZE__ : undefined;
  const testStepDelayMs =
    typeof window !== 'undefined' ? window.__FODT_ARCHIVE_TOOLKIT_TEST_STEP_DELAY_MS__ : undefined;
  const job: ArchiveToolkitExtractJobMessage = {
    type: 'archive-toolkit-extract-job',
    file,
    testLimits,
    testChunkSize,
    testStepDelayMs,
  };
  return runWorkerJob(job, ctx, isExtractDone, (data) => ({
    kind: data.kind,
    entries: data.entries,
    files: data.files.map((f) => ({ name: f.name, bytes: new Uint8Array(f.bytes) })),
    warnings: data.warnings,
  }));
}

export function createZipInWorker(
  files: File[],
  options: {
    method: 'store' | 'deflate';
    level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
    keepTimes: boolean;
    zipName: string;
  },
  ctx: RunContext,
): Promise<ArchiveCreateRunResult> {
  const job: ArchiveToolkitCreateJobMessage = { type: 'archive-toolkit-create-job', files, ...options };
  return runWorkerJob(job, ctx, isCreateDone, (data) => ({
    zipName: data.zipName,
    bytes: new Uint8Array(data.bytes),
    entries: data.entries,
  }));
}

if (typeof window !== 'undefined') {
  window.__FODT_ARCHIVE_TOOLKIT_TEST_HOOKS__ = { extractArchiveInWorker, createZipInWorker };
}
