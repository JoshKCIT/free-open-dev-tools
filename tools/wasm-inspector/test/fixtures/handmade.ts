/**
 * Modules assembled by hand, because the two second opinions cannot write them (wabt 1.0.39 cannot write GC types and
 * writes an invalid data segment for a second memory) or cannot accept them (V8 12.4, in Node 22, refuses 64-bit memories
 * and tables). Each module is a list of byte groups, each with a comment naming the grammar rule of the WebAssembly 3.0
 * core binary format it follows (specification/wasm-3.0, 5.1 to 5.4); the size of a section is worked out from its groups.
 *
 * `v8` says what V8 in Node 22 does with the module: `accepts` (the test also compares V8's imports and exports),
 * `refuses` (the module is outside what that V8 knows, so only the reader's answer is checked) or `either` (the test
 * compares when V8 accepts, so a newer Node never breaks it).
 */
export type Group = readonly [hex: string, comment: string];

function bytesOf(hex: string): number[] {
  const clean = hex.replace(/\s+/g, '');
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) throw new Error(`not hex: ${hex}`);
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
  return out;
}

function lebOf(value: number): string {
  const out: number[] = [];
  let rest = value;
  do {
    let byte = rest % 128;
    rest = Math.floor(rest / 128);
    if (rest > 0) byte |= 0x80;
    out.push(byte);
  } while (rest > 0);
  return out.map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
}

/** A section: the id and the size are written out first (the size is the number of bytes in the groups). */
function sec(id: number, label: string, ...groups: Group[]): Group[] {
  const size = groups.reduce((sum, group) => sum + bytesOf(group[0]).length, 0);
  return [[`${id.toString(16).padStart(2, '0')} ${lebOf(size)}`, `${label} section: id ${id}, size ${size}`], ...groups];
}

const HEADER_GROUP: Group = ['00 61 73 6d 01 00 00 00', 'magic 00 61 73 6d, version 1'];

export interface Handmade {
  groups: Group[];
  v8: 'accepts' | 'refuses' | 'either';
}

/** The bytes of a hand-assembled module. */
export function handmadeBytes(module: Handmade): Uint8Array<ArrayBuffer> {
  return Uint8Array.from([HEADER_GROUP, ...module.groups].flatMap((group) => bytesOf(group[0])));
}

/**
 * GC types: a recursive group of three subtypes (struct, struct that extends it, array), a function type that takes a
 * nullable reference and returns a non-null i31 reference, and a plain array with a packed field; two globals whose types
 * are references to the first struct.
 */
export const GC_TYPES: Handmade = {
  v8: 'accepts',
  groups: [
    ...sec(
      1,
      'type',
      ['04', 'vec(rectype): 4 entries (the group, then types 3, 4 and 5)'],
      ['4e 03', 'rectype: 0x4e, vec(subtype) of 3 (types 0, 1 and 2)'],
      ['50 00 5f 02 7f 01 78 00', 'type 0: sub, 0 supertypes, struct of 2 fields: i32 mut, i8 const'],
      ['4f 01 00 5f 03 7f 01 78 00 77 01', 'type 1: sub final, supertype 0, struct of 3 fields: i32 mut, i8, i16 mut'],
      ['50 00 5e 77 01', 'type 2: sub, 0 supertypes, array of i16 mut'],
      ['60 01 63 00 01 64 6c', 'type 3: func, 1 param (ref null 0), 1 result (ref i31)'],
      ['5e 78 01', 'type 4: array of i8 mut (no sub marker, so final)'],
      ['5f 00', 'type 5: struct with no fields'],
    ),
    ...sec(
      6,
      'global',
      ['02', 'vec(global): 2'],
      ['63 00 01 d0 00 0b', 'global 0: (ref null 0) mut, init ref.null 0'],
      ['64 00 00 fb 01 00 0b', 'global 1: (ref 0) const, init struct.new_default 0'],
    ),
  ],
};

/**
 * Two memories, a data count section, and two data segments: the first active in memory 0 (flag 0), the second active in
 * memory 1 (flag 2 with a memory index); memory 1 is exported.
 */
export const MULTI_MEMORY: Handmade = {
  v8: 'accepts',
  groups: [
    ...sec(
      5,
      'memory',
      ['02', 'vec(memory): 2'],
      ['00 01', 'memory 0: limits flag 0, min 1'],
      ['01 02 03', 'memory 1: limits flag 1, min 2, max 3'],
    ),
    ...sec(7, 'export', ['01', 'vec(export): 1'], ['01 62', 'name "b"'], ['02 01', 'kind memory, index 1']),
    ...sec(12, 'data count', ['02', 'data count: 2']),
    ...sec(
      11,
      'data',
      ['02', 'vec(data): 2'],
      ['00 41 00 0b 02 61 62', 'data 0: flag 0 (active, memory 0), offset i32.const 0, 2 bytes "ab"'],
      ['02 01 41 04 0b 02 78 79', 'data 1: flag 2 (active), memory index 1, offset i32.const 4, 2 bytes "xy"'],
    ),
  ],
};

/** 64-bit memories and tables (limits flags 4 and 5), and a data segment with an i64.const offset. */
export const MEMORY64: Handmade = {
  v8: 'either',
  groups: [
    ...sec(
      4,
      'table',
      ['02', 'vec(table): 2'],
      ['70 04 02', 'table 0: funcref, limits flag 4 (64-bit, min only), min 2'],
      ['70 05 01 08', 'table 1: funcref, limits flag 5 (64-bit, min and max), min 1, max 8'],
    ),
    ...sec(
      5,
      'memory',
      ['02', 'vec(memory): 2'],
      ['04 01', 'memory 0: limits flag 4 (64-bit, min only), min 1'],
      ['05 02 40', 'memory 1: limits flag 5 (64-bit, min and max), min 2, max 64'],
    ),
    ...sec(11, 'data', ['01', 'vec(data): 1'], ['00 42 10 0b 01 7a', 'data 0: flag 0 (active, memory 0), offset i64.const 16, 1 byte "z"']),
  ],
};

/** The shared forms of limits from the threads proposal (flags 2, 3, 6 and 7), which are outside the core text. */
export const SHARED_MEMORY: Handmade = {
  v8: 'either',
  groups: [
    ...sec(
      5,
      'memory',
      ['02', 'vec(memory): 2'],
      ['03 01 02', 'memory 0: limits flag 3 (shared, min and max), min 1, max 2'],
      ['07 01 04', 'memory 1: limits flag 7 (shared, 64-bit, min and max), min 1, max 4'],
    ),
  ],
};

/**
 * Exception handling: a function type taking an i32, a memory, a tag section (id 13, which sits between the memory and the
 * global sections in the grammar), a global, and an export of the tag. One tag is imported (an import of kind 4).
 */
export const TAGS: Handmade = {
  v8: 'accepts',
  groups: [
    ...sec(1, 'type', ['01', 'vec(rectype): 1'], ['60 01 7f 00', 'type 0: func (i32) -> ()']),
    ...sec(
      2,
      'import',
      ['01', 'vec(import): 1'],
      ['03 65 6e 76', 'module name "env"'],
      ['01 74', 'field name "t"'],
      ['04 00 00', 'kind 4 (tag), attribute 0, type 0'],
    ),
    ...sec(5, 'memory', ['01', 'vec(memory): 1'], ['00 01', 'memory 0: limits flag 0, min 1']),
    ...sec(13, 'tag', ['02', 'vec(tag): 2'], ['00 00', 'tag 1 (tag 0 is the import): attribute 0, type 0'], ['00 00', 'tag 2: attribute 0, type 0']),
    ...sec(6, 'global', ['01', 'vec(global): 1'], ['7f 00 41 05 0b', 'global 0: i32 const, init i32.const 5']),
    ...sec(7, 'export', ['01', 'vec(export): 1'], ['01 65', 'name "e"'], ['04 02', 'kind tag, index 2']),
  ],
};

/**
 * All eight forms of element segment (flags 0 to 7) and the three forms of data segment (flags 0 to 2), with a function, a
 * table of two kinds and two memories.
 */
export const SEGMENT_FORMS: Handmade = {
  v8: 'accepts',
  groups: [
    ...sec(1, 'type', ['01', 'vec(rectype): 1'], ['60 00 00', 'type 0: func () -> ()']),
    ...sec(3, 'function', ['01', 'vec(typeidx): 1'], ['00', 'function 0 has type 0']),
    ...sec(4, 'table', ['01', 'vec(table): 1'], ['70 00 08', 'table 0: funcref, limits flag 0, min 8']),
    ...sec(
      5,
      'memory',
      ['02', 'vec(memory): 2'],
      ['00 01', 'memory 0: min 1'],
      ['00 01', 'memory 1: min 1'],
    ),
    ...sec(
      9,
      'element',
      ['08', 'vec(elem): 8'],
      ['00 41 00 0b 01 00', 'elem 0: flag 0, active table 0, offset i32.const 0, funcidx vector [0]'],
      ['01 00 01 00', 'elem 1: flag 1, passive, elemkind func, funcidx vector [0]'],
      ['02 00 41 01 0b 00 01 00', 'elem 2: flag 2, active, table 0, offset i32.const 1, elemkind func, funcidx vector [0]'],
      ['03 00 01 00', 'elem 3: flag 3, declarative, elemkind func, funcidx vector [0]'],
      ['04 41 02 0b 01 d2 00 0b', 'elem 4: flag 4, active table 0, offset i32.const 2, expression vector [ref.func 0]'],
      ['05 70 01 d2 00 0b', 'elem 5: flag 5, passive, reftype funcref, expression vector [ref.func 0]'],
      ['06 00 41 03 0b 70 01 d2 00 0b', 'elem 6: flag 6, active, table 0, offset i32.const 3, reftype funcref, expression vector [ref.func 0]'],
      ['07 70 01 d2 00 0b', 'elem 7: flag 7, declarative, reftype funcref, expression vector [ref.func 0]'],
    ),
    ...sec(12, 'data count', ['03', 'data count: 3']),
    ...sec(10, 'code', ['01', 'vec(code): 1'], ['02 00 0b', 'code 0: size 2, 0 locals, end']),
    ...sec(
      11,
      'data',
      ['03', 'vec(data): 3'],
      ['00 41 00 0b 01 61', 'data 0: flag 0, active memory 0, offset i32.const 0, 1 byte "a"'],
      ['01 03 62 63 64', 'data 1: flag 1, passive, 3 bytes "bcd"'],
      ['02 01 41 08 0b 01 65', 'data 2: flag 2, active, memory 1, offset i32.const 8, 1 byte "e"'],
    ),
  ],
};
