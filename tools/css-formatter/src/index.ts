import meta from './meta.json';
// Subpaths confirmed from the installed prettier@3.9.9 package's own `exports`
// map: `prettier/standalone` (the bundler-friendly entry with no Node APIs)
// and `prettier/plugins/postcss` (the CSS/SCSS/Less parser plugin). Prettier
// here is a runtime dependency of this folder only; the repository root's own
// devDependency on prettier is unrelated and never imported by this file.
import * as prettier from 'prettier/standalone';
import * as postcssPlugin from 'prettier/plugins/postcss';
import { minify as cssoMinify } from 'csso';

export { meta };

export class CssFormatterError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'CssFormatterError';
    this.line = detail.line;
    this.column = detail.column;
  }
}

export type CssFormatterMode = 'beautify' | 'minify';
export type CssFormatterIndent = 2 | 4 | 'tab';
export type CssFormatterSyntax = 'css' | 'scss' | 'less';

export interface FormatCssOptions {
  mode?: CssFormatterMode;
  /**
   * The stylesheet dialect to parse. Default 'css'. Beautify accepts all
   * three (css, scss, less); minify accepts css only -- csso is a CSS
   * minifier and does not understand Sass or Less syntax, so minifying with
   * scss or less is refused before any parsing happens (see formatCss's own
   * doc comment).
   */
  syntax?: CssFormatterSyntax;
  /** Beautify only. Default 2. */
  indent?: CssFormatterIndent;
  /** Minify only. Default true: merge and reorder rules where csso judges it safe. */
  restructure?: boolean;
  /** Minify only. Default true: keep exclamation (licence) comments, remove every other comment. */
  keepLicenceComments?: boolean;
}

export interface FormatCssResult {
  output: string;
  inputBytes: number;
  outputBytes: number;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

interface PrettierParseError extends Error {
  loc?: { start?: { line?: number; column?: number } };
}

function isPrettierParseError(err: unknown): err is PrettierParseError {
  return err instanceof Error && 'loc' in err;
}

/**
 * Beautifies CSS, SCSS or Less with Prettier's own printer (its `css`,
 * `scss` or `less` parser, all from `prettier/plugins/postcss`), or
 * minifies CSS with csso. Beautify first parses the input with the chosen
 * syntax's own Prettier parser, so malformed CSS, SCSS or Less is refused
 * with that parser's own line and column. Minifying only ever understands
 * plain CSS -- csso has no SCSS or Less grammar -- so a minify request for
 * `syntax: 'scss'` or `'less'` is refused up front with a message asking
 * the visitor to compile to CSS first, before Prettier is even asked to
 * parse anything.
 */
export async function formatCss(source: string, options: FormatCssOptions = {}): Promise<FormatCssResult> {
  const { mode = 'beautify', syntax = 'css', indent = 2, restructure = true, keepLicenceComments = true } = options;

  if (syntax !== 'css' && syntax !== 'scss' && syntax !== 'less') {
    throw new CssFormatterError(`Unknown syntax "${String(syntax)}". Use "css", "scss" or "less".`);
  }
  if (mode === 'minify' && syntax !== 'css') {
    throw new CssFormatterError(
      'Minifying needs plain CSS. Compile the SCSS or Less to CSS first, then minify the result.',
    );
  }

  const inputBytes = byteLength(source);
  const tabWidth = indent === 'tab' ? 2 : indent;
  const useTabs = indent === 'tab';

  let beautified: string;
  try {
    beautified = await prettier.format(source, {
      parser: syntax,
      plugins: [postcssPlugin],
      tabWidth,
      useTabs,
    });
  } catch (err) {
    if (isPrettierParseError(err)) {
      throw new CssFormatterError(err.message, { line: err.loc?.start?.line, column: err.loc?.start?.column });
    }
    throw new CssFormatterError(err instanceof Error ? err.message : 'This stylesheet could not be parsed.');
  }

  const output =
    mode === 'beautify'
      ? beautified
      : cssoMinify(source, { restructure, comments: keepLicenceComments ? 'exclamation' : false }).css;

  return { output, inputBytes, outputBytes: byteLength(output) };
}
