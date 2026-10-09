/**
 * Render planning, PDF.js's own fixed safety options, output naming, and
 * the page loop -- over an injected PDF.js document proxy and an injected
 * surface factory, never over a named browser type (a browser worker
 * supplies a real one; the standalone test suite supplies one built on
 * @napi-rs/canvas). This package's own build and test run in plain Node,
 * so nothing here may name a browser-only type, not even in a comment.
 *
 * ISO 32000-1:2008 section 8.3.2.3 "User Space" (quoted in full in this
 * package's README): "the default value of 1/72 inch is used" for the
 * length of a unit along both axes of default user space -- so a page's
 * PDF.js viewport scale for a requested resolution in dots per inch is
 * `dpi / 72`.
 */
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
// The legacy build, not the modern one -- see src/index.ts's own header
// comment for why (measured: the modern build both warns and fails to
// finish a document's own lifecycle correctly under plain Node).
import { AnnotationMode } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { assertFileKind, type FileKind } from './file-sniff';
import { parsePageList } from './page-range';

/** The two output raster formats this tool ever produces. */
export type RenderFormat = 'png' | 'jpeg';

const MIME_TYPES: Record<RenderFormat, string> = { png: 'image/png', jpeg: 'image/jpeg' };

/** Refused above this many bytes, checked from the file's own reported size before PDF.js ever sees it. */
export const MAX_PDF_BYTES = 100 * 1024 * 1024;

/**
 * The largest rendered page area (width times height, in pixels) this tool
 * ever asks a browser to encode. Set from the smallest value that every one
 * of the four tested browser projects was measured to encode successfully
 * with `convertToBlob`; a page whose rendered size at the requested
 * resolution would exceed it is refused before a surface is ever created.
 */
export const MAX_PAGE_PIXELS = 40_000_000;

/** Refused above this many pages in one page list, so a run cannot ask for an unbounded number of renders. */
export const MAX_PAGES_PER_RUN = 200;

const ACCEPTED_KINDS: FileKind[] = ['pdf'];

/**
 * PDF.js's own fixed options for this tool, chosen so that once a document
 * is loaded, rendering it can never make a network request of any kind:
 * `useWorkerFetch: false` forces every cMap/standard-font/wasm request
 * through the caller's own `BinaryDataFactory` rather than the worker's built-in `fetch`; no
 * `cMapUrl`, `standardFontDataUrl` or `wasmUrl` is ever set (undefined,
 * never an address or a path); `enableXfa: false` and `verbosity: 0`
 * (`VerbosityLevel.ERRORS`, pdfjs-dist's own enum) keep XFA forms and
 * console chatter off.
 *
 * `useSystemFonts: false` is deliberate, not the browser default (`true`):
 * read directly from the installed source (`fetchStandardFontData`,
 * pdf.worker.mjs), `useSystemFonts: true` skips fetching standard-font data
 * entirely for every one of the 14 standard fonts except Symbol and
 * ZapfDingbats -- which would mean the bundled Foxit Times and Courier
 * files are never even asked for, and this tool's own licence-driven
 * bundling decision would have no effect. With
 * `useSystemFonts: false`, PDF.js asks this tool's own `BinaryDataFactory`
 * for standard-font data by name for all 14 fonts (`getFontNameToFileMap`,
 * same file): the ten Foxit files this tool bundles (Times, Courier,
 * Symbol, ZapfDingbats families) are served; the Helvetica family maps to
 * `LiberationSans-*.ttf`, which this tool does not bundle (GPL-2.0 with a
 * font exception that does not cover redistributing the font itself, not
 * on the licence gate's allow list) -- the factory refuses that request,
 * `fetchStandardFontData`'s own try/catch (`warn(ex); return null`)
 * already treats a factory rejection as "no font data for this name" and
 * falls back to the visitor's own sans-serif font with PDF.js's built-in
 * glyph widths keeping the layout, never a second request, since every one
 * of these calls is an in-memory message to this tool's own factory, not a
 * network fetch. The installed pdfjs-dist (6.3.289) has no
 * `isEvalSupported` option; this project's own file-sniff.ts and
 * BinaryDataFactory refusal already keep the scripting engine and any
 * fetch out of reach regardless.
 */
export const PDFJS_SAFE_OPTIONS = {
  useWorkerFetch: false,
  verbosity: 0,
  enableXfa: false,
  useSystemFonts: false,
} as const;

export class PdfToImageError extends Error {
  readonly reason: string;
  constructor(message: string, reason: string) {
    super(message);
    this.name = 'PdfToImageError';
    this.reason = reason;
  }
}

export interface RenderOptions {
  /** Dots per inch. Default 150. */
  dpi?: number;
  /** Output raster format. Default 'png'. */
  format?: RenderFormat;
  /** JPEG quality, 1-100. Default 90. Ignored for PNG. */
  quality?: number;
  /** PNG only: omit the opaque white background so drawn content keeps alpha. */
  transparent?: boolean;
  /** A page-list string (e.g. "1-3,5,8-"), parsed once the document's page count is known. Empty/absent means every page. */
  pages?: string;
}

export interface RenderPlan {
  /** 1-based page numbers in written order, or undefined for "every page" (resolved once pageCount is known). */
  pages: number[] | undefined;
  /** The raw page-list text, held until `resolvePages` can parse it against a real page count. */
  pagesText: string | undefined;
  format: RenderFormat;
  dpi: number;
  quality: number;
  transparent: boolean;
  baseName: string;
}

const MIN_DPI = 72;
const MAX_DPI = 600;

function clampDpi(dpi: number | undefined): number {
  if (dpi === undefined || !Number.isFinite(dpi)) return 150;
  return Math.min(MAX_DPI, Math.max(MIN_DPI, Math.round(dpi)));
}

function clampQuality(quality: number | undefined): number {
  if (quality === undefined || !Number.isFinite(quality)) return 90;
  return Math.min(100, Math.max(1, Math.round(quality)));
}

function baseNameFrom(fileName: string): string {
  const withoutExt = fileName.replace(/\.[^./\\]+$/, '');
  const cleaned = withoutExt.trim();
  return cleaned.length > 0 ? cleaned : 'document';
}

/**
 * Checks the file header (refusing anything that is not a PDF, or over
 * `MAX_PDF_BYTES`) and clamps every option, returning a plan the page loop
 * can execute unattended. The page list, if given, is only resolved once
 * the document's real page count is known -- see `resolvePages`.
 */
export function planRender(bytes: Uint8Array, fileName: string, options: RenderOptions = {}): RenderPlan {
  assertFileKind(bytes, ACCEPTED_KINDS, { maxBytes: MAX_PDF_BYTES });
  return {
    pages: undefined,
    pagesText: options.pages,
    format: options.format === 'jpeg' ? 'jpeg' : 'png',
    dpi: clampDpi(options.dpi),
    quality: clampQuality(options.quality),
    transparent: options.transparent === true,
    baseName: baseNameFrom(fileName),
  };
}

/**
 * Resolves a plan's page-list text against a document's real page count,
 * returning a new plan with `pages` set. Called once `document.numPages`
 * is known, after the document has loaded. An absent or blank page-list
 * text means every page, in order (`pages` stays `undefined`, and
 * `renderPages` falls back to the full page range itself). Refuses a
 * list naming more than `MAX_PAGES_PER_RUN` pages -- a plain, separate
 * limit from `page-range.ts`'s own `MAX_PAGE_LIST_LENGTH`, which exists to
 * stop the parser itself from ever building an unbounded array.
 */
export function resolvePages(plan: RenderPlan, pageCount: number): RenderPlan {
  if (!plan.pagesText || plan.pagesText.trim() === '') {
    return plan;
  }
  const list = parsePageList(plan.pagesText, pageCount);
  if (list.length > MAX_PAGES_PER_RUN) {
    throw new PdfToImageError(
      `This page list asks for ${list.length} pages, above this tool's ${MAX_PAGES_PER_RUN}-page limit for one run. Try a shorter list.`,
      'too-many-pages',
    );
  }
  return { ...plan, pages: list };
}

/** `<base>-page-<n>.<ext>`, with `n` zero-padded to the width of `pageCount`. */
export function outputName(baseName: string, page: number, pageCount: number, format: RenderFormat): string {
  const width = String(pageCount).length;
  const padded = String(page).padStart(width, '0');
  const ext = format === 'jpeg' ? 'jpg' : 'png';
  return `${baseName}-page-${padded}.${ext}`;
}

export interface RenderedPage {
  page: number;
  name: string;
  mime: string;
  bytes: Uint8Array;
  width: number;
  height: number;
}

/**
 * Duck-typed contract for creating and encoding a rendering surface,
 * matching PDF.js's own `CanvasFactory` shape (`create`/`reset`/`destroy`)
 * plus one `encode` step this package adds. `canvas` and `context` are
 * opaque to this file: a browser worker's own factory returns a canvas
 * surface never inserted into the document and its 2D context; the
 * standalone test suite's own factory returns an `@napi-rs/canvas` canvas
 * and its 2D context. Both expose the same `convertToBlob`-shaped encode
 * method, which is why one `encode` implementation below can serve both
 * without this file ever naming either concrete type.
 */
export interface RenderSurfacePair {
  canvas: unknown;
  context: unknown;
}

export interface SurfaceFactory {
  create(width: number, height: number): RenderSurfacePair;
  reset(pair: RenderSurfacePair, width: number, height: number): void;
  destroy(pair: RenderSurfacePair): void;
  /** Encodes the finished canvas to bytes, reporting the media type actually produced (a browser may silently substitute one). */
  encode(canvas: unknown, mimeType: string, quality?: number): Promise<{ type: string; bytes: Uint8Array }>;
}

export interface RenderHooks {
  /**
   * Checked between pages, and wired to PDF.js's own `RenderTask.cancel()`
   * while a page is actually rendering, so a cancel during a slow page
   * stops that page's own work immediately rather than waiting for it to
   * finish.
   */
  signal?: AbortSignal;
  onProgress?(done: number, total: number, detail?: string): void;
  /**
   * Called once per binary-data request PDF.js's own factory reports
   * (kind, filename, served). Test-only in production use; always present
   * during this package's own tests, which assert on it.
   */
  onBinaryDataRequest?(entry: { kind: string; filename: string; served: boolean }): void;
}

/**
 * Renders every page in `plan.pages` (or every page of the document when
 * `pages` is undefined) in page order, encoding each to `plan.format` at
 * `plan.dpi`. Checks `hooks.signal` between pages, and cancels the current
 * page's own `RenderTask` immediately when it aborts mid-render, so a
 * cancel during a large page's own render stops promptly rather than
 * waiting for that page to finish. Reports progress after each page
 * completes.
 */
export async function renderPages(
  document: PDFDocumentProxy,
  plan: RenderPlan,
  surfaces: SurfaceFactory,
  hooks: RenderHooks = {},
): Promise<RenderedPage[]> {
  const pageNumbers = plan.pages ?? Array.from({ length: document.numPages }, (_, i) => i + 1);
  const results: RenderedPage[] = [];
  const mimeType = MIME_TYPES[plan.format];

  for (let i = 0; i < pageNumbers.length; i++) {
    if (hooks.signal?.aborted) {
      throw new PdfToImageError('The run was cancelled.', 'cancelled');
    }
    const pageNumber = pageNumbers[i]!;
    const page: PDFPageProxy = await document.getPage(pageNumber);
    try {
      const viewport = page.getViewport({ scale: plan.dpi / 72 });
      const width = Math.max(1, Math.round(viewport.width));
      const height = Math.max(1, Math.round(viewport.height));

      if (width * height > MAX_PAGE_PIXELS) {
        throw new PdfToImageError(
          `Page ${pageNumber} at ${plan.dpi} dots per inch would be ${width} by ${height} pixels, above what a browser can reliably encode. Try a lower resolution.`,
          'page-too-large',
        );
      }

      const pair = surfaces.create(width, height);
      try {
        // No `canvasFactory` field belongs here: PDF.js binds a page's own
        // canvas factory once, at `getDocument`'s own `CanvasFactory`
        // option, for any internal canvas it needs (soft masks, patterns)
        // while rendering. This call only supplies the one top-level
        // surface this package's own `surfaces.create` built above.
        //
        // `canvas: null` is deliberate, not an omission: the installed
        // pdfjs-dist's own `RenderParameters` type says "If the context
        // must absolutely be used to render the page, the canvas must be
        // null" -- this package renders through `canvasContext` because
        // its own opaque `RenderSurfacePair.canvas` is never a named
        // browser-only type (BT: not even in a comment).
        //
        // `background` is PDF.js's own render parameter, read directly
        // from the installed source (`CanvasGraphics.beginDrawing`):
        // `this.ctx.fillStyle = background || "#ffffff"; this.ctx.fillRect(...)`
        // unconditionally paints the whole surface before drawing the page,
        // regardless of anything this package might have painted first --
        // measured directly this session, a page-side pre-fill (this
        // file's own earlier approach) is silently overwritten by this
        // internal fill. Passing `background` here is the only way to
        // control it: an explicit fully-transparent fill colour for
        // `plan.transparent`, opaque white otherwise.
        const renderTask = page.render({
          canvas: null,
          canvasContext: pair.context as never,
          viewport,
          annotationMode: AnnotationMode.ENABLE,
          background: plan.transparent ? 'rgba(0,0,0,0)' : '#ffffff',
        });
        const onAbort = () => renderTask.cancel();
        hooks.signal?.addEventListener('abort', onAbort, { once: true });
        try {
          await renderTask.promise;
        } catch (err) {
          if (hooks.signal?.aborted) {
            throw new PdfToImageError('The run was cancelled.', 'cancelled');
          }
          throw err;
        } finally {
          hooks.signal?.removeEventListener('abort', onAbort);
        }

        const encoded = await surfaces.encode(
          pair.canvas,
          mimeType,
          plan.format === 'jpeg' ? plan.quality / 100 : undefined,
        );
        if (encoded.type !== mimeType) {
          throw new PdfToImageError(
            `This browser could not encode page ${pageNumber} as ${plan.format.toUpperCase()}; it produced ${encoded.type || 'an unknown type'} instead.`,
            'encode-mismatch',
          );
        }

        results.push({
          page: pageNumber,
          name: outputName(plan.baseName, pageNumber, pageNumbers.length, plan.format),
          mime: encoded.type,
          bytes: encoded.bytes,
          width,
          height,
        });
      } finally {
        surfaces.destroy(pair);
      }
    } finally {
      page.cleanup();
    }

    hooks.onProgress?.(i + 1, pageNumbers.length, `Page ${i + 1} of ${pageNumbers.length}`);
  }

  return results;
}
