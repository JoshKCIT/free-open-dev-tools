import { FindingList, WasmInspectorError } from './errors';
import { MAX_NAME_BYTES, withCommas } from './limits';

// A name is UTF-8 by its byte length. The strict decoder says whether it is valid; the other one shows it anyway. The byte
// order mark is kept (ignoreBOM), so a name that starts with one is shown with it and not silently shortened.
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const LOSSY_UTF8 = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });

/**
 * A reading position in the bytes of a module, with the reading rules of the binary format: little-endian LEB128 numbers
 * whose unused bits are checked, counts compared with the bytes that remain before anything is sized from them, and names
 * read as UTF-8 by their byte length. Every fault is a `WasmInspectorError` with the offset of the byte at fault.
 */
export class Cursor {
  readonly bytes: Uint8Array;
  pos: number;
  end: number;

  constructor(bytes: Uint8Array, pos = 0, end: number = bytes.length) {
    this.bytes = bytes;
    this.pos = pos;
    this.end = end;
  }

  /** How many bytes remain before the end of this cursor's range. */
  left(): number {
    return this.end - this.pos;
  }

  atEnd(): boolean {
    return this.pos >= this.end;
  }

  /** The byte at the position, or -1 at the end, without moving. */
  peek(): number {
    return this.pos < this.end ? this.bytes[this.pos]! : -1;
  }

  u8(): number {
    if (this.pos >= this.end)
      throw new WasmInspectorError('The data ends in the middle of a value (unexpected end).', this.pos);
    return this.bytes[this.pos++]!;
  }

  /** An unsigned 32-bit LEB128 number: at most 5 bytes, the unused high bits of the last byte zero. */
  u32(): number {
    let result = 0;
    let scale = 1;
    for (let i = 0; i < 5; i++) {
      const byte = this.u8();
      if (i === 4) {
        if ((byte & 0x80) !== 0) {
          throw new WasmInspectorError(
            'A number uses more bytes than its width allows (integer representation too long).',
            this.pos - 1,
          );
        }
        if (byte > 0x0f)
          throw new WasmInspectorError('A number does not fit its width (integer too large).', this.pos - 1);
      }
      result += (byte & 0x7f) * scale;
      if ((byte & 0x80) === 0) return result;
      scale *= 128;
    }
    return result;
  }

  /** An unsigned LEB128 number of `bits` bits, as a BigInt. */
  private unsigned(bits: number): bigint {
    const maxBytes = Math.ceil(bits / 7);
    let result = 0n;
    let shift = 0n;
    for (let i = 1; ; i++) {
      const byte = this.u8();
      if (i === maxBytes) {
        if ((byte & 0x80) !== 0) {
          throw new WasmInspectorError(
            'A number uses more bytes than its width allows (integer representation too long).',
            this.pos - 1,
          );
        }
        if (byte >> (bits - 7 * (maxBytes - 1)) !== 0) {
          throw new WasmInspectorError('A number does not fit its width (integer too large).', this.pos - 1);
        }
      }
      result |= BigInt(byte & 0x7f) << shift;
      shift += 7n;
      if ((byte & 0x80) === 0) return result;
    }
  }

  /** A signed LEB128 number of `bits` bits: the unused bits of the last byte must repeat the sign bit. */
  private signed(bits: number): bigint {
    const maxBytes = Math.ceil(bits / 7);
    let result = 0n;
    let shift = 0n;
    for (let i = 1; ; i++) {
      const byte = this.u8();
      if (i === maxBytes) {
        if ((byte & 0x80) !== 0) {
          throw new WasmInspectorError(
            'A number uses more bytes than its width allows (integer representation too long).',
            this.pos - 1,
          );
        }
        const used = bits - 7 * (maxBytes - 1);
        const payload = byte & 0x7f;
        const sign = (payload >> (used - 1)) & 1;
        const high = payload >> used;
        const allowed = sign === 0 ? 0 : 0x7f >> used;
        if (high !== allowed)
          throw new WasmInspectorError('A number does not fit its width (integer too large).', this.pos - 1);
      }
      result |= BigInt(byte & 0x7f) << shift;
      shift += 7n;
      if ((byte & 0x80) === 0) {
        if ((byte & 0x40) !== 0) result -= 1n << shift;
        return result;
      }
    }
  }

  u64(): bigint {
    return this.unsigned(64);
  }

  s32(): number {
    return Number(this.signed(32));
  }

  s33(): bigint {
    return this.signed(33);
  }

  s64(): bigint {
    return this.signed(64);
  }

  /** Moves past `length` bytes and returns them (a view, not a copy). */
  bytesOf(length: number): Uint8Array {
    if (length > this.left()) {
      throw new WasmInspectorError('The data ends in the middle of a value (unexpected end).', this.pos);
    }
    const out = this.bytes.subarray(this.pos, this.pos + length);
    this.pos += length;
    return out;
  }

  /**
   * A count of items, each at least `minItemBytes` long. A count larger than the bytes that remain is refused here, before
   * any array is sized from it (a count of 4,294,967,295 in a 40 byte module is one sentence, not an allocation).
   */
  count(minItemBytes = 1): number {
    const at = this.pos;
    const n = this.u32();
    if (n * minItemBytes > this.left()) {
      throw new WasmInspectorError(
        `A length or count is larger than the bytes that remain (length out of bounds): ${withCommas(n)} announced, ${withCommas(this.left())} bytes remain.`,
        at,
      );
    }
    return n;
  }

  /**
   * A name: a byte count and that many bytes of UTF-8. Bytes that are not valid UTF-8 are reported at the offset of the name
   * (malformed UTF-8 encoding) and the name is still returned, with the replacement character for each bad sequence.
   */
  name(findings?: FindingList): string {
    const at = this.pos;
    const length = this.count(1);
    if (length > MAX_NAME_BYTES) {
      throw new WasmInspectorError(
        `A name is longer than the ${withCommas(MAX_NAME_BYTES)} bytes this page reads.`,
        at,
      );
    }
    const raw = this.bytesOf(length);
    try {
      return STRICT_UTF8.decode(raw);
    } catch {
      findings?.add(at, 'A name is not valid UTF-8 (malformed UTF-8 encoding).');
      return LOSSY_UTF8.decode(raw);
    }
  }
}
