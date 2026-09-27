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
 * Test-only affordance, read only when the browser test suite sets it
 * before the page loads. Lets a spec assert on exactly which binary-data
 * requests PDF.js made and whether each was served from the bundle.
 * Assigning this costs a real visitor nothing -- nobody reads it outside a
 * test.
 */
declare global {
  interface Window {
    __FODT_PDF_TO_IMAGE_TEST_HOOKS__?: { requests: BinaryDataRequestLog[] };
  }
}

/**
 * Answers PDF.js's own `BinaryDataFactory` requests entirely from this
 * tool's bundled bytes (`bundledBinaryData`, generated from the installed
 * pdfjs-dist package). Never reads a URL, never touches the network: a
 * request for anything not bundled (every Liberation Sans file the
 * Helvetica standard fonts map to) is refused, which PDF.js's own
 * `fetchStandardFontData` already treats as "fall back to a system font",
 * not a failure.
 */
class BundledBinaryDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const bundledKind = kind === 'standardFontDataUrl' ? 'font' : kind === 'cMapUrl' ? 'cmap' : 'wasm';
    const data = bundledBinaryData(bundledKind, filename);
    const served = data !== null;
    if (typeof window !== 'undefined') {
      window.__FODT_PDF_TO_IMAGE_TEST_HOOKS__?.requests.push({ kind, filename, served });
    }
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
 * already-loaded chunk, and renders through an `OffscreenCanvas` surface
 * factory. A password-protected PDF is refused with a clean message,
 * without PDF.js's own password callback ever being answered.
 */
export async function renderPdfInPage(file: File, options: RenderOptions, ctx: RunContext): Promise<RenderedPage[]> {
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

  const task = getDocument({
    ...PDFJS_SAFE_OPTIONS,
    // PDF.js's own `data` option takes ownership of the bytes it is given
    // and detaches the underlying buffer -- a fresh copy keeps `bytes`
    // itself usable if a later step (or a future task) needs it again.
    data: bytes.slice(),
    worker: pdfWorker,
    BinaryDataFactory: BundledBinaryDataFactory,
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

  try {
    const surfaces = createBrowserSurfaceFactory();
    return await renderPages(document, plan, surfaces, {
      signal: ctx.signal,
      onProgress: (done, total, detail) => ctx.onProgress?.(total === 0 ? 1 : done / total, detail),
    });
  } finally {
    await task.destroy();
  }
}
