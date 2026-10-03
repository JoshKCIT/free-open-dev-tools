/** Stub: the layout maths arrive in the next commit. */

export class SpriteSheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpriteSheetError';
  }
}

export const MAX_IMAGES = 200;
export const MAX_IMAGE_SIDE = 4096;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_SHEET_PIXELS = 16_000_000;
export const MAX_SHEET_SIDE = 8192;
export const MAX_PADDING = 64;

export interface SpriteInput {
  name: string;
  width: number;
  height: number;
}

export interface SpritePlacement {
  name: string;
  className: string;
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
}

export interface SpritePlan {
  width: number;
  height: number;
  placements: SpritePlacement[];
}

export interface SpriteOptions {
  layout: 'grid' | 'shelf';
  padding: number;
}

export function spriteClassName(_fileName: string, _used: Set<string>): string {
  throw new Error('not implemented');
}

export function checkPadding(_padding: number): number {
  throw new Error('not implemented');
}

export function checkSpriteInputs(_items: { width: number; height: number }[]): void {
  throw new Error('not implemented');
}

export function planSprites(_items: SpriteInput[], _options: SpriteOptions): SpritePlan {
  throw new Error('not implemented');
}
