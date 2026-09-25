/**
 * Renders the shared inferred model as Java `record` declarations (Java 16
 * or later) with Jackson's `@JsonProperty`, per the Java Language
 * Specification's Keywords section and Jackson's own `@JsonProperty`
 * documentation (both fetched live before this file was written).
 */
import type { EmitResult } from './emit-typescript';
import type { FieldType, InferredModel, ModelField } from './infer';
import { JAVA_SHADOW_TYPES, javaComponentName, withShadowSuffix } from './naming';

function typeNameMap(model: InferredModel): Map<string, string> {
  const map = new Map<string, string>();
  for (const obj of model.objects) map.set(obj.name, withShadowSuffix(obj.name, JAVA_SHADOW_TYPES));
  return map;
}

function renderType(type: FieldType, names: Map<string, string>, boxed: boolean): string {
  switch (type.kind) {
    case 'string':
      return 'String';
    case 'integer':
      return boxed ? 'Long' : 'long';
    case 'float':
      return boxed ? 'Double' : 'double';
    case 'boolean':
      return boxed ? 'Boolean' : 'boolean';
    case 'array':
      return `List<${renderType(type.item!, names, true)}>`;
    case 'ref':
      return names.get(type.name!) ?? type.name!;
    case 'any':
    default:
      return 'Object';
  }
}

function renderField(field: ModelField, names: Map<string, string>): string {
  const { identifier, needsAnnotation } = javaComponentName(field.key);
  const boxed = field.optional || field.type.nullable;
  const typeText = renderType(field.type, names, boxed);
  const annotation = needsAnnotation
    ? `@JsonProperty("${field.key.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}") `
    : '';
  return `    ${annotation}${typeText} ${identifier}`;
}

export function emitJava(model: InferredModel): EmitResult {
  const names = typeNameMap(model);
  const lines: string[] = ['import com.fasterxml.jackson.annotation.JsonProperty;', 'import java.util.List;', ''];

  for (const obj of model.objects) {
    const resolvedName = names.get(obj.name)!;
    const components = obj.fields.map((field) => renderField(field, names));
    lines.push(`public record ${resolvedName}(`);
    lines.push(components.join(',\n'));
    lines.push(') {}', '');
  }

  return { output: lines.join('\n').trimEnd() + '\n', warnings: [] };
}
