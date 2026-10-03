import meta from './meta.json';
import type { PreviewTreeNode } from './css-safe';
import { CssPatternError, PATTERNS, patternSvg, svgPatternCss, svgPatternHtml } from './svg-pattern';

export { meta, CssPatternError, PATTERNS, patternSvg, svgPatternCss, svgPatternHtml };
export type { PreviewTreeNode };

export interface GeneratePatternOptions {
  pattern?: string;
  output?: string;
  foreground?: string;
  background?: string;
  size?: number;
  thickness?: number;
}

export type GeneratePatternResult =
  | { output: 'gradient'; css: string; tree: PreviewTreeNode; markup: string; warnings: string[] }
  | { output: 'svg'; css: string; html: string; markup: string; warnings: string[] };

export function colourOrDefault(
  value: string,
  fallback: string,
  label: string,
): { colour: string; warning: string | null } {
  void value;
  void label;
  return { colour: fallback, warning: null };
}

export function generatePattern(options: GeneratePatternOptions): GeneratePatternResult {
  void options;
  throw new CssPatternError('not implemented');
}
