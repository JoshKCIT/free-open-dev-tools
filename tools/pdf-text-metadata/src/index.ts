import meta from './meta.json';
import { assertFileKind, FileSignatureError, MAX_HEADER_BYTES } from './file-sniff';
import { MAX_PDF_BYTES, PDF_MESSAGES, PdfToolError } from './shared';

export { meta };
export { MAX_HEADER_BYTES };
export * from './shared';
export * from './text';
export * from './metadata';
export * from './strip';
export * from './page-range';

// The PDF.js entry points the page needs, re-exported from here so this package stays the only place pnpm resolves
// `pdfjs-dist`. The `legacy/build/` entry is the one every PDF page of this site uses and the one that runs in Node.
export { getDocument, PDFWorker, PasswordException, version } from 'pdfjs-dist/legacy/build/pdf.mjs';
export type { PDFDocumentProxy, PDFPageProxy, PDFDocumentLoadingTask } from 'pdfjs-dist';

/** Scaffold: refuses nothing yet. */
export const PDFJS_SAFE_OPTIONS = {
  useWorkerFetch: false,
  verbosity: 0,
  enableXfa: false,
  useSystemFonts: false,
  isEvalSupported: false,
} as const;

export function checkPdfFile(_header: Uint8Array, _byteLength: number): void {
  void [assertFileKind, FileSignatureError, MAX_PDF_BYTES, PDF_MESSAGES, PdfToolError];
  throw new Error('not implemented');
}

export function cleanCopyName(_fileName: string): string {
  throw new Error('not implemented');
}

export interface BinaryRequest {
  kind: 'font' | 'cmap' | 'wasm' | 'other';
  filename: string;
}

export function createRefusingBinaryDataFactory(_onRequest?: (request: BinaryRequest) => void): {
  Factory: new (...args: unknown[]) => { fetch(request: { kind: string; filename: string }): Promise<Uint8Array> };
  requests: BinaryRequest[];
} {
  throw new Error('not implemented');
}
