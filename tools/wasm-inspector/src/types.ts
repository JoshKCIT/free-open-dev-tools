import type { Cursor } from './cursor';
import { WasmInspectorError } from './errors';
import { MAX_SIGNATURE_PARTS } from './limits';

const NUMBER_TYPES: Readonly<Record<number, string>> = {
  0x7f: 'i32',
  0x7e: 'i64',
  0x7d: 'f32',
  0x7c: 'f64',
  0x7b: 'v128',
};

/** Abstract heap types (WebAssembly 3.0 core, binary format of types). */
const ABSTRACT_HEAP: Readonly<Record<number, string>> = {
  0x69: 'exn',
  0x6a: 'array',
  0x6b: 'struct',
  0x6c: 'i31',
  0x6d: 'eq',
  0x6e: 'any',
  0x6f: 'extern',
  0x70: 'func',
  0x71: 'none',
  0x72: 'noextern',
  0x73: 'nofunc',
  0x74: 'noexn',
};

export type TypeKind = 'func' | 'struct' | 'array';

/** One type definition: a function signature, a struct or an array, with its place in a recursive group. */
export interface TypeRow {
  /** The type index. */
  index: number;
  kind: TypeKind;
  /** The signature or the fields as text, for example `(i32, i32) -> (i32)`. */
  text: string;
  /** The super types, as type indices; empty for a type without any. */
  supers: number[];
  /** False for a type written with `sub` (open to further subtypes), true for one written `sub final` or with no `sub`. */
  final: boolean;
  /** Empty for a type on its own, else `rec 4..6` for the group it belongs to. */
  group: string;
}

export function isAbstractHeap(byte: number): boolean {
  return ABSTRACT_HEAP[byte] !== undefined;
}

/** True for the bytes of the number types and v128. */
export function isNumberType(byte: number): boolean {
  return NUMBER_TYPES[byte] !== undefined;
}

export const MALFORMED_REF = 'A reference type is malformed (malformed reference type).';
export const MALFORMED_VALUE = 'A value type is malformed (malformed value type).';

/** A heap type: an abstract one by name, or a concrete one as a type index. */
export function readHeapType(c: Cursor): string {
  const first = c.peek();
  if (first >= 0 && isAbstractHeap(first)) {
    c.pos++;
    return ABSTRACT_HEAP[first]!;
  }
  const at = c.pos;
  const index = c.s33();
  if (index < 0n) throw new WasmInspectorError(MALFORMED_REF, at);
  return String(index);
}

/** A reference type: `(ref null 3)`, `(ref func)` or an abstract heap type written alone, which is nullable. */
export function readRefType(c: Cursor): string {
  const at = c.pos;
  const byte = c.u8();
  if (byte === 0x63) return `(ref null ${readHeapType(c)})`;
  if (byte === 0x64) return `(ref ${readHeapType(c)})`;
  if (isAbstractHeap(byte)) return `${ABSTRACT_HEAP[byte]}ref`;
  throw new WasmInspectorError(MALFORMED_REF, at);
}

/** A value type: a number type, v128 or a reference type. */
export function readValType(c: Cursor): string {
  const first = c.peek();
  if (first >= 0) {
    const number = NUMBER_TYPES[first];
    if (number !== undefined) {
      c.pos++;
      return number;
    }
  }
  const at = c.pos;
  try {
    return readRefType(c);
  } catch (error) {
    if (error instanceof WasmInspectorError && error.offset === at && first >= 0 && first !== 0x63 && first !== 0x64) {
      throw new WasmInspectorError(MALFORMED_VALUE, at);
    }
    throw error;
  }
}

/** A vector of value types written out as `i32, f64`, at most `MAX_SIGNATURE_PARTS` of them, with the rest counted. */
function readTypeList(c: Cursor): string {
  const n = c.count(1);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const text = readValType(c);
    if (i < MAX_SIGNATURE_PARTS) parts.push(text);
  }
  if (n > MAX_SIGNATURE_PARTS) parts.push(`and ${n - MAX_SIGNATURE_PARTS} more`);
  return parts.join(', ');
}

/** A storage type: a value type or a packed field type (i8, i16). */
function readStorageType(c: Cursor): string {
  const first = c.peek();
  if (first === 0x78) {
    c.pos++;
    return 'i8';
  }
  if (first === 0x77) {
    c.pos++;
    return 'i16';
  }
  return readValType(c);
}

/** A field type: a storage type and a mutability byte. */
function readFieldType(c: Cursor): string {
  const storage = readStorageType(c);
  const at = c.pos;
  const mutability = c.u8();
  if (mutability > 1) throw new WasmInspectorError('A mutability byte is neither 0 nor 1 (malformed mutability).', at);
  return mutability === 1 ? `mut ${storage}` : storage;
}

function readSubtype(c: Cursor, index: number, group: string): TypeRow {
  const supers: number[] = [];
  let final = true;
  const marker = c.peek();
  if (marker === 0x4f || marker === 0x50) {
    c.pos++;
    final = marker === 0x4f;
    const n = c.count(1);
    for (let i = 0; i < n; i++) {
      const type = c.u32();
      if (i < MAX_SIGNATURE_PARTS) supers.push(type);
    }
  }
  const at = c.pos;
  const form = c.u8();
  if (form === 0x60) {
    const params = readTypeList(c);
    const results = readTypeList(c);
    return { index, kind: 'func', text: `(${params}) -> (${results})`, supers, final, group };
  }
  if (form === 0x5f) {
    const n = c.count(2);
    const fields: string[] = [];
    for (let i = 0; i < n; i++) {
      const field = readFieldType(c);
      if (i < MAX_SIGNATURE_PARTS) fields.push(field);
    }
    if (n > MAX_SIGNATURE_PARTS) fields.push(`and ${n - MAX_SIGNATURE_PARTS} more`);
    const text = fields.length === 0 ? 'struct {}' : `struct { ${fields.join(', ')} }`;
    return { index, kind: 'struct', text, supers, final, group };
  }
  if (form === 0x5e) {
    return { index, kind: 'array', text: `array { ${readFieldType(c)} }`, supers, final, group };
  }
  throw new WasmInspectorError('A type definition starts with an unknown byte (malformed type definition).', at);
}

/**
 * One entry of the type section: a single type, or a recursive group of subtypes (`0x4e`). `firstIndex` is the index of the
 * first type it defines. Each type is handed to `emit` as it is read, and the number of types defined is returned, so the
 * caller keeps as many rows as it chooses and still reaches the end of the section.
 */
export function readRecType(c: Cursor, firstIndex: number, emit: (row: TypeRow) => void): number {
  if (c.peek() === 0x4e) {
    c.pos++;
    const n = c.count(1);
    const group = n === 1 ? `rec ${firstIndex}` : `rec ${firstIndex}..${firstIndex + n - 1}`;
    for (let i = 0; i < n; i++) emit(readSubtype(c, firstIndex + i, group));
    return n;
  }
  emit(readSubtype(c, firstIndex, ''));
  return 1;
}

/** Memory or table limits: a minimum, an optional maximum, 64-bit addressing and the threads proposal's shared flag. */
export interface Limits {
  min: bigint;
  max: bigint | null;
  is64: boolean;
  shared: boolean;
  /** For example `1 to 4` or `2 or more`. */
  range: string;
  /** `64-bit` and `shared (threads proposal)` when they apply. */
  flags: string[];
  /** The range and the flags in one line. */
  text: string;
}

/**
 * Limits. Flags 0 and 1 (32-bit, without and with a maximum) and 4 and 5 (64-bit) are the core text; 2, 3, 6 and 7 are the
 * shared forms of the threads proposal, shown as such. The numbers are u64 in every form.
 */
export function readLimits(c: Cursor): Limits {
  const at = c.pos;
  const flag = c.u8();
  if (flag > 7)
    throw new WasmInspectorError('The flags of a limit are not ones the format defines (malformed limits flags).', at);
  const hasMax = (flag & 1) !== 0;
  const shared = (flag & 2) !== 0;
  const is64 = (flag & 4) !== 0;
  const min = c.u64();
  const max = hasMax ? c.u64() : null;
  const range = max === null ? `${min} or more` : `${min} to ${max}`;
  const flags: string[] = [];
  if (is64) flags.push('64-bit');
  if (shared) flags.push('shared (threads proposal)');
  return { min, max, is64, shared, range, flags, text: [range, ...flags].join(', ') };
}

/** A table type: the reference type of its elements and its limits. */
export function readTableType(c: Cursor): { ref: string; limits: Limits; text: string } {
  const ref = readRefType(c);
  const limits = readLimits(c);
  return { ref, limits, text: `${ref}, ${limits.text}` };
}

/** A global type: a value type and whether it can change. */
export function readGlobalType(c: Cursor): { type: string; mutable: boolean; text: string } {
  const type = readValType(c);
  const at = c.pos;
  const mutability = c.u8();
  if (mutability > 1) throw new WasmInspectorError('A mutability byte is neither 0 nor 1 (malformed mutability).', at);
  return { type, mutable: mutability === 1, text: mutability === 1 ? `mut ${type}` : type };
}

/** A tag type: a zero attribute byte and the index of its function type. */
export function readTagType(c: Cursor): number {
  const at = c.pos;
  const attribute = c.u8();
  if (attribute !== 0)
    throw new WasmInspectorError('A tag has an attribute byte other than 0 (malformed tag attribute).', at);
  return c.u32();
}

/** A memory type: limits counted in pages of 64 KiB. */
export function readMemType(c: Cursor): { limits: Limits; text: string } {
  const limits = readLimits(c);
  return { limits, text: [`${limits.range} pages`, ...limits.flags].join(', ') };
}
