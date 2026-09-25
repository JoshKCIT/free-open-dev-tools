/**
 * Uses the real TypeScript compiler (a devDependency-only test oracle, per
 * shared procedure C) as an oracle: builds an in-memory program of two
 * virtual files, the generated interface source and a check file assigning
 * a sample literal to the root type under strict mode, and asserts the
 * compiler agrees. The same pattern this project's json-to-code tool
 * established (tools/json-to-code/test/typescript.test.ts).
 */
import ts from 'typescript';
import path from 'node:path';
import { it, expect } from 'vitest';
import { sqlToTypes, SqlToTypesError, type Dialect } from '../src/index';

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

/**
 * The Drizzle oracle. Unlike `typeCheck` above, the virtual file's own name
 * is a REAL path inside `tools/sql-to-types/test/` rather than a made-up
 * `/virtual/...` one, and no `resolveModuleNames` stub is installed: this
 * lets TypeScript's own default module resolution walk the real directory
 * tree from that path and find `drizzle-orm` in this package's own
 * `node_modules`, so the generated Drizzle source is checked against the
 * genuine installed package rather than a hand-written stub of its types.
 */
function normalizeSlashes(p: string): string {
  return p.split(path.sep).join('/');
}

function typeCheckDrizzle(generated: string): readonly ts.Diagnostic[] {
  const virtualPath = normalizeSlashes(path.join(__dirname, '__drizzle_generated__.ts'));
  const files: Record<string, string> = { [virtualPath]: generated };
  const options: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  const origGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, ...rest) => {
    const key = normalizeSlashes(fileName);
    if (files[key] !== undefined) return ts.createSourceFile(fileName, files[key]!, languageVersion, true);
    return origGetSourceFile(fileName, languageVersion, ...rest);
  };
  const origFileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => normalizeSlashes(fileName) in files || origFileExists(fileName);
  const origReadFile = host.readFile.bind(host);
  host.readFile = (fileName) => files[normalizeSlashes(fileName)] ?? origReadFile(fileName);
  const program = ts.createProgram([virtualPath], options, host);
  return ts.getPreEmitDiagnostics(program);
}

const DRIZZLE_SQL = 'CREATE TABLE users (id integer PRIMARY KEY, email text NOT NULL, bio text);';

it('Drizzle output type-checks against drizzle-orm for PostgreSQL, MySQL and SQLite', () => {
  for (const dialect of ['postgresql', 'mysql', 'sqlite'] as Dialect[]) {
    const { output } = sqlToTypes(DRIZZLE_SQL, { dialect, target: 'drizzle' });
    const diagnostics = typeCheckDrizzle(output);
    expect(
      diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')),
      `dialect ${dialect}`,
    ).toEqual([]);
  }
}, 120000);

it('a misspelt Drizzle builder fails the drizzle-orm type check', () => {
  const { output } = sqlToTypes(DRIZZLE_SQL, { dialect: 'postgresql', target: 'drizzle' });
  const misspelt = output.replace(/\bprimaryKey\b/, 'primaryKeyXYZ').replace(/\binteger\b/g, 'integerXYZ');
  const diagnostics = typeCheckDrizzle(misspelt);
  expect(diagnostics.length).toBeGreaterThan(0);
}, 120000);

it('SQL Server input with the Drizzle target is refused because drizzle-orm has no SQL Server table builder', () => {
  expect(() => sqlToTypes(DRIZZLE_SQL, { dialect: 'sqlserver', target: 'drizzle' })).toThrow(SqlToTypesError);
  try {
    sqlToTypes(DRIZZLE_SQL, { dialect: 'sqlserver', target: 'drizzle' });
  } catch (err) {
    expect((err as SqlToTypesError).message).toMatch(/no sql server table builder/i);
  }
});
