import meta from './meta.json';
import Ajv2020 from 'ajv/dist/2020';
import AjvDraft04 from 'ajv-draft-04';
import addFormats from 'ajv-formats';
import type { Ajv, ErrorObject, ValidateFunction } from 'ajv';
import {
  readOpenApiDocument,
  resolvePointerValue,
  OpenApiDocumentError,
  type OpenApiVersion,
} from './openapi-document';
import { hasOwn, getOwn } from './own-property';
import { formatPointer, parsePointer } from './pointer';
import schemaSwagger20 from './schema-swagger-2.0.json';
import schemaOpenApi30 from './schema-openapi-3.0.json';
import schemaOpenApi31 from './schema-openapi-3.1.json';
import schemaOpenApi32 from './schema-openapi-3.2.json';

export { meta };
export type { OpenApiVersion };

export interface OpenApiValidationError {
  /** RFC 6901 JSON Pointer to the offending location. Empty string is the whole document. */
  path: string;
  keyword: string;
  message: string;
  line?: number;
  column?: number;
}

export interface ValidateOpenApiResult {
  valid: boolean;
  version: OpenApiVersion;
  errors: OpenApiValidationError[];
  /** Count of oneOf/anyOf/if errors folded away because a more specific error at a deeper path already explains the same failure. */
  collapsed: number;
  warnings: string[];
  counts: { paths: number; operations: number; schemas: number; errors: number };
}

export interface ValidateOpenApiOptions {
  format?: 'auto' | 'json' | 'yaml';
  /** Default true. Checks format keywords (date-time, email, uri, ...) that ajv-formats defines. */
  checkFormats?: boolean;
}

export class OpenApiValidatorError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'OpenApiValidatorError';
    this.line = detail.line;
    this.column = detail.column;
  }
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query'] as const;

/**
 * Finds every `{"$dynamicRef": "#meta"}` node in a cloned copy of an
 * OpenAPI 3.1/3.2 document schema and replaces it with a plain `allOf` of
 * the standard 2020-12 meta-schema and this version's own OAS base
 * vocabulary document, both added to the Ajv instance under their own
 * `$id`. This is a deliberate, tested workaround (see openapi-validator's
 * SUMMARY): Ajv 8.20.0 does not resolve a `$dynamicAnchor` declared inside
 * a `$defs` entry of the outermost compiled schema resource into the
 * dynamic scope, so `$dynamicRef: "#meta"` silently resolves to nothing
 * and every property inside a Schema Object is reported as an unevaluated
 * property. A static `$ref` to the same two documents the dialect would
 * have combined produces the same result the dialect mechanism was meant
 * to produce, confirmed against every official example document for this
 * version. This project's validator always uses the OAS's own default
 * dialect (a document overriding `jsonSchemaDialect` to a different
 * dialect is not specially honoured); that is named in this package's
 * `limits`.
 */
function replaceDynamicMetaRef(node: unknown, metaId: string): void {
  if (Array.isArray(node)) {
    for (const item of node) replaceDynamicMetaRef(item, metaId);
    return;
  }
  if (node !== null && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (hasOwn(obj, '$dynamicRef') && getOwn(obj, '$dynamicRef') === '#meta') {
      delete obj.$dynamicRef;
      obj.allOf = [{ $ref: 'https://json-schema.org/draft/2020-12/schema' }, { $ref: metaId }];
    }
    for (const key of Object.keys(obj)) replaceDynamicMetaRef(obj[key], metaId);
  }
}

interface SchemaBundle31 {
  schemaBase: Record<string, unknown>;
  schema: Record<string, unknown>;
  dialect: Record<string, unknown>;
  meta: { $id: string } & Record<string, unknown>;
}

/**
 * Builds a fresh Ajv (or ajv-draft-04) instance and compiles it exactly
 * once per version, from the bundled schemas -- the schemas are fixed data,
 * never visitor input, so caching the compiled validator across calls is
 * safe and avoids recompiling the same schema on every keystroke.
 */
const validatorCache = new Map<string, ValidateFunction>();

function buildValidator(version: OpenApiVersion, checkFormats: boolean): ValidateFunction {
  const cacheKey = `${version}:${checkFormats}`;
  const cached = validatorCache.get(cacheKey);
  if (cached) return cached;

  const ajvOptions = {
    allErrors: true,
    strict: false,
    logger: false as const,
    ownProperties: true,
    validateFormats: checkFormats,
  };

  let ajv: Ajv;
  let validate: ValidateFunction;

  if (version === 'swagger-2.0' || version === 'openapi-3.0') {
    ajv = new AjvDraft04(ajvOptions) as unknown as Ajv;
    if (checkFormats) addFormats(ajv as never);
    const schema = version === 'swagger-2.0' ? schemaSwagger20 : schemaOpenApi30;
    validate = ajv.compile(schema as object);
  } else {
    ajv = new Ajv2020(ajvOptions) as unknown as Ajv;
    if (checkFormats) addFormats(ajv as never);
    const bundle = (version === 'openapi-3.1' ? schemaOpenApi31 : schemaOpenApi32) as unknown as SchemaBundle31;
    const schema = structuredClone(bundle.schema);
    replaceDynamicMetaRef(schema, bundle.meta.$id);
    ajv.addSchema(bundle.meta as object);
    validate = ajv.compile(schema);
  }

  validatorCache.set(cacheKey, validate);
  return validate;
}

function mapAjvError(
  e: ErrorObject,
  locate: (pointer: string) => { line: number; column: number } | undefined,
): OpenApiValidationError {
  const pos = locate(e.instancePath);
  return {
    path: e.instancePath,
    keyword: e.keyword,
    message: e.message ?? 'Validation failed.',
    line: pos?.line,
    column: pos?.column,
  };
}

/**
 * Folds an `oneOf`, `anyOf` or `if` error into `collapsed` when its path is
 * a prefix of a more specific error's path, so the displayed table leads
 * with the most specific problems rather than the generic combinator that
 * wraps them.
 */
function collapseErrors(errors: OpenApiValidationError[]): { errors: OpenApiValidationError[]; collapsed: number } {
  const sorted = [...errors].sort((a, b) => a.path.localeCompare(b.path));
  const kept: OpenApiValidationError[] = [];
  let collapsed = 0;
  for (const err of sorted) {
    const isCombinator = err.keyword === 'oneOf' || err.keyword === 'anyOf' || err.keyword === 'if';
    const hasMoreSpecific =
      isCombinator &&
      sorted.some((other) => other !== err && other.path !== err.path && other.path.startsWith(err.path));
    if (hasMoreSpecific) {
      collapsed++;
      continue;
    }
    kept.push(err);
  }
  return { errors: kept, collapsed };
}

interface WalkNode {
  pointer: string;
  tokens: string[];
  value: unknown;
}

function* walk(value: unknown, tokens: string[] = []): Generator<WalkNode> {
  yield { pointer: formatPointer(tokens), tokens, value };
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) yield* walk(value[i], [...tokens, String(i)]);
  } else if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      yield* walk((value as Record<string, unknown>)[key], [...tokens, key]);
    }
  }
}

/** Percent-decodes a `$ref` fragment per RFC 3986 before RFC 6901 pointer parsing. */
function decodeRefFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

function checkLocalRefs(root: unknown, locate: (pointer: string) => { line: number; column: number } | undefined) {
  const errors: OpenApiValidationError[] = [];
  const warnings: string[] = [];

  for (const node of walk(root)) {
    if (node.value === null || typeof node.value !== 'object' || Array.isArray(node.value)) continue;
    const obj = node.value as Record<string, unknown>;
    if (!hasOwn(obj, '$ref')) continue;
    const ref = getOwn(obj, '$ref');
    if (typeof ref !== 'string') continue;

    const refPointer = formatPointer([...node.tokens, '$ref']);
    if (ref.startsWith('#')) {
      const fragment = decodeRefFragment(ref.slice(1));
      const tokens = (() => {
        try {
          return parsePointer(fragment);
        } catch {
          return undefined;
        }
      })();
      const resolved = tokens === undefined ? { found: false, value: undefined } : resolvePointerValue(root, tokens);
      if (!resolved.found) {
        const pos = locate(refPointer);
        errors.push({
          path: refPointer,
          keyword: '$ref',
          message: `This reference points to "${ref}", which does not exist in this document.`,
          line: pos?.line,
          column: pos?.column,
        });
      }
    } else {
      warnings.push(
        `The reference "${ref}" at ${refPointer || '(whole document)'} points to another file or address; it was not followed and nothing was fetched.`,
      );
    }
  }

  return { errors, warnings };
}

function pathTemplateParams(template: string): string[] {
  const names: string[] = [];
  const re = /\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template))) names.push(m[1]!);
  return names;
}

/**
 * Resolves a Parameter Object that may itself be a Reference Object
 * (`{"$ref": "#/..."}`, the common shape for a shared path parameter). Only
 * a local (`#`-prefixed) reference is followed, once, non-recursively --
 * good enough for the shallow "components.parameters" indirection every
 * official example uses; a reference to another reference, or to another
 * file, is left unresolved (named in this package's `limits`).
 */
function resolveParameterObject(root: unknown, value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const obj = value as Record<string, unknown>;
  if (!hasOwn(obj, '$ref')) return obj;
  const ref = getOwn(obj, '$ref');
  if (typeof ref !== 'string' || !ref.startsWith('#')) return undefined;
  const tokens = (() => {
    try {
      return parsePointer(decodeRefFragment(ref.slice(1)));
    } catch {
      return undefined;
    }
  })();
  if (tokens === undefined) return undefined;
  const resolved = resolvePointerValue(root, tokens);
  if (
    !resolved.found ||
    resolved.value === null ||
    typeof resolved.value !== 'object' ||
    Array.isArray(resolved.value)
  ) {
    return undefined;
  }
  return resolved.value as Record<string, unknown>;
}

function collectPathParameters(
  root: unknown,
  list: unknown,
  pointerPrefix: string,
): { name: string; pointer: string; required: boolean }[] {
  if (!Array.isArray(list)) return [];
  const out: { name: string; pointer: string; required: boolean }[] = [];
  for (let i = 0; i < list.length; i++) {
    const resolved = resolveParameterObject(root, list[i]);
    if (!resolved) continue;
    if (getOwn(resolved, 'in') !== 'path') continue;
    const name = getOwn(resolved, 'name');
    if (typeof name !== 'string') continue;
    // Report at the array slot (the $ref site itself, when this entry is a
    // reference), not inside the resolved target, so a visitor sees the
    // problem where their own document actually is.
    out.push({ name, pointer: `${pointerPrefix}/${i}`, required: getOwn(resolved, 'required') === true });
  }
  return out;
}

function checkPathsAndOperations(
  root: unknown,
  locate: (pointer: string) => { line: number; column: number } | undefined,
): { errors: OpenApiValidationError[]; pathCount: number; operationCount: number } {
  const errors: OpenApiValidationError[] = [];
  if (root === null || typeof root !== 'object') return { errors, pathCount: 0, operationCount: 0 };
  const paths = getOwn(root as Record<string, unknown>, 'paths');
  if (paths === null || typeof paths !== 'object' || Array.isArray(paths))
    return { errors, pathCount: 0, operationCount: 0 };

  const pathEntries = Object.keys(paths as Record<string, unknown>).filter((k) => k.startsWith('/'));
  let operationCount = 0;
  const operationIds = new Map<string, string[]>(); // operationId -> pointers

  // Duplicate templated path check: two templates identical except parameter names.
  const normalized = new Map<string, string[]>();
  for (const template of pathEntries) {
    const norm = template.replace(/\{[^}]+\}/g, '{}');
    const list = normalized.get(norm) ?? [];
    list.push(template);
    normalized.set(norm, list);
  }
  for (const [, templates] of normalized) {
    if (templates.length > 1) {
      for (const t of templates) {
        const pointer = formatPointer(['paths', t]);
        const pos = locate(pointer);
        errors.push({
          path: pointer,
          keyword: 'duplicate-path-template',
          message: `This path template is identical to ${templates.filter((o) => o !== t).join(', ')} except for its parameter names.`,
          line: pos?.line,
          column: pos?.column,
        });
      }
    }
  }

  for (const template of pathEntries) {
    const pathItem = getOwn(paths as Record<string, unknown>, template);
    if (pathItem === null || typeof pathItem !== 'object' || Array.isArray(pathItem)) continue;
    const pathItemObj = pathItem as Record<string, unknown>;
    const pathLevelParams = collectPathParameters(
      root,
      getOwn(pathItemObj, 'parameters'),
      formatPointer(['paths', template, 'parameters']),
    );
    const templateParamNames = new Set(pathTemplateParams(template));

    const methodsPresent = HTTP_METHODS.filter((m) => hasOwn(pathItemObj, m));
    operationCount += methodsPresent.length;

    for (const method of methodsPresent) {
      const operation = getOwn(pathItemObj, method);
      if (operation === null || typeof operation !== 'object' || Array.isArray(operation)) continue;
      const operationObj = operation as Record<string, unknown>;
      const operationPointer = formatPointer(['paths', template, method]);

      const operationId = getOwn(operationObj, 'operationId');
      if (typeof operationId === 'string') {
        const pointer = formatPointer(['paths', template, method, 'operationId']);
        const list = operationIds.get(operationId) ?? [];
        list.push(pointer);
        operationIds.set(operationId, list);
      }

      const operationLevelParams = collectPathParameters(
        root,
        getOwn(operationObj, 'parameters'),
        formatPointer(['paths', template, method, 'parameters']),
      );
      // Operation-level parameters override path-level ones of the same name (per spec).
      const byName = new Map<string, { name: string; pointer: string; required: boolean }>();
      for (const p of pathLevelParams) byName.set(p.name, p);
      for (const p of operationLevelParams) byName.set(p.name, p);

      for (const name of templateParamNames) {
        const declared = byName.get(name);
        if (!declared) {
          const pos = locate(operationPointer);
          errors.push({
            path: operationPointer,
            keyword: 'path-parameter',
            message: `The path template names "{${name}}", but no path parameter with that name is declared for this operation.`,
            line: pos?.line,
            column: pos?.column,
          });
        } else if (!declared.required) {
          const pos = locate(declared.pointer);
          errors.push({
            path: declared.pointer,
            keyword: 'path-parameter',
            message: `The path parameter "${name}" is used in the path template, so it must be declared "required": true.`,
            line: pos?.line,
            column: pos?.column,
          });
        }
      }
      for (const [name, declared] of byName) {
        if (!templateParamNames.has(name)) {
          const pos = locate(declared.pointer);
          errors.push({
            path: declared.pointer,
            keyword: 'path-parameter',
            message: `The path parameter "${name}" is declared but does not appear in the path template "${template}".`,
            line: pos?.line,
            column: pos?.column,
          });
        }
      }
    }
  }

  for (const [operationId, pointers] of operationIds) {
    if (pointers.length > 1) {
      for (const pointer of pointers) {
        const pos = locate(pointer);
        errors.push({
          path: pointer,
          keyword: 'duplicate-operationId',
          message: `The operationId "${operationId}" is used by more than one operation (${pointers.length} total); operationId values must be unique.`,
          line: pos?.line,
          column: pos?.column,
        });
      }
    }
  }

  return { errors, pathCount: pathEntries.length, operationCount };
}

function countSchemas(root: unknown, version: OpenApiVersion): number {
  if (root === null || typeof root !== 'object') return 0;
  const obj = root as Record<string, unknown>;
  if (version === 'swagger-2.0') {
    const defs = getOwn(obj, 'definitions');
    if (defs === null || typeof defs !== 'object' || Array.isArray(defs)) return 0;
    return Object.keys(defs as Record<string, unknown>).length;
  }
  const components = getOwn(obj, 'components');
  if (components === null || typeof components !== 'object' || Array.isArray(components)) return 0;
  const schemas = getOwn(components as Record<string, unknown>, 'schemas');
  if (schemas === null || typeof schemas !== 'object' || Array.isArray(schemas)) return 0;
  return Object.keys(schemas as Record<string, unknown>).length;
}

/**
 * Validates an OpenAPI or Swagger document, in JSON or YAML, against the
 * official published JSON Schema for its declared version, then applies
 * the specification rules a schema cannot express: local `$ref` resolution,
 * `operationId` uniqueness, and path template parameter agreement.
 */
export function validateOpenApi(text: string, options: ValidateOpenApiOptions = {}): ValidateOpenApiResult {
  const checkFormats = options.checkFormats ?? true;
  let doc;
  try {
    doc = readOpenApiDocument(text, { format: options.format });
  } catch (err) {
    if (err instanceof OpenApiDocumentError) {
      throw new OpenApiValidatorError(err.message, { line: err.line, column: err.column });
    }
    throw err;
  }

  const validate = buildValidator(doc.version, checkFormats);
  validate(doc.value);
  const ajvErrors = (validate.errors ?? []).map((e) => mapAjvError(e, doc.locate));
  const { errors: collapsedSchemaErrors, collapsed } = collapseErrors(ajvErrors);

  const { errors: refErrors, warnings: refWarnings } = checkLocalRefs(doc.value, doc.locate);
  const { errors: pathErrors, pathCount, operationCount } = checkPathsAndOperations(doc.value, doc.locate);

  const allErrors = [...collapsedSchemaErrors, ...refErrors, ...pathErrors].sort((a, b) =>
    a.path.localeCompare(b.path),
  );

  return {
    valid: allErrors.length === 0,
    version: doc.version,
    errors: allErrors,
    collapsed,
    warnings: refWarnings,
    counts: {
      paths: pathCount,
      operations: operationCount,
      schemas: countSchemas(doc.value, doc.version),
      errors: allErrors.length,
    },
  };
}
