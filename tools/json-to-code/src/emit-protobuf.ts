/**
 * Renders the shared inferred model as proto3 `message` declarations, per
 * the Protocol Buffers Language Specification, the ProtoJSON format and the
 * proto3 Language Guide's reserved field-number range (all fetched live
 * before this file was written; the fetched keyword list, the default
 * JSON-name rule and the field-name assignment rule live in naming.ts).
 * https://protobuf.dev/reference/protobuf/proto3-spec/
 * https://protobuf.dev/programming-guides/json/
 * https://protobuf.dev/programming-guides/proto3/
 */
import type { EmitResult } from './emit-typescript';
import type { FieldType, InferredModel, ModelField } from './infer';
import {
  assignProtobufFieldNames,
  escapeProtobufStringLiteral,
  protobufDefaultJsonName,
  withShadowSuffix,
} from './naming';

function typeNameMap(model: InferredModel): Map<string, string> {
  const map = new Map<string, string>();
  for (const obj of model.objects) map.set(obj.name, withShadowSuffix(obj.name, new Set()));
  return map;
}

/** Field numbers 1..n in order, skipping the 19000-19999 range reserved for the protobuf implementation. */
function fieldNumbers(count: number): number[] {
  const numbers: number[] = [];
  let n = 1;
  while (numbers.length < count) {
    if (n < 19000 || n > 19999) numbers.push(n);
    n++;
  }
  return numbers;
}

function renderScalarOrRef(type: FieldType, names: Map<string, string>): string {
  switch (type.kind) {
    case 'string':
      return 'string';
    case 'integer':
      return 'int64';
    case 'float':
      return 'double';
    case 'boolean':
      return 'bool';
    case 'ref':
      return names.get(type.name!) ?? type.name!;
    default:
      // Only reachable for a scalar/ref item; array and any items are
      // handled by their own branches in renderField before this is called.
      return 'string';
  }
}

interface FieldRender {
  label: 'optional' | 'repeated' | '';
  typeName: string;
  needsStructImport: boolean;
  warning?: string;
}

function renderField(field: ModelField, names: Map<string, string>): FieldRender {
  const type = field.type;
  const key = field.key;

  if (type.kind === 'array') {
    const item = type.item!;
    if (item.kind === 'array') {
      return {
        label: 'repeated',
        typeName: 'google.protobuf.ListValue',
        needsStructImport: true,
        warning: `"${key}" is an array of arrays. proto3 cannot nest a repeated field directly inside another, so it became repeated google.protobuf.ListValue, losing the element type.`,
      };
    }
    if (item.kind === 'any') {
      return {
        label: 'repeated',
        typeName: 'google.protobuf.Value',
        needsStructImport: true,
        warning: `"${key}" is an array of any-JSON values, which became repeated google.protobuf.Value; it accepts any JSON value but carries no type information.`,
      };
    }
    if (item.nullable) {
      return {
        label: 'repeated',
        typeName: 'google.protobuf.Value',
        needsStructImport: true,
        warning: `"${key}" is an array that held null, which became repeated google.protobuf.Value because a proto3 repeated field cannot hold null.`,
      };
    }
    return { label: 'repeated', typeName: renderScalarOrRef(item, names), needsStructImport: false };
  }

  if (type.kind === 'ref') {
    return { label: '', typeName: names.get(type.name!) ?? type.name!, needsStructImport: false };
  }

  if (type.kind === 'any') {
    return {
      label: '',
      typeName: 'google.protobuf.Value',
      needsStructImport: true,
      warning: `"${key}" is any-JSON, which became google.protobuf.Value; it accepts any JSON value but carries no type information.`,
    };
  }

  const typeName = renderScalarOrRef(type, names);
  const label = field.optional || type.nullable ? 'optional' : '';
  return { label, typeName, needsStructImport: false };
}

export function emitProtobuf(model: InferredModel): EmitResult {
  const names = typeNameMap(model);
  const warnings: string[] = [];
  let needsStructImport = false;
  const messageBlocks: string[][] = [];

  for (const obj of model.objects) {
    const resolvedName = names.get(obj.name)!;
    const fieldNames = assignProtobufFieldNames(obj.fields.map((f) => f.key));
    const numbers = fieldNumbers(obj.fields.length);
    const lines: string[] = [`message ${resolvedName} {`];

    obj.fields.forEach((field, i) => {
      const render = renderField(field, names);
      if (render.needsStructImport) needsStructImport = true;
      if (render.warning) warnings.push(render.warning);

      const fieldName = fieldNames.get(field.key)!;
      const number = numbers[i]!;
      const labelPrefix = render.label ? `${render.label} ` : '';
      const defaultJsonName = protobufDefaultJsonName(fieldName);
      const needsJsonName = defaultJsonName !== field.key;
      const jsonNameSuffix = needsJsonName ? ` [json_name = "${escapeProtobufStringLiteral(field.key)}"]` : '';
      lines.push(`  ${labelPrefix}${render.typeName} ${fieldName} = ${number}${jsonNameSuffix};`);
    });

    lines.push('}');
    messageBlocks.push(lines);
  }

  if (model.root.kind !== 'ref') {
    warnings.push(
      'The top-level value is not a JSON object, so only the object types found inside it were emitted; a proto3 message can only describe an object.',
    );
  }

  const header: string[] = ['syntax = "proto3";', ''];
  if (needsStructImport) header.push('import "google/protobuf/struct.proto";', '');

  const body = messageBlocks.map((b) => b.join('\n')).join('\n\n');
  const output = [...header, body].join('\n').trimEnd() + '\n';

  return { output, warnings };
}
