/**
 * Renders the shared inferred model as Dart `json_serializable` classes, per
 * Dart's own keyword list (fetched live before this file was written; the
 * fetched keyword list lives in naming.ts).
 * https://dart.dev/language/keywords
 */
import type { EmitResult } from './emit-typescript';
import type { FieldType, InferredModel, ModelField } from './infer';
import {
  DART_SHADOW_TYPES,
  assignNames,
  dartFieldName,
  escapeDartStringLiteral,
  lowerSnakeCase,
  withShadowSuffix,
} from './naming';

function typeNameMap(model: InferredModel): Map<string, string> {
  const map = new Map<string, string>();
  for (const obj of model.objects) map.set(obj.name, withShadowSuffix(obj.name, DART_SHADOW_TYPES));
  return map;
}

function renderType(type: FieldType, names: Map<string, string>): string {
  let base: string;
  switch (type.kind) {
    case 'string':
      base = 'String';
      break;
    case 'integer':
      base = 'int';
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
      base = 'Object';
      break;
  }
  return type.nullable ? `${base}?` : base;
}

interface DartProperty {
  key: string;
  fieldName: string;
  needsKey: boolean;
}

function computeProperties(fields: ModelField[]): DartProperty[] {
  const names = assignNames(
    fields.map((f) => f.key),
    dartFieldName,
  );
  return fields.map((field) => {
    const fieldName = names.get(field.key)!;
    return { key: field.key, fieldName, needsKey: fieldName !== field.key };
  });
}

export function emitDart(model: InferredModel): EmitResult {
  const names = typeNameMap(model);
  const classBlocks: string[][] = [];

  for (const obj of model.objects) {
    const resolvedName = names.get(obj.name)!;
    const properties = computeProperties(obj.fields);
    const lines: string[] = ['@JsonSerializable()', `class ${resolvedName} {`];

    const ctorParams: string[] = [];
    obj.fields.forEach((field, i) => {
      const prop = properties[i]!;
      const typeText = renderType(field.type, names);
      const optionalOrNullable = field.optional || field.type.nullable;
      const finalType = optionalOrNullable && !typeText.endsWith('?') ? `${typeText}?` : typeText;
      if (prop.needsKey) lines.push(`  @JsonKey(name: '${escapeDartStringLiteral(prop.key)}')`);
      lines.push(`  final ${finalType} ${prop.fieldName};`);
      const isNullable = finalType.endsWith('?');
      ctorParams.push(isNullable ? `    this.${prop.fieldName},` : `    required this.${prop.fieldName},`);
    });

    lines.push('');
    if (obj.fields.length === 0) {
      lines.push(`  ${resolvedName}();`);
    } else {
      lines.push(`  ${resolvedName}({`, ...ctorParams, '  });');
    }
    lines.push('');
    lines.push(`  factory ${resolvedName}.fromJson(Map<String, dynamic> json) => _$${resolvedName}FromJson(json);`);
    lines.push(`  Map<String, dynamic> toJson() => _$${resolvedName}ToJson(this);`);
    lines.push('}');

    classBlocks.push(lines);
  }

  const partName = lowerSnakeCase(model.rootName, 'root');
  const header = ["import 'package:json_annotation/json_annotation.dart';", '', `part '${partName}.g.dart';`, ''];
  const body = classBlocks.map((b) => b.join('\n')).join('\n\n');
  const output = [...header, body].join('\n').trimEnd() + '\n';

  return { output, warnings: [] };
}
