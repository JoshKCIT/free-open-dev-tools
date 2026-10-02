import { MAX_DEPTH, MsgpackCborError } from './common';

/**
 * One CBOR data item (RFC 8949 section 3). Integers are `bigint` so the whole 64 bit range is exact.
 */
export type CborItem =
  { type: 'int'; value: bigint } | { type: 'bytes'; value: Uint8Array } | { type: 'tag'; tag: bigint; item: CborItem };

interface Head {
  /** Major type, 0 to 7. */
  major: number;
  /** Additional information, 0 to 31. */
  info: number;
  /** The argument, or null when the head is indefinite (additional information 31). */
  argument: bigint | null;
  /** Where the head starts. */
  offset: number;
}

class Reader {
  position = 0;
  constructor(readonly bytes: Uint8Array) {}

  /** Reads `count` bytes, or refuses naming the byte where the input ends. */
  take(count: number, what: string, from: number): Uint8Array {
    if (count > this.bytes.length - this.position) {
      throw new MsgpackCborError(
        `The input ends inside ${what}: it needs ${count.toLocaleString('en-US')} more ${count === 1 ? 'byte' : 'bytes'} but only ${(this.bytes.length - this.position).toLocaleString('en-US')} ${this.bytes.length - this.position === 1 ? 'is' : 'are'} left (item starts at byte ${from}).`,
        { offset: from },
      );
    }
    const slice = this.bytes.subarray(this.position, this.position + count);
    this.position += count;
    return slice;
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
      const raw = this.take(size, 'the length or value of an item', offset);
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

function readItem(reader: Reader, depth: number): CborItem {
  const head = reader.head();
  if (depth > MAX_DEPTH) {
    throw new MsgpackCborError(`The value nests more than ${MAX_DEPTH} levels deep at byte ${head.offset}.`, {
      offset: head.offset,
    });
  }
  if (head.major === 0) {
    if (head.argument === null) throw indefiniteNotAllowed(head);
    return { type: 'int', value: head.argument };
  }
  if (head.major === 1) {
    if (head.argument === null) throw indefiniteNotAllowed(head);
    return { type: 'int', value: -1n - head.argument };
  }
  if (head.major === 2) {
    if (head.argument === null) {
      throw new MsgpackCborError(`Byte ${head.offset}: an indefinite-length byte string is not read here yet.`, {
        offset: head.offset,
      });
    }
    return { type: 'bytes', value: reader.take(Number(head.argument), 'a byte string', head.offset) };
  }
  if (head.major === 6) {
    if (head.argument === null) throw indefiniteNotAllowed(head);
    return { type: 'tag', tag: head.argument, item: readItem(reader, depth + 1) };
  }
  throw new MsgpackCborError(`Byte ${head.offset}: major type ${head.major} is not read here yet.`, {
    offset: head.offset,
  });
}

function indefiniteNotAllowed(head: Head): MsgpackCborError {
  return new MsgpackCborError(
    `Byte ${head.offset}: major type ${head.major} cannot be indefinite-length (additional information 31).`,
    { offset: head.offset },
  );
}

/** Decodes exactly one CBOR item. Bytes left over after it are refused with their offset. */
export function decodeCbor(bytes: Uint8Array): CborItem {
  const reader = new Reader(bytes);
  const item = readItem(reader, 0);
  if (reader.position < bytes.length) {
    throw new MsgpackCborError(
      `The item ends at byte ${reader.position}, but ${(bytes.length - reader.position).toLocaleString('en-US')} more ${bytes.length - reader.position === 1 ? 'byte follows' : 'bytes follow'} it. Convert one item at a time.`,
      { offset: reader.position },
    );
  }
  return item;
}
