/**
 * Renders the shared inferred model as PHP 8.1+ `final class` declarations
 * with readonly promoted constructor properties, per PHP's own reserved
 * words pages and its constructor-promotion manual page (all fetched live
 * before this file was written).
 */
import type { EmitResult } from './emit-typescript';
import type { FieldType, InferredModel } from './infer';
import { phpClassName, phpVariableName } from './naming';

function typeNameMap(model: InferredModel): Map<string, string> {
  const map = new Map<string, string>();
  for (const obj of model.objects) map.set(obj.name, phpClassName(obj.name));
  return map;
}

function renderScalarType(type: FieldType, names: Map<string, string>): string {
  switch (type.kind) {
    case 'string':
      return 'string';
    case 'integer':
      return 'int';
    case 'float':
      return 'float';
    case 'boolean':
      return 'bool';
    case 'array':
      return 'array';
    case 'ref':
      return names.get(type.name!) ?? type.name!;
    case 'any':
    default:
      return 'mixed';
  }
}

/** The Item type text used in a `@var list<T>` docblock line, walking through nested arrays. */
function docblockItemType(type: FieldType, names: Map<string, string>): string {
  if (type.kind === 'array') return `list<${docblockItemType(type.item!, names)}>`;
  const base = renderScalarType(type, names);
  return type.nullable ? `${base}|null` : base;
}

export function emitPhp(model: InferredModel): EmitResult {
  const names = typeNameMap(model);
  const lines: string[] = ['<?php', '', 'declare(strict_types=1);', ''];

  for (const obj of model.objects) {
    const resolvedName = names.get(obj.name)!;
    lines.push(`final class ${resolvedName}`, '{', '    public function __construct(');

    const paramLines: string[] = [];
    for (const field of obj.fields) {
      const variable = phpVariableName(field.key);
      const keyLiteral = field.key === '' ? '(empty string)' : field.key;
      const docLines = [`        /** Original key: "${keyLiteral}" */`];
      const scalarType = renderScalarType(field.type, names);
      const typeHint = field.type.kind === 'any' ? 'mixed' : field.type.nullable ? `?${scalarType}` : scalarType;
      if (field.type.kind === 'array') {
        docLines.push(`        /** @var ${docblockItemType(field.type, names)} */`);
      }
      paramLines.push(`${docLines.join('\n')}\n        public readonly ${typeHint} $${variable}`);
    }
    lines.push(paramLines.join(',\n'));
    lines.push('    ) {}', '}', '');
  }

  return { output: lines.join('\n').trimEnd() + '\n', warnings: [] };
}
