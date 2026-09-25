/**
 * Renders the shared inferred model as TypeScript `export interface`
 * declarations. Source text only: this file never imports the `typescript`
 * package -- the compiler oracle lives in the test suite instead.
 */
import type { FieldType, InferredModel } from './infer';
import { TS_SHADOW_TYPES, typescriptPropertyName, withShadowSuffix } from './naming';

export interface EmitResult {
  output: string;
  warnings: string[];
}

function typeNameMap(model: InferredModel): Map<string, string> {
  const map = new Map<string, string>();
  for (const obj of model.objects) map.set(obj.name, withShadowSuffix(obj.name, TS_SHADOW_TYPES));
  return map;
}

function renderType(type: FieldType, names: Map<string, string>): string {
  let base: string;
  switch (type.kind) {
    case 'string':
      base = 'string';
      break;
    case 'integer':
    case 'float':
      base = 'number';
      break;
    case 'boolean':
      base = 'boolean';
      break;
    case 'array':
      base = `${renderType(type.item!, names)}[]`;
      break;
    case 'ref':
      base = names.get(type.name!) ?? type.name!;
      break;
    case 'any':
    default:
      base = 'unknown';
      break;
  }
  return type.nullable ? `${base} | null` : base;
}

export function emitTypeScript(model: InferredModel): EmitResult {
  const names = typeNameMap(model);
  const lines: string[] = [];

  for (const obj of model.objects) {
    const resolvedName = names.get(obj.name)!;
    lines.push(`export interface ${resolvedName} {`);
    for (const field of obj.fields) {
      const propName = typescriptPropertyName(field.key);
      const optional = field.optional ? '?' : '';
      lines.push(`  ${propName}${optional}: ${renderType(field.type, names)};`);
    }
    lines.push('}', '');
  }

  if (model.root.kind !== 'ref') {
    lines.push(`export type ${model.rootName} = ${renderType(model.root, names)};`, '');
  }

  return { output: lines.join('\n').trimEnd() + '\n', warnings: [] };
}
