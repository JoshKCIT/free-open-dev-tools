export class CssPatternError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CssPatternError';
  }
}

/** The eight patterns, by id with the label shown on the page. */
export const PATTERNS: ReadonlyMap<string, string> = new Map();

export function patternSvg(
  pattern: string,
  size: number,
  thickness: number,
  foreground: string,
  background: string,
): string {
  void pattern;
  void size;
  void thickness;
  void foreground;
  void background;
  throw new CssPatternError('not implemented');
}

export function svgPatternCss(svg: string, background: string, size: number): string {
  void svg;
  void background;
  void size;
  throw new CssPatternError('not implemented');
}

export function svgPatternHtml(css: string): string {
  void css;
  throw new CssPatternError('not implemented');
}
