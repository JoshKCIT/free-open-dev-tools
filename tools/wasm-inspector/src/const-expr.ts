import type { Cursor } from './cursor';
import { WasmInspectorError } from './errors';
import { MAX_EXPR_PARTS } from './limits';
import { readHeapType } from './types';

/** Names for the features a constant expression can show, handed to the caller through `marks`. */
export const MARK_SIMD = 'SIMD (v128 values)';
export const MARK_EXTENDED_CONST = 'extended constants';
export const MARK_GC = 'garbage collection types';

const GC_NEW: Readonly<Record<number, string>> = {
  0: 'struct.new',
  1: 'struct.new_default',
  6: 'array.new',
  7: 'array.new_default',
};

const ARITHMETIC: Readonly<Record<number, string>> = {
  0x6a: 'i32.add',
  0x6b: 'i32.sub',
  0x6c: 'i32.mul',
  0x7c: 'i64.add',
  0x7d: 'i64.sub',
  0x7e: 'i64.mul',
};

const UNSUPPORTED =
  'A constant expression uses an instruction this page does not decode, so the reading of this section stops here.';

/**
 * Reads a constant expression up to and including its `end` opcode and returns it as text, for example `i32.const 16` or
 * `global.get 0`. Only the instructions the specification allows in a constant expression are decoded (the numeric,
 * vector, reference, extended-constant and GC allocation forms); any other opcode is a fault that ends the reading of the
 * section, because the end of an expression that is not decoded cannot be found. The text keeps at most `MAX_EXPR_PARTS`
 * instructions, with the rest counted, so a hostile expression costs a count and not a string. `marks` collects the features
 * the expression shows.
 */
export function readConstExpr(c: Cursor, marks?: Set<string>): string {
  const parts: string[] = [];
  let count = 0;
  const add = (text: string): void => {
    count++;
    if (parts.length < MAX_EXPR_PARTS) parts.push(text);
  };
  for (;;) {
    const at = c.pos;
    const op = c.u8();
    switch (op) {
      case 0x0b:
        return count > parts.length ? `${parts.join(' ')} and ${count - parts.length} more` : parts.join(' ');
      case 0x41:
        add(`i32.const ${c.s32()}`);
        break;
      case 0x42:
        add(`i64.const ${c.s64()}`);
        break;
      case 0x43: {
        const raw = c.bytesOf(4);
        add(`f32.const ${new DataView(raw.buffer, raw.byteOffset, 4).getFloat32(0, true)}`);
        break;
      }
      case 0x44: {
        const raw = c.bytesOf(8);
        add(`f64.const ${new DataView(raw.buffer, raw.byteOffset, 8).getFloat64(0, true)}`);
        break;
      }
      case 0x23:
        add(`global.get ${c.u32()}`);
        break;
      case 0xd0:
        add(`ref.null ${readHeapType(c)}`);
        break;
      case 0xd2:
        add(`ref.func ${c.u32()}`);
        break;
      case 0x6a:
      case 0x6b:
      case 0x6c:
      case 0x7c:
      case 0x7d:
      case 0x7e:
        marks?.add(MARK_EXTENDED_CONST);
        add(ARITHMETIC[op]!);
        break;
      case 0xfd: {
        const sub = c.u32();
        if (sub !== 12) throw new WasmInspectorError(UNSUPPORTED, at);
        c.bytesOf(16);
        marks?.add(MARK_SIMD);
        add('v128.const');
        break;
      }
      case 0xfb: {
        const sub = c.u32();
        marks?.add(MARK_GC);
        const plain = GC_NEW[sub];
        if (plain !== undefined) add(`${plain} ${c.u32()}`);
        else if (sub === 8) {
          const type = c.u32();
          add(`array.new_fixed ${type} ${c.u32()}`);
        } else if (sub === 0x1a) add('any.convert_extern');
        else if (sub === 0x1b) add('extern.convert_any');
        else if (sub === 0x1c) add('ref.i31');
        else throw new WasmInspectorError(UNSUPPORTED, at);
        break;
      }
      default:
        throw new WasmInspectorError(UNSUPPORTED, at);
    }
  }
}
