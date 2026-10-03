import meta from './meta.json';
import { assertFileKind, FileSignatureError, MAX_HEADER_BYTES, type FileKind } from './file-sniff';
import { MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, MAX_SHEET_PIXELS, SpriteSheetError } from './layout';

export { meta };
export { MAX_HEADER_BYTES };
export {
  checkPadding,
  checkSpriteInputs,
  planSprites,
  spriteClassName,
  SpriteSheetError,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_SIDE,
  MAX_PADDING,
  MAX_SHEET_PIXELS,
  MAX_SHEET_SIDE,
} from './layout';
export type { SpriteInput, SpriteOptions, SpritePlacement, SpritePlan } from './layout';
export { spriteCss, spritePreviewCss, SHEET_FILE_NAME } from './css';

/** The five raster formats this page accepts as image files. */
const ACCEPTED_KINDS: FileKind[] = ['png', 'jpeg', 'gif', 'webp', 'bmp'];

const KINDS_SENTENCE = 'PNG, JPEG, GIF, WebP or BMP';

/**
 * Refuses a file that should not be decoded, before it is decoded: one over 20 MB (from its reported size, whatever the
 * header says), an empty one, one that is not a PNG, JPEG, GIF, WebP or BMP image, one more than 4,096 pixels on a side,
 * and one with more pixels than a sheet can hold. `header` is the first bytes of the file (at most MAX_HEADER_BYTES are
 * looked at). Every message names a size or a limit and never holds any of the file's own content or its name.
 */
export function checkSpriteFile(
  header: Uint8Array,
  byteLength: number,
): { kind: string; width: number; height: number } {
  if (byteLength > MAX_IMAGE_BYTES) {
    throw new SpriteSheetError('This file is larger than 20 MB, the most this page accepts for one image.');
  }
  if (byteLength === 0 || header.length === 0) {
    throw new SpriteSheetError('This file is empty.');
  }
  let sniffed;
  try {
    sniffed = assertFileKind(header, ACCEPTED_KINDS, { maxBytes: MAX_IMAGE_BYTES });
  } catch (err) {
    if (err instanceof FileSignatureError) {
      throw new SpriteSheetError(`This is not a ${KINDS_SENTENCE} image.`);
    }
    throw new SpriteSheetError('This image could not be checked.');
  }
  const { width, height } = sniffed;
  if (width === undefined || height === undefined) {
    throw new SpriteSheetError('The size of this image could not be read from its header.');
  }
  if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) {
    throw new SpriteSheetError(
      `This image is ${width} by ${height} pixels. The most is ${MAX_IMAGE_SIDE} pixels on a side.`,
    );
  }
  if (width * height > MAX_SHEET_PIXELS) {
    throw new SpriteSheetError(
      `This image holds ${(width * height).toLocaleString('en-US')} pixels. A sheet may have at most ${MAX_SHEET_PIXELS.toLocaleString('en-US')} pixels, so it cannot fit.`,
    );
  }
  return { kind: sniffed.kind, width, height };
}
