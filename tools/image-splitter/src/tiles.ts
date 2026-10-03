/**
 * Where each tile of a picture is, and what it is called.
 *
 * Everything here is plain arithmetic on whole numbers: no picture is ever read, so the same size and settings give the
 * same tiles every time, in Node and in every browser. A refusal is a plain sentence that names a count, a size or a
 * limit and never a file name or any byte of a picture.
 */

/** A refusal with a plain sentence the page can show as it is. */
export class ImageSplitterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageSplitterError';
  }
}

/** At most this many tiles are made in one run. */
export const MAX_TILES = 400;

/** Rows and columns each go from 1 to this. */
export const MAX_GRID_SIDE = 100;

/** A tile width or height goes from 1 to this many pixels. */
export const MAX_TILE_SIDE = 40_000;

export interface TileRect {
  /** Counted from 1, from the top. */
  row: number;
  /** Counted from 1, from the left. */
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** For example `tile-r1-c1.png`: made from the row and column numbers only. */
  name: string;
}

export type TileMode =
  { kind: 'grid'; rows: number; columns: number } | { kind: 'size'; tileWidth: number; tileHeight: number };

export type TileFormat = 'png' | 'jpeg';

function isWhole(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n);
}

function checkRange(value: number, label: string, max: number): void {
  if (!isWhole(value) || value < 1 || value > max) {
    throw new ImageSplitterError(`${label} must be a whole number from 1 to ${max}.`);
  }
}

function padded(n: number, digits: number): string {
  return String(n).padStart(digits, '0');
}

/**
 * The name of one tile: `tile-r<row>-c<column>` and `.png` or `.jpg`. Row and column count from 1 and are padded with
 * zeros to the number of digits of the larger of `rows` and `columns`, so names sort in the order of the tiles.
 */
export function tileName(row: number, column: number, rows: number, columns: number, format: TileFormat): string {
  const digits = String(Math.max(rows, columns)).length;
  return `tile-r${padded(row, digits)}-c${padded(column, digits)}.${format === 'jpeg' ? 'jpg' : 'png'}`;
}

/** The start of each of `parts` pieces of `size` (and one more entry for the end): the whole number below i * size / parts. */
function evenEdges(size: number, parts: number): number[] {
  const edges: number[] = [];
  for (let i = 0; i <= parts; i++) edges.push(Math.floor((i * size) / parts));
  return edges;
}

/** The start of each piece of a fixed `step`, the last one ending at `size`. */
function stepEdges(size: number, step: number, parts: number): number[] {
  const edges: number[] = [];
  for (let i = 0; i < parts; i++) edges.push(i * step);
  edges.push(size);
  return edges;
}

function refuseCount(count: number): never {
  throw new ImageSplitterError(
    `That would make ${count.toLocaleString('en-US')} tiles. The most is ${MAX_TILES} tiles, so use fewer rows and columns or larger tiles.`,
  );
}

/**
 * Cuts a `width` by `height` picture into tiles, in row-major order (left to right, then down).
 *
 * Rows and columns mode: column i spans the whole number below `i * width / columns` up to the one below `(i + 1) * width
 * / columns`, rows likewise, so tiles differ by at most one pixel. Tile size mode: tiles of the size asked for from the
 * top left, with a smaller last column and last row when the size does not divide the picture. Refuses a picture with no
 * size, rows or columns that are not whole numbers from 1 to 100, a tile size that is not a whole number from 1 to 40000,
 * more rows or columns than pixels, and more than 400 tiles (counted before any tile is built).
 */
export function planTiles(width: number, height: number, mode: TileMode, format: TileFormat): TileRect[] {
  if (!isWhole(width) || !isWhole(height) || width < 1 || height < 1) {
    throw new ImageSplitterError('The image has no usable size.');
  }
  let columnEdges: number[];
  let rowEdges: number[];
  if (mode.kind === 'grid') {
    checkRange(mode.rows, 'Rows', MAX_GRID_SIDE);
    checkRange(mode.columns, 'Columns', MAX_GRID_SIDE);
    if (mode.rows > height) {
      throw new ImageSplitterError(`The image is ${height} pixels tall, so it cannot be cut into ${mode.rows} rows.`);
    }
    if (mode.columns > width) {
      throw new ImageSplitterError(
        `The image is ${width} pixels wide, so it cannot be cut into ${mode.columns} columns.`,
      );
    }
    if (mode.rows * mode.columns > MAX_TILES) refuseCount(mode.rows * mode.columns);
    columnEdges = evenEdges(width, mode.columns);
    rowEdges = evenEdges(height, mode.rows);
  } else {
    checkRange(mode.tileWidth, 'Tile width', MAX_TILE_SIDE);
    checkRange(mode.tileHeight, 'Tile height', MAX_TILE_SIDE);
    const columns = Math.ceil(width / mode.tileWidth);
    const rows = Math.ceil(height / mode.tileHeight);
    if (rows * columns > MAX_TILES) refuseCount(rows * columns);
    columnEdges = stepEdges(width, mode.tileWidth, columns);
    rowEdges = stepEdges(height, mode.tileHeight, rows);
  }
  const columns = columnEdges.length - 1;
  const rows = rowEdges.length - 1;
  const tiles: TileRect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      tiles.push({
        row: r + 1,
        column: c + 1,
        x: columnEdges[c]!,
        y: rowEdges[r]!,
        width: columnEdges[c + 1]! - columnEdges[c]!,
        height: rowEdges[r + 1]! - rowEdges[r]!,
        name: tileName(r + 1, c + 1, rows, columns, format),
      });
    }
  }
  return tiles;
}
