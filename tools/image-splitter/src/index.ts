import meta from './meta.json';
import { MAX_HEADER_BYTES } from './file-sniff';

export { meta };
export { MAX_HEADER_BYTES };
export { ImageSplitterError, MAX_GRID_SIDE, MAX_TILES, MAX_TILE_SIDE, planTiles, tileName } from './tiles';
export type { TileFormat, TileMode, TileRect } from './tiles';
export { checkZipTotal, MAX_ZIP_BYTES, zipTiles } from './zip';
export type { ZipEntry } from './zip';
export { plainPng } from './png-plain';

/** 100 MB, checked from the file's own reported size before anything is read. */
export const MAX_INPUT_BYTES = 100 * 1024 * 1024;

/** 40,000,000 declared pixels, checked from the header before any decoding. */
export const MAX_INPUT_PIXELS = 40_000_000;

/** Stub: the real header check arrives in the next commit. */
export function checkSplitFile(
  _header: Uint8Array,
  _byteLength: number,
): { kind: string; width: number; height: number } {
  throw new Error('not implemented');
}
