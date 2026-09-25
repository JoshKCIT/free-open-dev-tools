/**
 * Renders the shared inferred model as Go struct declarations with
 * `encoding/json` struct tags, per the Go language specification's
 * Identifiers and Keywords sections and `encoding/json`'s own struct-tag
 * documentation (both fetched live before this file was written).
 */
import type { EmitResult } from './emit-typescript';
import type { FieldType, InferredModel } from './infer';
import { GO_SHADOW_TYPES, assignNames, goFieldName, goKeyIsTagSafe, goStructTag, withShadowSuffix } from './naming';

function typeNameMap(model: InferredModel): Map<string, string> {
  const map = new Map<string, string>();
  for (const obj of model.objects) map.set(obj.name, withShadowSuffix(obj.name, GO_SHADOW_TYPES));
  return map;
}

function renderType(type: FieldType, names: Map<string, string>): string {
  switch (type.kind) {
    case 'string':
      return type.nullable ? '*string' : 'string';
    case 'integer':
      return type.nullable ? '*int64' : 'int64';
    case 'float':
      return type.nullable ? '*float64' : 'float64';
    case 'boolean':
      return type.nullable ? '*bool' : 'bool';
    case 'array':
      return `[]${renderType(type.item!, names)}`;
    case 'ref': {
      const name = names.get(type.name!) ?? type.name!;
      return type.nullable ? `*${name}` : name;
    }
    case 'any':
    default:
      return 'any';
  }
}

export function emitGo(model: InferredModel): EmitResult {
  const names = typeNameMap(model);
  const warnings: string[] = [];
  const lines: string[] = ['package main', ''];

  for (const obj of model.objects) {
    const resolvedName = names.get(obj.name)!;
    const fieldNames = assignNames(
      obj.fields.map((f) => f.key),
      (key) => goFieldName(key),
    );
    lines.push(`type ${resolvedName} struct {`);
    for (const field of obj.fields) {
      const fieldName = fieldNames.get(field.key)!;
      const typeText = renderType(field.type, names);
      const tag = goStructTag(field.key, field.optional);
      lines.push(`\t${fieldName} ${typeText} ${tag}`);
      if (!goKeyIsTagSafe(field.key)) {
        warnings.push(
          `"${field.key}" contains a quotation mark, backslash or comma, so encoding/json cannot use it as an exact struct tag name; the tag text is kept for reference but Go's own decoder would fall back to the field name ${fieldName} instead.`,
        );
      }
    }
    lines.push('}', '');
  }

  return { output: lines.join('\n').trimEnd() + '\n', warnings };
}
