import meta from './meta.json';

export { meta };

export type Base64Alphabet = 'standard' | 'url';

export interface EncodeOptions {
  /** `standard` uses `+` and `/`; `url` uses `-` and `_` (RFC 4648 section 5). */
  alphabet?: Base64Alphabet;
  /** Append `=` padding so the output length is a multiple of 4. Default true. */
  padding?: boolean;
  /** Insert a line break every N characters, as MIME requires at 76. 0 disables. */
  lineLength?: number;
  /** Line ending used when `lineLength` is set. */
  newline?: '\n' | '\r\n';
}

export interface DecodeOptions {
  /**
   * `auto` accepts either alphabet, which is what you want when pasting a token
   * of unknown origin. The others reject characters from the opposite alphabet.
   */
  alphabet?: Base64Alphabet | 'auto';
  /**
   * Strict rejects whitespace, wrong padding, and non-canonical input whose
   * unused trailing bits are not zero. Lenient ignores whitespace, tolerates
   * missing padding and masks trailing bits. Default 'strict'.
   */
  mode?: 'strict' | 'lenient';
}

const STANDARD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const URLSAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export class Base64Error extends Error {
  /** Index into the input where the problem was found, when known. */
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'Base64Error';
    this.position = position;
  }
}

function alphabetFor(name: Base64Alphabet): string {
  return name === 'url' ? URLSAFE : STANDARD;
}

/** Builds a value lookup that maps a character code to its 6-bit value, or -1. */
function buildLookup(accept: 'standard' | 'url' | 'auto'): Int8Array {
  const table = new Int8Array(128).fill(-1);
  const apply = (alpha: string) => {
    for (let i = 0; i < alpha.length; i++) table[alpha.charCodeAt(i)] = i;
  };
  if (accept === 'standard' || accept === 'auto') apply(STANDARD);
  if (accept === 'url' || accept === 'auto') apply(URLSAFE);
  return table;
}

const LOOKUPS = {
  standard: buildLookup('standard'),
  url: buildLookup('url'),
  auto: buildLookup('auto'),
};

/** Encodes bytes. This is the primitive; the text helpers wrap it. */
export function encodeBytes(bytes: Uint8Array, options: EncodeOptions = {}): string {
  const { alphabet = 'standard', padding = true, lineLength = 0, newline = '\n' } = options;
  const alpha = alphabetFor(alphabet);
  let out = '';

  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];

    out += alpha[b0 >> 2];
    if (b1 === undefined) {
      out += alpha[(b0 & 0x03) << 4];
      if (padding) out += '==';
      break;
    }
    out += alpha[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (b2 === undefined) {
      out += alpha[(b1 & 0x0f) << 2];
      if (padding) out += '=';
      break;
    }
    out += alpha[((b1 & 0x0f) << 2) | (b2 >> 6)];
    out += alpha[b2 & 0x3f];
  }

  if (lineLength > 0) {
    const chunks: string[] = [];
    for (let i = 0; i < out.length; i += lineLength) chunks.push(out.slice(i, i + lineLength));
    return chunks.join(newline);
  }
  return out;
}

/** Decodes to bytes. Throws {@link Base64Error} rather than returning garbage. */
export function decodeToBytes(input: string, options: DecodeOptions = {}): Uint8Array {
  const { alphabet = 'auto', mode = 'strict' } = options;
  const lookup = LOOKUPS[alphabet];

  let cleaned = input;
  if (mode === 'lenient') {
    cleaned = input.replace(/[\s\r\n\t]/g, '');
  } else if (/\s/.test(input)) {
    const position = input.search(/\s/);
    throw new Base64Error(
      'Whitespace is not allowed in strict mode. Switch to lenient to ignore line breaks and spaces.',
      position,
    );
  }

  // Separate padding so the body can be validated on its own.
  let body = cleaned;
  let pad = 0;
  while (body.endsWith('=')) {
    body = body.slice(0, -1);
    pad++;
  }
  if (pad > 2) throw new Base64Error('More than two padding characters.', body.length);
  if (body.includes('=')) throw new Base64Error('Padding appears before the end of the input.', body.indexOf('='));

  for (let i = 0; i < body.length; i++) {
    const code = body.charCodeAt(i);
    if (code > 127 || lookup[code] === -1) {
      const ch = body[i]!;
      const hint =
        alphabet !== 'auto' && (STANDARD.includes(ch) || URLSAFE.includes(ch))
          ? ` "${ch}" belongs to the other alphabet.`
          : '';
      throw new Base64Error(`"${ch}" is not a Base64 character.${hint}`, i);
    }
  }

  const remainder = body.length % 4;
  if (remainder === 1) {
    throw new Base64Error('Truncated input: a Base64 group cannot be a single character.', body.length);
  }

  // A remainder is legal as long as padding makes the total a multiple of four.
  const expectedPad = remainder === 0 ? 0 : 4 - remainder;
  if (mode === 'strict' && pad !== expectedPad) {
    if (pad === 0) {
      throw new Base64Error(
        `Missing padding: expected ${expectedPad} "=" character${expectedPad === 1 ? '' : 's'}. Switch to lenient to accept unpadded input.`,
        cleaned.length,
      );
    }
    throw new Base64Error(
      `Padding length does not match the input length: found ${pad} but expected ${expectedPad}.`,
      cleaned.length,
    );
  }

  const groups = Math.floor(body.length / 4);
  const tail = body.length % 4;
  const byteLength = groups * 3 + (tail === 2 ? 1 : tail === 3 ? 2 : 0);
  const out = new Uint8Array(byteLength);

  let o = 0;
  let i = 0;
  for (; i + 4 <= body.length; i += 4) {
    const v =
      (lookup[body.charCodeAt(i)]! << 18) |
      (lookup[body.charCodeAt(i + 1)]! << 12) |
      (lookup[body.charCodeAt(i + 2)]! << 6) |
      lookup[body.charCodeAt(i + 3)]!;
    out[o++] = (v >> 16) & 0xff;
    out[o++] = (v >> 8) & 0xff;
    out[o++] = v & 0xff;
  }

  if (tail === 2) {
    const a = lookup[body.charCodeAt(i)]!;
    const b = lookup[body.charCodeAt(i + 1)]!;
    if (mode === 'strict' && (b & 0x0f) !== 0) {
      throw new Base64Error(
        `Non-canonical encoding: "${body[i + 1]}" leaves non-zero bits that decode to nothing. Switch to lenient to ignore them.`,
        i + 1,
      );
    }
    out[o++] = (a << 2) | (b >> 4);
  } else if (tail === 3) {
    const a = lookup[body.charCodeAt(i)]!;
    const b = lookup[body.charCodeAt(i + 1)]!;
    const c = lookup[body.charCodeAt(i + 2)]!;
    if (mode === 'strict' && (c & 0x03) !== 0) {
      throw new Base64Error(
        `Non-canonical encoding: "${body[i + 2]}" leaves non-zero bits that decode to nothing. Switch to lenient to ignore them.`,
        i + 2,
      );
    }
    out[o++] = (a << 2) | (b >> 4);
    out[o++] = ((b & 0x0f) << 4) | (c >> 2);
  }

  return out;
}

/** Encodes text as UTF-8, then Base64. */
export function encodeText(text: string, options: EncodeOptions = {}): string {
  return encodeBytes(new TextEncoder().encode(text), options);
}

/**
 * Decodes Base64 and interprets the bytes as UTF-8.
 *
 * Invalid UTF-8 sequences become U+FFFD rather than throwing, which matches
 * what `TextDecoder` does by default. Use {@link decodeToBytes} when the payload
 * is not text.
 */
export function decodeToText(input: string, options: DecodeOptions = {}): string {
  return new TextDecoder().decode(decodeToBytes(input, options));
}

/** True if the bytes decode as well-formed UTF-8. */
export function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Lowercase hex, two characters per byte. Handy for inspecting binary output. */
export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/** Best-effort guess at which alphabet a string uses. */
export function detectAlphabet(input: string): Base64Alphabet | 'ambiguous' {
  const hasStandardOnly = /[+/]/.test(input);
  const hasUrlOnly = /[-_]/.test(input);
  if (hasStandardOnly && !hasUrlOnly) return 'standard';
  if (hasUrlOnly && !hasStandardOnly) return 'url';
  return 'ambiguous';
}
