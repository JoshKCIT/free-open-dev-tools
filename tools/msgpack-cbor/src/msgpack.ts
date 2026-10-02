import { ByteWriter, MAX_DEPTH, MsgpackCborError, decodeUtf8 } from './common';

/** The name each integer format has in the MessagePack specification's format table. */
export type MsgpackIntFormat =
  | 'positive fixint'
  | 'negative fixint'
  | 'uint 8'
  | 'uint 16'
  | 'uint 32'
  | 'uint 64'
  | 'int 8'
  | 'int 16'
  | 'int 32'
  | 'int 64';

/**
 * One MessagePack value. Integers are `bigint` with the format they were read in, floats keep their width, maps keep
 * their keys of any type and in order, and an extension keeps its type number and its bytes. A timestamp is the
 * extension of type -1 in one of its three layouts (4, 8 or 12 bytes), with seconds and nanoseconds kept apart.
 */
export type MsgpackItem =
  | { type: 'nil' }
  | { type: 'bool'; value: boolean }
  | { type: 'int'; value: bigint; format: MsgpackIntFormat }
  | { type: 'float'; value: number; width: 32 | 64 }
  | { type: 'str'; value: string }
  | { type: 'bin'; value: Uint8Array }
  | { type: 'array'; items: MsgpackItem[] }
  | { type: 'map'; entries: [MsgpackItem, MsgpackItem][] }
  | { type: 'ext'; extType: number; data: Uint8Array }
  | { type: 'timestamp'; seconds: bigint; nanoseconds: number; size: 4 | 8 | 12 };

const MAX_NANOSECONDS = 999999999;
const INT_RANGE = 'MessagePack integers run from -9223372036854775808 to 18446744073709551615';

class Reader {
  position = 0;
  /** How many integers and floats of each format were read, in the order each format first appeared. */
  readonly widths = new Map<string, number>();
  /** Set when a NaN with payload bits was read. */
  nanPayload = false;
  private readonly view: DataView;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  remaining(): number {
    return this.bytes.length - this.position;
  }

  count(format: string): void {
    this.widths.set(format, (this.widths.get(format) ?? 0) + 1);
  }

  /** Refuses naming the byte where the value that needs `count` more bytes starts. */
  need(count: number, what: string, from: number): void {
    if (count > this.remaining()) {
      throw new MsgpackCborError(
        `The input ends inside ${what} that starts at byte ${from}: it needs ${count.toLocaleString('en-US')} more ${count === 1 ? 'byte' : 'bytes'} but only ${this.remaining().toLocaleString('en-US')} ${this.remaining() === 1 ? 'is' : 'are'} left.`,
        { offset: from },
      );
    }
  }

  byte(what: string, from: number): number {
    this.need(1, what, from);
    return this.bytes[this.position++]!;
  }

  /** Reads an unsigned integer of 1, 2 or 4 bytes (a length or a count). */
  length(size: 1 | 2 | 4, what: string, from: number): number {
    this.need(size, what, from);
    const at = this.position;
    this.position += size;
    return size === 1 ? this.view.getUint8(at) : size === 2 ? this.view.getUint16(at) : this.view.getUint32(at);
  }

  take(count: number, what: string, from: number): Uint8Array {
    this.need(count, what, from);
    const slice = this.bytes.subarray(this.position, this.position + count);
    this.position += count;
    return slice;
  }

  integer(size: 1 | 2 | 4 | 8, signed: boolean, what: string, from: number): bigint {
    this.need(size, what, from);
    const at = this.position;
    this.position += size;
    if (size === 1) return BigInt(signed ? this.view.getInt8(at) : this.view.getUint8(at));
    if (size === 2) return BigInt(signed ? this.view.getInt16(at) : this.view.getUint16(at));
    if (size === 4) return BigInt(signed ? this.view.getInt32(at) : this.view.getUint32(at));
    return signed ? this.view.getBigInt64(at) : this.view.getBigUint64(at);
  }

  float(size: 4 | 8, from: number): number {
    this.need(size, 'a float', from);
    const at = this.position;
    this.position += size;
    const value = size === 4 ? this.view.getFloat32(at) : this.view.getFloat64(at);
    if (Number.isNaN(value)) {
      const canonical =
        size === 4 ? this.view.getUint32(at) === 0x7fc00000 : this.view.getBigUint64(at) === 0x7ff8000000000000n;
      if (!canonical) this.nanPayload = true;
    }
    return value;
  }
}

function tooDeep(offset: number): MsgpackCborError {
  return new MsgpackCborError(
    `The value nests more than ${MAX_DEPTH} levels deep: the level that is too deep starts at byte ${offset}.`,
    { offset },
  );
}

/** An extension's bytes as a timestamp when its type is -1 and its layout is one of the three in the specification. */
function asTimestamp(extType: number, data: Uint8Array): MsgpackItem | null {
  if (extType !== -1) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length === 4) return { type: 'timestamp', seconds: BigInt(view.getUint32(0)), nanoseconds: 0, size: 4 };
  if (data.length === 8) {
    const packed = view.getBigUint64(0);
    const nanoseconds = Number(packed >> 34n);
    if (nanoseconds > MAX_NANOSECONDS) return null;
    return { type: 'timestamp', seconds: packed & 0x3ffffffffn, nanoseconds, size: 8 };
  }
  if (data.length === 12) {
    const nanoseconds = view.getUint32(0);
    if (nanoseconds > MAX_NANOSECONDS) return null;
    return { type: 'timestamp', seconds: view.getBigInt64(4), nanoseconds, size: 12 };
  }
  return null;
}

function readExt(reader: Reader, length: number, from: number): MsgpackItem {
  const type = reader.byte('an extension type', from);
  const extType = type > 127 ? type - 256 : type;
  const data = reader.take(length, 'an extension', from);
  return asTimestamp(extType, data) ?? { type: 'ext', extType, data };
}

function readString(reader: Reader, length: number, from: number): MsgpackItem {
  return { type: 'str', value: decodeUtf8(reader.take(length, 'a string', from), from, 'string') };
}

function readArray(reader: Reader, count: number, from: number, depth: number): MsgpackItem {
  if (depth + 1 > MAX_DEPTH) throw tooDeep(from);
  // Every item takes at least one byte, so a count beyond the bytes left is refused before any item is read.
  if (count > reader.remaining()) {
    throw new MsgpackCborError(
      `The array at byte ${from} declares ${count.toLocaleString('en-US')} items but only ${reader.remaining().toLocaleString('en-US')} bytes are left.`,
      { offset: from },
    );
  }
  const items: MsgpackItem[] = [];
  for (let i = 0; i < count; i++) items.push(readItem(reader, depth + 1));
  return { type: 'array', items };
}

function readMap(reader: Reader, count: number, from: number, depth: number): MsgpackItem {
  if (depth + 1 > MAX_DEPTH) throw tooDeep(from);
  // Every pair takes at least two bytes.
  if (count * 2 > reader.remaining()) {
    throw new MsgpackCborError(
      `The map at byte ${from} declares ${count.toLocaleString('en-US')} pairs but only ${reader.remaining().toLocaleString('en-US')} bytes are left.`,
      { offset: from },
    );
  }
  const entries: [MsgpackItem, MsgpackItem][] = [];
  for (let i = 0; i < count; i++) {
    const key = readItem(reader, depth + 1);
    entries.push([key, readItem(reader, depth + 1)]);
  }
  return { type: 'map', entries };
}

function readItem(reader: Reader, depth: number): MsgpackItem {
  const from = reader.position;
  const b = reader.byte('a value', from);
  if (b <= 0x7f) {
    reader.count('positive fixint');
    return { type: 'int', value: BigInt(b), format: 'positive fixint' };
  }
  if (b >= 0xe0) {
    reader.count('negative fixint');
    return { type: 'int', value: BigInt(b - 256), format: 'negative fixint' };
  }
  if (b <= 0x8f) return readMap(reader, b & 0x0f, from, depth);
  if (b <= 0x9f) return readArray(reader, b & 0x0f, from, depth);
  if (b <= 0xbf) return readString(reader, b & 0x1f, from);
  switch (b) {
    case 0xc0:
      return { type: 'nil' };
    case 0xc1:
      throw new MsgpackCborError(`Byte ${from} is 0xc1, which the MessagePack specification marks as never used.`, {
        offset: from,
      });
    case 0xc2:
      return { type: 'bool', value: false };
    case 0xc3:
      return { type: 'bool', value: true };
    case 0xc4:
    case 0xc5:
    case 0xc6:
      return {
        type: 'bin',
        value: reader.take(reader.length(b === 0xc4 ? 1 : b === 0xc5 ? 2 : 4, 'a binary', from), 'a binary', from),
      };
    case 0xc7:
    case 0xc8:
    case 0xc9:
      return readExt(reader, reader.length(b === 0xc7 ? 1 : b === 0xc8 ? 2 : 4, 'an extension', from), from);
    case 0xca: {
      reader.count('float 32');
      return { type: 'float', value: reader.float(4, from), width: 32 };
    }
    case 0xcb: {
      reader.count('float 64');
      return { type: 'float', value: reader.float(8, from), width: 64 };
    }
    case 0xcc:
    case 0xcd:
    case 0xce:
    case 0xcf: {
      const size = (1 << (b - 0xcc)) as 1 | 2 | 4 | 8;
      const format = `uint ${size * 8}` as MsgpackIntFormat;
      reader.count(format);
      return { type: 'int', value: reader.integer(size, false, 'an integer', from), format };
    }
    case 0xd0:
    case 0xd1:
    case 0xd2:
    case 0xd3: {
      const size = (1 << (b - 0xd0)) as 1 | 2 | 4 | 8;
      const format = `int ${size * 8}` as MsgpackIntFormat;
      reader.count(format);
      return { type: 'int', value: reader.integer(size, true, 'an integer', from), format };
    }
    case 0xd4:
    case 0xd5:
    case 0xd6:
    case 0xd7:
    case 0xd8:
      return readExt(reader, 1 << (b - 0xd4), from);
    case 0xd9:
    case 0xda:
    case 0xdb:
      return readString(reader, reader.length(b === 0xd9 ? 1 : b === 0xda ? 2 : 4, 'a string', from), from);
    case 0xdc:
    case 0xdd:
      return readArray(reader, reader.length(b === 0xdc ? 2 : 4, 'an array', from), from, depth);
    default:
      // 0xde and 0xdf are the only values left.
      return readMap(reader, reader.length(b === 0xde ? 2 : 4, 'a map', from), from, depth);
  }
}

/** What reading one value found besides the value, so the page can say what its JSON form cannot keep. */
export interface MsgpackDecoded {
  item: MsgpackItem;
  nanPayload: boolean;
  /** The integer and float formats used and how many of each, in the order each first appeared. */
  widths: [string, number][];
}

/** Decodes exactly one MessagePack value, with notes on what its JSON form cannot keep. Bytes left over are refused. */
export function decodeMsgpackWithNotes(bytes: Uint8Array): MsgpackDecoded {
  const reader = new Reader(bytes);
  const item = readItem(reader, 0);
  if (reader.position < bytes.length) {
    throw new MsgpackCborError(
      `The value ends at byte ${reader.position}, but ${(bytes.length - reader.position).toLocaleString('en-US')} more ${bytes.length - reader.position === 1 ? 'byte follows' : 'bytes follow'} it. Convert one value at a time.`,
      { offset: reader.position },
    );
  }
  return { item, nanPayload: reader.nanPayload, widths: [...reader.widths] };
}

/** Decodes exactly one MessagePack value. Bytes left over after it are refused with their offset. */
export function decodeMsgpack(bytes: Uint8Array): MsgpackItem {
  return decodeMsgpackWithNotes(bytes).item;
}

// ---------------------------------------------------------------------------------------------------------------------
// Encoder

const utf8 = new TextEncoder();
const scratch = new DataView(new ArrayBuffer(8));

function writeInt(out: ByteWriter, value: bigint): void {
  if (value >= 0n) {
    if (value <= 0x7fn) out.byte(Number(value));
    else if (value <= 0xffn) {
      out.byte(0xcc);
      out.unsigned(value, 1);
    } else if (value <= 0xffffn) {
      out.byte(0xcd);
      out.unsigned(value, 2);
    } else if (value <= 0xffffffffn) {
      out.byte(0xce);
      out.unsigned(value, 4);
    } else if (value <= 0xffffffffffffffffn) {
      out.byte(0xcf);
      out.unsigned(value, 8);
    } else throw new MsgpackCborError(`${value} is out of range. ${INT_RANGE}.`);
    return;
  }
  if (value >= -32n) out.byte(Number(value) + 256);
  else if (value >= -128n) {
    out.byte(0xd0);
    out.unsigned(BigInt.asUintN(8, value), 1);
  } else if (value >= -32768n) {
    out.byte(0xd1);
    out.unsigned(BigInt.asUintN(16, value), 2);
  } else if (value >= -2147483648n) {
    out.byte(0xd2);
    out.unsigned(BigInt.asUintN(32, value), 4);
  } else if (value >= -9223372036854775808n) {
    out.byte(0xd3);
    out.unsigned(BigInt.asUintN(64, value), 8);
  } else throw new MsgpackCborError(`${value} is out of range. ${INT_RANGE}.`);
}

function writeFloat(out: ByteWriter, value: number): void {
  if (Number.isNaN(value)) {
    out.byte(0xca);
    out.unsigned(0x7fc00000n, 4);
  } else if (Math.fround(value) === value) {
    out.byte(0xca);
    scratch.setFloat32(0, value);
    out.unsigned(BigInt(scratch.getUint32(0)), 4);
  } else {
    out.byte(0xcb);
    scratch.setFloat64(0, value);
    out.unsigned(scratch.getBigUint64(0), 8);
  }
}

function writeLength(
  out: ByteWriter,
  length: number,
  fix: { base: number; max: number } | null,
  wide: [number, number, number],
): void {
  // `wide` is the 8, 16 and 32 bit format bytes; 0 means that width does not exist for this type.
  if (fix && length <= fix.max) {
    out.byte(fix.base | length);
  } else if (wide[0] !== 0 && length <= 0xff) {
    out.byte(wide[0]);
    out.unsigned(BigInt(length), 1);
  } else if (length <= 0xffff) {
    out.byte(wide[1]);
    out.unsigned(BigInt(length), 2);
  } else {
    out.byte(wide[2]);
    out.unsigned(BigInt(length), 4);
  }
}

function writeExt(out: ByteWriter, extType: number, data: Uint8Array): void {
  if (!Number.isInteger(extType) || extType < -128 || extType > 127) {
    throw new MsgpackCborError('An extension type is a number from -128 to 127.');
  }
  const type = BigInt.asUintN(8, BigInt(extType));
  const fixed: Record<number, number> = { 1: 0xd4, 2: 0xd5, 4: 0xd6, 8: 0xd7, 16: 0xd8 };
  const fixext = fixed[data.length];
  if (fixext !== undefined) {
    out.byte(fixext);
  } else {
    writeLength(out, data.length, null, [0xc7, 0xc8, 0xc9]);
  }
  out.unsigned(type, 1);
  out.bytes(data);
}

function writeItem(out: ByteWriter, item: MsgpackItem): void {
  switch (item.type) {
    case 'nil':
      out.byte(0xc0);
      return;
    case 'bool':
      out.byte(item.value ? 0xc3 : 0xc2);
      return;
    case 'int':
      writeInt(out, item.value);
      return;
    case 'float':
      writeFloat(out, item.value);
      return;
    case 'str': {
      const raw = utf8.encode(item.value);
      writeLength(out, raw.length, { base: 0xa0, max: 31 }, [0xd9, 0xda, 0xdb]);
      out.bytes(raw);
      return;
    }
    case 'bin':
      writeLength(out, item.value.length, null, [0xc4, 0xc5, 0xc6]);
      out.bytes(item.value);
      return;
    case 'array':
      writeLength(out, item.items.length, { base: 0x90, max: 15 }, [0, 0xdc, 0xdd]);
      for (const child of item.items) writeItem(out, child);
      return;
    case 'map':
      writeLength(out, item.entries.length, { base: 0x80, max: 15 }, [0, 0xde, 0xdf]);
      for (const [key, value] of item.entries) {
        writeItem(out, key);
        writeItem(out, value);
      }
      return;
    case 'ext':
      writeExt(out, item.extType, item.data);
      return;
    case 'timestamp': {
      const nanoseconds = BigInt(item.nanoseconds);
      if (item.nanoseconds < 0 || item.nanoseconds > MAX_NANOSECONDS || !Number.isInteger(item.nanoseconds)) {
        throw new MsgpackCborError('The nanoseconds of a timestamp are a whole number from 0 to 999999999.');
      }
      if (item.seconds < -9223372036854775808n || item.seconds > 9223372036854775807n) {
        throw new MsgpackCborError('The seconds of a timestamp run from -9223372036854775808 to 9223372036854775807.');
      }
      // The specification's serialization: 34 bits of seconds fit the 32 or 64 bit layout, anything else the 96 bit one.
      if (item.seconds >= 0n && item.seconds >> 34n === 0n) {
        const packed = (nanoseconds << 34n) | item.seconds;
        const data = new ByteWriter();
        if (packed >> 32n === 0n) data.unsigned(packed, 4);
        else data.unsigned(packed, 8);
        writeExt(out, -1, data.finish());
      } else {
        const data = new ByteWriter();
        data.unsigned(nanoseconds, 4);
        data.unsigned(BigInt.asUintN(64, item.seconds), 8);
        writeExt(out, -1, data.finish());
      }
      return;
    }
  }
}

/**
 * Writes a value as MessagePack in its shortest form: the smallest integer format that holds a number (unsigned for
 * 0 and above, signed below), single precision for a float when it keeps the value, the shortest length format for a
 * string, binary, array or map, and the timestamp layout the specification's own serialization picks.
 */
export function encodeMsgpack(item: MsgpackItem): Uint8Array {
  const out = new ByteWriter();
  writeItem(out, item);
  return out.finish();
}
