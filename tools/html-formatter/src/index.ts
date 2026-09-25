import meta from './meta.json';
// Subpaths confirmed from the installed prettier@3.9.9 package's own
// `exports` map: `prettier/standalone`, `prettier/plugins/html` (the HTML
// parser/printer), and `prettier/plugins/postcss` plus `prettier/plugins/babel`
// and `prettier/plugins/estree` (so embedded `<style>` and `<script>` are
// formatted too, never run). Prettier here is a runtime dependency of this
// folder only; the repository root's own devDependency on prettier is
// unrelated.
import * as prettier from 'prettier/standalone';
import * as htmlPlugin from 'prettier/plugins/html';
import * as postcssPlugin from 'prettier/plugins/postcss';
import * as babelPlugin from 'prettier/plugins/babel';
import * as estreePlugin from 'prettier/plugins/estree';
// NOT the package's default `import` entry point (`src/htmlminifier.js`):
// that file imports `clean-css` at its own top level, and `clean-css`
// references the Node global `process` at ITS module top level too --
// confirmed this session by a real browser import throwing
// "ReferenceError: process is not defined" before any function in this
// file is even called. The pre-built browser bundle
// (`dist/htmlminifier.esm.bundle.js`) has no such reference and was
// confirmed this session to import and run cleanly through a real Vite
// build in chromium, firefox, webkit and mobile-chrome (see the SUMMARY for
// the build log evidence behind this choice). `minifyCSS` and `minifyJS`
// are always given as functions below regardless, so this package's own
// bundled CSS minifier (which can read local files and resolve `@import`
// over the network) and its own bundled terser call are never reached --
// csso and terser, the same libraries this site's other formatters use,
// run instead. Local type declarations: `./html-minifier-terser-bundle.d.ts`.
import { minify as htmlMinify } from 'html-minifier-terser/dist/htmlminifier.esm.bundle';
import { minify as cssoMinify } from 'csso';
import { minify as terserMinify } from 'terser';

export { meta };

export class HtmlFormatterError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'HtmlFormatterError';
    this.line = detail.line;
    this.column = detail.column;
  }
}

export type HtmlFormatterMode = 'beautify' | 'minify';
export type HtmlFormatterIndent = 2 | 4 | 'tab';
export type HtmlFormatterWhitespace = 'css' | 'strict' | 'ignore';

export interface FormatHtmlOptions {
  mode?: HtmlFormatterMode;
  /** Beautify only. Default 2. */
  indent?: HtmlFormatterIndent;
  /** Beautify only. Default 'css': follow each element's default CSS `display` value. */
  whitespace?: HtmlFormatterWhitespace;
  /** Minify only. Default true. */
  removeComments?: boolean;
}

export interface FormatHtmlResult {
  output: string;
  inputBytes: number;
  outputBytes: number;
  warnings: string[];
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
 * Minifies an embedded `<style>` block or `style` attribute with csso, the
 * same minifier `css-formatter` uses. Never the package's own bundled CSS
 * minifier (T-05-11): csso ships a browser-safe ESM build with no file or
 * network access. Falls back to the original text on a genuine parse
 * failure rather than losing content the visitor pasted.
 */
function minifyCSS(text: string): string {
  try {
    return cssoMinify(text).css;
  } catch {
    return text;
  }
}

/**
 * Minifies an embedded `<script>` block or an inline event-handler
 * attribute with terser, with the same safe options `js-formatter` uses --
 * every `unsafe*` compress flag stays at its default (`false`). A fragment
 * that is not valid as a standalone script (for example the body of an
 * `onclick` attribute) is left unminified rather than causing the whole
 * page to be refused.
 */
async function minifyJS(text: string): Promise<string> {
  try {
    const result = await terserMinify(text, {
      compress: {},
      mangle: true,
      module: false,
      toplevel: false,
      format: { comments: false },
    });
    return result.code ?? text;
  } catch {
    return text;
  }
}

/**
 * Beautifies HTML with Prettier's own HTML printer (embedded `<style>` and
 * `<script>` are formatted too, via the CSS and JS plugins, never run), or
 * minifies it with html-minifier-terser. Neither mode ever evaluates the
 * pasted markup or its embedded code (D-70): both work from a parsed tree,
 * and minifying reuses this site's own csso/terser wrappers for anything
 * embedded, so nothing embedded ever loads a file or a network address.
 */
export async function formatHtml(source: string, options: FormatHtmlOptions = {}): Promise<FormatHtmlResult> {
  const { mode = 'beautify', indent = 2, whitespace = 'css', removeComments = true } = options;
  const inputBytes = byteLength(source);
  const warnings: string[] = [];

  let output: string;
  if (mode === 'beautify') {
    const tabWidth = indent === 'tab' ? 2 : indent;
    const useTabs = indent === 'tab';
    try {
      output = await prettier.format(source, {
        parser: 'html',
        plugins: [htmlPlugin, postcssPlugin, babelPlugin, estreePlugin],
        tabWidth,
        useTabs,
        htmlWhitespaceSensitivity: whitespace,
      });
    } catch (err) {
      if (isPrettierParseError(err)) {
        throw new HtmlFormatterError(err.message, { line: err.loc?.start?.line, column: err.loc?.start?.column });
      }
      throw new HtmlFormatterError(err instanceof Error ? err.message : 'This HTML could not be parsed.');
    }
  } else {
    try {
      output = await htmlMinify(source, {
        collapseWhitespace: true,
        conservativeCollapse: true,
        collapseBooleanAttributes: true,
        removeComments,
        decodeEntities: false,
        minifyURLs: false,
        minifyCSS,
        minifyJS,
      });
    } catch (err) {
      throw new HtmlFormatterError(err instanceof Error ? err.message : 'This HTML could not be minified.');
    }
  }

  return { output, inputBytes, outputBytes: byteLength(output), warnings };
}
