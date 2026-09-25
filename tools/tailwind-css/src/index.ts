import meta from './meta.json';
import { resolveClass, type Declarations } from './utilities';
import { cssToClasses as cssToClassesImpl, type CssToClassesOptions, type CssToClassesResult } from './reverse';

export { meta };
export { TAILWIND_VERSION, THEME } from './theme';
export { resolveClass, SUPPORTED_CANDIDATES } from './utilities';
export type { Declarations } from './utilities';
export type { CssToClassesOptions, CssToClassesResult, CssToClassesRule, NormalizedDeclaration } from './reverse';

export class TailwindCssError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TailwindCssError';
  }
}

export type ClassesToCssOutputMode = 'per-class' | 'combined';

export interface ClassesToCssOptions {
  /** `per-class` (default) writes one rule per class; `combined` writes one `.element` rule with later classes winning for a repeated property, matching Tailwind's own cascade order (the order the classes are written in). */
  output?: ClassesToCssOutputMode;
}

export interface ConvertedClass {
  className: string;
  declarations: Declarations;
}

export interface ClassesToCssResult {
  css: string;
  converted: ConvertedClass[];
  unknown: string[];
}

/** Escapes a class name for use as a CSS selector, e.g. `bg-red-500/50` to `.bg-red-500\/50`. */
function cssEscapeSelector(className: string): string {
  return className.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

function declarationsBlock(selector: string, declarations: Declarations): string {
  const body = Object.entries(declarations)
    .map(([property, value]) => `  ${property}: ${value};`)
    .join('\n');
  return `${selector} {\n${body}\n}`;
}

/**
 * Converts a whitespace-separated list of Tailwind CSS 4 core utility
 * classes to plain CSS, with every theme value resolved. Variants, arbitrary
 * values, plugins and classes outside the core utility set this tool
 * implements are listed in `unknown` rather than guessed at.
 */
export function classesToCss(classes: string, options: ClassesToCssOptions = {}): ClassesToCssResult {
  const { output = 'per-class' } = options;
  const tokens = classes.split(/\s+/).filter((t) => t.length > 0);

  const converted: ConvertedClass[] = [];
  const unknown: string[] = [];
  for (const token of tokens) {
    const declarations = resolveClass(token);
    if (declarations === null) {
      unknown.push(token);
      continue;
    }
    converted.push({ className: token, declarations });
  }

  let css: string;
  if (output === 'combined') {
    const merged: Declarations = {};
    for (const c of converted) Object.assign(merged, c.declarations);
    css = Object.keys(merged).length === 0 ? '' : declarationsBlock('.element', merged);
  } else {
    css = converted.map((c) => declarationsBlock(`.${cssEscapeSelector(c.className)}`, c.declarations)).join('\n\n');
  }

  return { css, converted, unknown };
}

/** Converts CSS declarations back to the fewest core Tailwind CSS 4 classes that produce exactly those declarations. See `reverse.ts`. */
export function cssToClasses(css: string, options: CssToClassesOptions = {}): CssToClassesResult {
  return cssToClassesImpl(css, options);
}
