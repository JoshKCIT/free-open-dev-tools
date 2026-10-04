import { prepareZXingModule, readBarcodesFromImageData } from 'zxing-wasm/reader';
import meta from './meta.json';
import { assertFileKind, FileSignatureError, MAX_HEADER_BYTES, type FileKind } from './file-sniff';
import { toCodeResult, type CodeResult } from './results';

export { meta };
export { MAX_HEADER_BYTES };
export { MAX_TEXT_SHOWN, SYMBOLOGY_LABELS, toCodeResult, visible } from './results';
export type { CodeResult } from './results';

/** The five raster formats this reader accepts as image files. */
const ACCEPTED_KINDS: FileKind[] = ['png', 'jpeg', 'gif', 'webp', 'bmp'];

/** 50 MB, checked from the file's own reported size before anything is read. */
export const MAX_INPUT_BYTES = 50 * 1024 * 1024;

/** 50,000,000 declared pixels, checked from the header before any decoding. */
export const MAX_INPUT_PIXELS = 50_000_000;

/**
 * The most bytes of the start of a file a caller reads for `checkImageFile`. A photograph often carries more than 64 KB of
 * colour profile, XMP and editing data in front of its frame header, so a JPEG's size is looked for this far in.
 */
export const MAX_IMAGE_HEADER_BYTES = 2 * 1024 * 1024;

/** Camera frames are drawn at most this wide before they are read. */
export const MAX_FRAME_WIDTH = 1280;

/** At most this many codes are reported for one image. */
export const MAX_SYMBOLS = 16;

export class CodeReaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodeReaderError';
  }
}

export interface ImagePixels {
  /** RGBA, 4 bytes per pixel. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const KINDS_SENTENCE = 'PNG, JPEG, GIF, WebP or BMP';

const SIZE_UNREADABLE = 'The size of this image could not be read from its header.';

const SIZE_UNREADABLE_FROM_FILE = 'The size of this image could not be read from the file.';

const TOO_MANY_PIXELS =
  'This image declares more than 50,000,000 pixels, the most this reader accepts. Choose a smaller image.';

/** True when the bytes start with the two bytes that open every JPEG file. */
function isJpegStart(header: Uint8Array): boolean {
  return header.length >= 2 && header[0] === 0xff && header[1] === 0xd8;
}

/** The frame header markers of ITU-T T.81 Table B.1 (SOF0 to SOF15 without DHT, JPG and DAC). */
function isFrameMarker(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

/**
 * The width and height in the first frame header of a JPEG, found by walking its marker segments (ITU-T T.81 section
 * B.1.1.4), or null when the walk ends before one is found. The shared header check looks only at the first 64 KB; this
 * walks as far as the bytes it is given go.
 */
function jpegFrameSize(bytes: Uint8Array): { width: number; height: number } | null {
  let at = 2;
  while (at + 1 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    let marker = at + 1;
    while (bytes[marker] === 0xff) marker++;
    const code = bytes[marker];
    if (code === undefined) return null;
    const after = marker + 1;
    if (code === 0x01 || (code >= 0xd0 && code <= 0xd8)) {
      at = after;
      continue;
    }
    if (code === 0xd9 || code === 0xda || after + 2 > bytes.length) return null;
    const length = (bytes[after]! << 8) | bytes[after + 1]!;
    if (length < 2) return null;
    if (isFrameMarker(code)) {
      if (after + 7 > bytes.length) return null;
      return {
        height: (bytes[after + 3]! << 8) | bytes[after + 4]!,
        width: (bytes[after + 5]! << 8) | bytes[after + 6]!,
      };
    }
    at = after + length;
  }
  return null;
}

/** True when the bytes start with the two letters "BM" that open every BMP file. */
function isBmpStart(header: Uint8Array): boolean {
  return header.length >= 2 && header[0] === 0x42 && header[1] === 0x4d;
}

/**
 * Refuses a picture that decoded to more than 50,000,000 pixels, or to nothing. The header of a file says how big a picture
 * is, but a browser decides how big it decodes: a GIF whose screen is 1 by 1 and whose first frame is 65535 wide can come
 * back as a very large bitmap. Called with the size of the decoded bitmap, before any canvas is made for it, so a picture
 * the header check let through still cannot make the page allocate a canvas and a pixel buffer of hundreds of megabytes.
 */
export function checkDecodedSize(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new CodeReaderError('This browser could not decode this image.');
  }
  if (width * height > MAX_INPUT_PIXELS) throw new CodeReaderError(TOO_MANY_PIXELS);
}

/**
 * Refuses a file that should not be decoded, before it is decoded: one over 50 MB (from its reported size, whatever
 * the header says), an empty one, one that is not a PNG, JPEG, GIF, WebP or BMP image, and one that declares more than
 * 50,000,000 pixels. `header` is the first bytes of the file, up to MAX_IMAGE_HEADER_BYTES of them: the kind of a file is
 * told from its first 64 KB, and a JPEG whose frame header lies further in is walked up to the end of what it is given.
 * Every message names the limit or the accepted kinds and never holds any of the file's own content or its name.
 */
export function checkImageFile(
  header: Uint8Array,
  byteLength: number,
): { kind: string; width: number; height: number } {
  if (byteLength > MAX_INPUT_BYTES) {
    throw new CodeReaderError('This file is larger than 50 MB, the most this reader accepts. Choose a smaller image.');
  }
  if (byteLength === 0 || header.length === 0) {
    throw new CodeReaderError('This file is empty.');
  }
  let sniffed;
  try {
    sniffed = assertFileKind(header, ACCEPTED_KINDS, { maxBytes: MAX_INPUT_BYTES, maxPixels: MAX_INPUT_PIXELS });
  } catch (err) {
    if (err instanceof FileSignatureError) {
      if (err.reason === 'too-many-pixels') throw new CodeReaderError(TOO_MANY_PIXELS);
      if (err.reason === 'unrecognised' && isJpegStart(header)) {
        // A JPEG whose frame header is not in the first 64 KB: look further in, up to what was read.
        const size = jpegFrameSize(header.subarray(0, MAX_IMAGE_HEADER_BYTES));
        if (size === null) throw new CodeReaderError(SIZE_UNREADABLE_FROM_FILE);
        if (size.width < 1 || size.height < 1) throw new CodeReaderError(SIZE_UNREADABLE);
        if (size.width * size.height > MAX_INPUT_PIXELS) throw new CodeReaderError(TOO_MANY_PIXELS);
        return { kind: 'jpeg', width: size.width, height: size.height };
      }
      if (err.reason === 'no-size' || (err.reason === 'unrecognised' && isBmpStart(header))) {
        throw new CodeReaderError(SIZE_UNREADABLE);
      }
      throw new CodeReaderError(`This is not a ${KINDS_SENTENCE} image.`);
    }
    throw new CodeReaderError('This image could not be checked.');
  }
  if (sniffed.width === undefined || sniffed.height === undefined) {
    throw new CodeReaderError(SIZE_UNREADABLE);
  }
  return { kind: sniffed.kind, width: sniffed.width, height: sniffed.height };
}

let preparing: Promise<void> | null = null;

/**
 * Hands the engine its WebAssembly bytes and waits for it to be ready. The promise is kept, so a second call reuses
 * the first; a failed preparation is not kept, so a later call may try again. Nothing is located or fetched.
 */
export function prepareReader(wasmBinary: ArrayBuffer): Promise<void> {
  if (preparing === null) {
    const attempt = prepareZXingModule({ overrides: { wasmBinary }, fireImmediately: true }).then(() => undefined);
    preparing = attempt;
    attempt.catch(() => {
      if (preparing === attempt) preparing = null;
    });
  }
  return preparing;
}

/**
 * Reads every QR code and barcode in an RGBA picture, at most `maxSymbols` (default and ceiling MAX_SYMBOLS). The
 * engine's own defaults apply: every symbology, harder searching, rotated, inverted and reduced-size copies.
 */
export async function readCodes(pixels: ImagePixels, options: { maxSymbols?: number } = {}): Promise<CodeResult[]> {
  const { data, width, height } = pixels;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    data.length !== width * height * 4
  ) {
    throw new CodeReaderError('The picture is not in the form the reader expects.');
  }
  const wanted = options.maxSymbols;
  const max =
    wanted !== undefined && Number.isInteger(wanted) && wanted >= 1 ? Math.min(wanted, MAX_SYMBOLS) : MAX_SYMBOLS;
  const raw = await readBarcodesFromImageData({ data, width, height, colorSpace: 'srgb' } as ImageData, {
    formats: [],
    maxNumberOfSymbols: max,
  });
  return raw.slice(0, max).map((r) => toCodeResult({ format: r.format, text: r.text }));
}

/** The rows of the results table: symbology, shown text, notes. */
export function codeRows(results: CodeResult[]): string[][] {
  return results.map((r) => [r.label, r.shown, r.notes.join(' ')]);
}
