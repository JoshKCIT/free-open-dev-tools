import { countTooLarge, TOO_LARGE, TOO_LONG, UNEXPECTED_END } from './cursor';
import { isAbstractHeap, isNumberType, MALFORMED_REF, MALFORMED_VALUE } from './types';

/**
 * A reading position for the checks made once per item (the locals of every function body), which records its first fault
 * instead of throwing. It reads by the same rules as `Cursor` and gives the same offsets and sentences, so a module whose
 * every body is wrong costs a few comparisons per body and not an error thrown and caught per body. The sentence of a
 * count fault is a function, so a fault that ends up only counted builds no sentence.
 */
export class SoftReader {
  readonly bytes: Uint8Array;
  pos = 0;
  end = 0;
  /** The offset of the first fault, or -1 while there is none. */
  faultAt = -1;
  /** The sentence of the first fault. */
  fault: string | (() => string) = '';

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  /** Starts reading the range from `pos` to `end`, with no fault. */
  reset(pos: number, end: number): void {
    this.pos = pos;
    this.end = end;
    this.faultAt = -1;
    this.fault = '';
  }

  get failed(): boolean {
    return this.faultAt >= 0;
  }

  /** Records a fault (only the first one counts) and returns -1. */
  fail(at: number, text: string | (() => string)): number {
    if (this.faultAt < 0) {
      this.faultAt = at;
      this.fault = text;
    }
    return -1;
  }

  /** An unsigned 32-bit LEB128 number, as `Cursor.u32` reads it; -1 and a fault when it cannot be read. */
  u32(): number {
    let result = 0;
    let scale = 1;
    for (let i = 0; i < 5; i++) {
      if (this.pos >= this.end) return this.fail(this.pos, UNEXPECTED_END);
      const byte = this.bytes[this.pos++]!;
      if (i === 4) {
        if ((byte & 0x80) !== 0) return this.fail(this.pos - 1, TOO_LONG);
        if (byte > 0x0f) return this.fail(this.pos - 1, TOO_LARGE);
      }
      result += (byte & 0x7f) * scale;
      if ((byte & 0x80) === 0) return result;
      scale *= 128;
    }
    return result;
  }

  /**
   * A signed 33-bit LEB128 number, as `Cursor.s33` reads it: at most 5 bytes, the unused bits of the last byte repeating the
   * sign bit. The value fits a double exactly. Check `failed` after the call: a fault returns -1, which is also a value.
   */
  s33(): number {
    let result = 0;
    let scale = 1;
    for (let i = 1; ; i++) {
      if (this.pos >= this.end) return this.fail(this.pos, UNEXPECTED_END);
      const byte = this.bytes[this.pos++]!;
      if (i === 5) {
        if ((byte & 0x80) !== 0) return this.fail(this.pos - 1, TOO_LONG);
        // 33 bits leave 5 bits in the fifth byte: the two above them must repeat its top bit.
        const payload = byte & 0x7f;
        const sign = (payload >> 4) & 1;
        if (payload >> 5 !== (sign === 0 ? 0 : 3)) return this.fail(this.pos - 1, TOO_LARGE);
      }
      result += (byte & 0x7f) * scale;
      scale *= 128;
      if ((byte & 0x80) === 0) return (byte & 0x40) !== 0 ? result - scale : result;
    }
  }

  /** A count of items each at least `minItemBytes` long, as `Cursor.count` reads it; -1 and a fault otherwise. */
  count(minItemBytes: number): number {
    const at = this.pos;
    const n = this.u32();
    if (this.failed) return -1;
    const left = this.end - this.pos;
    if (n * minItemBytes > left) return this.fail(at, () => countTooLarge(n, left));
    return n;
  }

  /** Moves past a value type, as `readValType` reads it; a fault when it is not one. */
  valType(): void {
    const at = this.pos;
    if (at >= this.end) {
      this.fail(at, UNEXPECTED_END);
      return;
    }
    const first = this.bytes[at]!;
    this.pos++;
    if (isNumberType(first) || isAbstractHeap(first)) return;
    if (first !== 0x63 && first !== 0x64) {
      this.fail(at, MALFORMED_VALUE);
      return;
    }
    // A reference type with a heap type: an abstract one by its byte, else a type index that must not be negative.
    if (this.pos < this.end && isAbstractHeap(this.bytes[this.pos]!)) {
      this.pos++;
      return;
    }
    const indexAt = this.pos;
    const index = this.s33();
    if (!this.failed && index < 0) this.fail(indexAt, MALFORMED_REF);
  }
}
