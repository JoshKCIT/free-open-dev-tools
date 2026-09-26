import meta from './meta.json';
import type { PreviewTreeNode } from './css-safe';
import { GridSyntaxError } from './grid-syntax';

export { meta };
export type { PreviewTreeNode };
export { GridSyntaxError };

export class GridError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GridError';
  }
}

export interface GenerateGridOptions {
  columns?: string;
  rows?: string;
  areas?: string;
  itemCount?: number;
  columnGap?: number;
  rowGap?: number;
  justifyItems?: unknown;
  alignItems?: unknown;
  width?: number;
  height?: number;
}

export interface GenerateGridResult {
  css: string;
  tree: PreviewTreeNode;
  warnings: string[];
}

export function generateGrid(_options: GenerateGridOptions): GenerateGridResult {
  throw new Error('not implemented');
}
