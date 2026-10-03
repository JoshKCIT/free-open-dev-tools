/** Stub: the tile maths arrive in the next commit. */

export class ImageSplitterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageSplitterError';
  }
}

export const MAX_TILES = 400;
export const MAX_GRID_SIDE = 100;
export const MAX_TILE_SIDE = 40_000;

export interface TileRect {
  row: number;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
}

export type TileMode =
  { kind: 'grid'; rows: number; columns: number } | { kind: 'size'; tileWidth: number; tileHeight: number };

export type TileFormat = 'png' | 'jpeg';

export function tileName(_row: number, _column: number, _rows: number, _columns: number, _format: TileFormat): string {
  throw new Error('not implemented');
}

export function planTiles(_width: number, _height: number, _mode: TileMode, _format: TileFormat): TileRect[] {
  throw new Error('not implemented');
}
