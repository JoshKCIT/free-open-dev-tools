import meta from './meta.json';
import type { PreviewTreeNode } from './css-safe';

export { meta };
export type { PreviewTreeNode };

export class TextShadowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TextShadowError';
  }
}

export interface TextShadowLayer {
  x: number;
  y: number;
  blur: number;
  color: string;
  opacity: number;
}

export type TextShadowFontFamily = 'sans-serif' | 'serif' | 'monospace' | 'system-ui';

export interface GenerateTextShadowOptions {
  layers: TextShadowLayer[];
  sample?: string;
  fontFamily?: TextShadowFontFamily;
  fontSize?: number;
  fontWeight?: 400 | 700 | 900;
  textColor?: string;
  background?: string;
  width?: number;
  height?: number;
}

export interface GenerateTextShadowResult {
  css: string;
  tree: PreviewTreeNode;
  value: string;
  warnings: string[];
}

// RED stub (08-02 TDD): not implemented yet. Every test in
// test/index.test.ts must fail against this before the real implementation
// lands.
export function generateTextShadow(_options: GenerateTextShadowOptions): GenerateTextShadowResult {
  throw new TextShadowError('not implemented');
}
