import meta from './meta.json';
// Subpaths confirmed from the installed prettier@3.9.9 package's own `exports`
// map, the same pattern css-formatter and graphql-formatter use for their own
// syntax: `prettier/standalone` (the bundler-friendly entry with no Node APIs)
// and `prettier/plugins/markdown` (the CommonMark/GFM/MDX parser and printer
// plugin). Prettier here is a runtime dependency of this folder only.
import * as prettier from 'prettier/standalone';
import * as markdownPlugin from 'prettier/plugins/markdown';

export { meta };

export class MarkdownFormatterError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'MarkdownFormatterError';
    this.line = detail.line;
    this.column = detail.column;
  }
}

export type MarkdownFormatterParser = 'markdown' | 'mdx';
export type MarkdownProseWrap = 'preserve' | 'always' | 'never';

export interface FormatMarkdownOptions {
  /** Default 'markdown'. */
  parser?: MarkdownFormatterParser;
  /** Default 'preserve'. */
  proseWrap?: MarkdownProseWrap;
  /** A whole number from 20 to 200. Default 80. */
  printWidth?: number;
}

export interface FormatMarkdownResult {
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

/** Prettier's own markdown parser (remark, through mdast) overflows the call stack (RangeError) on a document nested thousands of levels deep -- for example deeply nested block quotes -- well before it could return a useful error; PD-7 turns that into one typed, line-less message instead of a crash. */
function isStackOverflow(err: unknown): boolean {
  return err instanceof RangeError;
}

function validatePrintWidth(printWidth: number): void {
  if (!Number.isInteger(printWidth) || printWidth < 20 || printWidth > 200) {
    throw new MarkdownFormatterError('Print width must be a whole number from 20 to 200.');
  }
}

/**
 * Reformats Markdown or MDX with Prettier's own Markdown printer: aligns
 * tables, normalises list markers, emphasis and heading styles, and wraps
 * prose per `proseWrap`. `embeddedLanguageFormatting: 'off'` (PD-6) means
 * fenced code blocks and YAML front matter are always carried through
 * byte-for-byte, whichever parser or plugins are loaded. This package owns
 * no time limit of its own -- the page that calls it, through a background
 * worker, is what stops a pathological document from freezing the tab (see
 * the page-side `run-markdown-formatter-in-worker.ts`).
 */
export async function formatMarkdown(
  source: string,
  options: FormatMarkdownOptions = {},
): Promise<FormatMarkdownResult> {
  const { parser = 'markdown', proseWrap = 'preserve', printWidth = 80 } = options;

  if (parser !== 'markdown' && parser !== 'mdx') {
    throw new MarkdownFormatterError(`Unknown parser "${String(parser)}". Use "markdown" or "mdx".`);
  }
  if (proseWrap !== 'preserve' && proseWrap !== 'always' && proseWrap !== 'never') {
    throw new MarkdownFormatterError(`Unknown prose wrap "${String(proseWrap)}". Use "preserve", "always" or "never".`);
  }
  validatePrintWidth(printWidth);

  const inputBytes = byteLength(source);

  if (source === '') {
    return { output: '', inputBytes: 0, outputBytes: 0 };
  }

  let output: string;
  try {
    output = await prettier.format(source, {
      parser,
      plugins: [markdownPlugin],
      proseWrap,
      printWidth,
      embeddedLanguageFormatting: 'off',
    });
  } catch (err) {
    if (isPrettierParseError(err)) {
      throw new MarkdownFormatterError(err.message.split('\n')[0] ?? err.message, {
        line: err.loc?.start?.line,
        column: err.loc?.start?.column,
      });
    }
    if (isStackOverflow(err)) {
      throw new MarkdownFormatterError('This document is nested too deeply to format.');
    }
    throw new MarkdownFormatterError(err instanceof Error ? err.message : 'This document could not be formatted.');
  }

  return { output, inputBytes, outputBytes: byteLength(output) };
}
