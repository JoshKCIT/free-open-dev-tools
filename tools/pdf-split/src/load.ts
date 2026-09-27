/**
 * Loads a PDF through @cantoo/pdf-lib (the actively maintained fork of the
 * stale upstream `pdf-lib`, D-134/D-137), refusing anything this tool
 * cannot safely rewrite: a file whose header is not a PDF's, and any
 * encrypted document. Written the same way `tools/pdf-merge/src/load.ts`
 * is; not a shared file, since each phase 9 PDF-writing tool owns its own
 * copy (09-05 plan text).
 *
 * ISO 32000-1:2008 section 7.6 "Encryption": an encrypted document's
 * trailer carries an `/Encrypt` entry naming a security handler. This tool
 * never applies one: writing a modified copy through it would produce an
 * unencrypted (or differently encrypted) file, silently dropping whatever
 * protection the source had. `@cantoo/pdf-lib`'s own `PDFDocument.load`
 * throws its `EncryptedPDFError` for an encrypted document unless a caller
 * opts out of that check with a load option this package never passes
 * (confirmed directly against the installed 2.11.1 source this session,
 * for both an owner-password-only document and a document requiring a
 * real user password) -- this package never passes that option, and never
 * passes a `password` either.
 */
import { PDFDocument, EncryptedPDFError } from '@cantoo/pdf-lib';
import { assertFileKind, FileSignatureError } from './file-sniff';

/** Total input bytes a single loaded PDF may declare, checked by its header before any parsing. */
export const MAX_PDF_BYTES = 200 * 1024 * 1024;

export class PdfLoadError extends Error {
  readonly fileName: string;
  readonly reason: string;
  constructor(message: string, fileName: string, reason: string) {
    super(message);
    this.name = 'PdfLoadError';
    this.fileName = fileName;
    this.reason = reason;
  }
}

/**
 * Checks `bytes`' own header, then loads it through `@cantoo/pdf-lib` with
 * `updateMetadata: false` and without `ignoreEncryption` or a `password`.
 * Refuses by name, never returning a document, when: the header is not a
 * PDF's; the library reports the document encrypted at load time; or --
 * belt and suspenders, since no load path this package uses is expected to
 * reach it -- a document that did load still reports `isEncrypted`.
 */
export async function loadPdf(bytes: Uint8Array, fileName: string): Promise<PDFDocument> {
  try {
    assertFileKind(bytes, ['pdf'], { maxBytes: MAX_PDF_BYTES });
  } catch (err) {
    if (err instanceof FileSignatureError) {
      throw new PdfLoadError(`Could not open '${fileName}': ${err.message}.`, fileName, err.reason);
    }
    throw err;
  }

  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if (err instanceof EncryptedPDFError) {
      throw new PdfLoadError(
        `Could not open '${fileName}': it is encrypted. This page does not open encrypted PDFs, including ones that open without a password.`,
        fileName,
        'encrypted',
      );
    }
    const reason = err instanceof Error ? err.message : String(err);
    throw new PdfLoadError(
      `Could not open '${fileName}': it is not a PDF this page can read (${reason}).`,
      fileName,
      'invalid',
    );
  }

  if (document.isEncrypted) {
    throw new PdfLoadError(
      `Could not open '${fileName}': it is encrypted. This page does not open encrypted PDFs, including ones that open without a password.`,
      fileName,
      'encrypted',
    );
  }

  return document;
}
