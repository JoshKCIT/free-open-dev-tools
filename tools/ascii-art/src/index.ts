import meta from './meta.json';

export { meta };

export class FigletFontError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FigletFontError';
  }
}

export interface FigFont {
  hardblank: string;
  height: number;
  baseline: number;
  maxLength: number;
  oldLayout: number;
  commentLines: number;
  printDirection?: number;
  fullLayout?: number;
  codetagCount?: number;
  characters: Map<number, string[]>;
}

export type Layout = 'full' | 'fitted';

export interface BannerResult {
  lines: string[];
  missing: string[];
}

/**
 * RED-phase stub (TDD): intentionally throws so the tests below fail on the
 * real behaviour they assert, not on a missing export. Task 2 of
 * .planning/phases/03-text-time-and-reference-tables/03-04-PLAN.md replaces
 * this with the real FIGfont Version 2 parser.
 */
export function parseFont(_text: string): FigFont {
  throw new Error('not implemented');
}

/**
 * RED-phase stub (TDD): intentionally throws. Task 2 replaces this with the
 * real full-width renderer; Task 3 adds the fitted layout.
 */
export function renderBanner(_fontName: string, _text: string, _options: { layout: Layout }): BannerResult {
  throw new Error('not implemented');
}
