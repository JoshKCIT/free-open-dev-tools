import meta from './meta.json';
import { assertFileKind, FileSignatureError, MAX_HEADER_BYTES, type FileKind } from './file-sniff';
import { MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, SpriteSheetError } from './layout';

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

/**
 * Stub: the real header check arrives in the next commit.
 */
export function checkSpriteFile(
  _header: Uint8Array,
  _byteLength: number,
): { kind: string; width: number; height: number } {
  void assertFileKind;
  void FileSignatureError;
  void ACCEPTED_KINDS;
  void MAX_IMAGE_BYTES;
  void MAX_IMAGE_SIDE;
  void SpriteSheetError;
  throw new Error('not implemented');
}
