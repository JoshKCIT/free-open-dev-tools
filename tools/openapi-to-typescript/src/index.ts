import meta from './meta.json';
import { readOpenApiDocument, OpenApiDocumentError, type OpenApiVersion } from './openapi-document';
import { hasOwn, getOwn } from './own-property';
import { assignTypeNames, pascalCase } from './naming';
import { emitNamedSchema, renderType, type EmitContext } from './emit';

export { meta };
export type { OpenApiVersion };

export interface OpenApiToTypeScriptOptions {
  format?: 'auto' | 'json' | 'yaml';
  includeOperations?: boolean;
  declarationStyle?: 'interface' | 'type';
}

export interface OpenApiToTypeScriptResult {
  output: string;
  /** Count of named component/definition schemas emitted. */
  types: number;
  /** Count of operations that produced at least one type. */
  operations: number;
  warnings: string[];
}

export class OpenApiToTypeScriptError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'OpenApiToTypeScriptError';
    this.line = detail.line;
    this.column = detail.column;
  }
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function collectNamedSchemas(root: unknown, version: OpenApiVersion): Record<string, unknown> {
  if (!isPlainObject(root)) return {};
  if (version === 'swagger-2.0') {
    const defs = getOwn(root, 'definitions');
    return isPlainObject(defs) ? defs : {};
  }
  const components = getOwn(root, 'components');
  if (!isPlainObject(components)) return {};
  const schemas = getOwn(components, 'schemas');
  return isPlainObject(schemas) ? schemas : {};
}

interface ResolvedParameter {
  name: string;
  in: string;
  required: boolean;
  schema: unknown;
}

/** Resolves a Parameter Object that may be a local `$ref` (a shared `components.parameters` entry). Non-local references are left unresolved. */
function resolveParameter(root: unknown, value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) return undefined;
  if (!hasOwn(value, '$ref')) return value;
  const ref = getOwn(value, '$ref');
  if (typeof ref !== 'string' || !ref.startsWith('#')) return undefined;
  const tokens = ref
    .slice(2)
    .split('/')
    .map((t) => decodeURIComponent(t).replace(/~1/g, '/').replace(/~0/g, '~'));
  let current: unknown = root;
  for (const token of tokens) {
    if (!isPlainObject(current) || !hasOwn(current, token)) return undefined;
    current = getOwn(current, token);
  }
  return isPlainObject(current) ? current : undefined;
}

function parameterSchema(param: Record<string, unknown>, version: OpenApiVersion): unknown {
  if (version === 'swagger-2.0') {
    // A 2.0 non-body parameter carries its schema-shaped fields (type, items, format, ...) directly.
    const { name: _n, in: _in, required: _r, description: _d, ...rest } = param;
    void _n;
    void _in;
    void _r;
    void _d;
    return rest;
  }
  if (hasOwn(param, 'schema')) return getOwn(param, 'schema');
  const content = getOwn(param, 'content');
  if (isPlainObject(content)) {
    const first = Object.values(content)[0];
    if (isPlainObject(first) && hasOwn(first, 'schema')) return getOwn(first, 'schema');
  }
  return undefined;
}

function firstJsonSchema(content: unknown): unknown {
  if (!isPlainObject(content)) return undefined;
  const jsonEntry = getOwn(content, 'application/json');
  if (isPlainObject(jsonEntry) && hasOwn(jsonEntry, 'schema')) return getOwn(jsonEntry, 'schema');
  for (const value of Object.values(content)) {
    if (isPlainObject(value) && hasOwn(value, 'schema')) return getOwn(value, 'schema');
  }
  return undefined;
}

interface OperationEntry {
  key: string;
  operationId?: string;
  method: string;
  pathTemplate: string;
  pathParams: ResolvedParameter[];
  queryParams: ResolvedParameter[];
  headerParams: ResolvedParameter[];
  requestBody?: unknown;
  responses: { status: string; schema: unknown }[];
}

function collectOperations(root: unknown, version: OpenApiVersion): OperationEntry[] {
  if (!isPlainObject(root)) return [];
  const paths = getOwn(root, 'paths');
  if (!isPlainObject(paths)) return [];

  const entries: OperationEntry[] = [];

  for (const pathTemplate of Object.keys(paths).filter((k) => k.startsWith('/'))) {
    const pathItem = getOwn(paths, pathTemplate);
    if (!isPlainObject(pathItem)) continue;
    const pathLevelParams = Array.isArray(getOwn(pathItem, 'parameters'))
      ? (getOwn(pathItem, 'parameters') as unknown[])
      : [];

    for (const method of HTTP_METHODS) {
      if (!hasOwn(pathItem, method)) continue;
      const operation = getOwn(pathItem, method);
      if (!isPlainObject(operation)) continue;

      const operationLevelParams = Array.isArray(getOwn(operation, 'parameters'))
        ? (getOwn(operation, 'parameters') as unknown[])
        : [];
      const byKey = new Map<string, ResolvedParameter>();
      for (const raw of [...pathLevelParams, ...operationLevelParams]) {
        const resolved = resolveParameter(root, raw);
        if (!resolved) continue;
        const name = getOwn(resolved, 'name');
        const inField = getOwn(resolved, 'in');
        if (typeof name !== 'string' || typeof inField !== 'string') continue;
        byKey.set(`${inField}:${name}`, {
          name,
          in: inField,
          required: getOwn(resolved, 'required') === true,
          schema: parameterSchema(resolved, version),
        });
      }

      const pathParams = [...byKey.values()].filter((p) => p.in === 'path');
      const queryParams = [...byKey.values()].filter((p) => p.in === 'query');
      const headerParams = [...byKey.values()].filter((p) => p.in === 'header');

      let requestBody: unknown;
      if (version === 'swagger-2.0') {
        const bodyParam = [...pathLevelParams, ...operationLevelParams]
          .map((p) => resolveParameter(root, p))
          .find((p) => p && getOwn(p, 'in') === 'body');
        if (bodyParam) requestBody = getOwn(bodyParam, 'schema');
      } else if (hasOwn(operation, 'requestBody')) {
        const rb = getOwn(operation, 'requestBody');
        if (isPlainObject(rb)) requestBody = firstJsonSchema(getOwn(rb, 'content'));
      }

      const responses: { status: string; schema: unknown }[] = [];
      const responsesObj = getOwn(operation, 'responses');
      if (isPlainObject(responsesObj)) {
        for (const status of Object.keys(responsesObj)) {
          const response = getOwn(responsesObj, status);
          if (!isPlainObject(response)) continue;
          const schema =
            version === 'swagger-2.0' ? getOwn(response, 'schema') : firstJsonSchema(getOwn(response, 'content'));
          if (schema !== undefined) responses.push({ status, schema });
        }
      }

      const operationId = getOwn(operation, 'operationId');
      entries.push({
        key: `${method} ${pathTemplate}`,
        operationId: typeof operationId === 'string' ? operationId : undefined,
        method,
        pathTemplate,
        pathParams,
        queryParams,
        headerParams,
        requestBody,
        responses,
      });
    }
  }

  return entries;
}

function operationBaseName(entry: OperationEntry): string {
  if (entry.operationId) return entry.operationId;
  return `${entry.method} ${entry.pathTemplate}`;
}

/**
 * Reads an OpenAPI or Swagger document and generates TypeScript source text
 * for its named schemas (`components.schemas` in 3.x, `definitions` in
 * 2.0), and, when `includeOperations` is on, each operation's path/query/
 * header parameters, JSON request body and JSON responses by status.
 * Source text only -- this module never imports the `typescript` package;
 * the compiler and `openapi-typescript` oracles live in the test suite.
 */
export function openApiToTypeScript(text: string, options: OpenApiToTypeScriptOptions = {}): OpenApiToTypeScriptResult {
  const includeOperations = options.includeOperations ?? true;
  const declarationStyle = options.declarationStyle ?? 'interface';

  let doc;
  try {
    doc = readOpenApiDocument(text, { format: options.format });
  } catch (err) {
    if (err instanceof OpenApiDocumentError) {
      throw new OpenApiToTypeScriptError(err.message, { line: err.line, column: err.column });
    }
    throw err;
  }

  const namedSchemas = collectNamedSchemas(doc.value, doc.version);
  const schemaKeys = Object.keys(namedSchemas);
  const schemaTypeNames = assignTypeNames(schemaKeys, 'Schema');

  const ctx: EmitContext = { schemaTypeNames, warnings: new Set() };

  const blocks: string[] = [];
  for (const key of schemaKeys) {
    const name = schemaTypeNames.get(key)!;
    blocks.push(emitNamedSchema(key, name, namedSchemas[key], declarationStyle, ctx));
  }

  let operationCount = 0;
  if (includeOperations) {
    const operations = collectOperations(doc.value, doc.version);
    const operationNames = assignTypeNames(
      operations.map((o) => operationBaseName(o)),
      'Operation',
    );

    for (const entry of operations) {
      const baseName = operationNames.get(operationBaseName(entry))!;
      let produced = false;

      const emitParamGroup = (label: string, params: ResolvedParameter[]) => {
        if (params.length === 0) return;
        const schema = {
          type: 'object',
          properties: Object.fromEntries(params.map((p) => [p.name, p.schema ?? true])),
          required: params.filter((p) => p.required).map((p) => p.name),
        };
        blocks.push(emitNamedSchema(`${entry.key} ${label}`, `${baseName}${label}`, schema, 'interface', ctx));
        produced = true;
      };

      emitParamGroup('PathParams', entry.pathParams);
      emitParamGroup('QueryParams', entry.queryParams);
      emitParamGroup('HeaderParams', entry.headerParams);

      if (entry.requestBody !== undefined) {
        blocks.push(
          emitNamedSchema(`${entry.key} RequestBody`, `${baseName}RequestBody`, entry.requestBody, 'type', ctx),
        );
        produced = true;
      }

      for (const response of entry.responses) {
        const statusName = /^[0-9]+$/.test(response.status) ? response.status : pascalCase(response.status, 'Default');
        blocks.push(
          emitNamedSchema(
            `${entry.key} Response${statusName}`,
            `${baseName}Response${statusName}`,
            response.schema,
            'type',
            ctx,
          ),
        );
        produced = true;
      }

      if (produced) operationCount++;
    }
  }

  const output = blocks.join('\n');

  return {
    output,
    types: schemaKeys.length,
    operations: operationCount,
    warnings: [...ctx.warnings],
  };
}

// renderType is re-exported so tests can exercise the emitter directly without a full document.
export { renderType };
