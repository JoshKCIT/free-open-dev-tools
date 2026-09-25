/**
 * Renders a graphql-js schema as TypeScript source text. Source text only:
 * this file never imports the typescript package -- the compiler oracle
 * lives in the test suite instead.
 */
import {
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  isUnionType,
  type GraphQLEnumType,
  type GraphQLInputObjectType,
  type GraphQLInterfaceType,
  type GraphQLNamedType,
  type GraphQLObjectType,
  type GraphQLScalarType,
  type GraphQLSchema,
  type GraphQLType,
  type GraphQLUnionType,
} from 'graphql';

export type EnumStyle = 'union' | 'enum';

export interface EmitOptions {
  enumStyle: EnumStyle;
  includeTypename: boolean;
  scalars: Record<string, string>;
}

export interface EmitResult {
  output: string;
  warnings: string[];
  /** Count of named GraphQL types turned into a TypeScript declaration. */
  types: number;
}

const BUILT_IN_SCALARS: Record<string, string> = {
  ID: 'string',
  String: 'string',
  Int: 'number',
  Float: 'number',
  Boolean: 'boolean',
};

const TS_SHADOW_TYPES = new Set([
  'Object',
  'String',
  'Number',
  'Boolean',
  'Array',
  'Function',
  'Symbol',
  'Date',
  'Error',
  'RegExp',
  'Map',
  'Set',
  'Promise',
]);

function shadowSuffix(name: string): string {
  return TS_SHADOW_TYPES.has(name) ? `${name}Type` : name;
}

function capitalize(name: string): string {
  return name.length === 0 ? name : name[0]!.toUpperCase() + name.slice(1);
}

/**
 * A scalar mapping's TypeScript text is restricted to a plain type
 * expression made only of identifiers, the union operator, array brackets,
 * `null` and quoted string literals -- a single-pass token scan, not a
 * regular expression run once over the whole string, so a mapping that is
 * mostly safe tokens but has one unsafe character in the middle is still
 * rejected rather than partially matched. Anything else is rejected outright
 * so a visitor's mapping text can never break out of the emitted source.
 */
const SAFE_TYPE_TOKEN = /[A-Za-z_$][A-Za-z0-9_$]*|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\[\]|\||null/y;

export function isSafeTypeExpression(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '') return false;
  let index = 0;
  while (index < trimmed.length) {
    while (index < trimmed.length && /\s/.test(trimmed[index]!)) index++;
    if (index >= trimmed.length) break;
    SAFE_TYPE_TOKEN.lastIndex = index;
    const match = SAFE_TYPE_TOKEN.exec(trimmed);
    if (!match) return false;
    index = SAFE_TYPE_TOKEN.lastIndex;
  }
  return true;
}

function buildNameMap(schema: GraphQLSchema): Map<string, string> {
  const map = new Map<string, string>(Object.entries(BUILT_IN_SCALARS));
  for (const [name] of Object.entries(schema.getTypeMap())) {
    if (name.startsWith('__') || name in BUILT_IN_SCALARS) continue;
    map.set(name, shadowSuffix(name));
  }
  return map;
}

/** Full field-type text, including a trailing `| null` whenever `type` is not wrapped in Non-Null. */
function renderType(type: GraphQLType, names: Map<string, string>): string {
  if (isNonNullType(type)) return renderBase(type.ofType as GraphQLType, names);
  return `${renderBase(type, names)} | null`;
}

function renderBase(type: GraphQLType, names: Map<string, string>): string {
  if (isListType(type)) {
    const itemText = renderType(type.ofType as GraphQLType, names);
    // TypeScript's `[]` binds tighter than `|`, so a list whose item text is
    // itself a union (including the two-member "T | null" union a nullable
    // item produces) needs parentheses, or `[]` would bind only to the last
    // member instead of the whole item type.
    const wrapped = itemText.includes('|') ? `(${itemText})` : itemText;
    return `${wrapped}[]`;
  }
  const named = type as GraphQLNamedType;
  return names.get(named.name) ?? named.name;
}

function escapeJsDoc(text: string): string {
  return text.replace(/\*\//g, '*\\/');
}

function jsDocLines(indent: string, description?: string | null, deprecationReason?: string | null): string[] {
  const parts: string[] = [];
  if (description) parts.push(...description.split('\n'));
  if (deprecationReason) parts.push(`@deprecated ${escapeJsDoc(deprecationReason)}`);
  if (parts.length === 0) return [];
  const lines = [`${indent}/**`];
  for (const part of parts) lines.push(`${indent} * ${escapeJsDoc(part)}`);
  lines.push(`${indent} */`);
  return lines;
}

function emitScalar(
  type: GraphQLScalarType,
  names: Map<string, string>,
  options: EmitOptions,
  warnings: string[],
  lines: string[],
): void {
  const resolvedName = names.get(type.name)!;
  const mapping = options.scalars[type.name];
  let target = 'unknown';
  if (mapping !== undefined && mapping.trim() !== '') {
    if (isSafeTypeExpression(mapping)) {
      target = mapping.trim();
    } else {
      warnings.push(
        `The mapping given for scalar "${type.name}" is not a plain TypeScript type expression (identifiers, |, [], null and string literals only), so it was left as unknown.`,
      );
    }
  }
  lines.push(...jsDocLines('', type.description));
  lines.push(`export type ${resolvedName} = ${target};`, '');
}

function emitEnum(type: GraphQLEnumType, names: Map<string, string>, options: EmitOptions, lines: string[]): void {
  const resolvedName = names.get(type.name)!;
  const values = type.getValues();
  lines.push(...jsDocLines('', type.description));
  if (options.enumStyle === 'enum') {
    lines.push(`export enum ${resolvedName} {`);
    for (const value of values) {
      lines.push(...jsDocLines('  ', value.description, value.deprecationReason));
      lines.push(`  ${value.name} = '${value.name}',`);
    }
    lines.push('}', '');
  } else {
    const literals = values.map((value) => `'${value.name}'`).join(' | ');
    lines.push(`export type ${resolvedName} = ${literals};`, '');
  }
}

function emitUnion(type: GraphQLUnionType, names: Map<string, string>, lines: string[]): void {
  const resolvedName = names.get(type.name)!;
  const memberNames = type.getTypes().map((member) => names.get(member.name) ?? member.name);
  lines.push(...jsDocLines('', type.description));
  lines.push(`export type ${resolvedName} = ${memberNames.join(' | ')};`, '');
}

function emitInputObject(type: GraphQLInputObjectType, names: Map<string, string>, lines: string[]): void {
  const resolvedName = names.get(type.name)!;
  lines.push(...jsDocLines('', type.description));
  lines.push(`export interface ${resolvedName} {`);
  for (const field of Object.values(type.getFields())) {
    lines.push(...jsDocLines('  ', field.description, field.deprecationReason));
    const optional = !isNonNullType(field.type);
    lines.push(`  ${field.name}${optional ? '?' : ''}: ${renderType(field.type, names)};`);
  }
  lines.push('}', '');
}

function emitObjectLike(
  type: GraphQLObjectType | GraphQLInterfaceType,
  names: Map<string, string>,
  options: EmitOptions,
  lines: string[],
): void {
  const resolvedName = names.get(type.name)!;
  const argsBlocks: string[][] = [];

  lines.push(...jsDocLines('', type.description));
  lines.push(`export interface ${resolvedName} {`);
  if (options.includeTypename) lines.push(`  __typename?: '${type.name}';`);

  for (const field of Object.values(type.getFields())) {
    lines.push(...jsDocLines('  ', field.description, field.deprecationReason));
    lines.push(`  ${field.name}: ${renderType(field.type, names)};`);

    if (field.args.length > 0) {
      const argsName = `${resolvedName}${capitalize(field.name)}Args`;
      const argsLines = [`export interface ${argsName} {`];
      for (const arg of field.args) {
        argsLines.push(...jsDocLines('  ', arg.description, arg.deprecationReason));
        const optional = !isNonNullType(arg.type);
        argsLines.push(`  ${arg.name}${optional ? '?' : ''}: ${renderType(arg.type, names)};`);
      }
      argsLines.push('}', '');
      argsBlocks.push(argsLines);
    }
  }

  lines.push('}', '');
  for (const block of argsBlocks) lines.push(...block);
}

export function emitTypeScript(schema: GraphQLSchema, options: EmitOptions): EmitResult {
  const names = buildNameMap(schema);
  const lines: string[] = [];
  const warnings: string[] = [];
  let types = 0;

  const typeMap = schema.getTypeMap();
  for (const name of Object.keys(typeMap)) {
    if (name.startsWith('__') || name in BUILT_IN_SCALARS) continue;
    const type = typeMap[name]!;
    types++;
    if (isScalarType(type)) {
      emitScalar(type, names, options, warnings, lines);
    } else if (isEnumType(type)) {
      emitEnum(type, names, options, lines);
    } else if (isUnionType(type)) {
      emitUnion(type, names, lines);
    } else if (isInputObjectType(type)) {
      emitInputObject(type, names, lines);
    } else if (isObjectType(type) || isInterfaceType(type)) {
      emitObjectLike(type, names, options, lines);
    }
  }

  return { output: lines.join('\n').trimEnd() + '\n', warnings, types };
}
