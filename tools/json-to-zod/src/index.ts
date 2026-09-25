/**
 * Turns a JSON sample or a JSON Schema document into Zod source text.
 * Source only: this file never imports `zod` -- the oracle tests are the
 * only place the generated text is ever evaluated.
 */
import meta from './meta.json';
import { MAX_JSON_DEPTH, exceedsDepth, parseJsonText } from './json-text';
import { parsePointer } from './pointer';

export { meta };
export { MAX_JSON_DEPTH };

const DEPTH_MESSAGE =
  'This document is nested more than 512 levels deep, so it was refused rather than risk freezing the tab.';

export class JsonToZodError extends Error {
  readonly line?: number;
  readonly column?: number;
  readonly pointer?: string;

  constructor(message: string, detail: { line?: number; column?: number; pointer?: string } = {}) {
    super(message);
    this.name = 'JsonToZodError';
    this.line = detail.line;
    this.column = detail.column;
    this.pointer = detail.pointer;
  }
}

export interface JsonToZodOptions {
  source?: 'sample' | 'schema';
  exportName?: string;
}

export interface JsonToZodResult {
  output: string;
  warnings: string[];
}

function quoteKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function sanitizeExportName(name: string): { name: string; changed: boolean } {
  const trimmed = name.trim();
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(trimmed)) return { name: trimmed, changed: false };
  const words = trimmed.split(/[^A-Za-z0-9]+/).filter(Boolean);
  let candidate = words
    .map((w, i) => (i === 0 ? w[0]!.toLowerCase() + w.slice(1) : w[0]!.toUpperCase() + w.slice(1)))
    .join('');
  if (candidate === '') candidate = 'schema';
  if (/^[0-9]/.test(candidate)) candidate = `schema${candidate[0]!.toUpperCase()}${candidate.slice(1)}`;
  return { name: candidate, changed: true };
}

// ---------------------------------------------------------------------------
// Sample mode: this package's own smaller inference, written independently
// rather than imported across a tool folder boundary (D-23). Same
// simplification rules as the eight-language type generator elsewhere on
// this site: optional for
// a missing key, .nullable() for null seen alongside a type, z.number().int()
// for integers, z.number() when mixed with a non-integer number, z.unknown()
// for any other mix of value kinds.
// ---------------------------------------------------------------------------

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

function inferSample(values: unknown[], warnings: string[], warnKey: string): string {
  const nullable = values.some((v) => v === null);
  const kinds = new Set(values.map(kindOf));
  const nonNull = [...kinds].filter((k) => k !== 'null');

  let expr: string;
  if (nonNull.length === 0) {
    expr = 'z.unknown()';
  } else if (nonNull.length === 1) {
    const only = nonNull[0]!;
    if (only === 'integer') expr = 'z.number().int()';
    else if (only === 'float') expr = 'z.number()';
    else if (only === 'string') expr = 'z.string()';
    else if (only === 'boolean') expr = 'z.boolean()';
    else if (only === 'object') {
      expr = inferSampleObject(values.filter((v) => kindOf(v) === 'object') as Record<string, unknown>[], warnings);
    } else {
      expr = inferSampleArray(values.filter((v) => kindOf(v) === 'array') as unknown[][], warnings, warnKey);
    }
  } else if (nonNull.length === 2 && nonNull.includes('integer') && nonNull.includes('float')) {
    expr = 'z.number()';
  } else {
    warnings.push(`"${warnKey}" mixes incompatible JSON value types and was widened to z.unknown().`);
    expr = 'z.unknown()';
  }

  return nullable ? `${expr}.nullable()` : expr;
}

function inferSampleObject(objs: Record<string, unknown>[], warnings: string[]): string {
  const keyOrder: string[] = [];
  const seen = new Set<string>();
  for (const o of objs) {
    for (const k of Object.keys(o)) {
      if (!seen.has(k)) {
        seen.add(k);
        keyOrder.push(k);
      }
    }
  }
  if (keyOrder.length === 0) return 'z.object({})';

  const props = keyOrder.map((key) => {
    const present = objs.filter((o) => Object.hasOwn(o, key));
    const optional = present.length < objs.length;
    const subValues = present.map((o) => o[key]);
    const expr = inferSample(subValues, warnings, key);
    return `${quoteKey(key)}: ${expr}${optional ? '.optional()' : ''}`;
  });

  return `z.object({ ${props.join(', ')} })`;
}

function inferSampleArray(arrs: unknown[][], warnings: string[], warnKey: string): string {
  const elements = arrs.flat();
  if (elements.length === 0) return 'z.array(z.unknown())';
  return `z.array(${inferSample(elements, warnings, warnKey)})`;
}

// ---------------------------------------------------------------------------
// Schema mode: a documented subset of JSON Schema draft-07 and 2020-12.
// ---------------------------------------------------------------------------

const HANDLED_KEYS = new Set([
  '$ref',
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'prefixItems',
  'enum',
  'const',
  'anyOf',
  'oneOf',
  'allOf',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'description',
  'default',
]);

// Structural or documentation-only keywords that never affect what a
// generated Zod call needs to check; recognised without a warning.
const IGNORED_META_KEYS = new Set(['$schema', '$id', 'definitions', '$defs', 'title', 'examples']);

const STRING_FORMAT_METHODS: Record<string, string> = {
  email: '.email()',
  uuid: '.uuid()',
  uri: '.url()',
  'date-time': '.datetime()',
};

interface SchemaContext {
  root: unknown;
  warnings: string[];
  refConstants: Map<string, string>;
  refOrder: { name: string; code: string }[];
  resolving: Set<string>;
  usedNames: Set<string>;
}

function normalizeTypeList(type: unknown): string[] | null {
  if (typeof type === 'string') return [type];
  if (Array.isArray(type) && type.every((t) => typeof t === 'string')) return type as string[];
  return null;
}

function jsonLiteral(value: unknown): string {
  return JSON.stringify(value);
}

function buildStringExpr(obj: Record<string, unknown>): string {
  let expr = 'z.string()';
  if (typeof obj.format === 'string' && STRING_FORMAT_METHODS[obj.format]) expr += STRING_FORMAT_METHODS[obj.format];
  if (typeof obj.minLength === 'number') expr += `.min(${obj.minLength})`;
  if (typeof obj.maxLength === 'number') expr += `.max(${obj.maxLength})`;
  if (typeof obj.pattern === 'string') expr += `.regex(new RegExp(${jsonLiteral(obj.pattern)}))`;
  return expr;
}

function buildNumberExpr(obj: Record<string, unknown>, isInteger: boolean): string {
  let expr = isInteger ? 'z.number().int()' : 'z.number()';
  if (typeof obj.minimum === 'number') expr += `.min(${obj.minimum})`;
  if (typeof obj.maximum === 'number') expr += `.max(${obj.maximum})`;
  if (typeof obj.exclusiveMinimum === 'number') expr += `.gt(${obj.exclusiveMinimum})`;
  if (typeof obj.exclusiveMaximum === 'number') expr += `.lt(${obj.exclusiveMaximum})`;
  if (typeof obj.multipleOf === 'number') expr += `.multipleOf(${obj.multipleOf})`;
  return expr;
}

function buildObjectExpr(obj: Record<string, unknown>, ctx: SchemaContext, pointer: string): string {
  const properties =
    obj.properties && typeof obj.properties === 'object' && !Array.isArray(obj.properties)
      ? (obj.properties as Record<string, unknown>)
      : {};
  const required = new Set(
    Array.isArray(obj.required) ? (obj.required as unknown[]).filter((r) => typeof r === 'string') : [],
  );
  const keys = Object.keys(properties);

  const props = keys.map((key) => {
    const sub = convertSchema(properties[key], ctx, `${pointer}/properties/${encodePathToken(key)}`);
    const optional = !required.has(key);
    return `${quoteKey(key)}: ${sub}${optional ? '.optional()' : ''}`;
  });

  let expr = `z.object({ ${props.join(', ')} })`;
  if (obj.additionalProperties === false) expr += '.strict()';
  return expr;
}

function buildArrayExpr(obj: Record<string, unknown>, ctx: SchemaContext, pointer: string): string {
  if (Array.isArray(obj.prefixItems)) {
    const parts = (obj.prefixItems as unknown[]).map((s, i) => convertSchema(s, ctx, `${pointer}/prefixItems/${i}`));
    return `z.tuple([${parts.join(', ')}])`;
  }
  if (Array.isArray(obj.items)) {
    const parts = (obj.items as unknown[]).map((s, i) => convertSchema(s, ctx, `${pointer}/items/${i}`));
    return `z.tuple([${parts.join(', ')}])`;
  }

  const item = obj.items !== undefined ? convertSchema(obj.items, ctx, `${pointer}/items`) : 'z.unknown()';
  let expr = `z.array(${item})`;
  if (typeof obj.minItems === 'number') expr += `.min(${obj.minItems})`;
  if (typeof obj.maxItems === 'number') expr += `.max(${obj.maxItems})`;
  return expr;
}

function buildForType(type: string, obj: Record<string, unknown>, ctx: SchemaContext, pointer: string): string {
  switch (type) {
    case 'object':
      return buildObjectExpr(obj, ctx, pointer);
    case 'array':
      return buildArrayExpr(obj, ctx, pointer);
    case 'string':
      return buildStringExpr(obj);
    case 'integer':
      return buildNumberExpr(obj, true);
    case 'number':
      return buildNumberExpr(obj, false);
    case 'boolean':
      return 'z.boolean()';
    case 'null':
      return 'z.null()';
    default:
      return 'z.unknown()';
  }
}

function buildSchemaExpr(obj: Record<string, unknown>, ctx: SchemaContext, pointer: string): string {
  if (Object.hasOwn(obj, 'const')) return `z.literal(${jsonLiteral(obj.const)})`;

  if (Array.isArray(obj.enum) && obj.enum.length > 0) {
    const values = obj.enum as unknown[];
    if (values.every((v) => typeof v === 'string')) {
      return `z.enum([${values.map((v) => jsonLiteral(v)).join(', ')}])`;
    }
    return `z.union([${values.map((v) => `z.literal(${jsonLiteral(v)})`).join(', ')}])`;
  }

  if (Array.isArray(obj.allOf) && obj.allOf.length > 0) {
    const parts = (obj.allOf as unknown[]).map((s, i) => convertSchema(s, ctx, `${pointer}/allOf/${i}`));
    return parts.reduce((acc, part) => (acc === '' ? part : `z.intersection(${acc}, ${part})`), '');
  }

  if (Array.isArray(obj.anyOf) && obj.anyOf.length > 0) {
    const parts = (obj.anyOf as unknown[]).map((s, i) => convertSchema(s, ctx, `${pointer}/anyOf/${i}`));
    return `z.union([${parts.join(', ')}])`;
  }

  if (Array.isArray(obj.oneOf) && obj.oneOf.length > 0) {
    ctx.warnings.push(
      `"oneOf" at "${pointer}" converts to a union; only one branch should match, and that exclusivity is not enforced.`,
    );
    const parts = (obj.oneOf as unknown[]).map((s, i) => convertSchema(s, ctx, `${pointer}/oneOf/${i}`));
    return `z.union([${parts.join(', ')}])`;
  }

  const types = normalizeTypeList(obj.type);
  if (types) {
    const nonNullTypes = types.filter((t) => t !== 'null');
    const nullable = types.includes('null');
    let expr: string;
    if (nonNullTypes.length === 0) {
      expr = 'z.null()';
    } else if (nonNullTypes.length === 1) {
      expr = buildForType(nonNullTypes[0]!, obj, ctx, pointer);
    } else {
      expr = `z.union([${nonNullTypes.map((t) => buildForType(t, obj, ctx, pointer)).join(', ')}])`;
    }
    return nullable ? `${expr}.nullable()` : expr;
  }

  if (Object.hasOwn(obj, 'properties') || Object.hasOwn(obj, 'required')) return buildObjectExpr(obj, ctx, pointer);
  if (Object.hasOwn(obj, 'items') || Object.hasOwn(obj, 'prefixItems')) return buildArrayExpr(obj, ctx, pointer);

  return 'z.unknown()';
}

function encodePathToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

function refConstantName(tokens: string[], ctx: SchemaContext): string {
  const last = tokens[tokens.length - 1] ?? 'ref';
  const words = last.split(/[^A-Za-z0-9]+/).filter(Boolean);
  let base = words
    .map((w, i) => (i === 0 ? w[0]!.toLowerCase() + w.slice(1) : w[0]!.toUpperCase() + w.slice(1)))
    .join('');
  if (base === '') base = 'ref';
  if (/^[0-9]/.test(base)) base = `ref${base[0]!.toUpperCase()}${base.slice(1)}`;

  let name = base;
  let i = 2;
  while (ctx.usedNames.has(name)) {
    name = `${base}${i}`;
    i++;
  }
  ctx.usedNames.add(name);
  return name;
}

function resolveRef(ref: string, ctx: SchemaContext, fromPointer: string): string {
  if (!ref.startsWith('#/') && ref !== '#') {
    ctx.warnings.push(`"$ref" at "${fromPointer}" points outside this document ("${ref}") and was not converted.`);
    return 'z.unknown()';
  }

  const pointerText = ref === '#' ? '' : ref.slice(1);
  let tokens: string[];
  try {
    tokens = parsePointer(pointerText);
  } catch {
    ctx.warnings.push(`"$ref" at "${fromPointer}" is not a valid JSON Pointer ("${ref}") and was not converted.`);
    return 'z.unknown()';
  }

  if (ctx.resolving.has(pointerText)) {
    throw new JsonToZodError(`A recursive $ref at "${pointerText}" was refused.`, { pointer: pointerText });
  }

  const existing = ctx.refConstants.get(pointerText);
  if (existing) return existing;

  let target: unknown = ctx.root;
  for (const token of tokens) {
    if (target === null || typeof target !== 'object' || Array.isArray(target)) {
      ctx.warnings.push(`"$ref" at "${fromPointer}" points to "${ref}", which does not exist, and was not converted.`);
      return 'z.unknown()';
    }
    target = (target as Record<string, unknown>)[token];
  }
  if (target === undefined) {
    ctx.warnings.push(`"$ref" at "${fromPointer}" points to "${ref}", which does not exist, and was not converted.`);
    return 'z.unknown()';
  }

  const constName = refConstantName(tokens, ctx);
  ctx.resolving.add(pointerText);
  const body = convertSchema(target, ctx, pointerText);
  ctx.resolving.delete(pointerText);
  ctx.refConstants.set(pointerText, constName);
  ctx.refOrder.push({ name: constName, code: body });
  return constName;
}

function convertSchema(schema: unknown, ctx: SchemaContext, pointer: string): string {
  if (schema === true) return 'z.unknown()';
  if (schema === false) return 'z.never()';
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    ctx.warnings.push(`The schema at "${pointer}" is not a JSON Schema object and was treated as z.unknown().`);
    return 'z.unknown()';
  }

  const obj = schema as Record<string, unknown>;

  if (typeof obj.$ref === 'string') return resolveRef(obj.$ref, ctx, pointer);

  let expr = buildSchemaExpr(obj, ctx, pointer);
  if (typeof obj.description === 'string') expr += `.describe(${jsonLiteral(obj.description)})`;
  if (Object.hasOwn(obj, 'default')) expr += `.default(${jsonLiteral(obj.default)})`;

  for (const key of Object.keys(obj)) {
    if (HANDLED_KEYS.has(key) || IGNORED_META_KEYS.has(key)) continue;
    ctx.warnings.push(`"${key}" at "${pointer}" is outside the supported JSON Schema subset and was not converted.`);
  }

  return expr;
}

interface SchemaRootResult {
  defs: string;
  mainExpr: string;
}

function convertSchemaRoot(schemaValue: unknown, warnings: string[], exportName: string): SchemaRootResult {
  const ctx: SchemaContext = {
    root: schemaValue,
    warnings,
    refConstants: new Map(),
    refOrder: [],
    resolving: new Set(),
    usedNames: new Set([exportName]),
  };
  const mainExpr = convertSchema(schemaValue, ctx, '');
  const defs = ctx.refOrder.map((r) => `const ${r.name} = ${r.code};\n\n`).join('');
  return { defs, mainExpr };
}

/**
 * Turns a JSON sample or a JSON Schema document into Zod source text.
 * `source` selects which one `text` is; `exportName` names the exported
 * constant and is sanitised to a valid identifier.
 */
export function jsonToZod(text: string, options: JsonToZodOptions = {}): JsonToZodResult {
  const parsed = parseJsonText(text);
  if (!parsed.ok) {
    throw new JsonToZodError(parsed.message ?? 'The document could not be parsed.', {
      line: parsed.line,
      column: parsed.column,
    });
  }
  if (exceedsDepth(parsed.value, MAX_JSON_DEPTH)) throw new JsonToZodError(DEPTH_MESSAGE);

  const warnings: string[] = [];
  const { name: exportName, changed } = sanitizeExportName(options.exportName ?? 'schema');
  if (changed) {
    warnings.push(`The export name was changed to "${exportName}" to make it a valid identifier.`);
  }

  const source = options.source ?? 'sample';
  const { defs, mainExpr } =
    source === 'schema'
      ? convertSchemaRoot(parsed.value, warnings, exportName)
      : { defs: '', mainExpr: inferSample([parsed.value], warnings, '(root)') };

  const output = `import { z } from 'zod';\n\n${defs}export const ${exportName} = ${mainExpr};\n`;
  return { output, warnings };
}
