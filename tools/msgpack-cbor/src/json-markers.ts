import type { CborItem } from './cbor';

/**
 * The JSON side of the conversion, as a tree that keeps what plain JavaScript values cannot: an integer of any size
 * (`int`, a bigint) is told apart from a float (`float`, a number), and an object keeps its keys in order, repeated
 * keys included.
 */
export type JsonNode =
  | { t: 'null' }
  | { t: 'bool'; v: boolean }
  | { t: 'str'; v: string }
  | { t: 'int'; v: bigint }
  | { t: 'float'; v: number }
  | { t: 'arr'; items: JsonNode[] }
  | { t: 'obj'; entries: [string, JsonNode][] };

/** Integers at or below this size in either direction are written as plain JSON numbers; larger ones as $bigint. */
const SAFE_LIMIT = 9007199254740991n;

const str = (v: string): JsonNode => ({ t: 'str', v });
const obj = (...entries: [string, JsonNode][]): JsonNode => ({ t: 'obj', entries });

/** Standard Base64 with padding. */
export function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += alphabet[a >> 2]! + alphabet[((a & 3) << 4) | (b >> 4)]!;
    out += i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)]! : '=';
    out += i + 2 < bytes.length ? alphabet[c & 63]! : '=';
  }
  return out;
}

function intNode(value: bigint): JsonNode {
  if (value <= SAFE_LIMIT && value >= -SAFE_LIMIT) return { t: 'int', v: value };
  return obj(['$bigint', str(value.toString())]);
}

/** A bignum (tag 2 or 3) holds a big endian byte string; its value is the number, or -1 minus it for tag 3. */
function bignumValue(tag: bigint, content: Uint8Array): bigint {
  let n = 0n;
  for (const byte of content) n = (n << 8n) | BigInt(byte);
  return tag === 3n ? -1n - n : n;
}

/** Writes one CBOR item as JSON, using the markers for everything JSON cannot hold. */
export function cborToJsonValue(item: CborItem): JsonNode {
  switch (item.type) {
    case 'int':
      return intNode(item.value);
    case 'bytes':
      return obj(['$bytes', str(bytesToBase64(item.value))]);
    case 'tag':
      if ((item.tag === 2n || item.tag === 3n) && item.item.type === 'bytes') {
        return obj(['$bigint', str(bignumValue(item.tag, item.item.value).toString())]);
      }
      return obj(['$tag', { t: 'int', v: item.tag }], ['$value', cborToJsonValue(item.item)]);
  }
}

/** Marker conversion for either format; MessagePack arrives with its own decoder. */
export function toJsonValue(item: CborItem, format: 'cbor'): JsonNode {
  void format;
  return cborToJsonValue(item);
}

/** A float as JSON text: always with a fraction or an exponent, so it reads back as a float. */
function floatText(value: number): string {
  if (Object.is(value, -0)) return '-0.0';
  const text = String(value);
  return /^-?\d+$/.test(text) ? `${text}.0` : text;
}

/** The JSON text of a tree, indented two spaces. */
export function stringifyJson(node: JsonNode, indent = 2): string {
  const write = (n: JsonNode, level: number): string => {
    const pad = ' '.repeat(indent * (level + 1));
    const closePad = ' '.repeat(indent * level);
    switch (n.t) {
      case 'null':
        return 'null';
      case 'bool':
        return n.v ? 'true' : 'false';
      case 'str':
        return JSON.stringify(n.v);
      case 'int':
        return n.v.toString();
      case 'float':
        return floatText(n.v);
      case 'arr':
        if (n.items.length === 0) return '[]';
        return `[\n${n.items.map((x) => pad + write(x, level + 1)).join(',\n')}\n${closePad}]`;
      case 'obj':
        if (n.entries.length === 0) return '{}';
        return `{\n${n.entries.map(([k, v]) => `${pad}${JSON.stringify(k)}: ${write(v, level + 1)}`).join(',\n')}\n${closePad}}`;
    }
  };
  return write(node, 0);
}
