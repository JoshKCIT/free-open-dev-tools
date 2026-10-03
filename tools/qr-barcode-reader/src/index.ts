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

/**
 * Refuses a file that should not be decoded, before it is decoded: one over 50 MB (from its reported size, whatever
 * the header says), an empty one, one that is not a PNG, JPEG, GIF, WebP or BMP image, and one that declares more than
 * 50,000,000 pixels. `header` is the first bytes of the file (at most MAX_HEADER_BYTES are looked at). Every message
 * names the limit or the accepted kinds and never holds any of the file's own content or its name.
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
      if (err.reason === 'too-many-pixels') {
        throw new CodeReaderError(
          'This image declares more than 50,000,000 pixels, the most this reader accepts. Choose a smaller image.',
        );
      }
      throw new CodeReaderError(`This is not a ${KINDS_SENTENCE} image.`);
    }
    throw new CodeReaderError('This image could not be checked.');
  }
  if (sniffed.width === undefined || sniffed.height === undefined) {
    throw new CodeReaderError('The size of this image could not be read from its header.');
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
