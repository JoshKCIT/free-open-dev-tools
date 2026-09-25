/**
 * Uses the real TypeScript compiler (a devDependency of this package) as an
 * oracle: builds an in-memory program of the generated source plus a check
 * file, and asserts the compiler agrees, the same shape json-to-code's own
 * TypeScript test uses.
 */
import ts from 'typescript';
import { it, expect, vi } from 'vitest';
import { graphqlToTypeScript, GraphqlToTypeScriptError } from '../src/index';

// Fetched with `curl -fsSL https://spec.graphql.org/September2025/`, 2026-09-25
// (graphql-js 17.0.2's own README points at https://graphql.org/graphql-js/
// and the "Specification for GraphQL" repository for the language this
// package parses; September 2025 is spec.graphql.org's own "Latest Release"
// row as of this session, the edition graphql-js 17 targets).
//
// Section 3.6 Objects, Example 44: "type Person {\n  name: String\n  age: Int\n  picture: Url\n}"
// Section 3.7 Interfaces: "an interface NamedEntity may describe a required
// field and types such as Person or Business may then implement this
// interface to guarantee this field will always exist."
// Section 3.12 Non-Null: "A trailing exclamation mark is used to denote a
// field that uses a Non-Null type like this: name: String!."

const SPEC_SCHEMA = `
"""An entity with a name, per the spec's Interfaces section."""
interface NamedEntity {
  name: String!
}

"""A GraphQL Person, per the spec's Objects section example."""
type Person implements NamedEntity {
  name: String!
  age: Int
  friends: [Person]
}

enum Episode {
  NEWHOPE
  EMPIRE
  JEDI @deprecated(reason: "Use RETURN_OF_THE_JEDI.")
}

union SearchResult = Person

input PersonInput {
  name: String!
  age: Int
}

type Query {
  hero(episode: Episode): Person
  search: [SearchResult]
  people(filter: PersonInput): [Person!]!
}
`;

function typeCheck(files: Record<string, string>, entry: string): readonly ts.Diagnostic[] {
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
    moduleNames.map((name) => {
      const resolved = name.startsWith('./') ? `/virtual/${name.slice(2)}.ts` : undefined;
      return resolved !== undefined && resolved in files
        ? { resolvedFileName: resolved, extension: ts.Extension.Ts }
        : undefined;
    });
  const program = ts.createProgram([entry], options, host);
  return ts.getPreEmitDiagnostics(program);
}

it('GraphQL specification type system examples produce TypeScript that compiles in strict mode', () => {
  const { output, types } = graphqlToTypeScript(SPEC_SCHEMA);
  expect(types).toBe(6); // NamedEntity, Person, Episode, SearchResult, PersonInput, Query
  const diagnostics = typeCheck(
    {
      '/virtual/generated.ts': output,
      '/virtual/check.ts': `import type { Person } from './generated';\nconst value: Person = { name: 'Luke', age: null, friends: [null, { name: 'Leia', age: 19, friends: [] }] };\nvoid value;\n`,
    },
    '/virtual/check.ts',
  );
  expect(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '))).toEqual([]);
});

it('non-null, list and nullable wrappers map to required, array and null union types', () => {
  const { output } = graphqlToTypeScript(SPEC_SCHEMA);
  expect(output).toContain('name: string;'); // String! on NamedEntity and Person
  expect(output).toContain('age: number | null;'); // Int, nullable
  expect(output).toContain('friends: (Person | null)[] | null;'); // [Person], nullable list of nullable items
});

it('enums, unions, interfaces and input objects map to the documented TypeScript forms', () => {
  const unionStyle = graphqlToTypeScript(SPEC_SCHEMA);
  expect(unionStyle.output).toContain("export type Episode = 'NEWHOPE' | 'EMPIRE' | 'JEDI';");
  expect(unionStyle.output).toContain('export interface NamedEntity {');
  expect(unionStyle.output).toContain('export type SearchResult = Person;');
  expect(unionStyle.output).toContain('export interface PersonInput {');
  expect(unionStyle.output).toContain('age?: number | null;'); // nullable input field, optional
  expect(unionStyle.output).toMatch(/PersonInput \{\s*name: string;/); // non-null input field, required

  const enumStyle = graphqlToTypeScript(SPEC_SCHEMA, { enumStyle: 'enum' });
  expect(enumStyle.output).toContain('export enum Episode {');
  expect(enumStyle.output).toContain("NEWHOPE = 'NEWHOPE',");
  expect(enumStyle.output).toContain('@deprecated Use RETURN_OF_THE_JEDI.');
});

it('field arguments produce an arguments type with optional nullable arguments', () => {
  const { output } = graphqlToTypeScript(SPEC_SCHEMA);
  expect(output).toContain('export interface QueryHeroArgs {');
  expect(output).toContain('episode?: Episode | null;');
  expect(output).toContain('export interface QueryPeopleArgs {');
  expect(output).toContain('filter?: PersonInput | null;');
});

it('custom scalars map to unknown unless a safe mapping is given', () => {
  const schema = `scalar DateTime\ntype Query { at: DateTime }`;
  const unmapped = graphqlToTypeScript(schema);
  expect(unmapped.output).toContain('export type DateTime = unknown;');
  expect(unmapped.warnings).toEqual([]);

  const mapped = graphqlToTypeScript(schema, { scalars: { DateTime: 'string' } });
  expect(mapped.output).toContain('export type DateTime = string;');

  const unsafe = graphqlToTypeScript(schema, { scalars: { DateTime: "string; })(); alert('x'" } });
  expect(unsafe.output).toContain('export type DateTime = unknown;');
  expect(unsafe.output).not.toContain('alert');
  expect(unsafe.warnings.some((w) => w.includes('DateTime'))).toBe(true);
});

it('an invalid schema is refused with the GraphQL error message and its line and column', () => {
  let thrown: unknown;
  try {
    graphqlToTypeScript('type A { b: B }');
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(GraphqlToTypeScriptError);
  const error = thrown as GraphqlToTypeScriptError;
  expect(error.message).toContain('B');
  expect(typeof error.line).toBe('number');
  expect(typeof error.column).toBe('number');
  expect(error.line).toBe(1);
  expect(error.column).toBe(13);
});

it('descriptions and deprecation reasons become JSDoc comments that cannot break out of the comment', () => {
  const schema = `
"""A type. */ nested close attempt"""
type Weird {
  """A field. */ nested close attempt"""
  value: String @deprecated(reason: "Use other. */ nested close attempt")
}
type Query { weird: Weird }
`;
  const { output } = graphqlToTypeScript(schema);
  expect(output).not.toMatch(/A type\. \*\/ nested/); // the literal terminator sequence never appears unescaped
  expect(output).toContain('A type. *\\/ nested close attempt');
  expect(output).toContain('@deprecated Use other. *\\/ nested close attempt');
  const diagnostics = typeCheck({ '/virtual/generated.ts': output }, '/virtual/generated.ts');
  expect(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '))).toEqual([]);
});

it('a sample response assigns to the generated types and a wrong one does not', () => {
  const { output } = graphqlToTypeScript(SPEC_SCHEMA);
  const files = { '/virtual/generated.ts': output };

  const good = typeCheck(
    {
      ...files,
      '/virtual/good.ts': `import type { Person } from './generated';\nconst v: Person = { name: 'Leia', age: 19, friends: [] };\nvoid v;\n`,
    },
    '/virtual/good.ts',
  );
  expect(good.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '))).toEqual([]);

  const bad = typeCheck(
    {
      ...files,
      '/virtual/bad.ts': `import type { Person } from './generated';\nconst v: Person = { name: 42, age: 19, friends: [] };\nvoid v;\n`,
    },
    '/virtual/bad.ts',
  );
  expect(bad.length).toBeGreaterThan(0);
});

it('nothing is written to the console while parsing or generating', () => {
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const spies = methods.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
  try {
    graphqlToTypeScript(SPEC_SCHEMA, { enumStyle: 'enum', includeTypename: true, scalars: { DateTime: 'string' } });
    try {
      graphqlToTypeScript('type A { b: B }');
    } catch {
      // expected: the refusal itself is under test elsewhere
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});
