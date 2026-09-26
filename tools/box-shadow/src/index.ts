import meta from './meta.json';
import type { PreviewTreeNode } from './css-safe';

export { meta };
export type { PreviewTreeNode };

export class BoxShadowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoxShadowError';
  }
}

export interface BoxShadowLayer {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  opacity: number;
  inset: boolean;
}

export interface GenerateBoxShadowOptions {
  layers: BoxShadowLayer[];
  width?: number;
  height?: number;
  radius?: number;
  background?: string;
}

export interface GenerateBoxShadowResult {
  css: string;
  tree: PreviewTreeNode;
  value: string;
  warnings: string[];
}

// RED stub (08-02 TDD): not implemented yet. Every test in
// test/index.test.ts must fail against this before the real implementation
// lands.
export function generateBoxShadow(_options: GenerateBoxShadowOptions): GenerateBoxShadowResult {
  throw new BoxShadowError('not implemented');
}
