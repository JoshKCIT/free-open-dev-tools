/**
 * Renders the shared inferred model as C# `sealed class` declarations with
 * `System.Text.Json`'s `[JsonPropertyName]` and nullable reference types,
 * per the C# language reference's keyword list (fetched live before this
 * file was written).
 */
import type { EmitResult } from './emit-typescript';
import type { FieldType, InferredModel } from './infer';
import { CSHARP_SHADOW_TYPES, csharpPropertyName, withShadowSuffix } from './naming';

function typeNameMap(model: InferredModel): Map<string, string> {
  const map = new Map<string, string>();
  for (const obj of model.objects) map.set(obj.name, withShadowSuffix(obj.name, CSHARP_SHADOW_TYPES));
  return map;
}

function renderType(type: FieldType, names: Map<string, string>): string {
  let base: string;
  switch (type.kind) {
    case 'string':
      base = 'string';
      break;
    case 'integer':
      base = 'long';
      break;
    case 'float':
      base = 'double';
      break;
    case 'boolean':
      base = 'bool';
      break;
    case 'array':
      base = `List<${renderType(type.item!, names)}>`;
      break;
    case 'ref':
      base = names.get(type.name!) ?? type.name!;
      break;
    case 'any':
    default:
      base = 'JsonElement';
      break;
  }
  return type.nullable ? `${base}?` : base;
}

export function emitCSharp(model: InferredModel): EmitResult {
  const names = typeNameMap(model);
  const lines: string[] = ['using System.Text.Json;', 'using System.Text.Json.Serialization;', ''];

  for (const obj of model.objects) {
    const resolvedName = names.get(obj.name)!;
    lines.push(`public sealed class ${resolvedName}`, '{');
    for (const field of obj.fields) {
      const propertyName = csharpPropertyName(field.key);
      const typeText = renderType(field.type, names);
      const keyLiteral = field.key.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      lines.push(`    [JsonPropertyName("${keyLiteral}")]`);
      lines.push(`    public ${typeText} ${propertyName} { get; set; }`);
    }
    lines.push('}', '');
  }

  return { output: lines.join('\n').trimEnd() + '\n', warnings: [] };
}
