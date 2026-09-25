/**
 * Renders the shared inferred model as Python `TypedDict` classes (Python
 * 3.11 or later, for `typing.NotRequired`), per the Python language
 * reference's Keywords section and the `typing` module's own documentation
 * of `TypedDict`, `NotRequired` and its functional form (both fetched live
 * before this file was written).
 */
import type { EmitResult } from './emit-typescript';
import type { FieldType, InferredModel } from './infer';
import { escapePythonStringLiteral, isValidPythonIdentifier } from './naming';

const PYTHON_SHADOW_TYPES = new Set(['Any', 'List', 'Dict', 'Optional', 'Union', 'Tuple', 'Set', 'Type']);

function typeNameMap(model: InferredModel): Map<string, string> {
  const map = new Map<string, string>();
  for (const obj of model.objects) {
    map.set(obj.name, PYTHON_SHADOW_TYPES.has(obj.name) ? `${obj.name}Type` : obj.name);
  }
  return map;
}

function renderBaseType(type: FieldType, names: Map<string, string>): string {
  switch (type.kind) {
    case 'string':
      return 'str';
    case 'integer':
      return 'int';
    case 'float':
      return 'float';
    case 'boolean':
      return 'bool';
    case 'array':
      return `list[${renderBaseType(type.item!, names)}]`;
    case 'ref':
      return names.get(type.name!) ?? type.name!;
    case 'any':
    default:
      return 'Any';
  }
}

function renderFieldType(type: FieldType, optional: boolean, names: Map<string, string>): string {
  const base = renderBaseType(type, names);
  const withNull = type.nullable ? `${base} | None` : base;
  return optional ? `NotRequired[${withNull}]` : withNull;
}

export function emitPython(model: InferredModel): EmitResult {
  const names = typeNameMap(model);
  const lines: string[] = ['from typing import Any, NotRequired, TypedDict', ''];

  for (const obj of model.objects) {
    const resolvedName = names.get(obj.name)!;
    const canUseClassSyntax = obj.fields.every((f) => isValidPythonIdentifier(f.key));

    if (canUseClassSyntax) {
      lines.push(`class ${resolvedName}(TypedDict):`);
      if (obj.fields.length === 0) {
        lines.push('    pass');
      } else {
        for (const field of obj.fields) {
          lines.push(`    ${field.key}: ${renderFieldType(field.type, field.optional, names)}`);
        }
      }
      lines.push('');
    } else {
      lines.push(`${resolvedName} = TypedDict(`, `    "${resolvedName}",`, '    {');
      for (const field of obj.fields) {
        const keyLiteral = `'${escapePythonStringLiteral(field.key)}'`;
        lines.push(`        ${keyLiteral}: ${renderFieldType(field.type, field.optional, names)},`);
      }
      lines.push('    },', ')', '');
    }
  }

  return { output: lines.join('\n').trimEnd() + '\n', warnings: [] };
}
