/**
 * The page-side helper that starts the metadata-reading-and-removal worker,
 * forwards its progress to the run context, enforces a stall limit and
 * turns an abort into a real stop.
 *
 * A close copy of `run-in-worker.ts`'s settle contract (this project's
 * first worker page, `hash-file`), plus the stall-limit reset on every
 * progress message this phase's shared worker procedure (BQ) adds: a large
 * legitimate photo can take real time to read, so this is a
 * no-progress-for-20-seconds stall limit, not a fixed total time limit.
 *
 * Imports the worker with the build-time inlining suffix, not the
 * URL-and-constructor form, for the same reason `run-in-worker.ts`
 * documents: the default form emits the worker as a separately fetched
 * file, and because the worker is constructed when the visitor presses Run,
 * that fetch would land inside the window the privacy harness records,
 * where it is an offending request. The inlining form embeds the worker's
 * code in the page chunk and constructs it from an object URL, which the
 * harness's existing filter already excludes.
 */
import ExifViewerWorker from './workers/exif-viewer.worker.ts?worker&inline';
import type { ExifViewerWorkerMessage } from './workers/exif-viewer.worker';
import type { ReadMetadataResult, StripMetadataResult } from '@fodt/exif-viewer';
import type { RunContext } from './tool-ui';

/**
 * 20,000 ms, this phase's own shared floor (BQ): a large legitimate photo
 * can take real time to read in slices, so this is a no-progress-for-20-
 * seconds stall limit, not a fixed total time limit.
 */
export const EXIF_VIEWER_STALL_LIMIT_MS = 20_000;

/**
 * Test-only affordances, read only when the browser test suite sets them
 * before the page loads, exactly like `hash-file`'s own
 * `__FODT_HASH_FILE_TEST_CHUNK_SIZE__`. Absent -- every real visit -- these
 * change nothing.
 */
declare global {
  interface Window {
    __FODT_EXIF_VIEWER_TEST_CHUNK_SIZE__?: number;
    __FODT_EXIF_VIEWER_TEST_STALL_MS__?: number;
    __FODT_EXIF_VIEWER_TEST_HOOKS__?: { runExifViewerInWorker: typeof runExifViewerInWorker };
  }
}

function currentChunkSize(): number {
  const testValue = typeof window !== 'undefined' ? window.__FODT_EXIF_VIEWER_TEST_CHUNK_SIZE__ : undefined;
  return typeof testValue === 'number' && testValue > 0 ? testValue : 4 * 1024 * 1024;
}

function currentStallLimitMs(): number {
  const testValue = typeof window !== 'undefined' ? window.__FODT_EXIF_VIEWER_TEST_STALL_MS__ : undefined;
  return typeof testValue === 'number' && testValue > 0 ? testValue : EXIF_VIEWER_STALL_LIMIT_MS;
}

export interface ExifViewerRunResult {
  original: ReadMetadataResult;
  removed: StripMetadataResult['removed'];
  kept: string[];
  warnings: string[];
  strippedBytes: Uint8Array;
  fileName: string;
}

/**
 * Reads and strips a picked photo in the background worker.
 *
 * Settlement is the point of this function: it resolves or rejects exactly
 * once, through the single guarded `settle` closure below, covering
 * success, an application-level error, a native worker failure, an
 * undeliverable message, an abort, a signal already aborted before this
 * function was called, and a stall (no progress message for the current
 * stall limit) -- every path terminates the worker and removes every
 * listener and timer this function registered.
 */
export function runExifViewerInWorker(
  file: File,
  options: { keepColourProfile: boolean; keepOrientation: boolean },
  ctx: RunContext,
): Promise<ExifViewerRunResult> {
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<ExifViewerRunResult>((resolve, reject) => {
    const worker = new ExifViewerWorker();
    let settled = false;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
      if (stallTimer) clearTimeout(stallTimer);
    };

    type Outcome = { ok: true; value: ExifViewerRunResult } | { ok: false; error: Error };

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

    const onMessage = (event: MessageEvent<ExifViewerWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'exif-viewer-progress') {
        resetStallTimer();
        ctx.onProgress?.(data.fraction, data.detail);
      } else if (data.type === 'exif-viewer-done') {
        settle({
          ok: true,
          value: {
            original: data.original,
            removed: data.removed,
            kept: data.kept,
            warnings: data.warnings,
            strippedBytes: new Uint8Array(data.strippedBytes),
            fileName: data.fileName,
          },
        });
      } else if (data.type === 'exif-viewer-error') {
        settle({ ok: false, error: new Error(data.message) });
      }
    };

    const onNativeError = () => {
      settle({ ok: false, error: new Error('The background task could not start.') });
    };
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

    try {
      worker.postMessage({
        type: 'exif-viewer-job',
        file,
        options,
        chunkSize: currentChunkSize(),
      });
    } catch {
      // postMessage throws synchronously when its argument cannot be
      // structured-cloned. The same fixed message as every other native
      // startup failure path, matching hash-file's own precedent.
      settle({ ok: false, error: new Error('The background task could not start.') });
    }
  });
}

if (typeof window !== 'undefined') {
  window.__FODT_EXIF_VIEWER_TEST_HOOKS__ = { runExifViewerInWorker };
}
