/**
 * Renders an OpenAPI or Swagger Schema Object as TypeScript source text.
 * Source text only: this file never imports the `typescript` package -- the
 * compiler oracle lives in the test suite instead.
 */
import { hasOwn, getOwn } from './own-property';
import { typescriptPropertyName } from './naming';

export interface EmitContext {
  /** Schema name (as written in components.schemas / definitions) -> chosen TypeScript type name. */
  schemaTypeNames: Map<string, string>;
  warnings: Set<string>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Formats a JS value as a TypeScript literal type (used for `enum` and `const`). */
function literalType(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  return JSON.stringify(value);
}

/** Escapes a close-block-comment sequence so a description safely closes a JSDoc block. */
function escapeJsDoc(text: string): string {
  return text.replace(/\*\//g, '*\\/');
}

function jsDocLines(schema: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const description = getOwn(schema, 'description');
  if (typeof description === 'string' && description.trim() !== '') {
    for (const line of escapeJsDoc(description).split('\n')) lines.push(line);
  }
  if (getOwn(schema, 'deprecated') === true) lines.push('@deprecated');
  if (getOwn(schema, 'readOnly') === true) lines.push('@readonly (present only when reading, never sent)');
  if (getOwn(schema, 'writeOnly') === true) lines.push('@writeonly (present only when writing, never returned)');
  return lines;
}

function renderJsDoc(lines: string[], indent: string): string {
  if (lines.length === 0) return '';
  if (lines.length === 1) return `${indent}/** ${lines[0]} */\n`;
  return `${indent}/**\n${lines.map((l) => `${indent} * ${l}`).join('\n')}\n${indent} */\n`;
}

/**
 * Resolves a local (`#`-prefixed) `$ref` to a schema name this tool has
 * already assigned a type to. A reference to anything else -- another file
 * or address, or a local pointer that is not a top-level named schema --
 * becomes `unknown` with a warning; nothing is ever fetched to resolve it.
 */
function resolveRef(ref: string, ctx: EmitContext): string {
  if (!ref.startsWith('#')) {
    ctx.warnings.add(
      `The reference "${ref}" points to another file or address; it was not followed, and its type is "unknown".`,
    );
    return 'unknown';
  }
  const match = /^#\/(definitions|components\/schemas)\/([^/]+)$/.exec(ref);
  if (match) {
    const key = decodeRefToken(match[2]!);
    const name = ctx.schemaTypeNames.get(key);
    if (name) return name;
  }
  ctx.warnings.add(
    `The reference "${ref}" does not point to a named schema this tool generates a type for; its type is "unknown".`,
  );
  return 'unknown';
}

function decodeRefToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** Renders a Schema Object (or a boolean schema, or `undefined`) as a TypeScript type expression. */
export function renderType(schema: unknown, ctx: EmitContext): string {
  if (schema === undefined) return 'unknown';
  if (schema === true) return 'unknown';
  if (schema === false) return 'never';
  if (!isPlainObject(schema)) return 'unknown';

  if (hasOwn(schema, '$ref') && typeof getOwn(schema, '$ref') === 'string') {
    return resolveRef(getOwn(schema, '$ref') as string, ctx);
  }
  if (hasOwn(schema, 'not')) {
    ctx.warnings.add('A schema using "not" cannot be expressed as a TypeScript type; its type is "unknown".');
    return 'unknown';
  }
  if (hasOwn(schema, 'const')) {
    return literalType(getOwn(schema, 'const'));
  }
  if (hasOwn(schema, 'enum')) {
    const values = getOwn(schema, 'enum');
    if (Array.isArray(values) && values.length > 0) {
      return values.map((v) => literalType(v)).join(' | ');
    }
  }
  if (hasOwn(schema, 'allOf')) {
    const parts = getOwn(schema, 'allOf');
    if (Array.isArray(parts) && parts.length > 0) {
      return parts.map((p) => wrapForCombinator(renderType(p, ctx))).join(' & ');
    }
  }
  if (hasOwn(schema, 'oneOf') || hasOwn(schema, 'anyOf')) {
    const parts = getOwn(schema, hasOwn(schema, 'oneOf') ? 'oneOf' : 'anyOf');
    if (Array.isArray(parts) && parts.length > 0) {
      return parts.map((p) => wrapForCombinator(renderType(p, ctx))).join(' | ');
    }
  }

  const nullable = getOwn(schema, 'nullable') === true;
  const rawType = getOwn(schema, 'type');
  const typeList = Array.isArray(rawType)
    ? rawType.filter((t) => typeof t === 'string')
    : typeof rawType === 'string'
      ? [rawType]
      : [];
  const hasNullType = typeList.includes('null');
  const realTypes = typeList.filter((t) => t !== 'null');

  const base = renderBase(schema, realTypes.length > 0 ? realTypes : rawType === undefined ? [] : typeList, ctx);
  return nullable || hasNullType ? `${base} | null` : base;
}

/** Parenthesises a union so it composes correctly inside an intersection or a nested union. */
function wrapForCombinator(type: string): string {
  return type.includes('|') ? `(${type})` : type;
}

function renderBase(schema: Record<string, unknown>, types: string[], ctx: EmitContext): string {
  if (types.length > 1) {
    return types.map((t) => renderScalarOrContainer(schema, t, ctx)).join(' | ');
  }
  if (types.length === 1) {
    return renderScalarOrContainer(schema, types[0]!, ctx);
  }
  // No explicit "type": treat as an object if it looks like one, else unknown.
  if (hasOwn(schema, 'properties') || hasOwn(schema, 'additionalProperties')) {
    return renderObject(schema, ctx);
  }
  return 'unknown';
}

function renderScalarOrContainer(schema: Record<string, unknown>, type: string, ctx: EmitContext): string {
  switch (type) {
    case 'string':
      return 'string';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array':
      return renderArray(schema, ctx);
    case 'object':
      return renderObject(schema, ctx);
    default:
      return 'unknown';
  }
}

function renderArray(schema: Record<string, unknown>, ctx: EmitContext): string {
  const items = getOwn(schema, 'items');
  if (items === undefined) return 'unknown[]';
  const itemType = renderType(items, ctx);
  return `${wrapForCombinator(itemType)}[]`;
}

function renderObject(schema: Record<string, unknown>, ctx: EmitContext): string {
  const propertiesRaw = getOwn(schema, 'properties');
  const properties = isPlainObject(propertiesRaw) ? propertiesRaw : {};
  const propertyKeys = Object.keys(properties);
  const requiredRaw = getOwn(schema, 'required');
  const required = new Set(Array.isArray(requiredRaw) ? requiredRaw.filter((r) => typeof r === 'string') : []);
  const additionalProperties = getOwn(schema, 'additionalProperties');

  const lines: string[] = ['{'];
  for (const key of propertyKeys) {
    const propSchema = properties[key];
    const doc = isPlainObject(propSchema) ? jsDocLines(propSchema) : [];
    lines.push(renderJsDoc(doc, '  ').trimEnd());
    const optional = required.has(key) ? '' : '?';
    lines.push(`  ${typescriptPropertyName(key)}${optional}: ${renderType(propSchema, ctx)};`);
  }

  const hasAdditional = additionalProperties === true || isPlainObject(additionalProperties);
  if (hasAdditional) {
    // An index signature type must be assignable from every named property's
    // own type; when named properties already exist, the index signature is
    // typed `unknown` (always a safe supertype) rather than trying to unify
    // it with each property's own type. With no named properties at all, the
    // index signature uses additionalProperties' own mapped type.
    const indexType =
      propertyKeys.length > 0
        ? 'unknown'
        : additionalProperties === true
          ? 'unknown'
          : renderType(additionalProperties, ctx);
    lines.push(`  [key: string]: ${indexType};`);
  }

  lines.push('}');
  return lines.filter((l) => l !== '').join('\n');
}

export interface EmittedSchema {
  name: string;
  declarationStyle: 'interface' | 'type';
  text: string;
}

/**
 * True only when `schema` renders as a single object-literal type (a bare
 * `{ ... }` with no surrounding combinator), so it is safe to declare with
 * `export interface`. Checked against the schema's own keywords rather than
 * by sniffing the rendered string for a leading `{` and trailing `}`: a
 * two-branch `allOf` of two object schemas also renders as `{...} & {...}`,
 * which starts with `{` and ends with `}` without being a single object
 * literal, so string-sniffing alone misclassifies it as interface-safe and
 * produces invalid syntax (`export interface X {...} & {...}`).
 */
function isSingleObjectLiteralSchema(schema: unknown): boolean {
  if (!isPlainObject(schema)) return false;
  if (
    hasOwn(schema, '$ref') ||
    hasOwn(schema, 'allOf') ||
    hasOwn(schema, 'oneOf') ||
    hasOwn(schema, 'anyOf') ||
    hasOwn(schema, 'not') ||
    hasOwn(schema, 'const') ||
    hasOwn(schema, 'enum')
  ) {
    return false;
  }
  if (getOwn(schema, 'nullable') === true) return false;

  const rawType = getOwn(schema, 'type');
  const typeList = Array.isArray(rawType)
    ? rawType.filter((t) => typeof t === 'string')
    : typeof rawType === 'string'
      ? [rawType]
      : [];
  if (typeList.includes('null')) return false;
  if (typeList.length > 1) return false; // multiple non-null types render as a union, not one object literal
  if (typeList.length === 1) return typeList[0] === 'object';

  // No explicit "type": renderBase treats this as an object only when it looks like one.
  return hasOwn(schema, 'properties') || hasOwn(schema, 'additionalProperties');
}

/** Emits one top-level `export interface` or `export type` declaration for a named schema. */
export function emitNamedSchema(
  key: string,
  name: string,
  schema: unknown,
  declarationStyle: 'interface' | 'type',
  ctx: EmitContext,
): string {
  const doc = isPlainObject(schema) ? jsDocLines(schema) : [];
  const docBlock = renderJsDoc(doc, '');
  const type = renderType(schema, ctx);
  const isPlainObjectType = isSingleObjectLiteralSchema(schema);

  if (declarationStyle === 'interface' && isPlainObjectType) {
    return `${docBlock}export interface ${name} ${type}\n`;
  }
  return `${docBlock}export type ${name} = ${type};\n`;
}
