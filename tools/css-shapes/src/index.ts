import meta from './meta.json';
import type { PreviewTreeNode } from './css-safe';

export { meta };
export type { PreviewTreeNode };

export class CssShapesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CssShapesError';
  }
}

/** The four shapes, by id with the label shown on the page. */
export const SHAPES: ReadonlyMap<string, string> = new Map();

/** The eight triangle directions, by id with the label shown on the page. */
export const TRIANGLE_DIRECTIONS: ReadonlyMap<string, string> = new Map();

/** The tail or arrow sides each shape accepts, by shape id ('bubble' and 'tooltip'). */
export const TAIL_SIDES: ReadonlyMap<string, readonly string[]> = new Map();

export interface GenerateShapeOptions {
  shape?: string;
  direction?: string;
  method?: string;
  tail?: string;
  width?: number;
  height?: number;
  colour?: string;
  background?: string;
  text?: string;
}

export interface GenerateShapeResult {
  css: string;
  tree: PreviewTreeNode;
  markup: string;
  warnings: string[];
}

export function generateShape(options: GenerateShapeOptions): GenerateShapeResult {
  void options;
  throw new CssShapesError('not implemented');
}
