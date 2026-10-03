import meta from './meta.json';
import { StylesheetError, importRefusedError } from './errors';
import { scanCssImport, statementAfter } from './import-scan';
import { compileLess, type LessOutcome } from './less-engine';
import { compileSass } from './sass-engine';

export { meta };
export { StylesheetError, IMPORT_REFUSED_MESSAGE } from './errors';
export type { StylesheetErrorKind } from './errors';
export { findCssImport } from './import-scan';
export { LESS_VERSION } from './less-engine';
export { MAX_WARNINGS, MAX_WARNING_CHARS } from './sass-engine';

/** The most UTF-8 bytes of source accepted: 256 KiB. */
export const MAX_SOURCE_BYTES = 262_144;

/** The most UTF-8 bytes of compiled CSS returned: 2 MiB. */
export const MAX_OUTPUT_BYTES = 2_097_152;

export type Language = 'scss' | 'sass' | 'less';

export type OutputStyle = 'expanded' | 'compressed';

export interface CompileResult {
  css: string;
  warnings: string[];
  /** The engine and its version as the engine reports them, for example `Sass 1.103.1` or `Less 4.9.1`. */
  engine: string;
}

/** True when the source is empty or holds only white space: there is nothing to compile. */
export function isBlankSource(source: string): boolean {
  return source.trim() === '';
}

/**
 * Refuses a source over 256 KiB, counted in UTF-8 bytes, with a message that names the size and the limit. Larger
 * stylesheets make the compiler run too long in the browser.
 */
export function checkSource(source: string): void {
  const bytes = new TextEncoder().encode(source).length;
  if (bytes > MAX_SOURCE_BYTES) {
    throw new StylesheetError(
      `This paste is ${bytes} bytes. The limit is 256 KiB because larger stylesheets make the compiler run too long in the browser.`,
      'limit',
    );
  }
}

type Engine = (source: string, style: OutputStyle) => Promise<CompileResult>;

/** The engines by language. A `Map`, so a language name such as `__proto__` is just a miss. */
const ENGINES: ReadonlyMap<Language, Engine> = new Map<Language, Engine>([
  ['scss', async (source, style) => compileSass(source, { syntax: 'scss', style })],
  ['sass', async (source, style) => compileSass(source, { syntax: 'indented', style })],
  ['less', async (source, style): Promise<LessOutcome> => compileLess(source, { compress: style === 'compressed' })],
]);

/**
 * Compiles SCSS, the indented Sass syntax or Less to CSS and returns the CSS, the compiler's own warnings and the
 * engine's name and version. Nothing is read or fetched: every import of another file or address is refused with its
 * position, whether the compiler asked for it (Sass `@use`, `@forward`, `@import`, `meta.load-css`; Less `@import`,
 * `@plugin`, `data-uri`, `image-size`) or copied it into the output untouched (a plain CSS `@import`, found by
 * scanning the compiled CSS). A blank source compiles nothing and returns empty text.
 *
 * Problems throw `StylesheetError`: `syntax` for a mistake the compiler found, `import` for a refused import and
 * `limit` for a source or output over its limit or a compiler that gave up.
 */
export async function compileStylesheet(
  source: string,
  options: { language: Language; style: OutputStyle },
): Promise<CompileResult> {
  checkSource(source);
  if (isBlankSource(source)) return { css: '', warnings: [], engine: '' };

  const engine = ENGINES.get(options.language);
  if (engine === undefined) throw new StylesheetError('Choose SCSS, indented Sass or Less.', 'limit');
  const result = await engine(source, options.style);

  const bytes = new TextEncoder().encode(result.css).length;
  if (bytes > MAX_OUTPUT_BYTES) {
    throw new StylesheetError(
      `The compiled CSS is ${bytes} bytes. The limit is 2 MiB because larger output would make this page slow.`,
      'limit',
    );
  }

  const found = scanCssImport(result.css);
  if (found !== null) {
    throw importRefusedError({
      line: found.line,
      column: found.column,
      inOutput: true,
      target: statementAfter(result.css, found.end),
    });
  }
  return result;
}
