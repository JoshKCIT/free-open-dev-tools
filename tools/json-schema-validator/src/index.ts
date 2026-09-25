import meta from './meta.json';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { ErrorObject } from 'ajv';
import { parseJsonText } from './json-text';

export { meta };

export type SchemaDraft = 'draft-07' | '2020-12';

export interface ValidationError {
  /** RFC 6901 JSON Pointer to the offending location in the data, e.g. "/a/b". Empty string is the whole document. */
  path: string;
  keyword: string;
  message: string;
  schemaPath: string;
}

export interface ValidateJsonResult {
  valid: boolean;
  draft: SchemaDraft;
  errors: ValidationError[];
}

export interface ValidateJsonOptions {
  /** 'auto' (default) reads the schema's own $schema declaration; 2020-12 when absent. */
  draft?: SchemaDraft | 'auto';
  checkFormats?: boolean;
}

export class SchemaValidatorError extends Error {
  readonly kind: 'schema-json' | 'data-json' | 'schema' | 'draft';
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, kind: SchemaValidatorError['kind'], detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'SchemaValidatorError';
    this.kind = kind;
    this.line = detail.line;
    this.column = detail.column;
  }
}

interface DeclaredDraft {
  /** Set only when the declared $schema names one of the two supported drafts. */
  draft?: SchemaDraft;
  /** The raw $schema string, for messages naming an unsupported or conflicting declaration. */
  raw: string;
}

/**
 * Reads a schema's own `$schema` declaration, if any. A boolean schema (a
 * whole schema of literally `true` or `false`, valid in both supported
 * drafts) and a schema object with no `$schema` string both return
 * `undefined` -- there is nothing declared to conflict with or fall back to.
 */
function declaredDraft(schema: unknown): DeclaredDraft | undefined {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return undefined;
  const raw = (schema as Record<string, unknown>)['$schema'];
  if (typeof raw !== 'string') return undefined;
  if (raw.includes('draft-07')) return { draft: 'draft-07', raw };
  if (raw.includes('2020-12')) return { draft: '2020-12', raw };
  return { raw };
}

/**
 * Resolves which draft to validate against, per this package's own stated
 * contract: 'auto' reads the schema's own declaration (2020-12 when absent),
 * refusing any declared draft this tool does not support; an explicit choice
 * that conflicts with the schema's own declaration is refused naming both.
 */
function resolveDraft(schema: unknown, requested: SchemaDraft | 'auto'): SchemaDraft {
  const declared = declaredDraft(schema);

  if (requested === 'auto') {
    if (declared === undefined) return '2020-12';
    if (declared.draft) return declared.draft;
    throw new SchemaValidatorError(
      `This schema declares "${declared.raw}", which is not a draft this tool supports. Only draft-07 and 2020-12 are supported.`,
      'draft',
    );
  }

  if (declared !== undefined && declared.draft !== requested) {
    const declaredName = declared.draft ?? declared.raw;
    throw new SchemaValidatorError(
      `The chosen draft (${requested}) conflicts with this schema's own declaration ("${declaredName}").`,
      'draft',
    );
  }
  return requested;
}

function mapError(e: ErrorObject): ValidationError {
  return {
    path: e.instancePath,
    keyword: e.keyword,
    message: e.message ?? 'Validation failed.',
    schemaPath: e.schemaPath,
  };
}

/**
 * Validates `dataText` against `schemaText` for draft-07 or JSON Schema
 * 2020-12. Builds a fresh Ajv instance every call -- never reused -- so one
 * schema's own keywords, formats or compiled cache can never leak into the
 * next call. `logger: false` (D-63/E4) keeps every part of this process,
 * including a schema compile failure, from ever writing to the console: Ajv
 * only logs through the `logger` option, and this package never calls
 * console itself.
 */
export function validateJson(
  schemaText: string,
  dataText: string,
  options: ValidateJsonOptions = {},
): ValidateJsonResult {
  const requestedDraft = options.draft ?? 'auto';
  const checkFormats = options.checkFormats ?? true;

  const schemaParsed = parseJsonText(schemaText);
  if (!schemaParsed.ok) {
    throw new SchemaValidatorError(schemaParsed.message ?? 'The schema could not be parsed.', 'schema-json', {
      line: schemaParsed.line,
      column: schemaParsed.column,
    });
  }
  const dataParsed = parseJsonText(dataText);
  if (!dataParsed.ok) {
    throw new SchemaValidatorError(dataParsed.message ?? 'The data could not be parsed.', 'data-json', {
      line: dataParsed.line,
      column: dataParsed.column,
    });
  }

  const schema = schemaParsed.value;
  const draft = resolveDraft(schema, requestedDraft);

  const ajvOptions = {
    allErrors: true,
    strict: false,
    logger: false as const,
    validateFormats: checkFormats,
    ownProperties: true,
  };
  const ajv = draft === '2020-12' ? new Ajv2020(ajvOptions) : new Ajv(ajvOptions);
  if (checkFormats) addFormats(ajv);

  let validateFn;
  try {
    validateFn = ajv.compile(schema as object);
  } catch (err) {
    throw new SchemaValidatorError(err instanceof Error ? err.message : 'The schema could not be compiled.', 'schema');
  }

  const valid = validateFn(dataParsed.value) as boolean;
  const errors = (validateFn.errors ?? []).map(mapError);
  return { valid, draft, errors };
}
