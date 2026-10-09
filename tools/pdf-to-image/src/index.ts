import meta from './meta.json';
import { BUNDLED_BINARY_DATA } from './binary-data';

export { meta };
export { BUNDLED_BINARY_DATA };

export * from './file-sniff';
export * from './render';
export * from './page-range';

// The PDF.js entry points the page and worker need. Re-exported from here
// (not imported directly by apps/web) so this package stays the only place
// pnpm resolves `pdfjs-dist`, per this file's own dependency declaration.
//
// Imports the `legacy/build/` entry, not the modern `build/` entry:
// measured directly this session, the modern build throws
// `UnknownErrorException: hashOriginal.toHex is not a function` the moment
// a document is opened under plain Node (this package's own standalone
// test suite), and pdfjs-dist's own modern build prints "Please use the
// `legacy` build in Node.js environments" for exactly this reason. The
// legacy build loads and renders correctly in Node (confirmed this
// session) and is also what every tested browser project (chromium,
// firefox, webkit, mobile-chrome) renders correctly, so both this
// package's own tests and the browser worker (pdf-worker-entry.ts) use the
// same build -- never testing one code path while shipping another.
export {
  getDocument,
  PDFWorker,
  PasswordException,
  GlobalWorkerOptions,
  version,
  AnnotationMode,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
export type { PDFDocumentProxy, PDFPageProxy, PDFDocumentLoadingTask } from 'pdfjs-dist';

/**
 * Decodes bundled binary data for a PDF.js `BinaryDataFactory` request, or
 * returns `null` when this tool does not bundle that file (for example
 * every Liberation Sans file the Helvetica standard fonts map to, which
 * this project's licence gate does not allow). `kind` is accepted for
 * callers that want to record it
 * alongside a request; lookup itself is by `filename`, which is unique
 * across every bundled entry.
 */
export function bundledBinaryData(_kind: string, filename: string): Uint8Array | null {
  const entry = BUNDLED_BINARY_DATA[filename];
  if (!entry) return null;
  const binary = atob(entry.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
