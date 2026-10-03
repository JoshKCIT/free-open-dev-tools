/**
 * A strict DER reader (ITU-T X.690, with the profile of RFC 5280). This file is the canonical copy: the certificate
 * decoder keeps a byte for byte copy of it (never an import across tool folders), so a change is made here first and
 * copied afterwards.
 *
 * Definite lengths only, written in their shortest form; every length is checked against the bytes that remain before
 * any slice is taken; tag numbers are in their minimal form; nesting stops at 24 levels and the element count at
 * 200,000, so a hostile input costs a bounded amount of time and memory. Every failure is a DerError whose message
 * names a byte offset and the problem.
 *
 * RULE, stated once and enforced by a test: no message thrown or returned from this file may ever contain a fragment
 * of a key, a secret, or a token. Describe the shape of the problem, never the content.
 */

export class DerError extends Error {
  /** Index of the byte where the problem was found. */
  readonly offset: number;
  constructor(message: string, offset: number) {
    super(message);
    this.name = 'DerError';
    this.offset = offset;
  }
}

export type DerClass = 'universal' | 'application' | 'context' | 'private';

export interface DerNode {
  tag: number;
  cls: DerClass;
  constructed: boolean;
  /** Index of the first byte of the element (its tag). */
  start: number;
  headerLength: number;
  /** Number of content bytes. */
  length: number;
  /** Index just after the last content byte. */
  end: number;
  children: DerNode[];
}

export const DER_LIMITS = { maxDepth: 24, maxNodes: 200000 };

export interface DerOptions {
  maxDepth?: number;
  maxNodes?: number;
  /** Accept bytes after the one element, for a caller that reads several in a row. */
  allowTrailing?: boolean;
}

const CLASSES: DerClass[] = ['universal', 'application', 'context', 'private'];

interface ReadState {
  nodes: number;
  maxDepth: number;
  maxNodes: number;
}

function readNode(bytes: Uint8Array, from: number, limit: number, depth: number, state: ReadState): DerNode {
  if (depth > state.maxDepth) {
    throw new DerError(`Elements are nested too deeply (more than ${state.maxDepth} levels) at offset ${from}.`, from);
  }
  state.nodes++;
  if (state.nodes > state.maxNodes) {
    throw new DerError(`Too many elements (more than ${state.maxNodes}) at offset ${from}.`, from);
  }
  if (from >= limit) throw new DerError(`The data ends where an element should start, at offset ${from}.`, from);
  let at = from;
  const first = bytes[at++]!;
  const cls = CLASSES[first >> 6]!;
  const constructed = (first & 0x20) !== 0;
  let tag = first & 0x1f;
  if (tag === 0x1f) {
    // High tag number form: 7 bits per octet, the last octet has its top bit clear, and the number must be 31 or more.
    tag = 0;
    let octets = 0;
    for (;;) {
      if (at >= limit) throw new DerError(`The data ends inside a tag number at offset ${at}.`, at);
      const octet = bytes[at++]!;
      if (octets === 0 && octet === 0x80) {
        throw new DerError(
          `The tag number at offset ${from} starts with a padding octet, so it is not in minimal form.`,
          from,
        );
      }
      octets++;
      if (octets > 4) throw new DerError(`The tag number at offset ${from} is too large.`, from);
      tag = tag * 128 + (octet & 0x7f);
      if ((octet & 0x80) === 0) break;
    }
    if (tag < 31) {
      throw new DerError(`The tag number at offset ${from} uses the long form for a number below 31.`, from);
    }
  }
  if (at >= limit) throw new DerError(`The data ends where a length should start, at offset ${at}.`, at);
  const lengthOffset = at;
  const lengthOctet = bytes[at++]!;
  let length = lengthOctet;
  if (lengthOctet === 0x80) {
    throw new DerError(`The length at offset ${lengthOffset} is indefinite, which DER does not allow.`, lengthOffset);
  }
  if (lengthOctet > 0x80) {
    const count = lengthOctet & 0x7f;
    if (lengthOctet === 0xff || count > 4) {
      throw new DerError(`The length at offset ${lengthOffset} is too large to be real.`, lengthOffset);
    }
    if (at + count > limit) throw new DerError(`The data ends inside a length at offset ${at}.`, at);
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + bytes[at + i]!;
    if (bytes[at]! === 0 || length < 128) {
      throw new DerError(`The length at offset ${lengthOffset} is not written in its shortest form.`, lengthOffset);
    }
    at += count;
  }
  // The length is compared with what remains before anything is sliced or allocated.
  if (length > limit - at) {
    throw new DerError(`The length at offset ${lengthOffset} runs past the end of the data.`, from);
  }
  const node: DerNode = {
    tag,
    cls,
    constructed,
    start: from,
    headerLength: at - from,
    length,
    end: at + length,
    children: [],
  };
  if (constructed) {
    let cursor = at;
    while (cursor < node.end) {
      const child = readNode(bytes, cursor, node.end, depth + 1, state);
      node.children.push(child);
      cursor = child.end;
    }
  }
  return node;
}

/** Reads the one DER element that fills `bytes`, with its whole tree of children. */
export function readDer(bytes: Uint8Array, options: DerOptions = {}): DerNode {
  const state: ReadState = {
    nodes: 0,
    maxDepth: options.maxDepth ?? DER_LIMITS.maxDepth,
    maxNodes: options.maxNodes ?? DER_LIMITS.maxNodes,
  };
  const root = readNode(bytes, 0, bytes.length, 1, state);
  if (root.end !== bytes.length && !options.allowTrailing) {
    throw new DerError(
      `There are ${bytes.length - root.end} extra bytes after the element, from offset ${root.end}.`,
      root.end,
    );
  }
  return root;
}

/** The content bytes of an element, without its tag and length. */
export function derContent(bytes: Uint8Array, node: DerNode): Uint8Array {
  return bytes.subarray(node.start + node.headerLength, node.end);
}

/** The child at `index`, with the index checked before it is read. */
export function derChild(node: DerNode, index: number): DerNode {
  const child = Number.isInteger(index) && index >= 0 ? node.children[index] : undefined;
  if (child === undefined) {
    throw new DerError(
      `Expected element number ${index + 1} inside the element at offset ${node.start}, but it holds ${node.children.length}.`,
      node.start,
    );
  }
  return child;
}

const UNIVERSAL_NAMES = new Map<number, string>([
  [1, 'BOOLEAN'],
  [2, 'INTEGER'],
  [3, 'BIT STRING'],
  [4, 'OCTET STRING'],
  [5, 'NULL'],
  [6, 'OBJECT IDENTIFIER'],
  [12, 'UTF8String'],
  [16, 'SEQUENCE'],
  [17, 'SET'],
  [18, 'NumericString'],
  [19, 'PrintableString'],
  [20, 'TeletexString'],
  [22, 'IA5String'],
  [23, 'UTCTime'],
  [24, 'GeneralizedTime'],
  [26, 'VisibleString'],
  [28, 'UniversalString'],
  [30, 'BMPString'],
]);

function nameOfTag(tag: number, cls: DerClass): string {
  if (cls === 'universal') return UNIVERSAL_NAMES.get(tag) ?? `tag ${tag}`;
  return `${cls} tag ${tag}`;
}

/** Checks the tag, class and (when given) the constructed bit of an element. */
export function derExpect(node: DerNode, tag: number, cls: DerClass = 'universal', constructed?: boolean): void {
  if (node.tag !== tag || node.cls !== cls) {
    throw new DerError(
      `Expected ${nameOfTag(tag, cls)} at offset ${node.start}, found ${nameOfTag(node.tag, node.cls)}.`,
      node.start,
    );
  }
  if (constructed !== undefined && node.constructed !== constructed) {
    throw new DerError(
      `Expected ${constructed ? 'a constructed' : 'a primitive'} ${nameOfTag(tag, cls)} at offset ${node.start}.`,
      node.start,
    );
  }
}

/** The exact content octets of an INTEGER, for a serial number. */
export function derIntegerContent(bytes: Uint8Array, node: DerNode): Uint8Array {
  derExpect(node, 2, 'universal', false);
  const content = derContent(bytes, node);
  if (content.length === 0) throw new DerError(`The INTEGER at offset ${node.start} is empty.`, node.start);
  return content;
}

/** The magnitude of a non-negative INTEGER: the sign octet and any padding zeros removed, one byte kept at least. */
export function derUnsigned(bytes: Uint8Array, node: DerNode): Uint8Array {
  const content = derIntegerContent(bytes, node);
  if ((content[0]! & 0x80) !== 0) throw new DerError(`The INTEGER at offset ${node.start} is negative.`, node.start);
  let skip = 0;
  while (skip < content.length - 1 && content[skip] === 0) skip++;
  return content.subarray(skip);
}

const MAX_OID_BYTES = 512;

/** A dotted object identifier. Arcs are read as BigInt, so one above 2 to the 64 stays exact. */
export function derOid(bytes: Uint8Array, node: DerNode): string {
  derExpect(node, 6, 'universal', false);
  const content = derContent(bytes, node);
  if (content.length === 0) throw new DerError(`The object identifier at offset ${node.start} is empty.`, node.start);
  if (content.length > MAX_OID_BYTES) {
    throw new DerError(
      `The object identifier at offset ${node.start} is longer than ${MAX_OID_BYTES} bytes.`,
      node.start,
    );
  }
  if ((content[content.length - 1]! & 0x80) !== 0) {
    throw new DerError(`The object identifier at offset ${node.start} ends in the middle of an arc.`, node.start);
  }
  const arcs: bigint[] = [];
  let value = 0n;
  let fresh = true;
  for (const octet of content) {
    if (fresh && octet === 0x80) {
      throw new DerError(
        `The object identifier at offset ${node.start} has an arc that starts with a padding octet.`,
        node.start,
      );
    }
    fresh = false;
    value = (value << 7n) | BigInt(octet & 0x7f);
    if ((octet & 0x80) === 0) {
      if (arcs.length === 0) {
        const first = value < 40n ? 0n : value < 80n ? 1n : 2n;
        arcs.push(first, value - first * 40n);
      } else {
        arcs.push(value);
      }
      value = 0n;
      fresh = true;
    }
  }
  return arcs.join('.');
}

export function derBitString(bytes: Uint8Array, node: DerNode): { unusedBits: number; bytes: Uint8Array } {
  derExpect(node, 3, 'universal', false);
  const content = derContent(bytes, node);
  const unusedBits = content[0];
  if (unusedBits === undefined) throw new DerError(`The BIT STRING at offset ${node.start} is empty.`, node.start);
  if (unusedBits > 7 || (content.length === 1 && unusedBits !== 0)) {
    throw new DerError(`The BIT STRING at offset ${node.start} gives an impossible number of unused bits.`, node.start);
  }
  return { unusedBits, bytes: content.subarray(1) };
}

export function derBoolean(bytes: Uint8Array, node: DerNode): boolean {
  derExpect(node, 1, 'universal', false);
  const content = derContent(bytes, node);
  if (content.length !== 1 || (content[0] !== 0x00 && content[0] !== 0xff)) {
    throw new DerError(`The BOOLEAN at offset ${node.start} must be one byte, 00 or ff.`, node.start);
  }
  return content[0] === 0xff;
}

function digits(content: Uint8Array, from: number, count: number): number {
  let value = 0;
  for (let i = from; i < from + count; i++) {
    const digit = content[i]! - 48;
    if (digit < 0 || digit > 9) return -1;
    value = value * 10 + digit;
  }
  return value;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/**
 * UTCTime (a two digit year of 50 or more is 19YY, below 50 is 20YY) and GeneralizedTime, both in the Z form that
 * RFC 5280 section 4.1.2.5 requires: YYMMDDHHMMSSZ and YYYYMMDDHHMMSSZ.
 */
export function derTime(bytes: Uint8Array, node: DerNode): { iso: string; epochMs: number } {
  if (node.cls !== 'universal' || node.constructed || (node.tag !== 23 && node.tag !== 24)) {
    throw new DerError(`Expected a UTCTime or GeneralizedTime at offset ${node.start}.`, node.start);
  }
  const content = derContent(bytes, node);
  const generalized = node.tag === 24;
  const name = generalized ? 'GeneralizedTime' : 'UTCTime';
  const yearDigits = generalized ? 4 : 2;
  const expected = yearDigits + 10 + 1;
  if (content.length !== expected || content[expected - 1] !== 0x5a) {
    throw new DerError(
      `The ${name} at offset ${node.start} is not in the form RFC 5280 requires, ending in Z.`,
      node.start,
    );
  }
  const yearValue = digits(content, 0, yearDigits);
  const month = digits(content, yearDigits, 2);
  const day = digits(content, yearDigits + 2, 2);
  const hour = digits(content, yearDigits + 4, 2);
  const minute = digits(content, yearDigits + 6, 2);
  const second = digits(content, yearDigits + 8, 2);
  const year = generalized ? yearValue : yearValue >= 50 ? 1900 + yearValue : 2000 + yearValue;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  const valid =
    yearValue >= 0 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  if (!valid) throw new DerError(`The ${name} at offset ${node.start} is not a real date and time.`, node.start);
  return {
    iso: `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}Z`,
    epochMs: date.getTime(),
  };
}

const REPLACEMENT = String.fromCodePoint(0xfffd);

/**
 * Any of the character string types a name can use. A byte that does not belong to the type becomes U+FFFD and the
 * result says `replaced: true`; nothing here throws on bad text.
 */
export function derString(bytes: Uint8Array, node: DerNode): { text: string; kind: string; replaced: boolean } {
  const kind = node.cls === 'universal' && !node.constructed ? UNIVERSAL_NAMES.get(node.tag) : undefined;
  const content = derContent(bytes, node);
  switch (node.tag) {
    case 12: {
      if (kind !== 'UTF8String') break;
      try {
        return {
          text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content),
          kind,
          replaced: false,
        };
      } catch {
        return {
          text: new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(content),
          kind,
          replaced: true,
        };
      }
    }
    case 18:
    case 19:
    case 22:
    case 26: {
      if (kind === undefined) break;
      const pieces: string[] = [];
      let replaced = false;
      for (const octet of content) {
        if (octet > 127) {
          replaced = true;
          pieces.push(REPLACEMENT);
        } else {
          pieces.push(String.fromCharCode(octet));
        }
      }
      return { text: pieces.join(''), kind, replaced };
    }
    case 20: {
      if (kind === undefined) break;
      const pieces: string[] = [];
      for (const octet of content) pieces.push(String.fromCharCode(octet));
      return { text: pieces.join(''), kind, replaced: false };
    }
    case 30: {
      if (kind === undefined) break;
      const pieces: string[] = [];
      let replaced = false;
      for (let i = 0; i < content.length; i += 2) {
        if (i + 1 >= content.length) {
          replaced = true;
          pieces.push(REPLACEMENT);
          break;
        }
        const unit = (content[i]! << 8) | content[i + 1]!;
        if (unit >= 0xd800 && unit <= 0xdbff && i + 3 < content.length) {
          const next = (content[i + 2]! << 8) | content[i + 3]!;
          if (next >= 0xdc00 && next <= 0xdfff) {
            pieces.push(String.fromCharCode(unit, next));
            i += 2;
            continue;
          }
        }
        if (unit >= 0xd800 && unit <= 0xdfff) {
          replaced = true;
          pieces.push(REPLACEMENT);
        } else {
          pieces.push(String.fromCharCode(unit));
        }
      }
      return { text: pieces.join(''), kind, replaced };
    }
    case 28: {
      if (kind === undefined) break;
      const pieces: string[] = [];
      let replaced = false;
      for (let i = 0; i < content.length; i += 4) {
        if (i + 3 >= content.length) {
          replaced = true;
          pieces.push(REPLACEMENT);
          break;
        }
        const point = ((content[i]! << 24) | (content[i + 1]! << 16) | (content[i + 2]! << 8) | content[i + 3]!) >>> 0;
        if (point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) {
          replaced = true;
          pieces.push(REPLACEMENT);
        } else {
          pieces.push(String.fromCodePoint(point));
        }
      }
      return { text: pieces.join(''), kind, replaced };
    }
    default:
      break;
  }
  throw new DerError(`Expected a character string at offset ${node.start}.`, node.start);
}

/** Lower case hex of the bytes, with `separator` between bytes. */
export function derHex(bytes: Uint8Array, separator = ''): string {
  const pieces: string[] = [];
  for (const octet of bytes) pieces.push(octet.toString(16).padStart(2, '0'));
  return pieces.join(separator);
}
