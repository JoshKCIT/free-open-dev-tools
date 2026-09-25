/**
 * Renders the shared inferred model as Rust structs deriving `Debug, Clone,
 * Serialize, Deserialize`, per the Rust reference's Keywords and Identifiers
 * pages and serde's own field-attribute documentation (both fetched live
 * before this file was written).
 */
import type { EmitResult } from './emit-typescript';
import type { FieldType, InferredModel } from './infer';
import { RUST_SHADOW_TYPES, assignNames, rustField, withShadowSuffix } from './naming';

function typeNameMap(model: InferredModel): Map<string, string> {
  const map = new Map<string, string>();
  for (const obj of model.objects) map.set(obj.name, withShadowSuffix(obj.name, RUST_SHADOW_TYPES));
  return map;
}

function renderType(type: FieldType, names: Map<string, string>): string {
  let base: string;
  switch (type.kind) {
    case 'string':
      base = 'String';
      break;
    case 'integer':
      base = 'i64';
      break;
    case 'float':
      base = 'f64';
      break;
    case 'boolean':
      base = 'bool';
      break;
    case 'array':
      base = `Vec<${renderType(type.item!, names)}>`;
      break;
    case 'ref':
      base = names.get(type.name!) ?? type.name!;
      break;
    case 'any':
    default:
      base = 'serde_json::Value';
      break;
  }
  return type.nullable ? `Option<${base}>` : base;
}

export function emitRust(model: InferredModel): EmitResult {
  const names = typeNameMap(model);
  const lines: string[] = ['use serde::{Deserialize, Serialize};', ''];

  for (const obj of model.objects) {
    const resolvedName = names.get(obj.name)!;
    const fields = assignNames(
      obj.fields.map((f) => f.key),
      (key) => rustField(key).identifier,
    );
    lines.push('#[derive(Debug, Clone, Serialize, Deserialize)]', `pub struct ${resolvedName} {`);
    for (const field of obj.fields) {
      const rf = rustField(field.key);
      const identifier = fields.get(field.key)!;
      if (rf.needsRename) lines.push(`    #[serde(rename = ${rf.renameLiteral})]`);
      lines.push(`    pub ${identifier}: ${renderType(field.type, names)},`);
    }
    lines.push('}', '');
  }

  return { output: lines.join('\n').trimEnd() + '\n', warnings: [] };
}
