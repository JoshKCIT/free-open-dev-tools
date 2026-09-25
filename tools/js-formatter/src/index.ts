import meta from './meta.json';
// Subpaths confirmed from the installed prettier@3.9.9 package's own
// `exports` map: `prettier/standalone`, `prettier/plugins/babel` and
// `prettier/plugins/estree` (the parser/estree-printer pair that backs both
// the `babel` and `babel-ts` parsers). The TypeScript-specific Prettier
// plugin (`prettier/plugins/typescript`) is never imported, to keep this
// page's chunk smaller (meta.json `limits`); `babel-ts` already understands
// TypeScript syntax. Prettier here is a runtime dependency of this folder
// only; the repository root's own devDependency on prettier is unrelated.
import * as prettier from 'prettier/standalone';
import * as babelPlugin from 'prettier/plugins/babel';
import * as estreePlugin from 'prettier/plugins/estree';
import { minify as terserMinify } from 'terser';
// PINNED to the 5.x line -- TypeScript 7's `latest` dist-tag ships only a
// native `tsc` binary and drops the classic in-process compiler API
// (`transpileModule`) entirely. Never widen this range without re-confirming
// the classic API still exists at the new version (D-80). Same handling as
// `tools/ts-to-js/src/index.ts`.
import ts from 'typescript';

export { meta };

export class JsFormatterError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'JsFormatterError';
    this.line = detail.line;
    this.column = detail.column;
  }
}

export type JsFormatterLanguage = 'javascript' | 'typescript';
export type JsFormatterMode = 'beautify' | 'minify';
export type JsFormatterIndent = 2 | 4 | 'tab';

export interface FormatJsOptions {
  language?: JsFormatterLanguage;
  mode?: JsFormatterMode;
  /** Beautify only. Default 2. */
  indent?: JsFormatterIndent;
  /** Beautify only. Default true. */
  semicolons?: boolean;
  /** Beautify only. Default false (double quotes). */
  singleQuote?: boolean;
  /** Minify only. Default true: minify as an ES module (top-level `this` is `undefined`). */
  module?: boolean;
  /** Minify only. Default true: shorten local names. */
  mangle?: boolean;
  /** Minify only. Default true: apply terser's static-analysis compression passes. */
  compress?: boolean;
  /** Minify only. Default true: keep JSDoc-style/licence comments (terser's own "some"), else strip all. */
  keepLicenceComments?: boolean;
}

export interface FormatJsResult {
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

interface TerserParseError extends Error {
  line?: number;
  col?: number;
}

function isTerserParseError(err: unknown): err is TerserParseError {
  // terser's parse error class is named JS_Parse_Error, but its own `name`
  // property (inherited from a plain Error) reads "SyntaxError" -- the
  // constructor name is what actually identifies it. Checked by test.
  return err instanceof Error && err.constructor.name === 'JS_Parse_Error';
}

/** Beautifies JavaScript or TypeScript with Prettier's babel/babel-ts parsers. Never executes the input. */
async function beautify(source: string, language: JsFormatterLanguage, opts: FormatJsOptions): Promise<string> {
  const { indent = 2, semicolons = true, singleQuote = false } = opts;
  const tabWidth = indent === 'tab' ? 2 : indent;
  const useTabs = indent === 'tab';
  try {
    return await prettier.format(source, {
      parser: language === 'typescript' ? 'babel-ts' : 'babel',
      plugins: [babelPlugin, estreePlugin],
      tabWidth,
      useTabs,
      semi: semicolons,
      singleQuote,
    });
  } catch (err) {
    if (isPrettierParseError(err)) {
      throw new JsFormatterError(err.message, { line: err.loc?.start?.line, column: err.loc?.start?.column });
    }
    throw new JsFormatterError(err instanceof Error ? err.message : 'This input could not be parsed.');
  }
}

/**
 * Minifies already-JavaScript source with terser. Every `unsafe*` compress
 * flag stays at its default (`false`): only static-analysis optimisations
 * that do not change observable behaviour are applied, and the pasted code
 * is never run to compute them.
 */
async function minifyJavaScript(source: string, opts: FormatJsOptions): Promise<{ code: string }> {
  const { module = true, mangle = true, compress = true, keepLicenceComments = true } = opts;
  try {
    const result = await terserMinify(source, {
      compress: compress ? {} : false,
      mangle,
      module,
      toplevel: false,
      format: { comments: keepLicenceComments ? 'some' : false },
    });
    return { code: result.code ?? '' };
  } catch (err) {
    if (isTerserParseError(err)) {
      // terser's own `col` is 0-based; this project's error columns are 1-based throughout.
      throw new JsFormatterError(err.message, { line: err.line, column: (err.col ?? 0) + 1 });
    }
    throw new JsFormatterError(err instanceof Error ? err.message : 'This input could not be minified.');
  }
}

/**
 * Beautifies or minifies JavaScript or TypeScript. TypeScript is always
 * minified down to JavaScript: types are stripped by `ts.transpileModule`
 * (a syntactic transform only -- it never creates a `Program`, never
 * type-checks and never emits to disk) before terser runs. Neither path ever
 * evaluates the pasted code (D-70): Prettier and terser both work from a
 * parsed syntax tree, and `ts.transpileModule` only rewrites syntax.
 */
export async function formatJs(source: string, options: FormatJsOptions = {}): Promise<FormatJsResult> {
  const { language = 'javascript', mode = 'beautify' } = options;
  const inputBytes = byteLength(source);
  const warnings: string[] = [];

  let output: string;
  if (mode === 'beautify') {
    output = await beautify(source, language, options);
  } else if (language === 'javascript') {
    output = (await minifyJavaScript(source, options)).code;
  } else {
    let transpiled: ts.TranspileOutput;
    try {
      transpiled = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.Preserve, jsx: ts.JsxEmit.Preserve },
        fileName: 'input.tsx',
        reportDiagnostics: true,
      });
    } catch (err) {
      throw new JsFormatterError(err instanceof Error ? err.message : 'This TypeScript could not be parsed.');
    }
    const syntaxDiagnostic = (transpiled.diagnostics ?? []).find((d) => d.category === ts.DiagnosticCategory.Error);
    if (syntaxDiagnostic) {
      let line = 0;
      let column = 0;
      if (syntaxDiagnostic.file && syntaxDiagnostic.start !== undefined) {
        const pos = syntaxDiagnostic.file.getLineAndCharacterOfPosition(syntaxDiagnostic.start);
        line = pos.line + 1;
        column = pos.character + 1;
      }
      throw new JsFormatterError(ts.flattenDiagnosticMessageText(syntaxDiagnostic.messageText, '\n'), {
        line,
        column,
      });
    }
    warnings.push('TypeScript input is minified to JavaScript output; types are stripped, not preserved.');
    output = (await minifyJavaScript(transpiled.outputText, options)).code;
  }

  return { output, inputBytes, outputBytes: byteLength(output), warnings };
}
