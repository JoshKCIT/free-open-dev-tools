/**
 * PHP serialize() decoded to a plain JSON value, byte-counted and bounded.
 *
 * This never instantiates a class, calls a magic method, evaluates code or
 * sets an object's prototype -- it only ever scans the byte stream and
 * builds plain objects, arrays, strings, numbers, booleans and null. The
 * PHP manual's own warning on unserialize() (quoted in test/index.test.ts)
 * is exactly the real-world vulnerability class this design defends
 * against by construction: no code path here resembles a constructor call.
 *
 * Grammar reference: the PHP manual pages for serialize() and
 * unserialize(), and the token grammar in php-src's own
 * ext/standard/var_unserializer.re (fetched this session; every token
 * shape below is quoted from one of those three sources in
 * test/index.test.ts). String and byte counts are always UTF-8 BYTE
 * counts, never JavaScript UTF-16 code unit counts -- this is the single
 * most consequential detail in the whole format, and is why every read
 * here counts bytes on a `Uint8Array`, never characters on a JS string.
 */
import meta from './meta.json';
import { setOwn } from './own-property';

export { meta };

/** Depth over 512 levels, or more than one million decoded values (reference copies included), is refused. */
export const PHP_LIMITS = { maxDepth: 512, maxValues: 1_000_000 };

export interface UnserializeOptions {
  /** Turn an array whose keys are exactly 0..n-1 in order into a JSON array. Default true. */
  sequentialArrays?: boolean;
}

export interface UnserializeStats {
  /** Every decoded value, containers included, reference copies included. */
  valueCount: number;
  /** The deepest level of nesting reached. */
  maxDepth: number;
}

export interface UnserializeResult {
  value: unknown;
  warnings: string[];
  stats: UnserializeStats;
}

export class PhpUnserializeError extends Error {
  /** Byte offset into the UTF-8 encoding of the original text. */
  readonly offset: number;
  readonly line: number;
  /** Character offset for the page, 1-based. */
  readonly column: number;

  constructor(message: string, offset: number, column: number) {
    super(message);
    this.name = 'PhpUnserializeError';
    this.offset = offset;
    this.line = 1;
    this.column = column;
  }
}

const DEPTH_MESSAGE = `This value is nested more than ${PHP_LIMITS.maxDepth} levels deep, so it was refused rather than risk freezing the tab.`;
const VALUE_LIMIT_MESSAGE = `This value contains more than ${PHP_LIMITS.maxValues.toLocaleString('en-US')} decoded values, so it was refused rather than risk freezing the tab.`;

/** Minimum plausible bytes a single key/value pair could occupy (the shortest real pair, "i:0;N;", is 6 -- 4 is a deliberately conservative floor). */
const MIN_BYTES_PER_PAIR = 4;

interface RefSlot {
  done: boolean;
  value: unknown;
}

/**
 * Byte-indexed cursor over the UTF-8 encoding of the input text. All
 * structural bytes of the PHP serialize format (digits, `:` `;` `{` `}`
 * `"` `-` and the type letters) are single-byte ASCII, so structural
 * scanning never needs to decode anything -- only string, class-name and
 * enum CONTENT bytes are ever handed to the UTF-8 decoder below.
 */
class ByteReader {
  readonly bytes: Uint8Array;
  index = 0;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }
  atEnd(): boolean {
    return this.index >= this.bytes.length;
  }
  peek(offset = 0): number | undefined {
    return this.bytes[this.index + offset];
  }
  remaining(): number {
    return this.bytes.length - this.index;
  }
  advance(n = 1): void {
    this.index += n;
  }
}

const CHAR = {
  colon: 0x3a,
  semicolon: 0x3b,
  openBrace: 0x7b,
  closeBrace: 0x7d,
  quote: 0x22,
  minus: 0x2d,
  dot: 0x2e,
};

function isDigit(byte: number | undefined): boolean {
  return byte !== undefined && byte >= 0x30 && byte <= 0x39;
}

/**
 * Decodes `len` UTF-8 bytes starting at `start` on their own, without
 * reading a single byte past `start + len` even when a multi-byte
 * sequence would otherwise continue there -- a wrong declared byte count
 * must be caught as an invalid sequence bounded by that count, not
 * silently repaired by reading further into the buffer. Returns the exact
 * byte offset (relative to `start`) of the first byte that made the
 * sequence invalid or unable to complete within the span.
 */
function decodeUtf8Span(
  bytes: Uint8Array,
  start: number,
  len: number,
): { ok: true; text: string } | { ok: false; badOffset: number } {
  const end = start + len;
  let i = start;
  const codePoints: number[] = [];
  while (i < end) {
    const b0 = bytes[i]!;
    let extra: number;
    let codePoint: number;
    let minCodePoint: number;
    if (b0 <= 0x7f) {
      codePoints.push(b0);
      i += 1;
      continue;
    } else if ((b0 & 0xe0) === 0xc0) {
      extra = 1;
      codePoint = b0 & 0x1f;
      minCodePoint = 0x80;
    } else if ((b0 & 0xf0) === 0xe0) {
      extra = 2;
      codePoint = b0 & 0x0f;
      minCodePoint = 0x800;
    } else if ((b0 & 0xf8) === 0xf0) {
      extra = 3;
      codePoint = b0 & 0x07;
      minCodePoint = 0x10000;
    } else {
      return { ok: false, badOffset: i - start };
    }
    if (i + extra >= end) {
      return { ok: false, badOffset: i - start };
    }
    for (let k = 1; k <= extra; k++) {
      const cont = bytes[i + k]!;
      if ((cont & 0xc0) !== 0x80) {
        return { ok: false, badOffset: i - start };
      }
      codePoint = (codePoint << 6) | (cont & 0x3f);
    }
    if (codePoint < minCodePoint || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      return { ok: false, badOffset: i - start };
    }
    codePoints.push(codePoint);
    i += extra + 1;
  }
  return { ok: true, text: String.fromCodePoint(...codePoints) };
}

/** Character offset (1-based) of a byte position, for the page. Decodes leniently: an error position never needs to itself be exact UTF-8. */
function columnAt(bytes: Uint8Array, offset: number): number {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, offset)).length + 1;
}

class Scanner {
  readonly reader: ByteReader;
  readonly options: Required<UnserializeOptions>;
  readonly refs: RefSlot[] = [];
  readonly warnings: string[] = [];
  valueCount = 0;
  maxDepthSeen = 0;

  constructor(bytes: Uint8Array, options: Required<UnserializeOptions>) {
    this.reader = new ByteReader(bytes);
    this.options = options;
  }

  fail(message: string, offset?: number): never {
    const at = offset ?? this.reader.index;
    throw new PhpUnserializeError(message, at, columnAt(this.reader.bytes, at));
  }

  expectByte(byte: number, what: string): void {
    if (this.reader.peek() !== byte) this.fail(`Expected ${what}.`);
    this.reader.advance();
  }

  /** Reads a run of ASCII digits, with an optional leading '-'. Returns the raw text; the caller decides how to interpret it. */
  readDigits(allowSign: boolean): string {
    const start = this.reader.index;
    if (allowSign && this.reader.peek() === CHAR.minus) this.reader.advance();
    const digitsStart = this.reader.index;
    while (isDigit(this.reader.peek())) this.reader.advance();
    if (this.reader.index === digitsStart) this.fail('Expected a digit.');
    return new TextDecoder('utf-8').decode(this.reader.bytes.slice(start, this.reader.index));
  }

  /** A non-negative count used as a byte length or an element count. Refused immediately, before any allocation, if larger than the input could possibly hold. */
  readCount(minBytesPerUnit: number): number {
    const text = this.readDigits(false);
    if (text.length > 15) {
      this.fail(
        'The declared count is larger than this document could possibly hold, so it was refused before allocating anything.',
      );
    }
    const n = Number(text);
    if (n * minBytesPerUnit > this.reader.remaining()) {
      this.fail(
        'The declared count is larger than the remaining input could hold, so it was refused before allocating anything.',
      );
    }
    return n;
  }

  /** Reads exactly `len` bytes as a double-quoted string body: the opening quote must already be consumed by the caller. */
  readQuotedBytes(len: number): string {
    if (len > this.reader.remaining()) {
      this.fail('The declared byte count is larger than the remaining input, so it was refused.');
    }
    const start = this.reader.index;
    const decoded = decodeUtf8Span(this.reader.bytes, start, len);
    if (!decoded.ok) {
      this.fail(`This string is not valid UTF-8 at the declared byte count.`, start + decoded.badOffset);
    }
    this.reader.advance(len);
    if (this.reader.peek() !== CHAR.quote) {
      this.fail(`A string declared ${len} bytes long does not end with a closing quote there.`);
    }
    this.reader.advance();
    return decoded.text;
  }

  countValue(): void {
    this.valueCount++;
    if (this.valueCount > PHP_LIMITS.maxValues) this.fail(VALUE_LIMIT_MESSAGE);
  }

  /** Deep-clones an already-decoded value, counting every node toward the value limit -- this is what keeps reference amplification from ever exceeding it. */
  cloneCounting(value: unknown): unknown {
    this.countValue();
    if (Array.isArray(value)) return value.map((v) => this.cloneCounting(v));
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) setOwn(out, k, this.cloneCounting(v));
      return out;
    }
    return value;
  }

  resolveReference(n: number, atOffset: number): unknown {
    const idx = n - 1;
    if (idx < 0 || idx >= this.refs.length) {
      this.fail(`This references value ${n}, which does not exist.`, atOffset);
    }
    const slot = this.refs[idx]!;
    if (!slot.done) {
      this.warnings.push(
        `Reference to value ${n}, which had not finished decoding yet, was kept as a plain marker to avoid creating a cycle.`,
      );
      return { __reference: n };
    }
    return this.cloneCounting(slot.value);
  }

  /** Parses one value, with reference-table bookkeeping: every value gets a numbered slot before it is parsed, except a literal R: token, matching php-src's own var_hash push rule. */
  parseTracked(depth: number): unknown {
    this.countValue();
    if (depth > PHP_LIMITS.maxDepth) this.fail(DEPTH_MESSAGE);
    if (depth > this.maxDepthSeen) this.maxDepthSeen = depth;

    const isCapitalR = this.reader.peek() === 0x52 /* R */ && this.reader.peek(1) === CHAR.colon;
    let slotIndex = -1;
    if (!isCapitalR) {
      slotIndex = this.refs.length;
      this.refs.push({ done: false, value: undefined });
    }
    const value = this.parseValue(depth);
    if (!isCapitalR) {
      this.refs[slotIndex]!.done = true;
      this.refs[slotIndex]!.value = value;
    }
    return value;
  }

  parseValue(depth: number): unknown {
    const tag = this.reader.peek();
    if (tag === undefined) this.fail('Unexpected end of input: a value was expected here.');
    switch (String.fromCharCode(tag)) {
      case 'N':
        this.reader.advance();
        this.expectByte(CHAR.semicolon, '";"');
        return null;
      case 'b':
        return this.parseBoolean();
      case 'i':
        return this.parseInteger();
      case 'd':
        return this.parseFloat();
      case 's':
        return this.parseString();
      case 'a':
        return this.parseArray(depth);
      case 'O':
      case 'C':
        return this.parseObject(depth, tag === 0x43 /* C */);
      case 'E':
        return this.parseEnum();
      case 'r':
      case 'R':
        return this.parseReferenceToken();
      default:
        this.fail(`Unrecognized token "${String.fromCharCode(tag)}".`);
    }
  }

  parseBoolean(): boolean {
    this.reader.advance(); // b
    this.expectByte(CHAR.colon, '":"');
    const digit = this.reader.peek();
    if (digit !== 0x30 && digit !== 0x31) this.fail('A boolean is "0" or "1".');
    this.reader.advance();
    this.expectByte(CHAR.semicolon, '";"');
    return digit === 0x31;
  }

  parseInteger(): number | string {
    this.reader.advance(); // i
    this.expectByte(CHAR.colon, '":"');
    const text = this.readDigits(true);
    this.expectByte(CHAR.semicolon, '";"');
    const unsigned = text.startsWith('-') ? text.slice(1) : text;
    if (unsigned.length <= 15) return Number(text);
    this.warnings.push(
      `Integer ${text} is outside the range JavaScript can represent exactly, so it was kept as text.`,
    );
    return text;
  }

  parseFloat(): number | string {
    this.reader.advance(); // d
    this.expectByte(CHAR.colon, '":"');
    const start = this.reader.index;
    while (this.reader.peek() !== undefined && this.reader.peek() !== CHAR.semicolon) this.reader.advance();
    const text = new TextDecoder('utf-8').decode(this.reader.bytes.slice(start, this.reader.index));
    this.expectByte(CHAR.semicolon, '";"');
    if (text === 'NAN' || text === 'INF' || text === '-INF') {
      this.warnings.push(`PHP's ${text} float has no JSON representation, so it was kept as the text "${text}".`);
      return text;
    }
    if (!/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(text)) {
      this.fail(`"${text}" is not a value a PHP float uses.`, start);
    }
    return Number(text);
  }

  parseString(): string {
    this.reader.advance(); // s
    this.expectByte(CHAR.colon, '":"');
    const len = this.readCount(1);
    this.expectByte(CHAR.colon, '":"');
    this.expectByte(CHAR.quote, 'an opening quote');
    const text = this.readQuotedBytes(len);
    this.expectByte(CHAR.semicolon, '";"');
    return text;
  }

  /** Reads an array or object key: only i: or s: are allowed. */
  readKey(depth: number): string {
    const tag = this.reader.peek();
    if (tag !== 0x69 /* i */ && tag !== 0x73 /* s */) {
      this.fail('An array or object key must be an integer or a string.');
    }
    const value = this.parseTracked(depth);
    return String(value);
  }

  parseArray(depth: number): unknown {
    this.reader.advance(); // a
    this.expectByte(CHAR.colon, '":"');
    const count = this.readCount(MIN_BYTES_PER_PAIR);
    this.expectByte(CHAR.colon, '":"');
    this.expectByte(CHAR.openBrace, '"{"');

    const out: Record<string, unknown> = {};
    const keyOrder: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < count; i++) {
      const key = this.readKey(depth + 1);
      if (seen.has(key)) this.fail(`Two entries both use the key "${key}".`);
      seen.add(key);
      keyOrder.push(key);
      const value = this.parseTracked(depth + 1);
      setOwn(out, key, value);
    }
    this.expectByte(CHAR.closeBrace, '"}"');

    if (this.options.sequentialArrays && keyOrder.every((k, i) => k === String(i))) {
      return keyOrder.map((k) => out[k]);
    }
    return out;
  }

  /** Turns a raw decoded property-key string into its display name, per the manual's own note: private members get their class name prepended, protected members a '*', both with NUL bytes on either side. */
  propertyDisplayName(raw: string): string {
    if (raw.charCodeAt(0) !== 0) return raw;
    if (raw.charCodeAt(1) === 0x2a /* * */ && raw.charCodeAt(2) === 0) {
      return `${raw.slice(3)} (protected)`;
    }
    const secondNul = raw.indexOf('\u0000', 1);
    if (secondNul === -1) return raw;
    const className = raw.slice(1, secondNul);
    return `${raw.slice(secondNul + 1)} (private ${className})`;
  }

  parseObject(depth: number, isCustom: boolean): unknown {
    this.reader.advance(); // O or C
    this.expectByte(CHAR.colon, '":"');
    const nameLen = this.readCount(1);
    this.expectByte(CHAR.colon, '":"');
    this.expectByte(CHAR.quote, 'an opening quote');
    const className = this.readQuotedBytes(nameLen);
    this.expectByte(CHAR.colon, '":"');

    if (isCustom) {
      const dataLen = this.readCount(1);
      this.expectByte(CHAR.colon, '":"');
      this.expectByte(CHAR.openBrace, '"{"');
      if (dataLen > this.reader.remaining()) {
        this.fail('The declared payload length is larger than the remaining input, so it was refused.');
      }
      const start = this.reader.index;
      const payload = new TextDecoder('utf-8', { fatal: false }).decode(
        this.reader.bytes.slice(start, start + dataLen),
      );
      this.reader.advance(dataLen);
      this.expectByte(CHAR.closeBrace, '"}"');
      const out: Record<string, unknown> = {};
      setOwn(out, '__class', className);
      setOwn(out, '__serialized', payload);
      return out;
    }

    const count = this.readCount(MIN_BYTES_PER_PAIR);
    this.expectByte(CHAR.colon, '":"');
    this.expectByte(CHAR.openBrace, '"{"');

    const out: Record<string, unknown> = {};
    setOwn(out, '__class', className);
    const seen = new Set<string>();
    for (let i = 0; i < count; i++) {
      const keyTag = this.reader.peek();
      if (keyTag !== 0x73 /* s */) this.fail('An object property key must be a string.');
      const rawKey = this.parseTracked(depth + 1) as string;
      const displayKey = this.propertyDisplayName(rawKey);
      if (seen.has(displayKey)) this.fail(`Two properties both decode to the key "${displayKey}".`);
      seen.add(displayKey);
      const value = this.parseTracked(depth + 1);
      setOwn(out, displayKey, value);
    }
    this.expectByte(CHAR.closeBrace, '"}"');
    return out;
  }

  parseEnum(): unknown {
    this.reader.advance(); // E
    this.expectByte(CHAR.colon, '":"');
    const len = this.readCount(1);
    this.expectByte(CHAR.colon, '":"');
    this.expectByte(CHAR.quote, 'an opening quote');
    const text = this.readQuotedBytes(len);
    this.expectByte(CHAR.semicolon, '";"');
    const colonIndex = text.indexOf(':');
    if (colonIndex === -1)
      this.fail(`"${text}" is not a valid enum name: it has no colon separating the enum from its case.`);
    const out: Record<string, unknown> = {};
    setOwn(out, '__enum', text.slice(0, colonIndex));
    setOwn(out, 'case', text.slice(colonIndex + 1));
    return out;
  }

  parseReferenceToken(): unknown {
    const atOffset = this.reader.index;
    this.reader.advance(); // r or R
    this.expectByte(CHAR.colon, '":"');
    const text = this.readDigits(false);
    this.expectByte(CHAR.semicolon, '";"');
    return this.resolveReference(Number(text), atOffset);
  }
}

/**
 * Decodes a PHP serialize() string into a plain JSON value. Never
 * instantiates, calls or evaluates anything: the scanner only ever builds
 * plain objects, arrays, strings, numbers, booleans and null.
 */
export function unserializePhp(text: string, options: UnserializeOptions = {}): UnserializeResult {
  const resolved: Required<UnserializeOptions> = { sequentialArrays: options.sequentialArrays ?? true };
  const bytes = new TextEncoder().encode(text);
  const scanner = new Scanner(bytes, resolved);
  const value = scanner.parseTracked(1);
  return {
    value,
    warnings: scanner.warnings,
    stats: { valueCount: scanner.valueCount, maxDepth: scanner.maxDepthSeen },
  };
}
