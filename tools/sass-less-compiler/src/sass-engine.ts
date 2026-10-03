import * as sass from 'sass';
import { StylesheetError, describeEngineMessage, importRefusedError, syntaxError } from './errors';
import { cutWithEllipsis, positionAt, visible } from './text';

/** At most this many messages are returned, the last of them saying how many more were left out. */
export const MAX_WARNINGS = 20;

/** Each returned message is cut to this many characters. */
export const MAX_WARNING_CHARS = 200;

export interface SassOutcome {
  css: string;
  warnings: string[];
  engine: string;
}

/** The longest start of a message kept before it is formatted; the rest of a very long message is never looked at. */
const MESSAGE_KEPT_CHARS = MAX_WARNING_CHARS * 2;

const COMPILER_FAILED = 'The compiler could not process this stylesheet';

const TOO_DEEP = 'This stylesheet nests or repeats too deeply, or builds something too large, for the compiler';

/**
 * A Sass error that carries a position. The compiler's own `Exception` type has these fields; reading them this way
 * keeps the code working for the browser build and the Node build alike.
 */
interface SassFailure {
  sassMessage?: unknown;
  span?: { start?: { offset?: unknown } };
}

/**
 * Compiles SCSS or the indented syntax with Dart Sass's pure JavaScript build. The one importer given to the compiler
 * is asked for the address of every `@use`, `@forward`, `@import` and `meta.load-css` that names anything other than a
 * built-in module, writes the address down and refuses; it never loads anything, so no file is read and no address is
 * requested. Plain CSS imports (`@import url(foo.css)`) are copied into the output without any importer being asked;
 * `compileStylesheet` finds those in the compiled CSS.
 *
 * `@warn` and `@debug` messages, and the compiler's own warnings, are returned as short strings; nothing is printed.
 */
export function compileSass(
  source: string,
  options: { syntax: 'scss' | 'indented'; style: 'expanded' | 'compressed' },
): SassOutcome {
  const asked: string[] = [];
  const messages: string[] = [];
  let total = 0;

  const refusing: sass.Importer<'sync'> = {
    canonicalize(url: string): URL | null {
      asked.push(url);
      throw new Error('refused');
    },
    load(): null {
      return null;
    },
  };

  const keep = (text: string) => {
    total++;
    if (messages.length < MAX_WARNINGS) messages.push(cutWithEllipsis(visible(text), MAX_WARNING_CHARS));
  };

  const logger: sass.Logger = {
    warn(message, warnOptions) {
      if (warnOptions.deprecation) {
        // The compiler's own notice: its first line only, without whatever it quotes from the stylesheet.
        keep(describeEngineMessage(message.slice(0, MESSAGE_KEPT_CHARS), source, COMPILER_FAILED));
      } else {
        keep(`@warn: ${message.slice(0, MESSAGE_KEPT_CHARS)}`);
      }
    },
    debug(message) {
      keep(`@debug: ${message.slice(0, MESSAGE_KEPT_CHARS)}`);
    },
  };

  const engine = `Sass ${sass.info.split('\t')[1] ?? ''}`.trimEnd();

  let css: string;
  try {
    css = sass.compileString(source, {
      syntax: options.syntax,
      style: options.style,
      importers: [refusing],
      logger,
      charset: false,
    }).css;
  } catch (err) {
    const failure = err as SassFailure;
    const offset = typeof failure.span?.start?.offset === 'number' ? failure.span.start.offset : undefined;
    if (asked.length > 0) {
      const position = offset === undefined ? undefined : positionAt(source, offset);
      throw importRefusedError({ line: position?.line, column: position?.column, target: asked[0] });
    }
    if (typeof failure.sassMessage === 'string') {
      throw syntaxError(describeEngineMessage(failure.sassMessage, source, COMPILER_FAILED), source, offset, {});
    }
    if (err instanceof RangeError) throw new StylesheetError(`${TOO_DEEP}.`, 'limit');
    throw new StylesheetError(`${COMPILER_FAILED}.`, 'limit');
  }
  if (asked.length > 0) throw importRefusedError({ target: asked[0] });

  const warnings = messages.slice();
  if (total > MAX_WARNINGS) {
    warnings[MAX_WARNINGS - 1] = `${total - (MAX_WARNINGS - 1)} more messages were left out.`;
  }
  return { css, warnings, engine };
}
