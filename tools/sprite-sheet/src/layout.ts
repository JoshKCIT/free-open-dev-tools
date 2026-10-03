/**
 * Where each picked image goes on the sprite sheet, and what its CSS class is called.
 *
 * Everything here is plain arithmetic on whole numbers: no picture is ever read, so the same sizes and settings give the
 * same sheet every time, in Node and in every browser. A refusal is a plain sentence that names a count, a size or a
 * limit and never a file name or any byte of a picture.
 */

/** A refusal with a plain sentence the page can show as it is. */
export class SpriteSheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpriteSheetError';
  }
}

/** At most this many images are packed in one run. */
export const MAX_IMAGES = 200;

/** Each image may be this many pixels wide and this many tall. */
export const MAX_IMAGE_SIDE = 4096;

/** One picked file may be this large, checked from its reported size before anything is read. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** The sheet may hold this many pixels, which is also the most the picked images may hold together. */
export const MAX_SHEET_PIXELS = 16_000_000;

/** The sheet may be this many pixels wide and this many tall. */
export const MAX_SHEET_SIDE = 8192;

/** The most space, in pixels, that can be left between neighbouring sprites. */
export const MAX_PADDING = 64;

/** Class names are cut to this many characters. */
const MAX_CLASS_NAME = 40;

export interface SpriteInput {
  /** The picked file's name; only ever used to make the class name, never shown or written anywhere else. */
  name: string;
  width: number;
  height: number;
}

export interface SpritePlacement {
  /** The picked file's name as given. */
  name: string;
  /** The class name without its `sprite-` prefix: lower case letters, digits and hyphens, at most 40 characters. */
  className: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The position of the image in the order it was picked, from 0. */
  index: number;
}

export interface SpritePlan {
  /** The size of the sheet; 0 by 0 when there are no images. */
  width: number;
  height: number;
  /** One entry per image, in the order the images were picked. */
  placements: SpritePlacement[];
}

export interface SpriteOptions {
  layout: 'grid' | 'shelf';
  padding: number;
}

/**
 * Makes a class name from a file name: the extension is dropped, the rest is made lower case, every run of characters
 * other than a to z and 0 to 9 becomes one hyphen, hyphens at either end go, and the result is cut to 40 characters.
 * Nothing left gives `sprite`. A name already in `used` gets `-2`, `-3` and so on (still at most 40 characters in all),
 * and the name chosen is added to `used`.
 */
export function spriteClassName(fileName: string, used: Set<string>): string {
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const slug = slugOf(base);
  let candidate = slug;
  let n = 2;
  while (used.has(candidate)) {
    const suffix = `-${n}`;
    candidate = trimHyphens(slug.slice(0, MAX_CLASS_NAME - suffix.length)) + suffix;
    n++;
  }
  used.add(candidate);
  return candidate;
}

function trimHyphens(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text.charCodeAt(start) === 45) start++;
  while (end > start && text.charCodeAt(end - 1) === 45) end--;
  return text.slice(start, end);
}

/** The base name made safe: one pass, so a very long name costs no more than its length. */
function slugOf(base: string): string {
  const lower = base.toLowerCase();
  let out = '';
  let pendingHyphen = false;
  for (let i = 0; i < lower.length && out.length < MAX_CLASS_NAME; i++) {
    const c = lower.charCodeAt(i);
    const keep = (c >= 97 && c <= 122) || (c >= 48 && c <= 57);
    if (keep) {
      if (pendingHyphen && out.length > 0) out += '-';
      pendingHyphen = false;
      out += lower[i];
    } else {
      pendingHyphen = true;
    }
  }
  const cut = trimHyphens(out.slice(0, MAX_CLASS_NAME));
  return cut === '' ? 'sprite' : cut;
}

/** The smallest whole number whose square is at least `n`. */
function ceilSqrt(n: number): number {
  let s = Math.floor(Math.sqrt(n));
  while (s * s < n) s++;
  while (s > 0 && (s - 1) * (s - 1) >= n) s--;
  return s;
}

function isWhole(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n);
}

/** Refuses a padding that is not a whole number from 0 to 64, naming the Padding field. */
export function checkPadding(padding: number): number {
  if (!isWhole(padding) || padding < 0 || padding > MAX_PADDING) {
    throw new SpriteSheetError(`Padding must be a whole number from 0 to ${MAX_PADDING}.`);
  }
  return padding;
}

/**
 * Refuses a set of images that cannot be packed whatever the layout: more than 200, one over 4,096 pixels on a side, or
 * together holding more pixels than a sheet may have (a sheet always holds every image, so it cannot be smaller than
 * their total area). Image numbers in messages count from 1 in the order picked.
 */
export function checkSpriteInputs(items: { width: number; height: number }[]): void {
  if (items.length > MAX_IMAGES) {
    throw new SpriteSheetError(`You picked ${items.length} images. The most that can be packed is ${MAX_IMAGES}.`);
  }
  let area = 0;
  items.forEach((item, i) => {
    if (!isWhole(item.width) || !isWhole(item.height) || item.width < 1 || item.height < 1) {
      throw new SpriteSheetError(`Image ${i + 1} has no usable size.`);
    }
    if (item.width > MAX_IMAGE_SIDE || item.height > MAX_IMAGE_SIDE) {
      throw new SpriteSheetError(
        `Image ${i + 1} is ${item.width} by ${item.height} pixels. The most is ${MAX_IMAGE_SIDE} pixels on a side.`,
      );
    }
    area += item.width * item.height;
  });
  if (area > MAX_SHEET_PIXELS) {
    throw new SpriteSheetError(
      `These images hold ${area.toLocaleString('en-US')} pixels together. A sheet may have at most ${MAX_SHEET_PIXELS.toLocaleString('en-US')} pixels, so pick fewer or smaller images.`,
    );
  }
}

function refuseSheet(width: number, height: number): never {
  throw new SpriteSheetError(
    `This layout would make a sheet of ${width} by ${height} pixels. A sheet may be at most ${MAX_SHEET_SIDE} pixels on a side and ${MAX_SHEET_PIXELS.toLocaleString('en-US')} pixels in all. Pick fewer or smaller images, or try the other layout.`,
  );
}

/**
 * Places every image on a sheet.
 *
 * Grid: every cell is as wide as the widest image and as tall as the tallest; there are `ceil(sqrt(n))` columns; images
 * go left to right, then down, in the order picked, each at the top left of its cell.
 *
 * Shelf: images are sorted tallest first (equal heights keep the order picked) and laid left to right in rows, starting
 * a new row when the next image would pass a width of `ceil(sqrt(total area))` (never less than the widest image); each
 * row is as tall as its first, tallest image.
 *
 * `padding` is the empty space left between neighbouring sprites, in both directions; none is added around the edge.
 * The returned placements are in the order the images were picked, so the CSS and the table list them that way.
 */
export function planSprites(items: SpriteInput[], options: SpriteOptions): SpritePlan {
  const padding = checkPadding(options.padding);
  checkSpriteInputs(items);
  if (items.length === 0) return { width: 0, height: 0, placements: [] };

  const used = new Set<string>();
  const placements: SpritePlacement[] = items.map((item, index) => ({
    name: item.name,
    className: spriteClassName(item.name, used),
    x: 0,
    y: 0,
    width: item.width,
    height: item.height,
    index,
  }));

  let sheetWidth = 0;
  let sheetHeight = 0;

  if (options.layout === 'grid') {
    const columns = ceilSqrt(items.length);
    const rows = Math.ceil(items.length / columns);
    let cellWidth = 0;
    let cellHeight = 0;
    for (const item of items) {
      cellWidth = Math.max(cellWidth, item.width);
      cellHeight = Math.max(cellHeight, item.height);
    }
    for (const p of placements) {
      p.x = (p.index % columns) * (cellWidth + padding);
      p.y = Math.floor(p.index / columns) * (cellHeight + padding);
    }
    sheetWidth = columns * cellWidth + (columns - 1) * padding;
    sheetHeight = rows * cellHeight + (rows - 1) * padding;
  } else {
    let area = 0;
    let widest = 0;
    for (const item of items) {
      area += item.width * item.height;
      widest = Math.max(widest, item.width);
    }
    const shelfWidth = Math.max(widest, ceilSqrt(area));
    // Array.prototype.sort is stable, so images of equal height stay in the order picked.
    const order = placements.slice().sort((a, b) => b.height - a.height);
    let x = 0;
    let y = 0;
    let rowHeight = 0;
    for (const p of order) {
      if (x > 0 && x + p.width > shelfWidth) {
        y += rowHeight + padding;
        x = 0;
        rowHeight = 0;
      }
      p.x = x;
      p.y = y;
      x += p.width + padding;
      rowHeight = Math.max(rowHeight, p.height);
      sheetWidth = Math.max(sheetWidth, p.x + p.width);
      sheetHeight = Math.max(sheetHeight, p.y + p.height);
    }
  }

  if (sheetWidth > MAX_SHEET_SIDE || sheetHeight > MAX_SHEET_SIDE || sheetWidth * sheetHeight > MAX_SHEET_PIXELS) {
    refuseSheet(sheetWidth, sheetHeight);
  }
  return { width: sheetWidth, height: sheetHeight, placements };
}
