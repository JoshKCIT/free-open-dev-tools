import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import openapiTS, { astToString } from 'openapi-typescript';
import { it, expect, vi, afterEach } from 'vitest';
import { openApiToTypeScript, OpenApiToTypeScriptError } from '../src/index';
import { pascalCase } from '../src/naming';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = join(HERE, 'fixtures', 'openapi-examples');

function readExample(path: string): string {
  return readFileSync(join(EXAMPLES, path), 'utf8');
}

/** Every top-level, self-contained OpenAPI/Swagger document vendored for this tool (fragment-only files, referenced by $ref from these, are excluded). Same list as openapi-validator's, copied by reading since the fixture folder itself is a byte-for-byte copy. */
const V2_DOCS = [
  'v2.0/json/api-with-examples.json',
  'v2.0/json/petstore-expanded.json',
  'v2.0/json/petstore-minimal.json',
  'v2.0/json/petstore-separate/spec/swagger.json',
  'v2.0/json/petstore-simple.json',
  'v2.0/json/petstore-with-external-docs.json',
  'v2.0/json/petstore.json',
  'v2.0/json/uber.json',
];
const V30_DOCS = [
  'v3.0/api-with-examples.json',
  'v3.0/callback-example.json',
  'v3.0/link-example.json',
  'v3.0/petstore-expanded.json',
  'v3.0/petstore.json',
  'v3.0/uspto.json',
];
const V31_DOCS = ['v3.1/non-oauth-scopes.json', 'v3.1/tictactoe.json', 'v3.1/webhook-example.json'];

/**
 * Uses the real TypeScript compiler (already a devDependency, per shared
 * procedure C) as an in-memory oracle: builds a virtual program from the
 * given in-memory files under strict mode and returns its diagnostics.
 * `noUnusedLocals` is off because the mutual-assignability check declares
 * variables purely to force the compiler to evaluate an assignment; nothing
 * here is ever run.
 */
function typeCheck(files: Record<string, string>, entry: string): readonly ts.Diagnostic[] {
  const options: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    noUnusedLocals: false,
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
      const resolved = `/virtual/${name.replace(/^\.\//, '')}.ts`;
      return resolved in files ? { resolvedFileName: resolved, extension: ts.Extension.Ts } : undefined;
    });
  const program = ts.createProgram([entry], options, host);
  return ts.getPreEmitDiagnostics(program);
}

function diagnosticMessages(diagnostics: readonly ts.Diagnostic[]): string[] {
  return diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
}

it('every official example document generates TypeScript that compiles in strict mode', () => {
  for (const path of [...V2_DOCS, ...V30_DOCS, ...V31_DOCS]) {
    const text = readExample(path);
    const result = openApiToTypeScript(text, { format: 'json' });
    if (result.output.trim() === '') continue; // a document with no named schemas and no typed operations, e.g. api-with-examples.json
    const diagnostics = typeCheck({ '/virtual/generated.ts': result.output }, '/virtual/generated.ts');
    expect(diagnosticMessages(diagnostics), path).toEqual([]);
  }
}, 30000);

it('component types are mutually assignable with the types openapi-typescript generates for the same document', async () => {
  // openapi-typescript 7.13.0 supports OpenAPI 3.0 and 3.1 (its own README:
  // "Supports OpenAPI 3.0 and 3.1"; 2.x needs its own 5.x line), so the
  // cross-check runs against one 3.0 and one 3.1 vendored example.
  for (const path of ['v3.0/petstore.json', 'v3.1/tictactoe.json']) {
    const text = readExample(path);
    const doc = JSON.parse(text) as { components: { schemas: Record<string, unknown> } };
    const schemaNames = Object.keys(doc.components.schemas);

    const ours = openApiToTypeScript(text, { format: 'json', includeOperations: false });
    const oracleAst = await openapiTS(doc as never, { silent: true });
    const oracleSource = astToString(oracleAst);

    const checks = schemaNames
      .map((name) => pascalCase(name, 'Schema'))
      .map(
        (typeName, i) => `
declare const ours_${i}: Ours.${typeName};
const oracleAccepts_${i}: Oracle.components['schemas']['${schemaNames[i]}'] = ours_${i};
declare const oracle_${i}: Oracle.components['schemas']['${schemaNames[i]}'];
const oursAccepts_${i}: Ours.${typeName} = oracle_${i};
`,
      )
      .join('\n');

    const files: Record<string, string> = {
      '/virtual/ours.ts': ours.output,
      '/virtual/oracle.ts': oracleSource,
      '/virtual/check.ts': `import * as Ours from './ours';\nimport * as Oracle from './oracle';\n${checks}`,
    };
    const diagnostics = typeCheck(files, '/virtual/check.ts');
    expect(diagnosticMessages(diagnostics), path).toEqual([]);
  }
}, 20000);

it('OpenAPI 3.0 nullable and 3.1 null types both become a union with null', () => {
  const doc30 = {
    openapi: '3.0.4',
    info: { title: 't', version: '1' },
    paths: {},
    components: { schemas: { Nullable30: { type: 'string', nullable: true } } },
  };
  const result30 = openApiToTypeScript(JSON.stringify(doc30));
  expect(result30.output).toContain('export type Nullable30 = string | null;');

  const doc31 = {
    openapi: '3.1.0',
    info: { title: 't', version: '1' },
    paths: {},
    components: { schemas: { Nullable31: { type: ['string', 'null'] } } },
  };
  const result31 = openApiToTypeScript(JSON.stringify(doc31));
  expect(result31.output).toContain('export type Nullable31 = string | null;');
});

it('allOf, oneOf, anyOf, enum and additionalProperties map to the documented TypeScript forms', () => {
  const doc = {
    openapi: '3.0.4',
    info: { title: 't', version: '1' },
    paths: {},
    components: {
      schemas: {
        AllOfThing: {
          allOf: [
            { type: 'object', properties: { a: { type: 'string' } } },
            { type: 'object', properties: { b: { type: 'number' } } },
          ],
        },
        OneOfThing: { oneOf: [{ type: 'string' }, { type: 'number' }] },
        AnyOfThing: { anyOf: [{ type: 'string' }, { type: 'number' }] },
        EnumThing: { type: 'string', enum: ['a', 'b', 'c'] },
        MapWithNamedProps: {
          type: 'object',
          properties: { known: { type: 'string' } },
          additionalProperties: { type: 'number' },
        },
        FreeMap: { type: 'object', additionalProperties: { type: 'number' } },
      },
    },
  };
  const result = openApiToTypeScript(JSON.stringify(doc));

  // allOf combines two object schemas: the emitted type is an intersection,
  // never `export interface X {...} & {...}`, which is invalid TypeScript
  // syntax (a bug found and fixed while executing this task: emitNamedSchema
  // used to sniff the rendered string's leading `{` and trailing `}` to
  // decide between `interface` and `type`, which misclassified a two-branch
  // object allOf the same way as a single object literal).
  expect(result.output).toMatch(/export type AllOfThing = \{\s*a\?: string;\s*\} & \{\s*b\?: number;\s*\};/);
  expect(result.output).not.toContain('export interface AllOfThing');

  expect(result.output).toContain('export type OneOfThing = string | number;');
  expect(result.output).toContain('export type AnyOfThing = string | number;');
  expect(result.output).toContain('export type EnumThing = "a" | "b" | "c";');

  // additionalProperties as an index signature: typed unknown alongside named
  // properties (so every named property's own type stays assignable to the
  // index signature), and typed by the additionalProperties schema when there
  // are no named properties.
  expect(result.output).toMatch(
    /export interface MapWithNamedProps \{\s*known\?: string;\s*\[key: string\]: unknown;\s*\}/,
  );
  expect(result.output).toMatch(/export interface FreeMap \{\s*\[key: string\]: number;\s*\}/);

  const diagnostics = typeCheck({ '/virtual/generated.ts': result.output }, '/virtual/generated.ts');
  expect(diagnosticMessages(diagnostics)).toEqual([]);
});

it('schema names that are not identifiers or that collide get distinct valid names', () => {
  const doc = {
    openapi: '3.0.4',
    info: { title: 't', version: '1' },
    paths: {},
    components: {
      schemas: {
        'Order Item': { type: 'object', properties: { x: { type: 'string' } } },
        'order-item': { type: 'object', properties: { y: { type: 'string' } } },
      },
    },
  };
  const result = openApiToTypeScript(JSON.stringify(doc));
  expect(result.output).toContain('export interface OrderItem {');
  expect(result.output).toContain('export interface OrderItem2 {');
  // Both are valid, distinct TypeScript identifiers.
  const names = [...result.output.matchAll(/export interface (\w+)/g)].map((m) => m[1]);
  expect(new Set(names).size).toBe(names.length);
  for (const name of names) expect(name).toMatch(/^[A-Za-z_$][A-Za-z0-9_$]*$/);
});

it('operations produce parameter, request body and response types named from operationId', () => {
  const result = openApiToTypeScript(readExample('v3.0/petstore.json'), { format: 'json' });
  expect(result.output).toContain('export interface ListPetsQueryParams {');
  expect(result.output).toContain('export type ListPetsResponse200 = Pets;');
  expect(result.output).toContain('export type ListPetsResponseDefault = Error;');
  expect(result.output).toContain('export type CreatePetsRequestBody = Pet;');
  expect(result.output).toContain('export interface ShowPetByIdPathParams {');
  expect(result.output).toContain('petId: string;');
  expect(result.output).toContain('export type ShowPetByIdResponse200 = Pet;');
  expect(result.operations).toBe(3);
});

it('a reference to another file becomes unknown with a warning and nothing is fetched', () => {
  const originalFetch = globalThis.fetch;
  const originalXhr = (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
  globalThis.fetch = (() => {
    throw new Error('fetch must never be called');
  }) as typeof fetch;
  (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = function XMLHttpRequestSpy() {
    throw new Error('XMLHttpRequest must never be constructed');
  };
  try {
    const doc = {
      openapi: '3.0.4',
      info: { title: 't', version: '1' },
      paths: {},
      components: {
        schemas: {
          UsesExternal: { type: 'object', properties: { thing: { $ref: 'https://example.invalid/schemas/pet.json' } } },
        },
      },
    };
    const result = openApiToTypeScript(JSON.stringify(doc));
    expect(result.output).toContain('thing?: unknown;');
    expect(result.warnings.some((w) => w.includes('example.invalid') && w.includes('not followed'))).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
    (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = originalXhr;
  }
});

it('a broken document raises OpenApiToTypeScriptError with the reader position', () => {
  expect(() => openApiToTypeScript('{"info":{},"paths":{}}')).toThrow(OpenApiToTypeScriptError);
  expect(() => openApiToTypeScript('{"openapi":"4.0.0","info":{},"paths":{}}')).toThrow(/"4\.0\.0"/);
});

afterEach(() => {
  vi.restoreAllMocks();
});

it('nothing is written to the console while generating', () => {
  const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );

  openApiToTypeScript(readExample('v3.0/petstore.json'), { format: 'json' });
  openApiToTypeScript(
    JSON.stringify({
      openapi: '3.0.4',
      info: { title: 't', version: '1' },
      paths: {},
      components: { schemas: { X: { anyOf: [{ type: 'string' }], allOf: [{ type: 'object' }] } } },
    }),
  );
  try {
    openApiToTypeScript('{"openapi":"4.0.0","info":{},"paths":{}}');
  } catch {
    /* expected */
  }
  try {
    openApiToTypeScript('{not valid json');
  } catch {
    /* expected */
  }

  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
});
