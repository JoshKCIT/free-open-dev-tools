import { ByteWriter, MAX_BIGNUM_BYTES, MAX_DEPTH, MsgpackCborError, bigintToBytes, decodeUtf8 } from './common';

/**
 * One CBOR data item (RFC 8949 section 3). Integers are `bigint` so the whole 64 bit range is exact. An item keeps what
 * its encoding said beyond its value: a string or container read from an indefinite-length encoding says so, and a float
 * keeps its width, so `encodeCbor` can write the same bytes back.
 */
export type CborItem =
  /** Major types 0 and 1: any integer from -2^64 to 2^64 - 1. Bigger ones are bignums, a tag around a byte string. */
  | { type: 'int'; value: bigint }
  /** `chunks` is present when the string was indefinite-length; `value` is then the chunks joined. */
  | { type: 'bytes'; value: Uint8Array; chunks?: Uint8Array[] }
  | { type: 'text'; value: string; chunks?: string[] }
  | { type: 'array'; items: CborItem[]; indefinite: boolean }
  | { type: 'map'; entries: [CborItem, CborItem][]; indefinite: boolean }
  | { type: 'tag'; tag: bigint; item: CborItem }
  /** `width` is the encoded precision in bits; `raw` holds the bits of a NaN whose payload is not the usual quiet NaN. */
  | { type: 'float'; value: number; width?: 16 | 32 | 64; raw?: bigint }
  /** A simple value other than false, true, null and undefined: 0 to 19 and 32 to 255. */
  | { type: 'simple'; value: number }
  | { type: 'bool'; value: boolean }
  | { type: 'null' }
  | { type: 'undefined' };

const MAX_UINT64 = 0xffffffffffffffffn;

const scratch = new DataView(new ArrayBuffer(8));

/** The value of half precision bits, by hand (RFC 8949 Appendix D). A NaN of any payload is NaN. */
export function decodeHalf(bits: number): number {
  const exponent = (bits >> 10) & 0x1f;
  const mantissa = bits & 0x3ff;
  const magnitude =
    exponent === 0
      ? mantissa * 2 ** -24
      : exponent !== 31
        ? (mantissa + 1024) * 2 ** (exponent - 25)
        : mantissa === 0
          ? Infinity
          : NaN;
  return bits & 0x8000 ? -magnitude : magnitude;
}

/** The half precision bits that hold `value` exactly, or null when half precision cannot hold it. NaN and infinities are not asked. */
export function halfBitsOf(value: number): number | null {
  if (!Number.isFinite(value) || Math.fround(value) !== value) return null;
  scratch.setFloat32(0, value);
  const bits = scratch.getUint32(0);
  const sign = (bits >>> 31) << 15;
  const exponent = (bits >>> 23) & 0xff;
  const mantissa = bits & 0x7fffff;
  let half: number | null = null;
  if (exponent === 0) {
    // Zero, or a single subnormal, which is far below the smallest half precision number.
    half = mantissa === 0 ? sign : null;
  } else {
    const e = exponent - 127;
    if (e >= -14 && e <= 15) {
      half = (mantissa & 0x1fff) === 0 ? sign | ((e + 15) << 10) | (mantissa >>> 13) : null;
    } else if (e >= -24 && e < -14) {
      // A half precision subnormal: the mantissa with its hidden bit shifted down.
      const full = 0x800000 | mantissa;
      const shift = -1 - e;
      const m = full >>> shift;
      half = (full & ((1 << shift) - 1)) === 0 && m >= 1 && m < 1024 ? sign | m : null;
    }
  }
  return half !== null && Object.is(decodeHalf(half), value) ? half : null;
}

/** The usual quiet NaN of each width: only the top mantissa bit set, no sign. */
const CANONICAL_NAN = { 16: 0x7e00n, 32: 0x7fc00000n, 64: 0x7ff8000000000000n } as const;

interface Head {
  /** Major type, 0 to 7. */
  major: number;
  /** Additional information, 0 to 31. */
  info: number;
  /** The argument (for major type 7 with information 25 to 27 the raw float bits), or null when indefinite. */
  argument: bigint | null;
  /** Where the head starts. */
  offset: number;
}

const BREAK = Symbol('break');

class Reader {
  position = 0;
  /** Set when an indefinite-length string was joined into one value, so the page can say so. */
  joinedChunks = false;
  /** Set when a NaN with payload bits was read. */
  nanPayload = false;
  constructor(readonly bytes: Uint8Array) {}

  remaining(): number {
    return this.bytes.length - this.position;
  }

  /** Reads `count` bytes, or refuses naming the byte where the item that needs them starts. */
  take(count: number, what: string, from: number): Uint8Array {
    if (count > this.remaining()) {
      throw new MsgpackCborError(
        `The input ends inside ${what} that starts at byte ${from}: it needs ${count.toLocaleString('en-US')} more ${count === 1 ? 'byte' : 'bytes'} but only ${this.remaining().toLocaleString('en-US')} ${this.remaining() === 1 ? 'is' : 'are'} left.`,
        { offset: from },
      );
    }
    const slice = this.bytes.subarray(this.position, this.position + count);
    this.position += count;
    return slice;
  }

  /** Reads a length that is checked against what is left before anything is allocated. */
  takeLength(length: bigint, what: string, from: number): Uint8Array {
    if (length > BigInt(this.remaining())) {
      throw new MsgpackCborError(
        `The input ends inside ${what} that starts at byte ${from}: it declares ${length.toLocaleString('en-US')} bytes but only ${this.remaining().toLocaleString('en-US')} ${this.remaining() === 1 ? 'is' : 'are'} left.`,
        { offset: from },
      );
    }
    return this.take(Number(length), what, from);
  }

  /** Reads a head: the major type, the additional information and its argument (1, 2, 4 or 8 bytes, big endian). */
  head(): Head {
    const offset = this.position;
    const first = this.take(1, 'a head byte', offset)[0]!;
    const major = first >> 5;
    const info = first & 31;
    if (info < 24) return { major, info, argument: BigInt(info), offset };
    if (info < 28) {
      const size = 1 << (info - 24);
      const raw = this.take(size, 'a length or value', offset);
      let value = 0n;
      for (const byte of raw) value = (value << 8n) | BigInt(byte);
      return { major, info, argument: value, offset };
    }
    if (info === 31) return { major, info, argument: null, offset };
    throw new MsgpackCborError(
      `Byte ${offset} (0x${first.toString(16).padStart(2, '0')}) uses additional information ${info}, which RFC 8949 reserves and never assigns.`,
      { offset },
    );
  }
}

function indefiniteNotAllowed(head: Head): MsgpackCborError {
  return new MsgpackCborError(
    `Byte ${head.offset}: major type ${head.major} cannot be indefinite-length (additional information 31).`,
    { offset: head.offset },
  );
}

function tooDeep(offset: number): MsgpackCborError {
  return new MsgpackCborError(
    `The value nests more than ${MAX_DEPTH} levels deep: the level that is too deep starts at byte ${offset}.`,
    { offset },
  );
}

/** Reads the chunks of an indefinite-length string, each a definite-length string of the same major type. */
function readChunks(reader: Reader, major: 2 | 3, start: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (;;) {
    const head = reader.head();
    if (head.major === 7 && head.info === 31) return chunks;
    if (head.major !== major || head.argument === null) {
      throw new MsgpackCborError(
        `Byte ${head.offset}: a chunk of the indefinite-length ${major === 2 ? 'byte' : 'text'} string that starts at byte ${start} must be a definite-length ${major === 2 ? 'byte' : 'text'} string.`,
        { offset: head.offset },
      );
    }
    chunks.push(reader.takeLength(head.argument, `a ${major === 2 ? 'byte' : 'text'} string`, head.offset));
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const chunk of chunks) length += chunk.length;
  const joined = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.length;
  }
  return joined;
}

function readFloat(reader: Reader, head: Head): CborItem {
  const raw = head.argument!;
  if (head.info === 25) {
    const value = decodeHalf(Number(raw));
    return floatItem(reader, value, 16, raw);
  }
  if (head.info === 26) {
    scratch.setUint32(0, Number(raw));
    return floatItem(reader, scratch.getFloat32(0), 32, raw);
  }
  scratch.setBigUint64(0, raw);
  return floatItem(reader, scratch.getFloat64(0), 64, raw);
}

function floatItem(reader: Reader, value: number, width: 16 | 32 | 64, raw: bigint): CborItem {
  if (Number.isNaN(value) && raw !== CANONICAL_NAN[width]) {
    reader.nanPayload = true;
    return { type: 'float', value, width, raw };
  }
  return { type: 'float', value, width };
}

/**
 * Reads one item. `depth` is how many arrays, maps and tags enclose it; a container that would make it more than
 * MAX_DEPTH is refused at its own byte. A break is returned only where the caller can end an indefinite-length item.
 */
function readItem(reader: Reader, depth: number, allowBreak: boolean): CborItem | typeof BREAK {
  const head = reader.head();
  switch (head.major) {
    case 0:
      if (head.argument === null) throw indefiniteNotAllowed(head);
      return { type: 'int', value: head.argument };
    case 1:
      if (head.argument === null) throw indefiniteNotAllowed(head);
      return { type: 'int', value: -1n - head.argument };
    case 2: {
      if (head.argument === null) {
        reader.joinedChunks = true;
        const chunks = readChunks(reader, 2, head.offset);
        return { type: 'bytes', value: concat(chunks), chunks };
      }
      return { type: 'bytes', value: reader.takeLength(head.argument, 'a byte string', head.offset) };
    }
    case 3: {
      if (head.argument === null) {
        reader.joinedChunks = true;
        const chunks = readChunks(reader, 3, head.offset).map((chunk) =>
          decodeUtf8(chunk, head.offset, 'text string chunk'),
        );
        return { type: 'text', value: chunks.join(''), chunks };
      }
      const raw = reader.takeLength(head.argument, 'a text string', head.offset);
      return { type: 'text', value: decodeUtf8(raw, head.offset, 'text string') };
    }
    case 4: {
      if (depth + 1 > MAX_DEPTH) throw tooDeep(head.offset);
      const items: CborItem[] = [];
      if (head.argument === null) {
        for (;;) {
          const next = readItem(reader, depth + 1, true);
          if (next === BREAK) return { type: 'array', items, indefinite: true };
          items.push(next);
        }
      }
      // Every item takes at least one byte, so a count beyond the bytes left is refused before any item is read.
      if (head.argument > BigInt(reader.remaining())) {
        throw new MsgpackCborError(
          `The array at byte ${head.offset} declares ${head.argument.toLocaleString('en-US')} items but only ${reader.remaining().toLocaleString('en-US')} bytes are left.`,
          { offset: head.offset },
        );
      }
      for (let i = 0; i < Number(head.argument); i++) items.push(readItem(reader, depth + 1, false) as CborItem);
      return { type: 'array', items, indefinite: false };
    }
    case 5: {
      if (depth + 1 > MAX_DEPTH) throw tooDeep(head.offset);
      const entries: [CborItem, CborItem][] = [];
      if (head.argument === null) {
        for (;;) {
          const key = readItem(reader, depth + 1, true);
          if (key === BREAK) return { type: 'map', entries, indefinite: true };
          entries.push([key, readItem(reader, depth + 1, false) as CborItem]);
        }
      }
      // Every pair takes at least two bytes.
      if (head.argument * 2n > BigInt(reader.remaining())) {
        throw new MsgpackCborError(
          `The map at byte ${head.offset} declares ${head.argument.toLocaleString('en-US')} pairs but only ${reader.remaining().toLocaleString('en-US')} bytes are left.`,
          { offset: head.offset },
        );
      }
      for (let i = 0; i < Number(head.argument); i++) {
        const key = readItem(reader, depth + 1, false) as CborItem;
        entries.push([key, readItem(reader, depth + 1, false) as CborItem]);
      }
      return { type: 'map', entries, indefinite: false };
    }
    case 6: {
      if (head.argument === null) throw indefiniteNotAllowed(head);
      if (depth + 1 > MAX_DEPTH) throw tooDeep(head.offset);
      return { type: 'tag', tag: head.argument, item: readItem(reader, depth + 1, false) as CborItem };
    }
    default: {
      // Major type 7: simple values, floats and the break.
      if (head.info === 31) {
        if (allowBreak) return BREAK;
        throw new MsgpackCborError(
          `Byte ${head.offset} is a break (0xff), but no indefinite-length item is waiting for one here.`,
          { offset: head.offset },
        );
      }
      if (head.info >= 25) return readFloat(reader, head);
      const value = Number(head.argument);
      if (head.info === 24 && value < 32) {
        throw new MsgpackCborError(
          `Byte ${head.offset}: the two byte form of a simple value must hold 32 or more, and this one holds ${value}.`,
          { offset: head.offset },
        );
      }
      if (head.info === 20) return { type: 'bool', value: false };
      if (head.info === 21) return { type: 'bool', value: true };
      if (head.info === 22) return { type: 'null' };
      if (head.info === 23) return { type: 'undefined' };
      return { type: 'simple', value };
    }
  }
}

/** What reading one item found besides the item, so the page can say what its JSON form cannot keep. */
export interface CborDecoded {
  item: CborItem;
  joinedChunks: boolean;
  nanPayload: boolean;
}

/** Decodes exactly one CBOR item, with notes on what its JSON form cannot keep. Bytes left over are refused. */
export function decodeCborWithNotes(bytes: Uint8Array): CborDecoded {
  const reader = new Reader(bytes);
  const item = readItem(reader, 0, false) as CborItem;
  if (reader.position < bytes.length) {
    throw new MsgpackCborError(
      `The item ends at byte ${reader.position}, but ${(bytes.length - reader.position).toLocaleString('en-US')} more ${bytes.length - reader.position === 1 ? 'byte follows' : 'bytes follow'} it. Convert one item at a time.`,
      { offset: reader.position },
    );
  }
  return { item, joinedChunks: reader.joinedChunks, nanPayload: reader.nanPayload };
}

/** Decodes exactly one CBOR item. Bytes left over after it are refused with their offset. */
export function decodeCbor(bytes: Uint8Array): CborItem {
  return decodeCborWithNotes(bytes).item;
}

/** The value of a bignum (tag 2) or negative bignum (tag 3) over `content`, or -1 minus it. */
export function bignumValue(tag: bigint, content: Uint8Array): bigint {
  let n = 0n;
  for (const byte of content) n = (n << 8n) | BigInt(byte);
  return tag === 3n ? -1n - n : n;
}

/** True when a tag item is a bignum whose byte string is short enough to be shown as a decimal number. */
export function isShortBignum(
  item: CborItem,
): item is { type: 'tag'; tag: bigint; item: CborItem & { type: 'bytes' } } {
  return (
    item.type === 'tag' &&
    (item.tag === 2n || item.tag === 3n) &&
    item.item.type === 'bytes' &&
    item.item.chunks === undefined &&
    item.item.value.length <= MAX_BIGNUM_BYTES
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Diagnostic notation (RFC 8949 section 8)

const hexOf = (data: Uint8Array): string => Array.from(data, (b) => b.toString(16).padStart(2, '0')).join('');

/** A text string as RFC 8949 Appendix A writes it: JSON syntax, with every character outside printable ASCII as \uXXXX. */
function diagnosticText(text: string): string {
  return JSON.stringify(text).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** A float as Table 6 prints it: the shortest digits that read back, always with a fraction or an exponent. */
function diagnosticFloat(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  if (Object.is(value, -0)) return '-0.0';
  const text = String(value);
  const e = text.indexOf('e');
  if (e >= 0) return text.slice(0, e).includes('.') ? text : `${text.slice(0, e)}.0${text.slice(e)}`;
  return text.includes('.') ? text : `${text}.0`;
}

/** Writes an item in diagnostic notation, the text form RFC 8949 section 8 defines and Appendix A prints. */
export function cborToDiagnostic(item: CborItem): string {
  switch (item.type) {
    case 'int':
      return item.value.toString();
    case 'bytes':
      return item.chunks
        ? `(_ ${item.chunks.map((chunk) => `h'${hexOf(chunk)}'`).join(', ')})`
        : `h'${hexOf(item.value)}'`;
    case 'text':
      return item.chunks ? `(_ ${item.chunks.map(diagnosticText).join(', ')})` : diagnosticText(item.value);
    case 'array': {
      const inner = item.items.map(cborToDiagnostic).join(', ');
      return item.indefinite ? `[_ ${inner}]` : `[${inner}]`;
    }
    case 'map': {
      const inner = item.entries.map(([k, v]) => `${cborToDiagnostic(k)}: ${cborToDiagnostic(v)}`).join(', ');
      return item.indefinite ? `{_ ${inner}}` : `{${inner}}`;
    }
    case 'tag':
      // RFC 8949 Appendix A prints a bignum as the number it stands for.
      if (isShortBignum(item)) return bignumValue(item.tag, item.item.value).toString();
      return `${item.tag}(${cborToDiagnostic(item.item)})`;
    case 'float':
      return diagnosticFloat(item.value);
    case 'simple':
      return `simple(${item.value})`;
    case 'bool':
      return item.value ? 'true' : 'false';
    case 'null':
      return 'null';
    case 'undefined':
      return 'undefined';
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Encoder

function writeHead(out: ByteWriter, major: number, argument: bigint): void {
  const m = major << 5;
  if (argument < 24n) out.byte(m | Number(argument));
  else if (argument <= 0xffn) {
    out.byte(m | 24);
    out.unsigned(argument, 1);
  } else if (argument <= 0xffffn) {
    out.byte(m | 25);
    out.unsigned(argument, 2);
  } else if (argument <= 0xffffffffn) {
    out.byte(m | 26);
    out.unsigned(argument, 4);
  } else if (argument <= MAX_UINT64) {
    out.byte(m | 27);
    out.unsigned(argument, 8);
  } else {
    throw new MsgpackCborError('A length or number over 18446744073709551615 cannot be written as one CBOR head.');
  }
}

const utf8 = new TextEncoder();

/** True when a value is held exactly by the given precision (NaN and the infinities are held by every width). */
function heldBy(value: number, width: 16 | 32 | 64): boolean {
  if (!Number.isFinite(value)) return true;
  if (width === 16) return halfBitsOf(value) !== null;
  if (width === 32) return Math.fround(value) === value;
  return true;
}

function writeFloat(out: ByteWriter, item: { value: number; width?: 16 | 32 | 64; raw?: bigint }): void {
  const { value, raw } = item;
  // A recorded width is kept when it still holds the value; otherwise the shortest width that does is used.
  const recorded = item.width;
  let width: 16 | 32 | 64;
  if (raw !== undefined && recorded !== undefined) width = recorded;
  else if (recorded !== undefined && heldBy(value, recorded)) width = recorded;
  else width = heldBy(value, 16) ? 16 : heldBy(value, 32) ? 32 : 64;
  const nan = Number.isNaN(value);
  if (width === 16) {
    // A NaN that was read with payload bits is written with the same bits, at the same width.
    const bits =
      raw !== undefined
        ? raw
        : BigInt(nan ? 0x7e00 : value === Infinity ? 0x7c00 : value === -Infinity ? 0xfc00 : halfBitsOf(value)!);
    out.byte(0xf9);
    out.unsigned(bits, 2);
  } else if (width === 32) {
    out.byte(0xfa);
    if (raw !== undefined) out.unsigned(raw, 4);
    else if (nan) out.unsigned(0x7fc00000n, 4);
    else {
      scratch.setFloat32(0, value);
      out.unsigned(BigInt(scratch.getUint32(0)), 4);
    }
  } else {
    out.byte(0xfb);
    if (raw !== undefined) out.unsigned(raw, 8);
    else if (nan) out.unsigned(0x7ff8000000000000n, 8);
    else {
      scratch.setFloat64(0, value);
      out.unsigned(scratch.getBigUint64(0), 8);
    }
  }
}

function writeItem(out: ByteWriter, item: CborItem): void {
  switch (item.type) {
    case 'int':
      if (item.value >= 0n) writeHead(out, 0, item.value);
      else writeHead(out, 1, -1n - item.value);
      return;
    case 'bytes':
      if (item.chunks) {
        out.byte(0x5f);
        for (const chunk of item.chunks) {
          writeHead(out, 2, BigInt(chunk.length));
          out.bytes(chunk);
        }
        out.byte(0xff);
      } else {
        writeHead(out, 2, BigInt(item.value.length));
        out.bytes(item.value);
      }
      return;
    case 'text':
      if (item.chunks) {
        out.byte(0x7f);
        for (const chunk of item.chunks) {
          const raw = utf8.encode(chunk);
          writeHead(out, 3, BigInt(raw.length));
          out.bytes(raw);
        }
        out.byte(0xff);
      } else {
        const raw = utf8.encode(item.value);
        writeHead(out, 3, BigInt(raw.length));
        out.bytes(raw);
      }
      return;
    case 'array':
      if (item.indefinite) out.byte(0x9f);
      else writeHead(out, 4, BigInt(item.items.length));
      for (const child of item.items) writeItem(out, child);
      if (item.indefinite) out.byte(0xff);
      return;
    case 'map':
      if (item.indefinite) out.byte(0xbf);
      else writeHead(out, 5, BigInt(item.entries.length));
      for (const [key, value] of item.entries) {
        writeItem(out, key);
        writeItem(out, value);
      }
      if (item.indefinite) out.byte(0xff);
      return;
    case 'tag':
      writeHead(out, 6, item.tag);
      writeItem(out, item.item);
      return;
    case 'float':
      writeFloat(out, item);
      return;
    case 'simple':
      if (item.value < 20) out.byte(0xe0 | item.value);
      else {
        out.byte(0xf8);
        out.byte(item.value);
      }
      return;
    case 'bool':
      out.byte(item.value ? 0xf5 : 0xf4);
      return;
    case 'null':
      out.byte(0xf6);
      return;
    case 'undefined':
      out.byte(0xf7);
      return;
  }
}

/**
 * Writes an item as CBOR. Heads and lengths are always the shortest, and a float without a recorded width is the
 * shortest of half, single and double precision that keeps its value (RFC 8949 section 4.1, preferred serialization).
 * An item read from an indefinite-length encoding, or with a recorded width, is written the way it was read.
 */
export function encodeCbor(item: CborItem): Uint8Array {
  const out = new ByteWriter();
  writeItem(out, item);
  return out.finish();
}

/** A bignum item for an integer outside the 64 bit range, in the shortest form (no leading zero bytes). */
export function bignumItem(value: bigint): CborItem {
  const negative = value < 0n;
  return {
    type: 'tag',
    tag: negative ? 3n : 2n,
    item: { type: 'bytes', value: bigintToBytes(negative ? -1n - value : value) },
  };
}
