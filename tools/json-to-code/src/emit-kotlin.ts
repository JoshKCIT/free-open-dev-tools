/**
 * Renders the shared inferred model as Kotlin `@Serializable data class`
 * declarations with kotlinx.serialization's `@SerialName`, per Kotlin's
 * keyword reference (fetched live before this file was written).
 */
import type { EmitResult } from './emit-typescript';
import type { FieldType, InferredModel } from './infer';
import { KOTLIN_SHADOW_TYPES, kotlinField, withShadowSuffix } from './naming';

function typeNameMap(model: InferredModel): Map<string, string> {
  const map = new Map<string, string>();
  for (const obj of model.objects) map.set(obj.name, withShadowSuffix(obj.name, KOTLIN_SHADOW_TYPES));
  return map;
}

function renderType(type: FieldType, names: Map<string, string>): string {
  let base: string;
  switch (type.kind) {
    case 'string':
      base = 'String';
      break;
    case 'integer':
      base = 'Long';
      break;
    case 'float':
      base = 'Double';
      break;
    case 'boolean':
      base = 'Boolean';
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

export function emitKotlin(model: InferredModel): EmitResult {
  const names = typeNameMap(model);
  const lines: string[] = [
    'import kotlinx.serialization.SerialName',
    'import kotlinx.serialization.Serializable',
    'import kotlinx.serialization.json.JsonElement',
    '',
  ];

  for (const obj of model.objects) {
    const resolvedName = names.get(obj.name)!;
    const properties = obj.fields.map((field) => {
      const { identifier, needsSerialName } = kotlinField(field.key);
      const typeText = renderType(field.type, names);
      const optionalOrNullable = field.optional || field.type.nullable;
      const finalType = optionalOrNullable && !typeText.endsWith('?') ? `${typeText}?` : typeText;
      const defaultValue = optionalOrNullable ? ' = null' : '';
      const keyLiteral = field.key.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const annotation = needsSerialName ? `@SerialName("${keyLiteral}") ` : '';
      return `    ${annotation}val ${identifier}: ${finalType}${defaultValue}`;
    });
    lines.push('@Serializable', `data class ${resolvedName}(`);
    lines.push(properties.join(',\n'));
    lines.push(')', '');
  }

  return { output: lines.join('\n').trimEnd() + '\n', warnings: [] };
}
