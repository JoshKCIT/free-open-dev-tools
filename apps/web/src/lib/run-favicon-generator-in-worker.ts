/**
 * The page-side helper that starts the favicon-drawing worker, forwards its
 * progress to the run context, enforces a stall limit and turns an abort
 * into a real stop.
 *
 * A close copy of `run-in-worker.ts`'s settle contract, the same shape
 * `run-image-converter-in-worker.ts` (09-03 Task 1) already established for
 * this phase's canvas-drawing worker pages, including its own page-thread
 * fallback for an engine with no `OffscreenCanvas` anywhere.
 *
 * Imports the worker with the build-time inlining suffix, not the
 * URL-and-constructor form: the default form emits the worker as a
 * separately fetched file, and because the worker is constructed when the
 * visitor presses Run, that fetch would land inside the window the privacy
 * harness records, where it is an offending request.
 */
import FaviconGeneratorWorker from './workers/favicon-generator.worker.ts?worker&inline';
import { drawFaviconSize, FAVICON_DRAW_SIZES } from './workers/favicon-generator.worker';
import type {
  FaviconGeneratorJobMessage,
  FaviconGeneratorWorkerMessage,
  FaviconGeneratorNeedsPageCanvasMessage,
} from './workers/favicon-generator.worker';
import type { FaviconOptions } from '@fodt/favicon-generator';
import type { RunContext } from './tool-ui';

export const FAVICON_GENERATOR_STALL_LIMIT_MS = 20_000;

declare global {
  interface Window {
    __FODT_FAVICON_GENERATOR_TEST_STALL_MS__?: number;
    /** See the worker's own `testStepDelayMs` doc comment. Absent -- every real visit -- this changes nothing. */
    __FODT_FAVICON_GENERATOR_TEST_STEP_DELAY_MS__?: number;
    __FODT_FAVICON_GENERATOR_TEST_HOOKS__?: {
      buildFaviconInWorker: typeof buildFaviconInWorker;
    };
  }
}

function currentStallLimitMs(): number {
  const testValue = typeof window !== 'undefined' ? window.__FODT_FAVICON_GENERATOR_TEST_STALL_MS__ : undefined;
  return typeof testValue === 'number' && testValue > 0 ? testValue : FAVICON_GENERATOR_STALL_LIMIT_MS;
}

function currentTestStepDelayMs(): number | undefined {
  const testValue = typeof window !== 'undefined' ? window.__FODT_FAVICON_GENERATOR_TEST_STEP_DELAY_MS__ : undefined;
  return typeof testValue === 'number' && testValue > 0 ? testValue : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Draws every size on the page thread -- the fallback for an engine with no
 * `OffscreenCanvas` anywhere, confirmed necessary for this project's tested
 * WebKit build. The canvas this function draws into is a local variable
 * never appended to the document, so a picked image is still never shown.
 */
async function finishOnPageThread(
  data: FaviconGeneratorNeedsPageCanvasMessage,
  onProgress: RunContext['onProgress'],
): Promise<Record<number, ArrayBuffer>> {
  const { bitmap, plan } = data;
  try {
    const pngs: Record<number, ArrayBuffer> = {};
    let done = 0;
    for (const size of FAVICON_DRAW_SIZES) {
      const canvas = document.createElement('canvas'); // never appended to the document
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('This browser could not provide a 2D drawing surface for the favicon.');
      drawFaviconSize(ctx, size, plan, bitmap);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('This browser could not encode the favicon.'))),
          'image/png',
        ),
      );
      if (blob.type !== 'image/png') {
        throw new Error('This browser cannot write PNG images, so no favicon could be produced.');
      }
      pngs[size] = await blob.arrayBuffer();
      done++;
      // The worker's own progress messages never reach this page-thread
      // fallback (it never runs inside the worker at all on this engine),
      // so this is the one place that reports progress here -- called
      // directly rather than posted, since we are already on the page.
      onProgress?.(done / FAVICON_DRAW_SIZES.length, `${size}px drawn`);
      if (data.testStepDelayMs) await sleep(data.testStepDelayMs);
    }
    return pngs;
  } finally {
    bitmap?.close();
  }
}

export interface BuildFaviconResult {
  pngs: Record<number, ArrayBuffer>;
  warnings: string[];
}

/**
 * Builds every favicon size in the background worker, resolving with the
 * PNG bytes per size and any warnings the plan carries.
 *
 * Settlement is the point of this function: it resolves or rejects exactly
 * once, through the single guarded `settle` closure below, covering
 * success, an application-level error, a native worker failure, an
 * undeliverable message, an abort, a signal already aborted before this
 * function was called, and a stall (no progress message for the current
 * stall limit).
 */
export function buildFaviconInWorker(
  options: FaviconOptions,
  file: File | null,
  ctx: RunContext,
): Promise<BuildFaviconResult> {
  if (ctx.signal.aborted) {
    return Promise.reject(new Error('The run was cancelled before it started.'));
  }

  return new Promise<BuildFaviconResult>((resolve, reject) => {
    const worker = new FaviconGeneratorWorker();
    let settled = false;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;

    const removeListeners = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onNativeError);
      worker.removeEventListener('messageerror', onMessageError);
      ctx.signal.removeEventListener('abort', onAbort);
      if (stallTimer) clearTimeout(stallTimer);
    };

    type Outcome = { ok: true; value: BuildFaviconResult } | { ok: false; error: Error };

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
            `Stopped: no progress for ${Math.round(limit / 1000)} seconds. This favicon is taking too long to build.`,
          ),
        });
      }, limit);
    };

    const onMessage = (event: MessageEvent<FaviconGeneratorWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'favicon-generator-progress') {
        resetStallTimer();
        ctx.onProgress?.(data.fraction, data.detail);
      } else if (data.type === 'favicon-generator-done') {
        settle({ ok: true, value: { pngs: data.pngs, warnings: data.warnings } });
      } else if (data.type === 'favicon-generator-error') {
        settle({ ok: false, error: new Error(data.message) });
      } else if (data.type === 'favicon-generator-needs-page-canvas') {
        finishOnPageThread(data, (fraction, detail) => {
          resetStallTimer();
          ctx.onProgress?.(fraction, detail);
        })
          .then((pngs) => settle({ ok: true, value: { pngs, warnings: data.plan.warnings } }))
          .catch((err) => settle({ ok: false, error: err instanceof Error ? err : new Error(String(err)) }));
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
    resetStallTimer();

    const send = (bytes?: ArrayBuffer) => {
      const job: FaviconGeneratorJobMessage = {
        type: 'favicon-generator-job',
        options,
        bytes,
        fileName: file?.name,
        testStepDelayMs: currentTestStepDelayMs(),
      };
      try {
        worker.postMessage(job, bytes ? [bytes] : []);
      } catch {
        settle({ ok: false, error: new Error('The background task could not start.') });
      }
    };

    if (options.source === 'image' && file) {
      file
        .arrayBuffer()
        .then((bytes) => {
          if (!settled) send(bytes);
        })
        .catch(() => {
          settle({ ok: false, error: new Error(`Could not read '${file.name}'.`) });
        });
    } else {
      send();
    }
  });
}

if (typeof window !== 'undefined') {
  window.__FODT_FAVICON_GENERATOR_TEST_HOOKS__ = { buildFaviconInWorker };
}
