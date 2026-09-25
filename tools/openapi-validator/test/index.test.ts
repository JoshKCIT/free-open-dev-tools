import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { it, expect, vi, afterEach } from 'vitest';
import { validateOpenApi } from '../src/index';
import schemaSwagger20 from '../src/schema-swagger-2.0.json';
import schemaOpenApi30 from '../src/schema-openapi-3.0.json';
import schemaOpenApi31 from '../src/schema-openapi-3.1.json';
import schemaOpenApi32 from '../src/schema-openapi-3.2.json';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = join(HERE, 'fixtures', 'openapi-examples');
const SCHEMAS = join(HERE, 'fixtures', 'openapi-schemas');

function readExample(path: string): string {
  return readFileSync(join(EXAMPLES, path), 'utf8');
}

/** Every top-level, self-contained OpenAPI/Swagger document vendored for this tool (fragment-only files, referenced by $ref from these, are excluded). */
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

it('the official OpenAPI Initiative example documents for 2.0, 3.0 and 3.1 validate with no errors', () => {
  for (const path of [...V2_DOCS, ...V30_DOCS, ...V31_DOCS]) {
    const result = validateOpenApi(readExample(path), { format: 'json' });
    expect(result.errors, `${path}: ${JSON.stringify(result.errors)}`).toEqual([]);
    expect(result.valid, path).toBe(true);
  }
});

it('Swagger 2.0 documents are checked against the official 2.0 schema', () => {
  const result = validateOpenApi(readExample('v2.0/json/petstore.json'), { format: 'json' });
  expect(result.version).toBe('swagger-2.0');
  expect(result.valid).toBe(true);
  expect(result.counts.paths).toBeGreaterThan(0);
});

it('OpenAPI 3.0 documents are checked against the official 3.0 schema', () => {
  const result = validateOpenApi(readExample('v3.0/petstore.json'), { format: 'json' });
  expect(result.version).toBe('openapi-3.0');
  expect(result.valid).toBe(true);
});

it('OpenAPI 3.1 documents are checked against the official 3.1 schema and dialect', () => {
  const result = validateOpenApi(readExample('v3.1/tictactoe.json'), { format: 'json' });
  expect(result.version).toBe('openapi-3.1');
  expect(result.valid, JSON.stringify(result.errors)).toBe(true);
  // The dialect's own base vocabulary (discriminator/externalDocs/xml) and the standard
  // 2020-12 validation vocabulary (type/minimum/description/...) must both be honoured
  // for a Schema Object node -- a document with a Schema Object carrying an invalid
  // "type" value must still be refused, proving the dialect is genuinely applied, not
  // silently skipped.
  const broken = JSON.parse(readExample('v3.1/tictactoe.json')) as { components: { schemas: Record<string, unknown> } };
  broken.components.schemas.errorMessage = { type: 'not-a-real-type' };
  const brokenResult = validateOpenApi(JSON.stringify(broken), { format: 'json' });
  expect(brokenResult.valid).toBe(false);
});

it('OpenAPI 3.2 documents are checked against the official 3.2 schema and dialect', () => {
  const minimal = {
    openapi: '3.2.0',
    info: { title: 't', version: '1' },
    paths: {
      '/pets': { get: { responses: { '200': { description: 'ok' } } } },
    },
    components: {
      schemas: {
        Pet: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      },
    },
  };
  const result = validateOpenApi(JSON.stringify(minimal), { format: 'json' });
  expect(result.version).toBe('openapi-3.2');
  expect(result.valid, JSON.stringify(result.errors)).toBe(true);

  const brokenMinimal = { ...minimal, components: { schemas: { Pet: { type: 'not-a-real-type' } } } };
  const brokenResult = validateOpenApi(JSON.stringify(brokenMinimal), { format: 'json' });
  expect(brokenResult.valid).toBe(false);
});

it('a local reference that points nowhere is reported with its path', () => {
  const doc = {
    openapi: '3.0.4',
    info: { title: 't', version: '1' },
    paths: {
      '/pets': {
        get: {
          responses: {
            '200': {
              description: 'ok',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Missing' } } },
            },
          },
        },
      },
    },
  };
  const result = validateOpenApi(JSON.stringify(doc), { format: 'json' });
  expect(result.valid).toBe(false);
  const refError = result.errors.find((e) => e.keyword === '$ref');
  expect(refError).toBeDefined();
  expect(refError?.path).toBe('/paths/~1pets/get/responses/200/content/application~1json/schema/$ref');
  expect(refError?.message).toMatch(/#\/components\/schemas\/Missing/);
});

it('duplicate operationId values are reported', () => {
  const doc = {
    openapi: '3.0.4',
    info: { title: 't', version: '1' },
    paths: {
      '/pets': { get: { operationId: 'listPets', responses: { '200': { description: 'ok' } } } },
      '/pets2': { get: { operationId: 'listPets', responses: { '200': { description: 'ok' } } } },
    },
  };
  const result = validateOpenApi(JSON.stringify(doc), { format: 'json' });
  expect(result.valid).toBe(false);
  const dupes = result.errors.filter((e) => e.keyword === 'duplicate-operationId');
  expect(dupes).toHaveLength(2);
  expect(dupes[0]?.message).toMatch(/listPets/);
});

it('path template parameters must be declared as required path parameters and match the template', () => {
  const doc = {
    openapi: '3.0.4',
    info: { title: 't', version: '1' },
    paths: {
      '/pets/{petId}': {
        get: { responses: { '200': { description: 'ok' } } },
      },
    },
  };
  const result = validateOpenApi(JSON.stringify(doc), { format: 'json' });
  expect(result.valid).toBe(false);
  const missing = result.errors.find((e) => e.keyword === 'path-parameter' && /petId/.test(e.message));
  expect(missing).toBeDefined();

  const notRequired = {
    ...doc,
    paths: {
      '/pets/{petId}': {
        get: {
          parameters: [{ name: 'petId', in: 'path', schema: { type: 'string' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  };
  const notRequiredResult = validateOpenApi(JSON.stringify(notRequired), { format: 'json' });
  expect(notRequiredResult.valid).toBe(false);
  expect(notRequiredResult.errors.some((e) => e.keyword === 'path-parameter' && /required/.test(e.message))).toBe(true);

  const good = {
    ...doc,
    paths: {
      '/pets/{petId}': {
        get: {
          parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  };
  expect(validateOpenApi(JSON.stringify(good), { format: 'json' }).valid).toBe(true);
});

it('errors carry an RFC 6901 path and the line and column of the value in JSON or YAML', () => {
  const petstore = JSON.parse(readExample('v3.0/petstore.json')) as Record<string, unknown>;
  delete petstore.info;
  const result = validateOpenApi(JSON.stringify(petstore, null, 2), { format: 'json' });
  expect(result.valid).toBe(false);
  const missingInfo = result.errors.find((e) => e.keyword === 'required' && /"?info"?/.test(e.message));
  expect(missingInfo).toBeDefined();
  expect(missingInfo?.path).toBe('');
  expect(missingInfo?.line).toBeGreaterThan(0);
  expect(missingInfo?.column).toBeGreaterThan(0);
});

it('a reference to another file or address is reported as not followed and nothing is fetched', () => {
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
      paths: {
        '/pets': {
          get: {
            responses: {
              '200': {
                description: 'ok',
                content: { 'application/json': { schema: { $ref: 'https://example.invalid/schemas/pet.json' } } },
              },
            },
          },
        },
      },
    };
    const result = validateOpenApi(JSON.stringify(doc), { format: 'json' });
    expect(result.warnings.some((w) => w.includes('example.invalid') && w.includes('not followed'))).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
    (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = originalXhr;
  }
});

it('the bundled schemas equal the vendored upstream copies', () => {
  const readSchema = (name: string): unknown => JSON.parse(readFileSync(join(SCHEMAS, name), 'utf8'));

  expect(schemaSwagger20).toEqual(readSchema('swagger-2.0.schema.json'));
  expect(schemaOpenApi30).toEqual(readSchema('openapi-3.0.schema.json'));

  const bundle31 = schemaOpenApi31 as {
    schemaBase: unknown;
    schema: unknown;
    dialect: unknown;
    meta: unknown;
  };
  expect(bundle31.schemaBase).toEqual(readSchema('openapi-3.1.schema-base.json'));
  expect(bundle31.schema).toEqual(readSchema('openapi-3.1.schema.json'));
  expect(bundle31.dialect).toEqual(readSchema('openapi-3.1.dialect.json'));
  expect(bundle31.meta).toEqual(readSchema('openapi-3.1.meta.json'));

  const bundle32 = schemaOpenApi32 as {
    schemaBase: unknown;
    schema: unknown;
    dialect: unknown;
    meta: unknown;
  };
  expect(bundle32.schemaBase).toEqual(readSchema('openapi-3.2.schema-base.json'));
  expect(bundle32.schema).toEqual(readSchema('openapi-3.2.schema.json'));
  expect(bundle32.dialect).toEqual(readSchema('openapi-3.2.dialect.json'));
  expect(bundle32.meta).toEqual(readSchema('openapi-3.2.meta.json'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

it('nothing is written to the console while parsing or validating', () => {
  const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );

  validateOpenApi(readExample('v3.0/petstore.json'), { format: 'json' });
  try {
    validateOpenApi('{"openapi":"4.0.0","info":{},"paths":{}}', { format: 'json' });
  } catch {
    /* expected */
  }
  try {
    validateOpenApi('{not valid json', { format: 'json' });
  } catch {
    /* expected */
  }
  try {
    validateOpenApi('openapi: [', { format: 'yaml' });
  } catch {
    /* expected */
  }
  validateOpenApi(
    JSON.stringify({
      openapi: '3.0.4',
      info: { title: 't', version: '1' },
      paths: {
        '/a': {
          get: {
            responses: {
              '200': {
                description: 'ok',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Nope' } } },
              },
            },
          },
        },
      },
    }),
    { format: 'json' },
  );

  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
});
