import { bignumItem, bignumValue, isShortBignum, type CborItem } from './cbor';
import { MAX_BIGINT_DIGITS, MAX_DEPTH, MAX_OUTPUT_CHARS, MsgpackCborError } from './common';
import type { MsgpackItem } from './msgpack';

/**
 * The JSON side of the conversion, as a tree that keeps what plain JavaScript values cannot: an integer of any size
 * (`int`, a bigint) is told apart from a float (`float`, a number), and an object keeps its keys in order, repeated
 * keys and a key named __proto__ included.
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
const INT64_MIN = -9223372036854775808n;
const INT64_MAX = 9223372036854775807n;
const UINT64_MAX = 18446744073709551615n;
const CBOR_INT_MIN = -18446744073709551616n;
const INT_RANGE = 'MessagePack integers run from -9223372036854775808 to 18446744073709551615';

const str = (v: string): JsonNode => ({ t: 'str', v });
const int = (v: bigint | number): JsonNode => ({ t: 'int', v: BigInt(v) });
const obj = (...entries: [string, JsonNode][]): JsonNode => ({ t: 'obj', entries });

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard Base64 with padding. */
export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    parts.push(
      BASE64[a >> 2]! +
        BASE64[((a & 3) << 4) | (b >> 4)]! +
        (i + 1 < bytes.length ? BASE64[((b & 15) << 2) | (c >> 6)]! : '=') +
        (i + 2 < bytes.length ? BASE64[c & 63]! : '='),
    );
  }
  return parts.join('');
}

/** Bytes from Base64 text (standard or URL-safe letters, padding optional but right when present), or null when it is not Base64. */
export function base64ToBytes(text: string): Uint8Array | null {
  const body = text.replace(/={1,2}$/, '');
  if (!/^[A-Za-z0-9+/_-]*$/.test(body)) return null;
  if (body.length % 4 === 1) return null;
  const padding = text.length - body.length;
  if (padding > 0 && (body.length + padding) % 4 !== 0) return null;
  const bytes = new Uint8Array(Math.floor((body.length * 3) / 4));
  let out = 0;
  for (let i = 0; i < body.length; i += 4) {
    let triple = 0;
    for (let j = 0; j < 4; j++) {
      const char = body[i + j];
      const value = char === undefined ? 0 : char === '-' ? 62 : char === '_' ? 63 : BASE64.indexOf(char);
      triple = (triple << 6) | value;
    }
    if (out < bytes.length) bytes[out++] = (triple >> 16) & 255;
    if (out < bytes.length) bytes[out++] = (triple >> 8) & 255;
    if (out < bytes.length) bytes[out++] = triple & 255;
  }
  return bytes;
}

const hexOf = (data: Uint8Array): string => Array.from(data, (b) => b.toString(16).padStart(2, '0')).join('');

function hexToBytes(text: string): Uint8Array | null {
  if (!/^([0-9a-fA-F]{2})*$/.test(text)) return null;
  return Uint8Array.from(text.match(/../g) ?? [], (pair) => parseInt(pair, 16));
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading binary values as JSON

function intNode(value: bigint): JsonNode {
  if (value <= SAFE_LIMIT && value >= -SAFE_LIMIT) return { t: 'int', v: value };
  return obj(['$bigint', str(value.toString())]);
}

function floatNode(value: number): JsonNode {
  if (Number.isNaN(value)) return obj(['$float', str('NaN')]);
  if (value === Infinity) return obj(['$float', str('Infinity')]);
  if (value === -Infinity) return obj(['$float', str('-Infinity')]);
  return { t: 'float', v: value };
}

/**
 * A map as JSON: an ordinary object when every key is text, no key repeats and no key begins with a dollar sign (so no
 * key can be mistaken for a marker); otherwise a $map list of key and value pairs, which loses nothing.
 */
function mapNode(pairs: [JsonNode, JsonNode][]): JsonNode {
  const seen = new Set<string>();
  let plain = true;
  for (const [key] of pairs) {
    if (key.t !== 'str' || key.v.startsWith('$') || seen.has(key.v)) {
      plain = false;
      break;
    }
    seen.add(key.v);
  }
  if (plain) return { t: 'obj', entries: pairs.map(([key, value]) => [(key as { v: string }).v, value]) };
  return obj([
    '$map',
    { t: 'arr', items: pairs.map(([key, value]) => ({ t: 'arr', items: [key, value] }) as JsonNode) },
  ]);
}

function cborNode(item: CborItem): JsonNode {
  switch (item.type) {
    case 'int':
      return intNode(item.value);
    case 'bytes':
      return obj(['$bytes', str(bytesToBase64(item.value))]);
    case 'text':
      return str(item.value);
    case 'array':
      return { t: 'arr', items: item.items.map(cborNode) };
    case 'map':
      return mapNode(item.entries.map(([key, value]) => [cborNode(key), cborNode(value)]));
    case 'tag':
      // A bignum is shown as the number it stands for, as RFC 8949 Appendix A does; a very long one stays a tag.
      if (isShortBignum(item)) return intNode(bignumValue(item.tag, item.item.value));
      return obj(['$tag', int(item.tag)], ['$value', cborNode(item.item)]);
    case 'float':
      return floatNode(item.value);
    case 'simple':
      return obj(['$simple', int(item.value)]);
    case 'bool':
      return { t: 'bool', v: item.value };
    case 'null':
      return { t: 'null' };
    case 'undefined':
      return obj(['$undefined', { t: 'bool', v: true }]);
  }
}

function msgpackNode(item: MsgpackItem): JsonNode {
  switch (item.type) {
    case 'nil':
      return { t: 'null' };
    case 'bool':
      return { t: 'bool', v: item.value };
    case 'int':
      return intNode(item.value);
    case 'float':
      return floatNode(item.value);
    case 'str':
      return str(item.value);
    case 'bin':
      return obj(['$bytes', str(bytesToBase64(item.value))]);
    case 'array':
      return { t: 'arr', items: item.items.map(msgpackNode) };
    case 'map':
      return mapNode(item.entries.map(([key, value]) => [msgpackNode(key), msgpackNode(value)]));
    case 'ext':
      return obj(['$ext', int(item.extType)], ['$hex', str(hexOf(item.data))]);
    case 'timestamp':
      return obj([
        '$timestamp',
        obj(['seconds', str(item.seconds.toString())], ['nanoseconds', int(item.nanoseconds)]),
      ]);
  }
}

/** Writes one decoded value as JSON, using the markers for everything JSON cannot hold. */
export function toJsonValue(item: CborItem, format: 'cbor'): JsonNode;
export function toJsonValue(item: MsgpackItem, format: 'msgpack'): JsonNode;
export function toJsonValue(item: CborItem | MsgpackItem, format: 'cbor' | 'msgpack'): JsonNode {
  return format === 'cbor' ? cborNode(item as CborItem) : msgpackNode(item as MsgpackItem);
}

// ---------------------------------------------------------------------------------------------------------------------
// JSON text

/** A float as JSON text: always with a fraction or an exponent, so it reads back as a float. */
function floatText(value: number): string {
  if (Object.is(value, -0)) return '-0.0';
  const text = String(value);
  return /^-?\d+$/.test(text) ? `${text}.0` : text;
}

/** The length of an integer's decimal text, or a lower bound close to it for a very large one (a hex digit is 4 bits). */
function intLength(value: bigint): number {
  const hex = (value < 0n ? -value : value).toString(16).length;
  if (hex <= 13) return value.toString().length;
  return Math.floor((hex - 1) * 4 * 0.30103) + 1 + (value < 0n ? 1 : 0);
}

/**
 * Refuses a tree whose JSON text would be longer than `MAX_OUTPUT_CHARS`, before any text is built. The length is
 * counted from the tree (every token, line break and indentation space; a string counts its characters and two quotes,
 * so an escape makes the real text a little longer), and the count stops at the limit.
 */
function checkOutputSize(node: JsonNode, indent: number): void {
  let total = 0;
  const add = (n: number): void => {
    total += n;
    if (total > MAX_OUTPUT_CHARS) {
      throw new MsgpackCborError(
        `The JSON text would be more than 32 MiB (${MAX_OUTPUT_CHARS.toLocaleString('en-US')} characters), because every nested array and map indents its lines. Nothing was written. For CBOR, choose diagnostic notation, which does not indent.`,
      );
    }
  };
  const measure = (n: JsonNode, level: number): void => {
    switch (n.t) {
      case 'null':
        add(4);
        return;
      case 'bool':
        add(n.v ? 4 : 5);
        return;
      case 'str':
        add(n.v.length + 2);
        return;
      case 'int':
        add(intLength(n.v));
        return;
      case 'float':
        add(floatText(n.v).length);
        return;
      case 'arr':
        if (n.items.length === 0) {
          add(2);
          return;
        }
        // The brackets, the line breaks after the opening one, between the items and before the closing one.
        add(2 + (n.items.length - 1) * 2 + 1 + indent * level + 1);
        for (const item of n.items) {
          add(indent * (level + 1));
          measure(item, level + 1);
        }
        return;
      case 'obj':
        if (n.entries.length === 0) {
          add(2);
          return;
        }
        add(2 + (n.entries.length - 1) * 2 + 1 + indent * level + 1);
        for (const [key, value] of n.entries) {
          add(indent * (level + 1) + key.length + 2 + 2);
          measure(value, level + 1);
        }
        return;
    }
  };
  measure(node, 0);
}

/** The JSON text of a tree, indented two spaces. A tree whose text would pass 32 MiB is refused (`MAX_OUTPUT_CHARS`). */
export function stringifyJson(node: JsonNode, indent = 2): string {
  checkOutputSize(node, indent);
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

function lineAndColumn(text: string, position: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < position && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

const NUMBER = /-?(?:0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;

/**
 * Reads JSON text into a tree. A number with a fraction or an exponent is a float and one without either is an
 * integer of any size; an object keeps every key in order, a repeated key and __proto__ included. Errors name the line
 * and column.
 */
export function parseJson(text: string): JsonNode {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const fail = (message: string, at: number): never => {
    const { line, column } = lineAndColumn(text, at);
    throw new MsgpackCborError(`${message} (line ${line}, column ${column}).`, { line, column });
  };
  const skip = (): void => {
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i++;
      else break;
    }
  };
  const describe = (at: number): string => (at >= text.length ? 'the end of the text' : JSON.stringify(text[at]));

  const readString = (): string => {
    const start = i;
    i++;
    for (;;) {
      if (i >= text.length) return fail('The text ends inside a string', start);
      const c = text.charCodeAt(i);
      if (c === 0x22) break;
      if (c < 0x20)
        return fail('A string holds a line break or another control character, which JSON writes as an escape', i);
      if (c === 0x5c) {
        const next = text[i + 1];
        if (next === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) return fail('A \\u escape needs four hex digits', i);
          i += 6;
        } else if (next !== undefined && '"\\/bfnrt'.includes(next)) {
          i += 2;
        } else {
          return fail(`A string holds the escape \\${next ?? ''}, which JSON does not define`, i);
        }
      } else {
        i++;
      }
    }
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };

  const readNumber = (): JsonNode => {
    NUMBER.lastIndex = i;
    const match = NUMBER.exec(text);
    if (!match) return fail(`Expected a digit but found ${describe(i + 1)}`, i);
    const literal = match[0];
    const at = i;
    i += literal.length;
    if (match[1] === undefined && match[2] === undefined) {
      if (literal === '-0') return { t: 'float', v: -0 };
      const digits = literal.startsWith('-') ? literal.length - 1 : literal.length;
      if (digits > MAX_BIGINT_DIGITS) {
        return fail(
          `This integer has ${digits.toLocaleString('en-US')} digits. Integers of more than ${MAX_BIGINT_DIGITS.toLocaleString('en-US')} digits are not converted`,
          at,
        );
      }
      return { t: 'int', v: BigInt(literal) };
    }
    const value = Number(literal);
    if (!Number.isFinite(value)) return fail(`The number ${literal} is too large for a float`, at);
    if (value === 0 && /[1-9]/.test(literal.split(/[eE]/)[0]!))
      return fail(`The number ${literal} is too small for a float`, at);
    return { t: 'float', v: value };
  };

  const readValue = (depth: number): JsonNode => {
    skip();
    if (i >= text.length) return fail('The JSON ends where a value was expected', i);
    const c = text[i]!;
    if (c === '{') {
      if (depth + 1 > MAX_DEPTH) return fail(`The JSON nests more than ${MAX_DEPTH} levels deep`, i);
      i++;
      const entries: [string, JsonNode][] = [];
      skip();
      if (text[i] === '}') {
        i++;
        return { t: 'obj', entries };
      }
      for (;;) {
        skip();
        if (text[i] !== '"') return fail(`Expected a quoted key but found ${describe(i)}`, i);
        const key = readString();
        skip();
        if (text[i] !== ':') return fail(`Expected ":" after a key but found ${describe(i)}`, i);
        i++;
        entries.push([key, readValue(depth + 1)]);
        skip();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === '}') {
          i++;
          return { t: 'obj', entries };
        }
        return fail(`Expected "," or "}" but found ${describe(i)}`, i);
      }
    }
    if (c === '[') {
      if (depth + 1 > MAX_DEPTH) return fail(`The JSON nests more than ${MAX_DEPTH} levels deep`, i);
      i++;
      const items: JsonNode[] = [];
      skip();
      if (text[i] === ']') {
        i++;
        return { t: 'arr', items };
      }
      for (;;) {
        items.push(readValue(depth + 1));
        skip();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === ']') {
          i++;
          return { t: 'arr', items };
        }
        return fail(`Expected "," or "]" but found ${describe(i)}`, i);
      }
    }
    if (c === '"') return { t: 'str', v: readString() };
    if (c === '-' || (c >= '0' && c <= '9')) return readNumber();
    for (const [word, node] of [
      ['true', { t: 'bool', v: true }],
      ['false', { t: 'bool', v: false }],
      ['null', { t: 'null' }],
    ] as [string, JsonNode][]) {
      if (text.startsWith(word, i)) {
        i += word.length;
        return node;
      }
    }
    return fail(`Expected a JSON value but found ${describe(i)}`, i);
  };

  skip();
  if (i >= text.length) throw new MsgpackCborError('The JSON text is empty. Type or paste a JSON value.');
  const value = readValue(0);
  skip();
  if (i < text.length) return fail(`Unexpected ${describe(i)} after the JSON value`, i);
  return value;
}

// ---------------------------------------------------------------------------------------------------------------------
// Writing JSON as binary values

/** What a format needs to build from a JSON tree. Markers a format has no value for are left out of its target. */
interface Target<T> {
  nil(): T;
  bool(value: boolean): T;
  int(value: bigint): T;
  float(value: number): T;
  text(value: string): T;
  bytes(value: Uint8Array): T;
  array(items: T[]): T;
  map(entries: [T, T][]): T;
  tag?(tag: bigint, item: T): T;
  undef?(): T;
  simple?(value: number): T;
  ext?(extType: number, data: Uint8Array): T;
  timestamp?(seconds: bigint, nanoseconds: number): T;
}

const MARKER_KEYS = new Set([
  '$bigint',
  '$bytes',
  '$tag',
  '$value',
  '$ext',
  '$hex',
  '$timestamp',
  '$map',
  '$float',
  '$undefined',
  '$simple',
]);

const HINT: Record<string, string> = {
  $bigint: 'a decimal whole number in a string',
  $bytes: 'a Base64 string and nothing else',
  $tag: '"$tag" as a whole number from 0 with "$value" beside it, in CBOR only',
  $value: '"$value" with "$tag" beside it, in CBOR only',
  $ext: '"$ext" as a whole number from -128 to 127 with "$hex" beside it, in MessagePack only',
  $hex: '"$hex" as pairs of hex digits with "$ext" beside it, in MessagePack only',
  $timestamp: 'seconds and nanoseconds, in MessagePack only',
  $map: 'a list of two item lists',
  $float: '"NaN", "Infinity" or "-Infinity" in a string',
  $undefined: 'true, in CBOR only',
  $simple: 'a whole number from 0 to 19 or 32 to 255, in CBOR only',
};

/** True when a string holds half of a surrogate pair, which UTF-8 cannot write. */
function hasLoneSurrogate(text: string): boolean {
  return /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(text);
}

function childPath(path: string, key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

const DECIMAL = /^-?(?:0|[1-9]\d*)$/;

function decimalOf(node: JsonNode | undefined, path: string, what: string, allowNumber: boolean): bigint | null {
  if (node === undefined) return null;
  let digits: string;
  if (allowNumber && node.t === 'int') digits = node.v.toString();
  else if (node.t === 'str' && DECIMAL.test(node.v)) digits = node.v;
  else return null;
  const length = digits.startsWith('-') ? digits.length - 1 : digits.length;
  if (length > MAX_BIGINT_DIGITS) {
    throw new MsgpackCborError(
      `${path}: ${what} has ${length.toLocaleString('en-US')} digits. Integers of more than ${MAX_BIGINT_DIGITS.toLocaleString('en-US')} digits are not converted.`,
    );
  }
  return BigInt(digits);
}

function convertNode<T>(node: JsonNode, path: string, target: Target<T>, warnings: string[]): T {
  switch (node.t) {
    case 'null':
      return target.nil();
    case 'bool':
      return target.bool(node.v);
    case 'int':
      return target.int(node.v);
    case 'float':
      return target.float(node.v);
    case 'str':
      if (hasLoneSurrogate(node.v)) {
        throw new MsgpackCborError(
          `${path}: the string holds half of a surrogate pair, which cannot be written as UTF-8. Replace it with the character it was meant to be.`,
        );
      }
      return target.text(node.v);
    case 'arr':
      return target.array(node.items.map((item, index) => convertNode(item, `${path}[${index}]`, target, warnings)));
    case 'obj':
      return convertObject(node.entries, path, target, warnings);
  }
}

function convertObject<T>(entries: [string, JsonNode][], path: string, target: Target<T>, warnings: string[]): T {
  const keys = entries.map(([key]) => key);
  const first = keys.find((key) => MARKER_KEYS.has(key));
  if (first !== undefined) {
    const fit = convertMarker(entries, keys, path, target, warnings);
    if (fit !== undefined) return fit.value;
    warnings.push(
      `${path} holds a "${first}" key but does not fit that marker (${HINT[first] ?? 'see the marker list'}), so it is written as an ordinary map.`,
    );
  }
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) repeated.add(key);
    seen.add(key);
  }
  for (const key of repeated) {
    warnings.push(
      `${path} repeats the key ${JSON.stringify(key)}. Every entry is kept, although RFC 8949 calls a map with a repeated key invalid.`,
    );
  }
  for (const key of keys) {
    if (hasLoneSurrogate(key)) {
      throw new MsgpackCborError(
        `${path}: the key ${JSON.stringify(key)} holds half of a surrogate pair, which cannot be written as UTF-8.`,
      );
    }
  }
  return target.map(
    entries.map(
      ([key, value]) => [target.text(key), convertNode(value, childPath(path, key), target, warnings)] as [T, T],
    ),
  );
}

/** Builds a value from a marker object, or returns undefined when the object does not fit the marker it looks like. */
function convertMarker<T>(
  entries: [string, JsonNode][],
  keys: string[],
  path: string,
  target: Target<T>,
  warnings: string[],
): { value: T } | undefined {
  const only = (...names: string[]): boolean =>
    keys.length === names.length && names.every((name) => keys.filter((key) => key === name).length === 1);
  const get = (name: string): JsonNode | undefined => entries.find(([key]) => key === name)?.[1];

  if (only('$bigint')) {
    const value = decimalOf(get('$bigint'), path, 'the $bigint value', false);
    return value === null ? undefined : { value: target.int(value) };
  }
  if (only('$bytes')) {
    const text = get('$bytes');
    const bytes = text?.t === 'str' ? base64ToBytes(text.v) : null;
    return bytes === null ? undefined : { value: target.bytes(bytes) };
  }
  if (only('$float')) {
    const text = get('$float');
    if (text?.t !== 'str') return undefined;
    if (text.v === 'NaN') return { value: target.float(NaN) };
    if (text.v === 'Infinity') return { value: target.float(Infinity) };
    if (text.v === '-Infinity') return { value: target.float(-Infinity) };
    return undefined;
  }
  if (only('$map')) {
    const list = get('$map');
    if (list?.t !== 'arr') return undefined;
    if (!list.items.every((pair) => pair.t === 'arr' && pair.items.length === 2)) return undefined;
    return {
      value: target.map(
        list.items.map((pair, index) => {
          const [key, value] = (pair as { items: JsonNode[] }).items as [JsonNode, JsonNode];
          return [
            convertNode(key, `${path}.$map[${index}][0]`, target, warnings),
            convertNode(value, `${path}.$map[${index}][1]`, target, warnings),
          ] as [T, T];
        }),
      ),
    };
  }
  if (target.tag && only('$tag', '$value')) {
    const tag = get('$tag');
    if (tag?.t !== 'int' || tag.v < 0n || tag.v > UINT64_MAX) return undefined;
    return { value: target.tag(tag.v, convertNode(get('$value')!, `${path}.$value`, target, warnings)) };
  }
  if (target.undef && only('$undefined')) {
    const flag = get('$undefined');
    return flag?.t === 'bool' && flag.v ? { value: target.undef() } : undefined;
  }
  if (target.simple && only('$simple')) {
    const n = get('$simple');
    if (n?.t !== 'int') return undefined;
    const value = Number(n.v);
    return (n.v >= 0n && n.v <= 19n) || (n.v >= 32n && n.v <= 255n) ? { value: target.simple(value) } : undefined;
  }
  if (target.ext && only('$ext', '$hex')) {
    const type = get('$ext');
    const hex = get('$hex');
    if (type?.t !== 'int' || type.v < -128n || type.v > 127n || hex?.t !== 'str') return undefined;
    const data = hexToBytes(hex.v);
    return data === null ? undefined : { value: target.ext(Number(type.v), data) };
  }
  if (target.timestamp && only('$timestamp')) {
    const inner = get('$timestamp');
    if (inner?.t !== 'obj') return undefined;
    const names = inner.entries.map(([key]) => key);
    if (names.length !== 2 || !names.includes('seconds') || !names.includes('nanoseconds')) return undefined;
    const seconds = decimalOf(inner.entries.find(([key]) => key === 'seconds')![1], path, 'the seconds', true);
    const nanoseconds = inner.entries.find(([key]) => key === 'nanoseconds')![1];
    if (seconds === null || seconds < INT64_MIN || seconds > INT64_MAX) return undefined;
    if (nanoseconds.t !== 'int' || nanoseconds.v < 0n || nanoseconds.v > 999999999n) return undefined;
    return { value: target.timestamp(seconds, Number(nanoseconds.v)) };
  }
  return undefined;
}

const cborTarget: Target<CborItem> = {
  nil: () => ({ type: 'null' }),
  bool: (value) => ({ type: 'bool', value }),
  int: (value) => (value >= CBOR_INT_MIN && value <= UINT64_MAX ? { type: 'int', value } : bignumItem(value)),
  float: (value) => ({ type: 'float', value }),
  text: (value) => ({ type: 'text', value }),
  bytes: (value) => ({ type: 'bytes', value }),
  array: (items) => ({ type: 'array', items, indefinite: false }),
  map: (entries) => ({ type: 'map', entries, indefinite: false }),
  tag: (tag, item) => ({ type: 'tag', tag, item }),
  undef: () => ({ type: 'undefined' }),
  simple: (value) => ({ type: 'simple', value }),
};

const msgpackTarget: Target<MsgpackItem> = {
  nil: () => ({ type: 'nil' }),
  bool: (value) => ({ type: 'bool', value }),
  int: (value) => {
    if (value < INT64_MIN || value > UINT64_MAX) throw new MsgpackCborError(`${value} is out of range. ${INT_RANGE}.`);
    return { type: 'int', value, format: 'int 64' };
  },
  float: (value) => ({ type: 'float', value, width: 64 }),
  text: (value) => ({ type: 'str', value }),
  bytes: (value) => ({ type: 'bin', value }),
  array: (items) => ({ type: 'array', items }),
  map: (entries) => ({ type: 'map', entries }),
  ext: (extType, data) => ({ type: 'ext', extType, data }),
  timestamp: (seconds, nanoseconds) => ({ type: 'timestamp', seconds, nanoseconds, size: 12 }),
};

/** Builds a value from JSON, reading the markers. Objects that look like a marker but do not fit give a warning. */
export function fromJsonValue(node: JsonNode, format: 'cbor'): { item: CborItem; warnings: string[] };
export function fromJsonValue(node: JsonNode, format: 'msgpack'): { item: MsgpackItem; warnings: string[] };
export function fromJsonValue(
  node: JsonNode,
  format: 'cbor' | 'msgpack',
): { item: CborItem | MsgpackItem; warnings: string[] } {
  const warnings: string[] = [];
  const item =
    format === 'cbor' ? convertNode(node, '$', cborTarget, warnings) : convertNode(node, '$', msgpackTarget, warnings);
  return { item, warnings };
}
