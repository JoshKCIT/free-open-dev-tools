/** Input can be up to this many bytes (5 MiB); anything larger is refused before it is decoded. */
export const MAX_INPUT_BYTES = 5242880;
/** Arrays, maps and tags may nest this deep; one level deeper is refused with its byte offset. */
export const MAX_DEPTH = 256;

/**
 * Raised, with a plain message, for every expected failure: input that is not hex or Base64, bytes that are not valid
 * MessagePack or CBOR, JSON that cannot be written as either, and anything over a limit. `offset` is the byte offset in
 * the binary data a refusal is about (counted from 0), `path` says where in the value it happened, such as `$[2].a`.
 */
export class MsgpackCborError extends Error {
  readonly offset?: number;
  readonly path?: string;
  readonly line?: number;
  readonly column?: number;
  constructor(message: string, detail: { offset?: number; path?: string; line?: number; column?: number } = {}) {
    super(message);
    this.name = 'MsgpackCborError';
    if (detail.offset !== undefined) this.offset = detail.offset;
    if (detail.path !== undefined) this.path = detail.path;
    if (detail.line !== undefined) this.line = detail.line;
    if (detail.column !== undefined) this.column = detail.column;
  }
}

/** Formats a size the way the refusal sentences quote it. */
export function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  const units: [string, number][] = [
    ['MiB', 1048576],
    ['KiB', 1024],
  ];
  for (const [name, size] of units) {
    if (bytes >= size) return `${(bytes / size).toFixed(1)} ${name} (${bytes.toLocaleString('en-US')} bytes)`;
  }
  return `${bytes} bytes`;
}

/** The refusal for input over the limit, raised before any byte of it is decoded. */
export function tooLarge(bytes: number, what = 'The input'): MsgpackCborError {
  return new MsgpackCborError(
    `${what} is ${sizeWords(bytes)}. The limit is 5 MiB because the whole value is held in the page while it is converted.`,
  );
}

/**
 * The most characters of JSON text one conversion writes: 32 MiB. Indentation makes a deeply nested value much longer than
 * its bytes (255 levels and a million small numbers would be over 500 MB), so a value that would pass this is refused
 * before any text is built.
 */
export const MAX_OUTPUT_CHARS = 33554432;

/** A bignum or `$bigint` longer than this many digits is not turned into a number: the conversion would take too long. */
export const MAX_BIGINT_DIGITS = 20000;
/** The same limit in bytes for a CBOR bignum's byte string (8192 bytes hold at most 19,729 digits, under the digit limit). */
export const MAX_BIGNUM_BYTES = 8192;

const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * Reads bytes as UTF-8 text. A byte order mark stays in the text (it is data, not a marker), and bytes that are not
 * UTF-8 are refused naming `offset`, the byte where the string starts, instead of being replaced by U+FFFD.
 */
export function decodeUtf8(bytes: Uint8Array, offset: number, what: string): string {
  try {
    return strictUtf8.decode(bytes);
  } catch {
    throw new MsgpackCborError(`The ${what} starting at byte ${offset} is not valid UTF-8.`, { offset });
  }
}

/** The big endian bytes of a non-negative integer, with no leading zero byte (zero is one zero byte). */
export function bigintToBytes(value: bigint): Uint8Array {
  if (value === 0n) return new Uint8Array(1);
  let hex = value.toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** A growable byte buffer for the encoders. */
export class ByteWriter {
  private buffer = new Uint8Array(256);
  length = 0;

  private room(extra: number): void {
    if (this.length + extra <= this.buffer.length) return;
    let size = this.buffer.length;
    while (size < this.length + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buffer.subarray(0, this.length));
    this.buffer = next;
  }

  byte(value: number): void {
    this.room(1);
    this.buffer[this.length++] = value;
  }

  bytes(data: Uint8Array): void {
    this.room(data.length);
    this.buffer.set(data, this.length);
    this.length += data.length;
  }

  /** An unsigned integer of `size` bytes (1, 2, 4 or 8), big endian. */
  unsigned(value: bigint, size: 1 | 2 | 4 | 8): void {
    for (let shift = (size - 1) * 8; shift >= 0; shift -= 8) this.byte(Number((value >> BigInt(shift)) & 0xffn));
  }

  finish(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}
