import { FontInspectorError } from './errors';

/** Prints a number as a hexadecimal tag-free offset text, used by sentences that name a place. */
export function hex(value: number, width = 4): string {
  return value.toString(16).toUpperCase().padStart(width, '0');
}

/**
 * Reads big-endian numbers from a font file. Every read is compared with the length first, so a count or an offset taken
 * from the file can never reach past the data: the fault is a `FontInspectorError` that names the offset.
 */
export class ByteReader {
  readonly bytes: Uint8Array;
  readonly length: number;
  private readonly view: DataView;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.length = bytes.length;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  /** True when `length` bytes starting at `offset` are all inside the data. */
  has(offset: number, length: number): boolean {
    return (
      Number.isInteger(offset) &&
      Number.isInteger(length) &&
      offset >= 0 &&
      length >= 0 &&
      offset <= this.length &&
      length <= this.length - offset
    );
  }

  private need(offset: number, length: number): void {
    if (!this.has(offset, length)) {
      throw new FontInspectorError(
        'The font data ends in the middle of a value.',
        undefined,
        Number.isInteger(offset) ? offset : 0,
      );
    }
  }

  u8(offset: number): number {
    this.need(offset, 1);
    return this.view.getUint8(offset);
  }

  u16(offset: number): number {
    this.need(offset, 2);
    return this.view.getUint16(offset, false);
  }

  i16(offset: number): number {
    this.need(offset, 2);
    return this.view.getInt16(offset, false);
  }

  u24(offset: number): number {
    this.need(offset, 3);
    return (this.view.getUint8(offset) << 16) | this.view.getUint16(offset + 1, false);
  }

  u32(offset: number): number {
    this.need(offset, 4);
    return this.view.getUint32(offset, false);
  }

  i32(offset: number): number {
    this.need(offset, 4);
    return this.view.getInt32(offset, false);
  }

  /** A 16.16 fixed point number, exact (a multiple of 1/65536 is exact in a double). */
  fixed(offset: number): number {
    return this.i32(offset) / 65536;
  }

  /** A signed 2.14 fixed point number, exact. */
  f2dot14(offset: number): number {
    return this.i16(offset) / 16384;
  }

  /** Four bytes as a tag of Latin-1 characters. */
  tag(offset: number): string {
    this.need(offset, 4);
    return String.fromCharCode(
      this.view.getUint8(offset),
      this.view.getUint8(offset + 1),
      this.view.getUint8(offset + 2),
      this.view.getUint8(offset + 3),
    );
  }

  /** A view of `length` bytes at `offset`, not a copy. */
  slice(offset: number, length: number): Uint8Array {
    this.need(offset, length);
    return this.bytes.subarray(offset, offset + length);
  }
}
