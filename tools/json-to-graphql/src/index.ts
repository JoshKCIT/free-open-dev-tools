import meta from './meta.json';
import { MAX_JSON_DEPTH, exceedsDepth, parseJsonText } from './json-text';
import { getOwn, hasOwn, setOwn } from './own-property';

export { meta };
export { MAX_JSON_DEPTH };

const DEPTH_MESSAGE =
  'This document is nested more than 512 levels deep, so it was refused rather than risk freezing the tab.';

export class JsonToGraphqlError extends Error {
  readonly line?: number;
  readonly column?: number;
  readonly path?: string;

  constructor(message: string, detail: { line?: number; column?: number; path?: string } = {}) {
    super(message);
    this.name = 'JsonToGraphqlError';
    this.line = detail.line;
    this.column = detail.column;
    this.path = detail.path;
  }
}

export interface JsonToGraphqlOptions {
  /** Whether the input is one sample object, or an array of samples merged into one shape. Default 'single'. */
  samplesAre?: 'single' | 'array';
  /** Name of the root GraphQL type. Default 'Root'. Falls back to 'Root' with a warning when not a valid GraphQL Name. */
  rootName?: string;
  /** A field present and never null in every merged sample becomes GraphQL non-null (!). Default true. */
  nonNullWhenAlwaysPresent?: boolean;
  /** Detects an id-shaped key (id, or ending in Id or _id) as GraphQL's ID scalar. Default true. */
  idFields?: boolean;
  /** Appends a root Query field naming the inferred root type. Default true. */
  addQuery?: boolean;
}

export interface JsonToGraphqlResult {
  output: string;
  /** Count of named GraphQL object types the sample produced. */
  types: number;
  warnings: string[];
}

// GraphQL Specification (September 2025 Edition), section 2.1.9 Names:
// https://spec.graphql.org/September2025/#sec-Names -- Name ::= NameStart
// NameContinue* -- a Name always matches /^[_A-Za-z][_0-9A-Za-z]*$/ and a
// name starting with two underscores is reserved for introspection.
const GRAPHQL_NAME = /^[_A-Za-z][_0-9A-Za-z]*$/;

type ScalarName = 'ID' | 'String' | 'Int' | 'Float' | 'Boolean';

interface FieldType {
  kind: 'scalar' | 'list' | 'object';
  /** True when no sample ever held a literal null at this exact location. */
  neverNull: boolean;
  scalar?: ScalarName;
  item?: FieldType;
  objectName?: string;
}

interface ObjectField {
  name: string;
  type: FieldType;
  /** True when this key was present in every merged sample at this location. */
  alwaysPresent: boolean;
}

interface ObjectTypeDef {
  name: string;
  fields: ObjectField[];
}

interface BuildContext {
  usedTypeNames: Set<string>;
  objects: ObjectTypeDef[];
  warnings: string[];
  idFields: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function wordsFromKey(key: string): string[] {
  return key.split(/[^A-Za-z0-9]+/).filter(Boolean);
}

function capitalizeWord(word: string): string {
  return word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1);
}

/** Turns arbitrary text into a PascalCase GraphQL type-name candidate. Always starts with a letter. */
function pascalCase(key: string, fallback = 'Type'): string {
  const words = wordsFromKey(key);
  if (words.length === 0) return fallback;
  let name = words.map(capitalizeWord).join('');
  if (name === '') return fallback;
  if (/^[0-9]/.test(name)) name = `N${name}`;
  return name;
}

/** `ies` to `y`; a trailing `s` not preceded by `s` is dropped; anything else is unchanged. */
function singularize(word: string): string {
  if (/ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (/s$/.test(word) && !/ss$/.test(word)) return word.slice(0, -1);
  return word;
}

function lowerFirst(word: string): string {
  return word.length === 0 ? word : word[0]!.toLowerCase() + word.slice(1);
}

/**
 * Turns a JSON key into a valid, non-introspection-reserved GraphQL Name:
 * every character outside `[_0-9A-Za-z]` becomes `_`, a leading digit is
 * prefixed with `_`, and a leading run of two or more underscores collapses
 * to a single `_` (GraphQL reserves a name starting with `__` for its own
 * introspection system). Returns the original key unchanged when it was
 * already a valid, non-reserved Name.
 */
function sanitizeName(key: string): { name: string; changed: boolean } {
  const needsRename = !GRAPHQL_NAME.test(key) || key.startsWith('__');
  if (!needsRename) return { name: key, changed: false };
  let name = key.replace(/[^_0-9A-Za-z]/g, '_');
  if (/^[0-9]/.test(name)) name = `_${name}`;
  name = name.replace(/^_{2,}/, '_');
  if (name === '') name = '_field';
  return { name, changed: true };
}

function looksLikeId(key: string): boolean {
  return key === 'id' || key.endsWith('Id') || key.endsWith('_id');
}

function uniqueTypeName(base: string, ctx: BuildContext): string {
  let name = base;
  let i = 2;
  while (ctx.usedTypeNames.has(name)) {
    name = `${base}${i}`;
    i++;
  }
  ctx.usedTypeNames.add(name);
  return name;
}

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

type Kind = 'string' | 'integer' | 'float' | 'boolean' | 'null' | 'object' | 'array';

function kindOf(value: unknown): Kind {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'string') return 'string';
  if (t === 'boolean') return 'boolean';
  if (t === 'number') return Number.isInteger(value) ? 'integer' : 'float';
  return 'object';
}

function resolve(values: unknown[], nameHint: string, path: string, ctx: BuildContext, idKey?: string): FieldType {
  const hasNull = values.some((v) => v === null);
  const kinds = new Set(values.map(kindOf));
  const nonNull = [...kinds].filter((k) => k !== 'null');
  const nonNullSet = new Set(nonNull);

  if (nonNullSet.size === 0) {
    ctx.warnings.push(`"${path}" is always null, so it was mapped to String.`);
    return { kind: 'scalar', scalar: 'String', neverNull: false };
  }

  const isIdCandidate = ctx.idFields && idKey !== undefined && looksLikeId(idKey);
  if (isIdCandidate && [...nonNullSet].every((k) => k === 'string' || k === 'integer')) {
    return { kind: 'scalar', scalar: 'ID', neverNull: !hasNull };
  }

  if (nonNullSet.size === 1) {
    const only = [...nonNullSet][0]!;
    if (only === 'string') return { kind: 'scalar', scalar: 'String', neverNull: !hasNull };
    if (only === 'integer') {
      const inRange = values.every((v) => typeof v !== 'number' || (v >= INT32_MIN && v <= INT32_MAX));
      if (!inRange) {
        ctx.warnings.push(
          `"${path}" has an integer outside GraphQL's signed 32-bit Int range, so it was mapped to Float.`,
        );
        return { kind: 'scalar', scalar: 'Float', neverNull: !hasNull };
      }
      return { kind: 'scalar', scalar: 'Int', neverNull: !hasNull };
    }
    if (only === 'float') return { kind: 'scalar', scalar: 'Float', neverNull: !hasNull };
    if (only === 'boolean') return { kind: 'scalar', scalar: 'Boolean', neverNull: !hasNull };
    if (only === 'object') {
      const objs = values.filter((v) => kindOf(v) === 'object') as Record<string, unknown>[];
      const objectName = resolveObject(objs, nameHint, path, ctx);
      return { kind: 'object', objectName, neverNull: !hasNull };
    }
    const arrs = values.filter((v) => Array.isArray(v)) as unknown[][];
    const item = resolveArray(arrs, nameHint, path, ctx);
    return { kind: 'list', item, neverNull: !hasNull };
  }

  if (nonNullSet.size === 2 && nonNullSet.has('integer') && nonNullSet.has('float')) {
    return { kind: 'scalar', scalar: 'Float', neverNull: !hasNull };
  }

  ctx.warnings.push(`"${path}" mixes incompatible JSON value types and was mapped to String.`);
  return { kind: 'scalar', scalar: 'String', neverNull: !hasNull };
}

function resolveArray(arrs: unknown[][], nameHint: string, path: string, ctx: BuildContext): FieldType {
  const elements = arrs.flat();
  if (elements.length === 0) {
    ctx.warnings.push(`"${path}" is always an empty array, so its items were mapped to String.`);
    return { kind: 'scalar', scalar: 'String', neverNull: false };
  }
  return resolve(elements, singularize(nameHint), `${path}[]`, ctx);
}

function resolveObject(objs: Record<string, unknown>[], nameHint: string, path: string, ctx: BuildContext): string {
  const typeName = uniqueTypeName(nameHint, ctx);
  const objType: ObjectTypeDef = { name: typeName, fields: [] };
  ctx.objects.push(objType);

  const keyOrder: string[] = [];
  const seen = new Set<string>();
  for (const o of objs) {
    for (const key of Object.keys(o)) {
      if (!seen.has(key)) {
        seen.add(key);
        keyOrder.push(key);
      }
    }
  }

  const usedFieldNames = new Set<string>();
  for (const key of keyOrder) {
    const present = objs.filter((o) => hasOwn(o, key));
    const alwaysPresent = present.length === objs.length;
    const subValues = present.map((o) => getOwn(o, key));

    const { name: sanitized, changed } = sanitizeName(key);
    let fieldName = sanitized;
    let i = 2;
    while (usedFieldNames.has(fieldName)) {
      fieldName = `${sanitized}${i}`;
      i++;
    }
    usedFieldNames.add(fieldName);
    if (changed) {
      ctx.warnings.push(`"${key}" is not a valid GraphQL name, so it was renamed to "${fieldName}".`);
    } else if (fieldName !== key) {
      ctx.warnings.push(`"${key}" collided with another field after renaming, so it was renamed to "${fieldName}".`);
    }

    const fieldType = resolve(subValues, pascalCase(fieldName), `${path}.${key}`, ctx, key);
    objType.fields.push({ name: fieldName, type: fieldType, alwaysPresent });
  }

  return typeName;
}

function renderFieldType(type: FieldType, alwaysPresent: boolean, nonNullWhenAlwaysPresent: boolean): string {
  const nonNull = alwaysPresent && type.neverNull && nonNullWhenAlwaysPresent;
  if (type.kind === 'scalar') return `${type.scalar!}${nonNull ? '!' : ''}`;
  if (type.kind === 'object') return `${type.objectName!}${nonNull ? '!' : ''}`;
  // Array items are always-present by definition: an element that exists in the array is never "absent".
  const itemText = renderFieldType(type.item!, true, nonNullWhenAlwaysPresent);
  return `[${itemText}]${nonNull ? '!' : ''}`;
}

function sanitizeRootName(rootName: string, ctx: BuildContext): string {
  if (GRAPHQL_NAME.test(rootName) && !rootName.startsWith('__')) return rootName;
  ctx.warnings.push(`"${rootName}" is not a valid GraphQL name, so the root type was named "Root" instead.`);
  return 'Root';
}

/**
 * Infers a GraphQL schema definition (SDL) from a sample JSON document, or
 * from an array of samples merged into one shape. Every use of an
 * input-derived key as a property on an object this package builds goes
 * through `setOwn`/`hasOwn`/`getOwn`, so a key such as `__proto__` becomes an
 * ordinary own key everywhere it is read or written, never a prototype write.
 */
export function jsonToGraphql(text: string, options: JsonToGraphqlOptions = {}): JsonToGraphqlResult {
  const parsed = parseJsonText(text);
  if (!parsed.ok) {
    throw new JsonToGraphqlError(parsed.message ?? 'The document could not be parsed.', {
      line: parsed.line,
      column: parsed.column,
    });
  }
  if (exceedsDepth(parsed.value, MAX_JSON_DEPTH)) throw new JsonToGraphqlError(DEPTH_MESSAGE);

  const samplesAre = options.samplesAre ?? 'single';
  let samples: unknown[];
  if (samplesAre === 'array') {
    if (!Array.isArray(parsed.value)) {
      throw new JsonToGraphqlError('With "multiple samples" chosen, the input must be a JSON array of sample objects.');
    }
    samples = parsed.value;
  } else {
    samples = [parsed.value];
  }

  if (samples.length === 0 || !samples.every(isPlainObject)) {
    throw new JsonToGraphqlError('Each sample must be a JSON object, so it can become a GraphQL type.');
  }

  // Copies each sample into a fresh object via setOwn before any merge walk
  // reads its keys, so a key such as __proto__ or constructor from the
  // parsed JSON is always read back as this tool's own own-property, never
  // as an inherited name.
  const safeSamples = samples.map((sample) => {
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(sample as Record<string, unknown>)) {
      setOwn(copy, key, (sample as Record<string, unknown>)[key]);
    }
    return copy;
  });

  const ctx: BuildContext = {
    usedTypeNames: new Set(),
    objects: [],
    warnings: [],
    idFields: options.idFields ?? true,
  };
  const nonNullWhenAlwaysPresent = options.nonNullWhenAlwaysPresent ?? true;
  const addQuery = options.addQuery ?? true;

  const rootName = sanitizeRootName(options.rootName ?? 'Root', ctx);
  const rootTypeName = resolveObject(safeSamples, rootName, 'root', ctx);

  const lines: string[] = [];
  for (const obj of ctx.objects) {
    lines.push(`type ${obj.name} {`);
    for (const field of obj.fields) {
      lines.push(`  ${field.name}: ${renderFieldType(field.type, field.alwaysPresent, nonNullWhenAlwaysPresent)}`);
    }
    lines.push('}', '');
  }
  if (addQuery) {
    lines.push('type Query {', `  ${lowerFirst(rootTypeName)}: ${rootTypeName}`, '}', '');
  }
  const output = `${lines.join('\n').trimEnd()}\n`;

  return { output, types: ctx.objects.length, warnings: ctx.warnings };
}
