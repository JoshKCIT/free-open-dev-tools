import meta from './meta.json';
import { assertFileKind, FileSignatureError, MAX_HEADER_BYTES, type FileKind } from './file-sniff';
import { ImageSplitterError } from './tiles';

export { meta };
export { MAX_HEADER_BYTES };
export { ImageSplitterError, MAX_GRID_SIDE, MAX_TILES, MAX_TILE_SIDE, planTiles, tileName } from './tiles';
export type { TileFormat, TileMode, TileRect } from './tiles';
export { checkZipTotal, MAX_ZIP_BYTES, zipTiles } from './zip';
export type { ZipEntry } from './zip';
export { plainPng } from './png-plain';

/** The five raster formats this page accepts as image files. */
const ACCEPTED_KINDS: FileKind[] = ['png', 'jpeg', 'gif', 'webp', 'bmp'];

/** 100 MB, checked from the file's own reported size before anything is read. */
export const MAX_INPUT_BYTES = 100 * 1024 * 1024;

/** 40,000,000 declared pixels, checked from the header before any decoding. */
export const MAX_INPUT_PIXELS = 40_000_000;

const KINDS_SENTENCE = 'PNG, JPEG, GIF, WebP or BMP';

/**
 * Refuses a file that should not be decoded, before it is decoded: one over 100 MB (from its reported size, whatever the
 * header says), an empty one, one that is not a PNG, JPEG, GIF, WebP or BMP image, and one that declares more than
 * 40,000,000 pixels. `header` is the first bytes of the file (at most MAX_HEADER_BYTES are looked at). Every message names
 * the limit or the accepted kinds and never holds any of the file's own content or its name.
 */
export function checkSplitFile(
  header: Uint8Array,
  byteLength: number,
): { kind: string; width: number; height: number } {
  if (byteLength > MAX_INPUT_BYTES) {
    throw new ImageSplitterError('This file is larger than 100 MB, the most this page accepts.');
  }
  if (byteLength === 0 || header.length === 0) {
    throw new ImageSplitterError('This file is empty.');
  }
  let sniffed;
  try {
    sniffed = assertFileKind(header, ACCEPTED_KINDS, { maxBytes: MAX_INPUT_BYTES, maxPixels: MAX_INPUT_PIXELS });
  } catch (err) {
    if (err instanceof FileSignatureError) {
      if (err.reason === 'too-many-pixels') {
        throw new ImageSplitterError(
          'This image declares more than 40,000,000 pixels, the most this page accepts. Choose a smaller image.',
        );
      }
      throw new ImageSplitterError(`This is not a ${KINDS_SENTENCE} image.`);
    }
    throw new ImageSplitterError('This image could not be checked.');
  }
  if (sniffed.width === undefined || sniffed.height === undefined) {
    throw new ImageSplitterError('The size of this image could not be read from its header.');
  }
  return { kind: sniffed.kind, width: sniffed.width, height: sniffed.height };
}
