/**
 * The page-side work of the Image Splitter: it checks the picked file, decodes the picture once on the page thread, asks
 * the package where each tile is, draws each tile on one local canvas that is reused and never appended to the document,
 * encodes it, and only when every tile is made stores them all in one ZIP.
 *
 * Everything runs on the page thread, not in a worker: decoding is one call, drawing a tile is quick, and `toBlob` is
 * already asynchronous, so a run of 400 tiles of a 16 megapixel picture took under a second in the tested engines (WebKit
 * has no OffscreenCanvas, which is the other reason). Cancel is checked between tiles, so a cancelled run stops at once,
 * and a cancelled or failed run returns nothing: the ZIP is built only after the last tile.
 *
 * Every limit is refused before any canvas exists: the file's size and header are checked first and the tile plan (which
 * counts the tiles before building any) is made from the header's size before the picture is decoded. A bitmap is closed
 * whatever happens. Nothing is fetched, stored, logged or turned into an address here.
 */
import {
  checkSplitFile,
  checkZipTotal,
  ImageSplitterError,
  MAX_HEADER_BYTES,
  MAX_INPUT_BYTES,
  plainPng,
  planTiles,
  zipTiles,
  type TileFormat,
  type TileMode,
  type TileRect,
} from '@fodt/image-splitter';
import type { RunContext } from './tool-ui';

const DECODE_FAILED_MESSAGE = 'This browser could not decode this image.';

const SURFACE_MESSAGE = 'This browser could not provide a 2D drawing surface for the tiles.';

const ENCODE_FAILED_MESSAGE = 'This browser could not encode a tile. Try smaller tiles.';

const CANCELLED_MESSAGE = 'The run was cancelled.';

/** The quality of JPEG tiles, from 0 to 1. */
const JPEG_QUALITY = 0.92;

/** A failure of this helper, with a fixed plain sentence (never the picture's name or content). */
export class ImageSplitterRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageSplitterRunError';
  }
}

export interface SplitResult {
  /** All the tiles, stored in one ZIP. */
  zip: Uint8Array;
  /** Where each tile came from, in the order they are in the ZIP. */
  tiles: TileRect[];
}

function throwIfCancelled(ctx: RunContext): void {
  if (ctx.signal.aborted) throw new ImageSplitterRunError(CANCELLED_MESSAGE);
}

/**
 * Splits the picked picture into tiles and returns them in one ZIP. Throws `ImageSplitterError` for a limit, a mode that
 * cannot be used on this picture or a file that is not a picture, and `ImageSplitterRunError` when the browser cannot
 * decode or encode, or the run was cancelled. Progress is reported after each tile.
 */
export async function splitImage(
  file: File,
  mode: TileMode,
  format: TileFormat,
  ctx: RunContext,
): Promise<SplitResult> {
  // The file's reported size first, then its header, before a single byte of it is decoded.
  const header =
    file.size > MAX_INPUT_BYTES
      ? new Uint8Array(0)
      : new Uint8Array(await file.slice(0, MAX_HEADER_BYTES).arrayBuffer());
  const declared = checkSplitFile(header, file.size);
  // The tiles are counted from the header's size, so a mode that would make too many is refused before decoding.
  planTiles(declared.width, declared.height, mode, format);
  throwIfCancelled(ctx);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ImageSplitterRunError(DECODE_FAILED_MESSAGE);
  }
  try {
    throwIfCancelled(ctx);
    // The decoded size decides the tiles (a photo with an orientation tag decodes turned).
    const tiles = planTiles(bitmap.width, bitmap.height, mode, format);

    const canvas = document.createElement('canvas'); // one canvas for every tile, never appended to the document
    const context = canvas.getContext('2d');
    if (!context) throw new ImageSplitterRunError(SURFACE_MESSAGE);
    const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';

    const entries: { name: string; bytes: Uint8Array }[] = [];
    let total = 0;
    for (let i = 0; i < tiles.length; i++) {
      throwIfCancelled(ctx);
      const tile = tiles[i]!;
      canvas.width = tile.width; // resizing clears the canvas and resets its drawing state
      canvas.height = tile.height;
      context.imageSmoothingEnabled = false;
      if (format === 'jpeg') {
        // JPEG has no transparency: transparent areas would become black, so the tile is drawn on white.
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, tile.width, tile.height);
      }
      context.drawImage(bitmap, tile.x, tile.y, tile.width, tile.height, 0, 0, tile.width, tile.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        format === 'jpeg' ? canvas.toBlob(resolve, mime, JPEG_QUALITY) : canvas.toBlob(resolve, mime),
      );
      if (!blob || blob.type !== mime) throw new ImageSplitterRunError(ENCODE_FAILED_MESSAGE);
      const raw = new Uint8Array(await blob.arrayBuffer());
      // Colour profile tags some browsers write into a PNG are taken out, so every browser shows the tile's pixels as drawn.
      const bytes = format === 'png' ? plainPng(raw) : raw;
      total = checkZipTotal(total + bytes.length);
      entries.push({ name: tile.name, bytes });
      ctx.onProgress?.((i + 1) / tiles.length, `Tile ${i + 1} of ${tiles.length}`);
    }
    throwIfCancelled(ctx);
    const zip = zipTiles(entries);
    // A result that is ready after Cancel is not offered.
    throwIfCancelled(ctx);
    return { zip, tiles };
  } catch (err) {
    if (err instanceof ImageSplitterError || err instanceof ImageSplitterRunError) throw err;
    throw new ImageSplitterRunError(ENCODE_FAILED_MESSAGE);
  } finally {
    bitmap.close();
  }
}
