import meta from './meta.json';

export { meta };

/** Input can be up to this many bytes (5 MiB); anything larger is refused before it is decoded. */
export const MAX_INPUT_BYTES = 5242880;
/** Nested-message guesses go down this many levels; a length-delimited field below that is shown as bytes. */
export const MAX_GUESS_DEPTH = 32;
/** At most this many fields are kept (with their readings); the rest are still read and counted. */
export const MAX_FIELDS = 50000;
/** The largest field number: 2 to the 29 minus 1 (Protocol Buffers Language Guide). */
const MAX_FIELD_NUMBER = 536870911;
/** How much of a long length-delimited field a reading shows. */
const PREVIEW_BYTES = 64;
const PREVIEW_CHARS = 200;
const PREVIEW_VALUES = 100;

/**
 * Raised, with a plain message, for every expected failure: bytes that are not a valid wire format, input over the
 * limit, and text that is not hex or Base64. `offset` is the byte (counted from 0) the failure is about; for text that
 * is not hex or Base64 it is the character position, counted from 1.
 */
export class ProtobufDecoderError extends Error {
  readonly offset: number;
  constructor(message: string, offset: number) {
    super(message);
    this.name = 'ProtobufDecoderError';
    this.offset = offset;
  }
}

export type WireType = 0 | 1 | 2 | 3 | 4 | 5;
export type WireName = 'VARINT' | 'I64' | 'LEN' | 'SGROUP' | 'EGROUP' | 'I32';
const WIRE_NAMES: WireName[] = ['VARINT', 'I64', 'LEN', 'SGROUP', 'EGROUP', 'I32'];

export interface ProtoReading {
  label: string;
  value: string;
}

export interface ProtoField {
  /** The field numbers from the top, joined by dots: `3.1` is field 1 inside field 3. */
  path: string;
  number: number;
  wireType: WireType;
  wireName: WireName;
  /** Where the field's tag starts, counted in bytes from the start of the input. */
  offset: number;
  /** Every reading the bytes allow; the first is the one a plain listing uses. */
  readings: ProtoReading[];
  /** The number of payload bytes, for a length-delimited field. */
  length?: number;
  /** The fields of a nested message (a guess) or of a group. */
  children?: ProtoField[];
}

export interface DecodeOptions {
  /** Try to read each length-delimited field as a nested message. */
  nested: boolean;
  /** Try to read each length-delimited field as a run of packed varints. */
  packed: boolean;
}

export interface DecodeInfo {
  fields: ProtoField[];
  /** How many fields the message holds, counting groups' fields and (up to the cap) nested messages' fields. */
  total: number;
  /** True when there were more than MAX_FIELDS fields and only the first MAX_FIELDS are kept. */
  truncated: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading hex and Base64

const isSpace = (code: number): boolean => code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
const hexValue = (code: number): number =>
  code >= 0x30 && code <= 0x39
    ? code - 0x30
    : code >= 0x61 && code <= 0x66
      ? code - 0x61 + 10
      : code >= 0x41 && code <= 0x46
        ? code - 0x41 + 10
        : -1;

function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MiB (${bytes.toLocaleString('en-US')} bytes)`;
  return `${(bytes / 1024).toFixed(1)} KiB (${bytes.toLocaleString('en-US')} bytes)`;
}

function tooLarge(bytes: number): ProtobufDecoderError {
  return new ProtobufDecoderError(
    `The input is ${sizeWords(bytes)}. The limit is 5 MiB because the whole message is held in the page while it is decoded.`,
    0,
  );
}

function readHex(text: string): Uint8Array {
  // First pass: check every character and count the digits, keeping nothing, so a refusal costs no allocation.
  let digits = 0;
  let run = 0;
  const endRun = (lastDigit: number): void => {
    if (run % 2 === 1) {
      throw new ProtobufDecoderError(
        `A byte is two hex digits, but the digit at character ${lastDigit} has no partner. Write pairs such as 08 96 01.`,
        lastDigit,
      );
    }
    run = 0;
  };
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (isSpace(code)) {
      endRun(index);
      continue;
    }
    if (hexValue(code) < 0) {
      throw new ProtobufDecoderError(
        `The text holds ${JSON.stringify(text[index])} at character ${index + 1}, which is not a hex digit. Use pairs of the digits 0 to 9 and a to f, or choose Base64.`,
        index + 1,
      );
    }
    run++;
    digits++;
  }
  endRun(text.length);
  if (digits / 2 > MAX_INPUT_BYTES) throw tooLarge(digits / 2);
  // Second pass: fill the bytes.
  const bytes = new Uint8Array(digits / 2);
  let filled = 0;
  let high = -1;
  for (let index = 0; index < text.length; index++) {
    const value = hexValue(text.charCodeAt(index));
    if (value < 0) continue;
    if (high < 0) high = value;
    else {
      bytes[filled++] = (high << 4) | value;
      high = -1;
    }
  }
  return bytes;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function readBase64(text: string): Uint8Array {
  const values: number[] = [];
  let padding = 0;
  for (let index = 0; index < text.length; index++) {
    if (isSpace(text.charCodeAt(index))) continue;
    const char = text[index]!;
    if (char === '=') {
      padding++;
      continue;
    }
    if (padding > 0) {
      throw new ProtobufDecoderError(
        `The Base64 text holds ${JSON.stringify(char)} at character ${index + 1} after its = padding. Padding comes only at the end.`,
        index + 1,
      );
    }
    const mapped = char === '-' ? 62 : char === '_' ? 63 : BASE64.indexOf(char);
    if (mapped < 0) {
      throw new ProtobufDecoderError(
        `The text holds ${JSON.stringify(char)} at character ${index + 1}, which is not a Base64 character. Use A to Z, a to z, 0 to 9, + and /, or choose hex.`,
        index + 1,
      );
    }
    // Refuse before the list can grow past the limit.
    if (Math.floor(((values.length + 1) * 3) / 4) > MAX_INPUT_BYTES)
      throw tooLarge(Math.floor(((values.length + 1) * 3) / 4));
    values.push(mapped);
  }
  const count = values.length;
  if (count % 4 === 1) {
    throw new ProtobufDecoderError(
      'The Base64 text has one character too many or too few: its length cannot be right.',
      text.length,
    );
  }
  if (padding > 2 || (padding > 0 && (count + padding) % 4 !== 0)) {
    throw new ProtobufDecoderError('The Base64 padding (=) does not match the length of the text.', text.length);
  }
  const bytes = new Uint8Array(Math.floor((count * 3) / 4));
  let out = 0;
  for (let i = 0; i < count; i += 4) {
    const triple =
      (values[i]! << 18) | ((values[i + 1] ?? 0) << 12) | ((values[i + 2] ?? 0) << 6) | (values[i + 3] ?? 0);
    if (out < bytes.length) bytes[out++] = (triple >> 16) & 255;
    if (out < bytes.length) bytes[out++] = (triple >> 8) & 255;
    if (out < bytes.length) bytes[out++] = triple & 255;
  }
  return bytes;
}

/** Refuses a size over 5 MiB, so a file can be refused before a byte of it is read. */
export function checkInputSize(size: number): void {
  if (size > MAX_INPUT_BYTES) throw tooLarge(size);
}

/** Reads pasted hex (pairs of digits, spaces and line breaks allowed) or Base64 as bytes. */
export function readInputBytes(text: string, encoding: 'hex' | 'base64'): Uint8Array {
  return encoding === 'hex' ? readHex(text) : readBase64(text);
}

// ---------------------------------------------------------------------------------------------------------------------
// The wire format

/** Thrown, not as an Error (no stack to build), when a guess that a field is a message turns out wrong. */
const GUESS_FAILED = { guess: 'failed' };

interface Context {
  bytes: Uint8Array;
  view: DataView;
  options: DecodeOptions;
  /** Fields kept so far, and fields counted so far. */
  materialized: number;
  total: number;
}

function fail(strict: boolean, message: string, offset: number): never {
  if (strict) throw new ProtobufDecoderError(message, offset);
  throw GUESS_FAILED;
}

const TRUNCATED = -1;
const TOO_LONG = -2;
const OVERFLOW = -3;

/**
 * Where the varint that starts at `pos` ends (the index after its last byte), or a negative code: it runs past `end`,
 * it is longer than 10 bytes, or its 10th byte is above 1 so it holds more than 64 bits.
 */
function varintEnd(bytes: Uint8Array, pos: number, end: number): number {
  for (let i = 0; i < 10; i++) {
    if (pos + i >= end) return TRUNCATED;
    const byte = bytes[pos + i]!;
    if ((byte & 0x80) === 0) return i === 9 && byte > 1 ? OVERFLOW : pos + i + 1;
  }
  return TOO_LONG;
}

function varintValue(bytes: Uint8Array, pos: number, next: number): bigint {
  if (next - pos <= 4) {
    let small = 0;
    for (let i = next - 1; i >= pos; i--) small = small * 128 + (bytes[i]! & 0x7f);
    return BigInt(small);
  }
  let value = 0n;
  for (let i = next - 1; i >= pos; i--) value = (value << 7n) | BigInt(bytes[i]! & 0x7f);
  return value;
}

function varintNumber(bytes: Uint8Array, pos: number, next: number): number {
  let value = 0;
  for (let i = next - 1; i >= pos; i--) value = value * 128 + (bytes[i]! & 0x7f);
  return value;
}

/**
 * Refuses a varint that cannot be read, naming the byte it starts at. A varint with no byte at all (the input ends right
 * after a tag) names the start of the field instead, since there is no varint to point at.
 */
function varintProblem(code: number, pos: number, end: number, fieldStart: number, strict: boolean): never {
  if (code === TRUNCATED && pos >= end) {
    fail(
      strict,
      `The input ends right after the tag of the field that starts at byte ${fieldStart}: its value is missing.`,
      fieldStart,
    );
  }
  if (code === TRUNCATED) fail(strict, `The input ends inside the varint that starts at byte ${pos}.`, pos);
  if (code === TOO_LONG) {
    fail(strict, `The varint at byte ${pos} is longer than 10 bytes, which no 64 bit number needs.`, pos);
  }
  return fail(strict, `The 10 byte varint at byte ${pos} holds more than 64 bits: its last byte is above 1.`, pos);
}

/** The shortest decimal text that reads back as the same single precision number. */
function floatText(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  if (value === 0) return Object.is(value, -0) ? '-0' : '0';
  for (let precision = 1; precision <= 9; precision++) {
    const text = value.toPrecision(precision);
    if (Math.fround(Number(text)) === value) return String(Number(text));
  }
  return String(value);
}

function doubleText(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  return Object.is(value, -0) ? '-0' : String(value);
}

const hexByte = (value: number): string => value.toString(16).padStart(2, '0');

function bytesText(bytes: Uint8Array, start: number, end: number): string {
  const shown = Math.min(end - start, PREVIEW_BYTES);
  const parts: string[] = [];
  for (let i = 0; i < shown; i++) parts.push(hexByte(bytes[start + i]!));
  const text = parts.join(' ');
  return end - start > PREVIEW_BYTES ? `${text} … (${(end - start).toLocaleString('en-US')} bytes in all)` : text;
}

/** True when the bytes are valid UTF-8 holding no control characters other than tab, line feed and carriage return. */
function isPrintableUtf8(bytes: Uint8Array, start: number, end: number): boolean {
  let i = start;
  while (i < end) {
    const b = bytes[i]!;
    if (b < 0x80) {
      if ((b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) || b === 0x7f) return false;
      i++;
    } else if (b < 0xc2) {
      return false;
    } else if (b < 0xe0) {
      if (i + 1 >= end || (bytes[i + 1]! & 0xc0) !== 0x80) return false;
      // U+0080 to U+009F are control characters.
      if (b === 0xc2 && bytes[i + 1]! < 0xa0) return false;
      i += 2;
    } else if (b < 0xf0) {
      if (i + 2 >= end || (bytes[i + 1]! & 0xc0) !== 0x80 || (bytes[i + 2]! & 0xc0) !== 0x80) return false;
      if (b === 0xe0 && bytes[i + 1]! < 0xa0) return false; // overlong
      if (b === 0xed && bytes[i + 1]! >= 0xa0) return false; // a surrogate
      i += 3;
    } else if (b < 0xf5) {
      if (
        i + 3 >= end ||
        (bytes[i + 1]! & 0xc0) !== 0x80 ||
        (bytes[i + 2]! & 0xc0) !== 0x80 ||
        (bytes[i + 3]! & 0xc0) !== 0x80
      ) {
        return false;
      }
      if (b === 0xf0 && bytes[i + 1]! < 0x90) return false; // overlong
      if (b === 0xf4 && bytes[i + 1]! >= 0x90) return false; // past U+10FFFF
      i += 4;
    } else {
      return false;
    }
  }
  return true;
}

const utf8 = new TextDecoder('utf-8', { ignoreBOM: true });

/** The text of the first part of valid UTF-8 bytes, cut at a character and marked when cut. */
function textPreview(bytes: Uint8Array, start: number, end: number): string {
  let cut = Math.min(end, start + PREVIEW_CHARS * 4);
  while (cut < end && cut > start && (bytes[cut]! & 0xc0) === 0x80) cut--;
  const characters = Array.from(utf8.decode(bytes.subarray(start, cut)));
  const more = cut < end || characters.length > PREVIEW_CHARS;
  return characters.slice(0, PREVIEW_CHARS).join('') + (more ? '…' : '');
}

/** The varints of a payload that is nothing but varints, or null when it is not. */
function scanPacked(
  bytes: Uint8Array,
  start: number,
  end: number,
): { count: number; shown: bigint[]; wide: boolean } | null {
  const shown: bigint[] = [];
  let count = 0;
  let wide = false;
  let pos = start;
  while (pos < end) {
    const next = varintEnd(bytes, pos, end);
    if (next < 0) return null;
    if (count < PREVIEW_VALUES) shown.push(varintValue(bytes, pos, next));
    // A 10 byte varint has its 64th bit set, so as a signed number it is negative.
    if (next - pos === 10) wide = true;
    count++;
    pos = next;
  }
  return { count, shown, wide };
}

function listText(values: bigint[], count: number): string {
  const list = values.join(', ');
  return count > values.length ? `${list}, … (${count.toLocaleString('en-US')} values in all)` : list;
}

function plural(count: number, word: string): string {
  return `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * Reads the fields of one message that lies between `start` and `end`. `depth` is how deep this message is (the top is
 * 0). `group` is the field number of the group this message is the inside of, or null; the group's start byte is
 * `groupStart`. `strict` is true for the real message, where a problem is refused with its offset, and false for a
 * guess, where a problem only means the guess was wrong.
 */
function readFields(
  ctx: Context,
  start: number,
  end: number,
  depth: number,
  parentPath: string,
  group: number | null,
  groupStart: number,
  strict: boolean,
): { fields: ProtoField[]; next: number } {
  const { bytes, view } = ctx;
  const fields: ProtoField[] = [];
  let pos = start;
  while (pos < end) {
    const fieldStart = pos;
    const tagEnd = varintEnd(bytes, pos, end);
    if (tagEnd < 0) varintProblem(tagEnd, pos, end, fieldStart, strict);
    // A tag longer than 5 bytes holds 36 bits or more, which is a field number over 2 to the 29 minus 1.
    const tag = tagEnd - pos <= 5 ? varintNumber(bytes, pos, tagEnd) : Infinity;
    const number = Math.floor(tag / 8);
    const wire = tag % 8;
    if (number === 0) {
      fail(strict, `Field number 0 at byte ${fieldStart} is not allowed: field numbers start at 1.`, fieldStart);
    }
    if (number > MAX_FIELD_NUMBER) {
      fail(
        strict,
        `The field number at byte ${fieldStart} is too large: the largest is ${MAX_FIELD_NUMBER.toLocaleString('en-US')}.`,
        fieldStart,
      );
    }
    if (wire === 6 || wire === 7) {
      fail(
        strict,
        `Field ${number} at byte ${fieldStart} has wire type ${wire}, which Protocol Buffers does not define. The types are 0 to 5.`,
        fieldStart,
      );
    }
    pos = tagEnd;
    const path = parentPath === '' ? String(number) : `${parentPath}.${number}`;

    if (wire === 4) {
      if (group === null) {
        fail(
          strict,
          `The end group for field ${number} at byte ${fieldStart} has no start group before it.`,
          fieldStart,
        );
      }
      if (number !== group) {
        fail(
          strict,
          `The end group at byte ${fieldStart} is for field ${number}, but the group that started at byte ${groupStart} is for field ${group}.`,
          fieldStart,
        );
      }
      return { fields, next: pos };
    }

    ctx.total++;
    const keep = ctx.materialized < MAX_FIELDS;
    if (keep) ctx.materialized++;
    let readings: ProtoReading[] = [];
    let length: number | undefined;
    let children: ProtoField[] | undefined;

    if (wire === 0) {
      const next = varintEnd(bytes, pos, end);
      if (next < 0) varintProblem(next, pos, end, fieldStart, strict);
      if (keep) {
        const value = varintValue(bytes, pos, next);
        const signed = BigInt.asIntN(64, value);
        const zigzag = (value >> 1n) ^ -(value & 1n);
        readings = [
          { label: 'Unsigned', value: value.toString() },
          { label: 'Signed', value: signed.toString() },
          { label: 'Zigzag', value: zigzag.toString() },
        ];
      }
      pos = next;
    } else if (wire === 1 || wire === 5) {
      const size = wire === 1 ? 8 : 4;
      if (end - pos < size) {
        fail(
          strict,
          `The input ends inside the ${size * 8} bit value of the field that starts at byte ${fieldStart}: it needs ${size} bytes and ${end - pos} ${end - pos === 1 ? 'is' : 'are'} left.`,
          fieldStart,
        );
      }
      if (keep) {
        const at = pos;
        readings =
          wire === 1
            ? [
                { label: 'Unsigned integer', value: view.getBigUint64(at, true).toString() },
                { label: 'Signed integer', value: view.getBigInt64(at, true).toString() },
                { label: 'Double', value: doubleText(view.getFloat64(at, true)) },
              ]
            : [
                { label: 'Unsigned integer', value: view.getUint32(at, true).toString() },
                { label: 'Signed integer', value: view.getInt32(at, true).toString() },
                { label: 'Float', value: floatText(view.getFloat32(at, true)) },
              ];
      }
      pos += size;
    } else if (wire === 2) {
      const lengthEnd = varintEnd(bytes, pos, end);
      if (lengthEnd < 0) varintProblem(lengthEnd, pos, end, fieldStart, strict);
      const declared = varintNumber(bytes, pos, lengthEnd);
      // The length as the exact whole number, for the refusal: a double holds only 53 bits.
      const exactLength = varintValue(bytes, pos, lengthEnd);
      pos = lengthEnd;
      if (declared > end - pos) {
        fail(
          strict,
          `The field starting at byte ${fieldStart} declares ${exactLength.toLocaleString('en-US')} ${declared === 1 ? 'byte' : 'bytes'} but only ${(end - pos).toLocaleString('en-US')} ${end - pos === 1 ? 'is' : 'are'} left.`,
          fieldStart,
        );
      }
      length = declared;
      const payloadEnd = pos + declared;
      if (keep) {
        // Try the payload as a message first (it costs nothing when it is not one), then collect every reading.
        if (ctx.options.nested && declared > 0 && depth + 1 <= MAX_GUESS_DEPTH) {
          const savedTotal = ctx.total;
          const savedMaterialized = ctx.materialized;
          try {
            children = readFields(ctx, pos, payloadEnd, depth + 1, path, null, -1, false).fields;
          } catch (err) {
            if (err !== GUESS_FAILED) throw err;
            ctx.total = savedTotal;
            ctx.materialized = savedMaterialized;
            children = undefined;
          }
        }
        if (isPrintableUtf8(bytes, pos, payloadEnd)) {
          readings.push({ label: 'Text', value: textPreview(bytes, pos, payloadEnd) });
        }
        if (children !== undefined) {
          readings.push({ label: 'Nested message', value: plural(children.length, 'field') });
        }
        if (ctx.options.packed && declared > 0) {
          const packed = scanPacked(bytes, pos, payloadEnd);
          if (packed !== null) {
            readings.push({ label: 'Packed varints', value: listText(packed.shown, packed.count) });
            if (packed.wide) {
              readings.push({
                label: 'Packed varints (signed)',
                value: listText(
                  packed.shown.map((v) => BigInt.asIntN(64, v)),
                  packed.count,
                ),
              });
            }
          }
        }
        readings.push({ label: 'Bytes', value: bytesText(bytes, pos, payloadEnd) });
      }
      pos = payloadEnd;
    } else {
      // Wire type 3: a group, which runs to the end group with the same field number.
      if (depth + 1 > MAX_GUESS_DEPTH) {
        fail(
          strict,
          `Groups nest more than ${MAX_GUESS_DEPTH} levels deep: the group at byte ${fieldStart} is too deep.`,
          fieldStart,
        );
      }
      const inside = readFields(ctx, pos, end, depth + 1, path, number, fieldStart, strict);
      children = inside.fields;
      pos = inside.next;
      if (keep) readings = [{ label: 'Group', value: plural(children.length, 'field') }];
    }

    if (keep) {
      const field: ProtoField = {
        path,
        number,
        wireType: wire as WireType,
        wireName: WIRE_NAMES[wire]!,
        offset: fieldStart,
        readings,
      };
      if (length !== undefined) field.length = length;
      if (children !== undefined) field.children = children;
      fields.push(field);
    }
  }
  if (group !== null) {
    fail(
      strict,
      `The group for field ${group} that starts at byte ${groupStart} never ends: the input has no end group for it.`,
      groupStart,
    );
  }
  return { fields, next: pos };
}

/** Decodes one message, saying also how many fields it held and whether the list was cut at MAX_FIELDS. */
export function decodeProtobufInfo(bytes: Uint8Array, options: DecodeOptions): DecodeInfo {
  if (bytes.length > MAX_INPUT_BYTES) throw tooLarge(bytes.length);
  if (bytes.length === 0) return { fields: [], total: 0, truncated: false };
  const ctx: Context = {
    bytes,
    view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    options,
    materialized: 0,
    total: 0,
  };
  const { fields } = readFields(ctx, 0, bytes.length, 0, '', null, -1, true);
  return { fields, total: ctx.total, truncated: ctx.total > ctx.materialized };
}

/**
 * Decodes one message into its fields without a schema. Each field has its number, wire type, byte offset and every
 * reading its bytes allow; a length-delimited field that parses completely as fields also has them as `children` when
 * `nested` is on, and shows packed varints when `packed` is on. Bytes that are not a valid wire format are refused with
 * the offset of the problem.
 */
export function decodeProtobuf(bytes: Uint8Array, options: DecodeOptions): ProtoField[] {
  return decodeProtobufInfo(bytes, options).fields;
}

function listing(fields: ProtoField[], indent: string, lines: string[]): void {
  for (const field of fields) {
    const first = field.readings[0];
    if (field.children !== undefined && (field.wireType === 3 || first?.label === 'Nested message')) {
      lines.push(`${indent}${field.number} {`);
      listing(field.children, `${indent}  `, lines);
      lines.push(`${indent}}`);
      continue;
    }
    if (first === undefined) continue;
    let value: string;
    switch (first.label) {
      case 'Text':
        value = JSON.stringify(first.value);
        break;
      case 'Bytes':
        value = `bytes ${first.value}`.trimEnd();
        break;
      case 'Packed varints':
        value = `[${first.value}]`;
        break;
      default:
        value = first.value;
    }
    lines.push(`${indent}${field.number}: ${value}`);
  }
}

/**
 * The fields as a plain listing in the style of a raw decode: `1: 150`, a quoted string for text, `bytes 00 01 ff` for
 * bytes, `[1, 2, 3]` for packed varints and an indented `3 { ... }` block for a message or group. Each field is written
 * with its first reading.
 */
export function formatDecodeRaw(fields: ProtoField[]): string {
  const lines: string[] = [];
  listing(fields, '', lines);
  return lines.join('\n');
}
