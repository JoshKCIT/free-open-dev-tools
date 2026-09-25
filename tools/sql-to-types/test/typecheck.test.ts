/**
 * Uses the real TypeScript compiler (a devDependency-only test oracle, per
 * shared procedure C) as an oracle: builds an in-memory program of two
 * virtual files, the generated interface source and a check file assigning
 * a sample literal to the root type under strict mode, and asserts the
 * compiler agrees. The same pattern this project's json-to-code tool
 * established (tools/json-to-code/test/typescript.test.ts).
 */
import ts from 'typescript';
import { it, expect } from 'vitest';
import { sqlToTypes } from '../src/index';

function typeCheck(generated: string, checkBody: string): readonly ts.Diagnostic[] {
  const files: Record<string, string> = {
    '/virtual/generated.ts': generated,
    '/virtual/check.ts': `import type { Users } from './generated';\n${checkBody}`,
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

const SQL = 'CREATE TABLE users (id integer PRIMARY KEY, email text NOT NULL, bio text);';

it('TypeScript output type-checks with the TypeScript compiler', () => {
  const { output } = sqlToTypes(SQL, { dialect: 'postgresql', target: 'typescript' });
  const diagnostics = typeCheck(output, 'const value: Users = { id: 1, email: "a@b.com", bio: null };\nvoid value;\n');
  expect(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '))).toEqual([]);
});

it('a wrongly typed value fails the TypeScript compiler check', () => {
  const { output } = sqlToTypes(SQL, { dialect: 'postgresql', target: 'typescript' });
  const diagnostics = typeCheck(
    output,
    'const value: Users = { id: "not-a-number", email: "a@b.com", bio: null };\nvoid value;\n',
  );
  expect(diagnostics.length).toBeGreaterThan(0);
});

it('bio without NOT NULL type-checks as nullable, confirmed against real TypeScript', () => {
  const { output } = sqlToTypes(SQL, { dialect: 'postgresql', target: 'typescript' });
  expect(output).toContain('bio: string | null;');
  const diagnostics = typeCheck(output, 'const value: Users = { id: 1, email: "a@b.com" };\nvoid value;\n');
  // bio is required (as a key) but its own type allows null; omitting the
  // key entirely is a genuine TypeScript error (Property bio is missing).
  expect(diagnostics.length).toBeGreaterThan(0);
});
