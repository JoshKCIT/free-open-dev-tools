/**
 * The page-side driver for PDF to Image: builds PDF.js's own worker at
 * build time (never fetched at run time), answers every binary-data
 * request PDF.js makes from this tool's own bundled bytes, and renders
 * every requested page onto an `OffscreenCanvas` never inserted into the
 * document, encoding each to the requested format.
 *
 * Imports the worker with the build-time inlining suffix, not the
 * URL-and-constructor form -- the single most important line in this
 * file, matching `run-in-worker.ts`'s own precedent: the default form
 * emits the worker as a separately fetched file, and because the worker is
 * constructed when the visitor presses Run, that fetch would land inside
 * the window the privacy harness records, where it is an offending
 * request. The inlining form embeds the worker's code in the page's own
 * chunk and constructs it from an object URL, which the harness's
 * existing filter already excludes.
 */
import PdfToImageWorker from './workers/pdf-to-image.worker.ts?worker&inline';
import {
  getDocument,
  PDFWorker,
  PDFJS_SAFE_OPTIONS,
  PasswordException,
  PdfToImageError,
  planRender,
  resolvePages,
  renderPages,
  bundledBinaryData,
  type RenderOptions,
  type RenderedPage,
  type RenderSurfacePair,
  type SurfaceFactory,
} from '@fodt/pdf-to-image';
import type { RunContext } from './tool-ui';

export interface BinaryDataRequestLog {
  kind: string;
  filename: string;
  served: boolean;
}

/**
 * No progress message for this long stops the run rather than leaving it to
 * run indefinitely (BQ). This is a stall limit, not a total time limit: a
 * large legitimate document can take minutes, as long as it keeps reporting
 * progress between pages.
 */
export const PDF_STALL_LIMIT_MS = 20_000;

/**
 * Test-only affordances, read only when the browser test suite sets them
 * before the page loads. `TEST_HOOKS` lets a spec assert on exactly which
 * binary-data requests PDF.js made and whether each was served from the
 * bundle. `TEST_STALL_MS` shortens the real stall wait without changing
 * the fixed message text a real visitor would see. Assigning these costs a
 * real visitor nothing -- nobody reads them outside a test.
 */
declare global {
  interface Window {
    __FODT_PDF_TO_IMAGE_TEST_HOOKS__?: { requests: BinaryDataRequestLog[] };
    __FODT_PDF_TO_IMAGE_TEST_STALL_MS__?: number;
  }
}

export interface RenderPdfResult {
  pages: RenderedPage[];
  /** True when the document asked for a built-in CMap this tool does not bundle. */
  cjkNoteNeeded: boolean;
  /** The document's own total page count, independent of how many pages this run actually rendered. */
  documentPageCount: number;
}

/**
 * Answers PDF.js's own `BinaryDataFactory` requests entirely from this
 * tool's bundled bytes (`bundledBinaryData`, generated from the installed
 * pdfjs-dist package). Never reads a URL, never touches the network: a
 * request for anything not bundled (every Liberation Sans file the
 * Helvetica standard fonts map to, or a built-in CMap, which this tool
 * never bundles at all) is refused, which PDF.js's own
 * `fetchStandardFontData`/`fetchBuiltInCMap` already treat as "fall back",
 * not a failure. `onCmapRequest` is called once per refused `cMapUrl`
 * request, which the caller turns into the visitor-facing CJK note.
 */
class BundledBinaryDataFactory {
  private readonly onCmapRequest: () => void;
  constructor(_opts: unknown, onCmapRequest: () => void) {
    this.onCmapRequest = onCmapRequest;
  }
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const bundledKind = kind === 'standardFontDataUrl' ? 'font' : kind === 'cMapUrl' ? 'cmap' : 'wasm';
    const data = bundledBinaryData(bundledKind, filename);
    const served = data !== null;
    if (typeof window !== 'undefined') {
      window.__FODT_PDF_TO_IMAGE_TEST_HOOKS__?.requests.push({ kind, filename, served });
    }
    if (!served && kind === 'cMapUrl') this.onCmapRequest();
    if (!data) throw new Error(`Not bundled: ${kind} ${filename}`);
    return data;
  }
}

/**
 * A `SurfaceFactory` (tools/pdf-to-image/src/render.ts) over
 * `OffscreenCanvas` where available, never inserted into the document, so
 * the picked PDF's rendered pages are never shown anywhere but the
 * download the visitor asked for.
 *
 * Measured directly this session (matching 08-09's own finding for
 * `image-color-extractor`): the tested WebKit build has no
 * `OffscreenCanvas` anywhere at all, including on the page's own main
 * thread, where this factory runs (PDF.js's page rendering is a main-thread
 * API; only its worker parses the document). The fallback is a
 * `document.createElement('canvas')` that is never appended to the
 * document -- still never shown to the visitor, on every tested engine --
 * whose `toBlob` callback is wrapped in a promise to match
 * `OffscreenCanvas.convertToBlob`'s own shape.
 */
function createBrowserSurfaceFactory(): SurfaceFactory {
  const hasOffscreenCanvas = typeof OffscreenCanvas !== 'undefined';
  return {
    create(width, height): RenderSurfacePair {
      let canvas: OffscreenCanvas | HTMLCanvasElement;
      if (hasOffscreenCanvas) {
        canvas = new OffscreenCanvas(width, height);
      } else {
        canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
      }
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) {
        throw new PdfToImageError('This browser could not create a drawing surface for this page.', 'no-context');
      }
      return { canvas, context };
    },
    reset(pair, width, height) {
      const canvas = pair.canvas as OffscreenCanvas | HTMLCanvasElement;
      canvas.width = width;
      canvas.height = height;
    },
    destroy(pair) {
      const canvas = pair.canvas as OffscreenCanvas | HTMLCanvasElement;
      canvas.width = 0;
      canvas.height = 0;
    },
    async encode(canvas, mimeType, quality) {
      if (hasOffscreenCanvas) {
        const offscreen = canvas as OffscreenCanvas;
        const blob = await offscreen.convertToBlob({ type: mimeType, quality });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        return { type: blob.type, bytes };
      }
      const domCanvas = canvas as HTMLCanvasElement;
      const blob = await new Promise<Blob | null>((resolve) => domCanvas.toBlob(resolve, mimeType, quality));
      if (!blob) {
        throw new PdfToImageError('This browser could not encode this page.', 'encode-failed');
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return { type: blob.type, bytes };
    },
  };
}

/**
 * Renders every requested page of `file` to the format `options` names.
 * Checks the file header and clamps options before anything else
 * (`planRender`), builds a fresh PDF.js worker from this page's own
 * already-loaded chunk, and renders through a browser surface factory.
 *
 * A password-protected PDF is refused with a clean message, without PDF.js's
 * own password callback ever being answered (`onPassword` is never set at
 * all). A run that reports no progress for `PDF_STALL_LIMIT_MS` is stopped;
 * a run the visitor cancels stops between pages, or mid-page through
 * PDF.js's own `RenderTask.cancel` (tools/pdf-to-image/src/render.ts).
 */
export async function renderPdfInPage(file: File, options: RenderOptions, ctx: RunContext): Promise<RenderPdfResult> {
  if (ctx.signal.aborted) {
    throw new Error('The run was cancelled before it started.');
  }

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Checks the header and clamps every option before a worker is even
  // constructed, so a non-PDF or an over-limit file never reaches PDF.js.
  const plan = planRender(bytes, file.name, options);

  const worker = new PdfToImageWorker();
  const pdfWorker = new PDFWorker({ port: worker as never });

  let cjkNoteNeeded = false;
  class ScopedBinaryDataFactory extends BundledBinaryDataFactory {
    constructor() {
      super(undefined, () => {
        cjkNoteNeeded = true;
      });
    }
  }

  const task = getDocument({
    ...PDFJS_SAFE_OPTIONS,
    // PDF.js's own `data` option takes ownership of the bytes it is given
    // and detaches the underlying buffer -- a fresh copy keeps `bytes`
    // itself usable if a later step (or a future task) needs it again.
    data: bytes.slice(),
    worker: pdfWorker,
    BinaryDataFactory: ScopedBinaryDataFactory,
  });

  let document;
  try {
    document = await task.promise;
  } catch (err) {
    await task.destroy();
    if (err instanceof PasswordException) {
      throw new PdfToImageError(
        'This PDF is protected by a password. This page does not open password-protected PDFs.',
        'password-protected',
      );
    }
    throw err;
  }

  // Combines the visitor's own Cancel/edit-triggered abort with this
  // driver's own stall watchdog: renderPages sees one signal regardless of
  // which one fires, and only this function needs to know which happened.
  const internalController = new AbortController();
  const forwardAbort = () => internalController.abort();
  ctx.signal.addEventListener('abort', forwardAbort, { once: true });

  let stalled = false;
  const stallLimitMs =
    typeof window !== 'undefined' && window.__FODT_PDF_TO_IMAGE_TEST_STALL_MS__
      ? window.__FODT_PDF_TO_IMAGE_TEST_STALL_MS__
      : PDF_STALL_LIMIT_MS;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  const resetStallTimer = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stalled = true;
      internalController.abort();
    }, stallLimitMs);
  };
  resetStallTimer();

  try {
    const resolvedPlan = resolvePages(plan, document.numPages);
    const surfaces = createBrowserSurfaceFactory();
    const pages = await renderPages(document, resolvedPlan, surfaces, {
      signal: internalController.signal,
      onProgress: (done, total, detail) => {
        resetStallTimer();
        ctx.onProgress?.(total === 0 ? 1 : done / total, detail);
      },
    });
    return { pages, cjkNoteNeeded, documentPageCount: document.numPages };
  } catch (err) {
    if (stalled) {
      throw new PdfToImageError(
        `Stopped: no progress for ${Math.round(stallLimitMs / 1000)} seconds. The file may be unusually large or complex for this browser.`,
        'stalled',
      );
    }
    throw err;
  } finally {
    clearTimeout(stallTimer);
    ctx.signal.removeEventListener('abort', forwardAbort);
    await task.destroy();
  }
}
