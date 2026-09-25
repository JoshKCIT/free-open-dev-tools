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

export interface FormatCssOptions {
  mode?: CssFormatterMode;
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
 * Beautifies CSS with Prettier's own CSS printer, or minifies it with csso.
 * Both modes first parse the input with Prettier's `css` parser (via
 * `prettier/plugins/postcss`, the plugin that backs Prettier's CSS/SCSS/Less
 * support), so malformed CSS is refused the same way in either mode, with
 * the same line and column. Minifying then runs csso separately over the
 * same, already-validated source text.
 */
export async function formatCss(source: string, options: FormatCssOptions = {}): Promise<FormatCssResult> {
  const { mode = 'beautify', indent = 2, restructure = true, keepLicenceComments = true } = options;

  const inputBytes = byteLength(source);
  const tabWidth = indent === 'tab' ? 2 : indent;
  const useTabs = indent === 'tab';

  let beautified: string;
  try {
    beautified = await prettier.format(source, {
      parser: 'css',
      plugins: [postcssPlugin],
      tabWidth,
      useTabs,
    });
  } catch (err) {
    if (isPrettierParseError(err)) {
      throw new CssFormatterError(err.message, { line: err.loc?.start?.line, column: err.loc?.start?.column });
    }
    throw new CssFormatterError(err instanceof Error ? err.message : 'This CSS could not be parsed.');
  }

  const output =
    mode === 'beautify'
      ? beautified
      : cssoMinify(source, { restructure, comments: keepLicenceComments ? 'exclamation' : false }).css;

  return { output, inputBytes, outputBytes: byteLength(output) };
}
