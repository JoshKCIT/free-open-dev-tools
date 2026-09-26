import meta from './meta.json';
import type { PreviewTreeNode } from './css-safe';

export { meta };
export type { PreviewTreeNode };

export class FlexboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlexboxError';
  }
}

export interface GenerateFlexboxOptions {
  container?: unknown;
  items?: unknown[];
}

export interface GenerateFlexboxResult {
  css: string;
  tree: PreviewTreeNode;
  warnings: string[];
}

export function generateFlexbox(_options: GenerateFlexboxOptions): GenerateFlexboxResult {
  throw new Error('not implemented');
}
