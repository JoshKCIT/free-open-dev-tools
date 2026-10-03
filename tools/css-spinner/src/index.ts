import meta from './meta.json';
import type { PreviewTreeNode } from './css-safe';

export { meta };
export type { PreviewTreeNode };

export class CssSpinnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CssSpinnerError';
  }
}

/** The six kinds of spinner, by id with the label shown on the page. */
export const SPINNER_TYPES: ReadonlyMap<string, string> = new Map();

export interface GenerateSpinnerOptions {
  type?: string;
  size?: number;
  colour?: string;
  speed?: number;
}

export interface GenerateSpinnerResult {
  css: string;
  tree: PreviewTreeNode;
  markup: string;
  warnings: string[];
}

export function colourOrDefault(
  value: string,
  fallback: string,
  label: string,
): { colour: string; warning: string | null } {
  void value;
  void label;
  return { colour: fallback, warning: null };
}

export function generateSpinner(options: GenerateSpinnerOptions): GenerateSpinnerResult {
  void options;
  throw new CssSpinnerError('not implemented');
}
