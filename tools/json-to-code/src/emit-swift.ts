/**
 * Renders the shared inferred model as Swift `struct X: Codable`
 * declarations, per the Swift Programming Language's Lexical Structure page
 * (fetched live before this file was written; the fetched keyword list
 * lives in naming.ts).
 * https://docs.swift.org/swift-book/documentation/the-swift-programming-language/lexicalstructure/
 */
import type { EmitResult } from './emit-typescript';
import type { FieldType, InferredModel, ModelField } from './infer';
import {
  SWIFT_KEYWORDS,
  SWIFT_SHADOW_TYPES,
  assignNames,
  camelCase,
  escapeSwiftStringLiteral,
  withShadowSuffix,
} from './naming';

function typeNameMap(model: InferredModel): Map<string, string> {
  const map = new Map<string, string>();
  for (const obj of model.objects) map.set(obj.name, withShadowSuffix(obj.name, SWIFT_SHADOW_TYPES));
  return map;
}

function renderType(type: FieldType, names: Map<string, string>, usesJson: { value: boolean }): string {
  let base: string;
  switch (type.kind) {
    case 'string':
      base = 'String';
      break;
    case 'integer':
      base = 'Int';
      break;
    case 'float':
      base = 'Double';
      break;
    case 'boolean':
      base = 'Bool';
      break;
    case 'array':
      base = `[${renderType(type.item!, names, usesJson)}]`;
      break;
    case 'ref':
      base = names.get(type.name!) ?? type.name!;
      break;
    case 'any':
    default:
      usesJson.value = true;
      base = 'JSONValue';
      break;
  }
  return type.nullable ? `${base}?` : base;
}

interface SwiftProperty {
  key: string;
  identifier: string;
  bareName: string;
  needsRawValue: boolean;
}

function computeProperties(fields: ModelField[]): SwiftProperty[] {
  const names = assignNames(
    fields.map((f) => f.key),
    (key) => camelCase(key, 'value'),
  );
  return fields.map((field) => {
    const bareName = names.get(field.key)!;
    const identifier = SWIFT_KEYWORDS.has(bareName) ? `\`${bareName}\`` : bareName;
    return { key: field.key, identifier, bareName, needsRawValue: bareName !== field.key };
  });
}

const JSON_VALUE_ENUM = [
  'enum JSONValue: Codable {',
  '  case string(String)',
  '  case number(Double)',
  '  case bool(Bool)',
  '  case object([String: JSONValue])',
  '  case array([JSONValue])',
  '  case null',
  '',
  '  init(from decoder: Decoder) throws {',
  '    let container = try decoder.singleValueContainer()',
  '    if container.decodeNil() {',
  '      self = .null',
  '    } else if let value = try? container.decode(Bool.self) {',
  '      self = .bool(value)',
  '    } else if let value = try? container.decode(Double.self) {',
  '      self = .number(value)',
  '    } else if let value = try? container.decode(String.self) {',
  '      self = .string(value)',
  '    } else if let value = try? container.decode([JSONValue].self) {',
  '      self = .array(value)',
  '    } else if let value = try? container.decode([String: JSONValue].self) {',
  '      self = .object(value)',
  '    } else {',
  '      throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value.")',
  '    }',
  '  }',
  '',
  '  func encode(to encoder: Encoder) throws {',
  '    var container = encoder.singleValueContainer()',
  '    switch self {',
  '    case .string(let value): try container.encode(value)',
  '    case .number(let value): try container.encode(value)',
  '    case .bool(let value): try container.encode(value)',
  '    case .object(let value): try container.encode(value)',
  '    case .array(let value): try container.encode(value)',
  '    case .null: try container.encodeNil()',
  '    }',
  '  }',
  '}',
];

export function emitSwift(model: InferredModel): EmitResult {
  const names = typeNameMap(model);
  const usesJson = { value: false };
  const structBlocks: string[][] = [];

  for (const obj of model.objects) {
    const resolvedName = names.get(obj.name)!;
    const properties = computeProperties(obj.fields);
    const needsCodingKeys = properties.some((p) => p.needsRawValue);

    const lines: string[] = [`struct ${resolvedName}: Codable {`];
    obj.fields.forEach((field, i) => {
      const prop = properties[i]!;
      const typeText = renderType(field.type, names, usesJson);
      const optionalOrNullable = field.optional || field.type.nullable;
      const finalType = optionalOrNullable && !typeText.endsWith('?') ? `${typeText}?` : typeText;
      lines.push(`  let ${prop.identifier}: ${finalType}`);
    });

    if (needsCodingKeys) {
      lines.push('', '  enum CodingKeys: String, CodingKey {');
      for (const prop of properties) {
        if (prop.needsRawValue) {
          lines.push(`    case ${prop.identifier} = "${escapeSwiftStringLiteral(prop.key)}"`);
        } else {
          lines.push(`    case ${prop.identifier}`);
        }
      }
      lines.push('  }');
    }

    lines.push('}');
    structBlocks.push(lines);
  }

  if (usesJson.value) structBlocks.push(JSON_VALUE_ENUM);

  const header = ['import Foundation', ''];
  const body = structBlocks.map((b) => b.join('\n')).join('\n\n');
  const output = [...header, body].join('\n').trimEnd() + '\n';

  return { output, warnings: [] };
}
