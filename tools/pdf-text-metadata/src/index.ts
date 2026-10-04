import meta from './meta.json';
import { assertFileKind, MAX_HEADER_BYTES } from './file-sniff';
import { MAX_PDF_BYTES, PdfToolError, visible } from './shared';

export { meta };
export { MAX_HEADER_BYTES };
export * from './shared';
export * from './text';
export * from './metadata';
export * from './strip';
export * from './page-range';
export * from './expansion';

// The PDF.js entry points the page needs, re-exported from here so this package stays the only place pnpm resolves
// `pdfjs-dist`. This is the `legacy/build/` entry, the one every PDF page of this site uses and the one that also runs in
// plain Node (the modern entry fails there), so the tests and the page run the same build. The removal worker does not
// import this file: it imports `strip.ts` by path, because `pdfjs-dist` declares no `sideEffects` and anything this file
// re-exports would be bundled into it.
export { getDocument, PDFWorker, PasswordException, version } from 'pdfjs-dist/legacy/build/pdf.mjs';
export type { PDFDocumentProxy, PDFPageProxy, PDFDocumentLoadingTask } from 'pdfjs-dist';

/**
 * PDF.js's fixed options for this page, chosen so that reading a PDF can never make a network request:
 * `useWorkerFetch: false` forces every character map, font and WebAssembly request through the caller's own
 * `BinaryDataFactory` (which refuses all of them); no `cMapUrl`, `standardFontDataUrl` or `wasmUrl` is ever given, so
 * PDF.js has no address to ask for; `enableXfa: false` keeps XFA forms off; `verbosity: 0` keeps PDF.js's warnings out
 * of the console; `useSystemFonts: false` makes PDF.js ask for the standard font data (and be refused) instead of
 * depending on the visitor's fonts. `isEvalSupported: false` is the option older PDF.js versions use to stop font code
 * being built with `eval`; pdfjs-dist 6.3.289 has no such option and ignores it, and it stays so that a version that has
 * the option is told never to use it.
 */
export const PDFJS_SAFE_OPTIONS = {
  useWorkerFetch: false,
  verbosity: 0,
  enableXfa: false,
  useSystemFonts: false,
  isEvalSupported: false,
} as const;

/**
 * Refuses a file that should not be parsed, before it is parsed: one over 100 MB (from its reported size, whatever the
 * header says), an empty one, and one that is not a PDF (`%PDF-` and a digit in its first kilobyte, ISO 32000-1 section
 * 7.5.2). `header` is the first bytes of the file (at most `MAX_HEADER_BYTES` are looked at). Throws `PdfToolError` with
 * a plain message that never holds the file's name or content.
 */
export function checkPdfFile(header: Uint8Array, byteLength: number): void {
  if (byteLength > MAX_PDF_BYTES) throw new PdfToolError('size');
  if (byteLength === 0 || header.length === 0) throw new PdfToolError('not-pdf', 'This file is empty.');
  try {
    assertFileKind(header, ['pdf'], { maxBytes: MAX_PDF_BYTES });
  } catch {
    throw new PdfToolError('not-pdf');
  }
}

/** True for the code units a file name may not carry into a download name: controls and direction marks. */
function isDropped(unit: number): boolean {
  if (unit <= 0x1f || (unit >= 0x7f && unit <= 0x9f)) return true;
  if (unit === 0x61c || unit === 0x200e || unit === 0x200f) return true;
  if (unit >= 0x202a && unit <= 0x202e) return true;
  return unit >= 0x2066 && unit <= 0x2069;
}

/**
 * The name of the copy: the picked file's base name (no folder, no final extension, no control or direction-changing
 * character), at most 100 characters, then `-clean.pdf`. A name with nothing left is `document`.
 */
export function cleanCopyName(fileName: string): string {
  const cut = Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf(String.fromCharCode(92)));
  let kept = '';
  for (const char of fileName.slice(cut + 1)) {
    if (!isDropped(char.codePointAt(0)!)) kept += char;
  }
  kept = kept.trim();
  const dot = kept.lastIndexOf('.');
  if (dot >= 0) kept = kept.slice(0, dot);
  const base = Array.from(kept).slice(0, 100).join('').trim();
  return `${base === '' ? 'document' : base}-clean.pdf`;
}

/** One request PDF.js made for data this page does not carry. */
export interface BinaryRequest {
  /** `font` (standard font data), `cmap` (a character map), `wasm` (a decoder) or `other`. */
  kind: 'font' | 'cmap' | 'wasm' | 'other';
  filename: string;
}

/** The shape PDF.js's `getDocument` calls on a `BinaryDataFactory`: one function, called with the kind and the file name. */
interface RefusingFactory {
  readonly fetch: (request: { kind: string; filename: string }) => Promise<Uint8Array>;
}

function kindOf(kind: string): BinaryRequest['kind'] {
  if (kind === 'standardFontDataUrl') return 'font';
  if (kind === 'cMapUrl') return 'cmap';
  if (kind === 'wasmUrl') return 'wasm';
  return 'other';
}

/**
 * A `BinaryDataFactory` class for PDF.js's `getDocument` (which constructs it itself) that answers every request for a
 * font, a character map or a WebAssembly decoder by refusing it, and records each request by kind in `requests` (and
 * through `onRequest`). Reading text and metadata needs none of that data: PDF.js falls back for fonts and goes on, and a
 * request for a character map is how a page learns that some text may be missing. Nothing is ever fetched.
 */
export function createRefusingBinaryDataFactory(onRequest?: (request: BinaryRequest) => void): {
  Factory: new (...args: unknown[]) => RefusingFactory;
  requests: BinaryRequest[];
} {
  const requests: BinaryRequest[] = [];
  class RefusingBinaryDataFactory implements RefusingFactory {
    constructor(..._args: unknown[]) {
      // PDF.js passes the (unset) addresses it was given; there is nothing to keep.
    }
    // A property holding a function, not a method: the same call for PDF.js, and nothing here for a reader of the source
    // to mistake for a network call.
    readonly fetch = ({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> => {
      const request: BinaryRequest = { kind: kindOf(kind), filename: visible(filename) };
      requests.push(request);
      onRequest?.(request);
      return Promise.reject(new Error('This page loads no data files.'));
    };
  }
  return { Factory: RefusingBinaryDataFactory, requests };
}
