/**
 * The page-side work of the Sprite Sheet Generator: it checks every picked file, decodes the pictures one at a time on
 * the page thread, asks the package where each one goes, draws them all on one local canvas that is never appended to the
 * document, and encodes the sheet as a PNG.
 *
 * Everything runs on the page thread, not in a worker: decoding and drawing are short (about 200 small images took a few
 * milliseconds in the tested engines), WebKit has no OffscreenCanvas, and `toBlob` is already asynchronous. Cancel is
 * checked between the pictures, so a cancelled run stops at once and returns nothing.
 *
 * Every limit is refused before any canvas exists: the count of files, each file's size and header, each declared size,
 * and the area the pictures hold together are checked first; the layout (and with it the sheet size) is checked before
 * the canvas is made. A bitmap is closed as soon as it is no longer needed, whatever happens.
 *
 * Nothing is fetched, stored, logged or turned into an address here, and the canvas is a local variable, so a picked
 * picture is never shown except as the page's own sheet.
 */
import {
  checkPadding,
  checkSpriteFile,
  checkSpriteInputs,
  MAX_HEADER_BYTES,
  MAX_IMAGE_BYTES,
  planSprites,
  plainPng,
  SpriteSheetError,
  type SpriteInput,
  type SpriteOptions,
  type SpritePlan,
} from '@fodt/sprite-sheet';
import type { RunContext } from './tool-ui';

const DECODE_FAILED_MESSAGE = 'This browser could not decode this image.';

const SURFACE_MESSAGE = 'This browser could not provide a 2D drawing surface for the sheet.';

const ENCODE_FAILED_MESSAGE = 'This browser could not encode the sprite sheet.';

const CANCELLED_MESSAGE = 'The run was cancelled.';

/** A failure of this helper, with a fixed plain sentence (never any picture's name or content). */
export class SpriteSheetRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpriteSheetRunError';
  }
}

export interface SpriteSheetResult {
  /** The sheet as PNG bytes. */
  png: Uint8Array;
  plan: SpritePlan;
}

/** Runs a check that throws the package's error, naming which picture it was about (counting from 1). */
function labelled<T>(index: number, check: () => T): T {
  try {
    return check();
  } catch (err) {
    if (err instanceof SpriteSheetError) throw new SpriteSheetError(`Image ${index + 1}: ${err.message}`);
    throw err;
  }
}

function throwIfCancelled(ctx: RunContext): void {
  if (ctx.signal.aborted) throw new SpriteSheetRunError(CANCELLED_MESSAGE);
}

/**
 * Packs the picked images into one sheet and returns it as a PNG with its plan. Throws `SpriteSheetError` for a limit,
 * a padding or a picture that cannot be used, and `SpriteSheetRunError` when the browser cannot decode or encode, or the
 * run was cancelled. The plan's class names come from the file names; nothing else about a file name is kept.
 */
export async function buildSpriteSheet(
  files: File[],
  options: SpriteOptions,
  ctx: RunContext,
): Promise<SpriteSheetResult> {
  checkPadding(options.padding);
  // The count first, before a single file is read.
  checkSpriteInputs(files.map(() => ({ width: 1, height: 1 })));

  // Every file is checked by its reported size and its header before any of them is decoded.
  const declared: { width: number; height: number }[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    throwIfCancelled(ctx);
    const header =
      file.size > MAX_IMAGE_BYTES
        ? new Uint8Array(0)
        : new Uint8Array(await file.slice(0, MAX_HEADER_BYTES).arrayBuffer());
    const sniffed = labelled(i, () => checkSpriteFile(header, file.size));
    declared.push({ width: sniffed.width, height: sniffed.height });
  }
  // The area the pictures hold together can never exceed the sheet's, so a set that is too heavy is refused here.
  checkSpriteInputs(declared);

  const bitmaps: ImageBitmap[] = [];
  try {
    const items: SpriteInput[] = [];
    for (let i = 0; i < files.length; i++) {
      throwIfCancelled(ctx);
      const file = files[i]!;
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch {
        throw new SpriteSheetRunError(`Image ${i + 1}: ${DECODE_FAILED_MESSAGE}`);
      }
      bitmaps.push(bitmap);
      items.push({ name: file.name, width: bitmap.width, height: bitmap.height });
    }
    throwIfCancelled(ctx);

    // The decoded sizes decide the layout (a photo with an orientation tag decodes turned), and the package refuses a
    // sheet over its caps here, before any canvas is made.
    const plan = planSprites(items, options);

    const canvas = document.createElement('canvas'); // never appended to the document
    canvas.width = plan.width;
    canvas.height = plan.height;
    const context = canvas.getContext('2d');
    if (!context) throw new SpriteSheetRunError(SURFACE_MESSAGE);
    for (const placement of plan.placements) {
      throwIfCancelled(ctx);
      context.drawImage(bitmaps[placement.index]!, placement.x, placement.y);
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob || blob.type !== 'image/png') throw new SpriteSheetRunError(ENCODE_FAILED_MESSAGE);
    // Colour profile tags some browsers write are taken out, so every browser shows the sheet's pixels as they were drawn.
    const png = plainPng(new Uint8Array(await blob.arrayBuffer()));
    // A result that is ready after Cancel is not offered.
    throwIfCancelled(ctx);
    return { png, plan };
  } finally {
    for (const bitmap of bitmaps) bitmap.close();
  }
}
