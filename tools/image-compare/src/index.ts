import meta from './meta.json';
import { MAX_HEADER_BYTES } from './file-sniff';

export { meta };
export { MAX_HEADER_BYTES };
export {
  compareImages,
  checkThreshold,
  DEFAULT_THRESHOLD,
  ImageCompareError,
  padPixels,
  planCompare,
  shareText,
} from './compare';
export type { CompareResult, Size } from './compare';

/** 50 MB, checked from the file's own reported size before anything is read. */
export const MAX_INPUT_BYTES = 50 * 1024 * 1024;

/** 16,000,000 declared pixels for each image, checked from the header before any decoding. */
export const MAX_INPUT_PIXELS = 16_000_000;

export function checkImageFile(
  header: Uint8Array,
  byteLength: number,
): { kind: string; width: number; height: number } {
  void header;
  void byteLength;
  throw new Error('not implemented');
}
