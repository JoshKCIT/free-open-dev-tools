/**
 * Uses the real TypeScript compiler (already a devDependency of this
 * package, per shared procedure C) as an oracle: builds an in-memory
 * program of two virtual files, the generated interface source and a check
 * file assigning the sample literal to the root type under strict mode, and
 * asserts the compiler agrees.
 */
import ts from 'typescript';
import { it, expect } from 'vitest';
import { jsonToCode } from '../src/index';

function typeCheck(generated: string, checkBody: string): readonly ts.Diagnostic[] {
  const files: Record<string, string> = {
    '/virtual/generated.ts': generated,
    '/virtual/check.ts': `import type { Root } from './generated';\n${checkBody}`,
  };
  const options: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Classic,
    noEmit: true,
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (fileName, languageVersion) => {
    const text = files[fileName] ?? ts.sys.readFile(fileName);
    if (text === undefined) return undefined;
    return ts.createSourceFile(fileName, text, languageVersion, true);
  };
  host.fileExists = (fileName) => fileName in files || ts.sys.fileExists(fileName);
  host.readFile = (fileName) => files[fileName] ?? ts.sys.readFile(fileName);
  host.resolveModuleNames = (moduleNames) =>
    moduleNames.map((name) =>
      name === './generated' ? { resolvedFileName: '/virtual/generated.ts', extension: ts.Extension.Ts } : undefined,
    );
  const program = ts.createProgram(['/virtual/check.ts'], options, host);
  return ts.getPreEmitDiagnostics(program);
}

const SAMPLE = '{"id":1,"name":"Ada","tags":["x"],"manager":null}';

it('TypeScript output type-checks the sample with the TypeScript compiler', () => {
  const { output } = jsonToCode(SAMPLE, { language: 'typescript', rootName: 'Root' });
  const diagnostics = typeCheck(output, `const value: Root = ${SAMPLE};\nvoid value;\n`);
  expect(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '))).toEqual([]);
});

it('a wrongly typed value fails the TypeScript compiler check', () => {
  const { output } = jsonToCode(SAMPLE, { language: 'typescript', rootName: 'Root' });
  const wrong = '{"id":"not-a-number","name":"Ada","tags":["x"],"manager":null}';
  const diagnostics = typeCheck(output, `const value: Root = ${wrong};\nvoid value;\n`);
  expect(diagnostics.length).toBeGreaterThan(0);
});
