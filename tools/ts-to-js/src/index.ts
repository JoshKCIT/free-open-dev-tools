import meta from './meta.json';
// PINNED to the 5.x line in package.json -- TypeScript 7's `latest` dist-tag
// ships only a native tsc binary and drops the classic in-process compiler
// API (transpileModule, createSourceFile, createProgram) entirely. Never
// widen this range without re-confirming the classic API still exists at
// the new version (D-80).
import ts from 'typescript';

export { meta };

export class TsToJsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TsToJsError';
  }
}

export interface StripTypesDiagnostic {
  message: string;
  line: number;
  column: number;
}

export type StripTypesTarget = 'ES2015' | 'ES2017' | 'ES2020' | 'ES2022' | 'ESNext';
export type StripTypesModule = 'preserve' | 'commonjs';
export type StripTypesJsx = 'preserve' | 'react-jsx' | 'react';

export interface StripTypesOptions {
  target?: StripTypesTarget;
  module?: StripTypesModule;
  jsx?: StripTypesJsx;
  removeComments?: boolean;
}

export interface StripTypesResult {
  output: string;
  diagnostics: StripTypesDiagnostic[];
}

const TARGETS: Record<StripTypesTarget, ts.ScriptTarget> = {
  ES2015: ts.ScriptTarget.ES2015,
  ES2017: ts.ScriptTarget.ES2017,
  ES2020: ts.ScriptTarget.ES2020,
  ES2022: ts.ScriptTarget.ES2022,
  ESNext: ts.ScriptTarget.ESNext,
};

const MODULES: Record<StripTypesModule, ts.ModuleKind> = {
  preserve: ts.ModuleKind.Preserve,
  commonjs: ts.ModuleKind.CommonJS,
};

const JSX_MODES: Record<StripTypesJsx, ts.JsxEmit> = {
  preserve: ts.JsxEmit.Preserve,
  'react-jsx': ts.JsxEmit.ReactJSX,
  react: ts.JsxEmit.React,
};

/**
 * A crude, deliberately conservative JSX detector used only to choose a
 * `.ts` vs `.tsx` file name for the compiler (ambiguities: this can be
 * fooled by an old-style angle-bracket type assertion, `<Foo>value`, which
 * looks like an opening tag; almost all modern TypeScript uses `value as
 * Foo` instead). Template literal bodies are stripped first so a template
 * string containing a literal `<...>` cannot trigger a false positive.
 */
function looksLikeJsx(source: string): boolean {
  const withoutTemplates = source.replace(/`(?:[^`\\]|\\.)*`/g, '``');
  return /<[A-Za-z][\w.-]*(\s[^<>]*)?\/?>/.test(withoutTemplates);
}

/**
 * Strips TypeScript's type-only syntax and rewrites run-time-only syntax
 * (enums, namespaces) into plain JavaScript, using `ts.transpileModule` --
 * a syntactic transform only. This never creates a `ts.Program`, never
 * type-checks and never emits to disk, so the pasted code is only parsed
 * and rewritten, never executed (D-70).
 */
export function stripTypes(source: string, options: StripTypesOptions = {}): StripTypesResult {
  const { target = 'ES2022', module = 'preserve', jsx = 'preserve', removeComments = false } = options;

  const fileName = jsx !== 'preserve' || looksLikeJsx(source) ? 'input.tsx' : 'input.ts';

  let result: ts.TranspileOutput;
  try {
    result = ts.transpileModule(source, {
      compilerOptions: {
        target: TARGETS[target],
        module: MODULES[module],
        jsx: JSX_MODES[jsx],
        removeComments,
      },
      fileName,
      reportDiagnostics: true,
    });
  } catch (err) {
    throw new TsToJsError(err instanceof Error ? err.message : 'The input could not be parsed.');
  }

  const diagnostics: StripTypesDiagnostic[] = (result.diagnostics ?? []).map((d) => {
    let line = 0;
    let column = 0;
    if (d.file && d.start !== undefined) {
      const pos = d.file.getLineAndCharacterOfPosition(d.start);
      line = pos.line + 1;
      column = pos.character + 1;
    }
    return { message: ts.flattenDiagnosticMessageText(d.messageText, '\n'), line, column };
  });

  return { output: result.outputText, diagnostics };
}
