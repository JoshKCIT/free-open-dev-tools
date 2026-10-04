/**
 * The page-side driver that reads a PDF with PDF.js: its text page by page, its document information and XMP metadata,
 * and (to check a copy) the same metadata of a copy's bytes. PDF.js runs in its own worker, built into this page's chunk
 * at build time and never fetched at run time, and every request it makes for a font, a character map or a WebAssembly
 * decoder is refused, because reading text and metadata needs none of them. A close copy in shape of run-pdf-to-image.ts,
 * not a shared helper -- the same reason that file gives for its own duplication.
 *
 * Imports the worker with the build-time inlining suffix, not the URL-and-constructor form: the default form emits the
 * worker as a separately fetched file, and because the worker is constructed when the visitor presses Run, that fetch
 * would land inside the window the privacy harness records. The inlining form embeds the worker's code in the page's own
 * chunk and constructs it from an object URL, which the harness's existing filter already excludes.
 *
 * Every read builds a NEW worker and ends it, with the loading task, however the read ends. PDF.js 6 has no destroy method
 * on the document; `loadingTask.destroy()` is the call that frees it. A read that reports no progress for 20 seconds is
 * stopped with its own message, and so is a document that does not open in that time; Cancel stops a read at once, and a
 * result that arrives after Cancel is never shown because the page ignores any run it has abandoned.
 *
 * Before PDF.js sees a file, the sizes its streams decode to are counted without being kept (`checkExpansion`), and a file
 * that decodes to more than 64 MiB in one stream or 256 MiB in all is refused: a PDF under one megabyte can otherwise make
 * PDF.js hold more than a gigabyte when a page's content stream is read.
 */
import PdfTextMetadataPdfJsWorker from './workers/pdf-text-metadata-pdfjs.worker.ts?worker&inline';
import {
  PDFJS_SAFE_OPTIONS,
  PDFWorker,
  PageRangeError,
  PasswordException,
  PdfToolError,
  checkExpansion,
  createRefusingBinaryDataFactory,
  describeMetadata,
  extractPageTexts,
  getDocument,
  parsePageList,
  type ExtractResult,
  type MetadataRows,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from '@fodt/pdf-text-metadata';
import type { RunContext } from './tool-ui';

/** No progress for this long stops a read; a large document may take longer in total as long as pages keep arriving. */
export const PDF_TEXT_METADATA_STALL_LIMIT_MS = 20_000;

export const PDF_TEXT_METADATA_STALL_MESSAGE =
  'Stopped after 20 seconds without progress. The file may be unusually large or complex for this browser.';

/**
 * A test-only affordance, read only when the browser test suite sets it before the page loads: it shortens the real stall
 * wait without changing the fixed message a visitor would see. Setting it costs a visitor nothing -- nobody reads it.
 */
declare global {
  interface Window {
    __FODT_PDF_TEXT_METADATA_TEST_STALL_MS__?: number;
  }
}

/** A read that did not finish for a reason the visitor can act on (the stall limit). Its message is fixed. */
export class PdfTextMetadataReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfTextMetadataReadError';
  }
}

interface OpenPdf {
  doc: PDFDocumentProxy;
  /** Aborts when the visitor cancels or the stall limit is reached. */
  signal: AbortSignal;
  /** Tells the stall watchdog that progress was made. */
  touch(): void;
  /** True once PDF.js asked for a character map this page does not carry. */
  characterMapAsked(): boolean;
}

/**
 * Opens `bytes` in a new PDF.js worker, runs `work` on the document, and ends the loading task and the worker whatever
 * happens. A document that needs a password becomes `PdfToolError` kind `password` (the password callback is never
 * answered); one that cannot be read becomes kind `damaged`; one that decodes to more than the memory caps becomes kind
 * `size` before PDF.js is built (`skipExpansionCheck` leaves the count out for a copy this page's own removal worker has
 * just written, whose streams were counted when the original was). The bytes are handed to PDF.js, which takes the buffer.
 */
async function withPdf<T>(
  bytes: Uint8Array,
  ctx: RunContext,
  work: (open: OpenPdf) => Promise<T>,
  options: { skipExpansionCheck?: boolean } = {},
): Promise<T> {
  if (ctx.signal.aborted) throw new Error('The run was cancelled before it started.');

  // One signal for the work: the visitor's Cancel and the stall watchdog both end it, and both end the loading task so a
  // read that is waiting on the worker rejects at once.
  const internal = new AbortController();
  let stalled = false;
  let task: PDFDocumentLoadingTask | undefined;
  let worker: Worker | undefined;
  let pdfWorker: InstanceType<typeof PDFWorker> | undefined;
  const stop = () => {
    internal.abort();
    if (task) void task.destroy();
  };
  ctx.signal.addEventListener('abort', stop, { once: true });

  const stallMs = window.__FODT_PDF_TEXT_METADATA_TEST_STALL_MS__ || PDF_TEXT_METADATA_STALL_LIMIT_MS;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  const touch = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stalled = true;
      stop();
    }, stallMs);
  };
  touch();

  try {
    // Counting the decoded size comes first, so a file that would exhaust memory never reaches PDF.js. It reports
    // progress to the stall watchdog and stops when the run is cancelled or stalls.
    if (!options.skipExpansionCheck) await checkExpansion(bytes, { signal: internal.signal, onProgress: touch });

    worker = new PdfTextMetadataPdfJsWorker();
    // The worker is told the verbosity here, not only through getDocument: a PDFWorker reads the global level when it is
    // built, which is before getDocument sets it, and a worker left at the default level prints a warning for every font
    // request that is refused.
    pdfWorker = new PDFWorker({ port: worker as never, verbosity: PDFJS_SAFE_OPTIONS.verbosity });
    let characterMap = false;
    const { Factory } = createRefusingBinaryDataFactory((request) => {
      if (request.kind === 'cmap') characterMap = true;
    });

    task = getDocument({
      ...PDFJS_SAFE_OPTIONS,
      data: bytes,
      worker: pdfWorker,
      BinaryDataFactory: Factory as never,
    });
    if (internal.signal.aborted) void task.destroy();

    const doc = await task.promise;
    return await work({ doc, signal: internal.signal, touch, characterMapAsked: () => characterMap });
  } catch (err) {
    // An abort rejection is let through rather than swallowed: the runner's own cancel handling owns the cancel note.
    if (ctx.signal.aborted) throw err;
    if (stalled) throw new PdfTextMetadataReadError(PDF_TEXT_METADATA_STALL_MESSAGE);
    if (err instanceof PdfToolError || err instanceof PageRangeError) throw err;
    if (err instanceof PasswordException) throw new PdfToolError('password');
    throw new PdfToolError('damaged');
  } finally {
    clearTimeout(stallTimer);
    ctx.signal.removeEventListener('abort', stop);
    try {
      if (task) await task.destroy();
    } finally {
      try {
        if (pdfWorker) await pdfWorker.destroy();
      } finally {
        worker?.terminate();
      }
    }
  }
}

export interface PdfTextRead extends ExtractResult {
  /** The document's own page count, however many pages this run read. */
  pageCount: number;
  /** True when PDF.js asked for a Chinese, Japanese or Korean character map this page does not carry. */
  characterMapNeeded: boolean;
}

/**
 * Reads the text of the pages `pagesText` names (empty for every page, `1-3,5,8-` and so on; a bad list throws
 * `PageRangeError`), reporting progress after each page. The caller has already checked the file's size and header.
 */
export async function readPdfText(file: File, pagesText: string, ctx: RunContext): Promise<PdfTextRead> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return withPdf(bytes, ctx, async ({ doc, signal, touch, characterMapAsked }) => {
    const pages = parsePageList(pagesText, doc.numPages);
    ctx.onProgress?.(0, `Reading ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}`);
    touch();
    const result = await extractPageTexts(doc, pages, {
      signal,
      onPage: (done, total) => {
        touch();
        ctx.onProgress?.(total === 0 ? 1 : done / total, `Page ${done} of ${total}`);
      },
    });
    return { ...result, pageCount: doc.numPages, characterMapNeeded: characterMapAsked() };
  });
}

export interface PdfMetadataRead extends MetadataRows {
  pageCount: number;
  /** The PDF version the file's header states (such as `1.7`), when PDF.js reports one. */
  pdfVersion: string | null;
}

async function describeOpenPdf(doc: PDFDocumentProxy): Promise<PdfMetadataRead> {
  const metadata = await doc.getMetadata();
  const info = metadata.info as Record<string, unknown>;
  const version = Object.hasOwn(info, 'PDFFormatVersion') ? info.PDFFormatVersion : null;
  return {
    ...describeMetadata(info, metadata.metadata),
    pageCount: doc.numPages,
    pdfVersion: typeof version === 'string' ? version : null,
  };
}

/** Reads the document information and the XMP properties of the picked file. */
export async function readPdfMetadata(file: File, ctx: RunContext): Promise<PdfMetadataRead> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return withPdf(bytes, ctx, ({ doc, touch }) => {
    touch();
    return describeOpenPdf(doc);
  });
}

/**
 * Reads the document information and XMP properties of a copy's bytes with PDF.js, in a new worker. The copy is read
 * from its own bytes (a fresh buffer is handed to PDF.js, so `bytes` stays usable): this is the first of the two readers
 * that must find nothing before the copy is offered.
 */
export async function reopenForCheck(bytes: Uint8Array, ctx: RunContext): Promise<PdfMetadataRead> {
  return withPdf(
    bytes.slice(),
    ctx,
    ({ doc, touch }) => {
      touch();
      return describeOpenPdf(doc);
    },
    // The copy was written by this page's own removal worker, whose streams were counted when the original was.
    { skipExpansionCheck: true },
  );
}
