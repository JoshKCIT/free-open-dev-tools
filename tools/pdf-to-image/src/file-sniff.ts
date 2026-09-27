/**
 * Canonical header checks for every file format a phase 9 tool reads,
 * checked from a file's own leading bytes only, before any real parsing or
 * decoding ever touches it. This header names only the specifications each
 * check implements, never a tool: every phase 9 file-reading package copies
 * this file byte for byte.
 *
 * ISO 32000-1:2008 section 7.5.2 "File Header" (fetched from Adobe's own
 * public copy, opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/
 * PDF32000_2008.pdf): "The first line of a PDF file shall be a header
 * consisting of the 5 characters %PDF- followed by a version number of the
 * form 1.N, where N is a digit between 0 and 7." This project follows
 * PDF.js's own leniency here (its `find(stream, PDF_HEADER_SIGNATURE)` call
 * in src/core/document.js at the installed 6.3.289 tag, whose `find`
 * defaults to a 1024-byte search limit) and accepts the header signature
 * starting anywhere within the first 1024 bytes, not only at byte 0, since
 * real-world PDFs sometimes carry junk (or a shebang line) before it.
 *
 * Other formats are added by a later plan in this same phase.
 */

export type FileKind = 'pdf' | 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'zip' | 'gzip' | 'tar';

export const FILE_KINDS: FileKind[] = ['pdf', 'png', 'jpeg', 'gif', 'webp', 'bmp', 'zip', 'gzip', 'tar'];

/** A human word for each kind, used only to build a visitor-facing message. */
const KIND_WORDS: Record<FileKind, string> = {
  pdf: 'PDF',
  png: 'PNG',
  jpeg: 'JPEG',
  gif: 'GIF',
  webp: 'WebP',
  bmp: 'BMP',
  zip: 'ZIP',
  gzip: 'gzip',
  tar: 'TAR',
};

/** At most this many leading bytes are ever read to identify a file's kind. */
export const MAX_HEADER_BYTES = 64 * 1024;

export interface SniffResult {
  kind: FileKind;
  width?: number;
  height?: number;
}

export class FileSignatureError extends Error {
  /** Why the file was refused, for tests and for callers that want to branch on it. */
  readonly reason: string;
  constructor(message: string, reason: string) {
    super(message);
    this.name = 'FileSignatureError';
    this.reason = reason;
  }
}

const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const PDF_HEADER_SEARCH_LIMIT = 1024;

function sniffPdf(bytes: Uint8Array): SniffResult | null {
  const limit = Math.min(bytes.length, PDF_HEADER_SEARCH_LIMIT);
  for (let i = 0; i <= limit - PDF_HEADER.length; i++) {
    let matched = true;
    for (let j = 0; j < PDF_HEADER.length; j++) {
      if (bytes[i + j] !== PDF_HEADER[j]) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    const digit = bytes[i + PDF_HEADER.length];
    if (digit !== undefined && digit >= 0x30 && digit <= 0x39) {
      return { kind: 'pdf' };
    }
  }
  return null;
}

/**
 * Reads at most `MAX_HEADER_BYTES` of a file and reports its kind, or
 * `null` when nothing this project reads recognises it. Never decodes a
 * page, a pixel or an archive entry -- only ever looks at header bytes.
 */
export function sniffFile(bytes: Uint8Array): SniffResult | null {
  const header = bytes.length > MAX_HEADER_BYTES ? bytes.subarray(0, MAX_HEADER_BYTES) : bytes;
  return sniffPdf(header);
  // A later plan in this phase adds png/jpeg/gif/webp/bmp/zip/gzip/tar here.
}

export interface FileKindLimits {
  maxBytes: number;
  maxPixels?: number;
}

function describeAccepted(accepted: FileKind[]): string {
  const words = accepted.map((k) => KIND_WORDS[k]);
  if (words.length === 1) return `a ${words[0]}`;
  return `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`;
}

/**
 * Refuses an empty file, a file over `limits.maxBytes`, an unrecognised
 * header, a recognised kind outside `accepted`, or -- once the sniffed
 * result carries dimensions -- a declared pixel count over
 * `limits.maxPixels`. Returns the sniff result only when every check
 * passes. Never quotes any byte of the file's own content in a message.
 */
export function assertFileKind(bytes: Uint8Array, accepted: FileKind[], limits: FileKindLimits): SniffResult {
  if (bytes.length === 0) {
    throw new FileSignatureError('this file is empty', 'empty');
  }
  if (bytes.length > limits.maxBytes) {
    throw new FileSignatureError("it is larger than this tool's size limit", 'too-large');
  }
  const result = sniffFile(bytes);
  if (!result) {
    throw new FileSignatureError(`this is not ${describeAccepted(accepted)}`, 'unrecognised');
  }
  if (!accepted.includes(result.kind)) {
    throw new FileSignatureError(`this is not ${describeAccepted(accepted)}`, 'wrong-kind');
  }
  if (
    limits.maxPixels !== undefined &&
    result.width !== undefined &&
    result.height !== undefined &&
    result.width * result.height > limits.maxPixels
  ) {
    throw new FileSignatureError(
      `this ${KIND_WORDS[result.kind]} declares more pixels than this tool's limit allows`,
      'too-many-pixels',
    );
  }
  return result;
}
