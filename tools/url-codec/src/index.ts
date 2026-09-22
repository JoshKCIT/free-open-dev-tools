import meta from './meta.json';

export { meta };

/**
 * The three encodings people mean when they say "URL encode". They are not
 * interchangeable, and picking the wrong one is the single most common cause
 * of a value arriving corrupted.
 */
export type UrlEncodingMode =
  /** One piece of a URL: a path segment, a query value, a fragment. Escapes `/`, `?`, `&`, `=`, `#`. */
  | 'component'
  /** A whole URL. Leaves the structural characters alone so the URL still parses. */
  | 'uri'
  /** HTML form submission. Space becomes `+`, and `~` is escaped. */
  | 'form';

export interface EncodeOptions {
  mode?: UrlEncodingMode;
  /**
   * `encodeURIComponent` leaves `!`, `'`, `(`, `)` and `*` unescaped even though
   * RFC 3986 lists them as sub-delimiters. Turn this on to escape them too,
   * which some servers and signing schemes require. Ignored in `uri` mode.
   */
  strictRfc3986?: boolean;
  /** Emit `%2f` instead of `%2F`. Both are valid; uppercase is the RFC's preference. */
  lowercaseHex?: boolean;
}

export interface DecodeOptions {
  mode?: UrlEncodingMode;
  /**
   * Strict rejects a malformed escape such as a lone `%` or `%zz`. Lenient
   * leaves it in place, which is what browsers do with a pasted URL.
   */
  onMalformed?: 'throw' | 'keep';
}

export class UrlCodecError extends Error {
  readonly position: number;
  constructor(message: string, position: number) {
    super(message);
    this.name = 'UrlCodecError';
    this.position = position;
  }
}

// RFC 3986 section 2.3. These never need escaping in any part of a URI.
const UNRESERVED = /[A-Za-z0-9\-._~]/;
// Characters encodeURIComponent leaves alone but RFC 3986 treats as reserved.
const LEGACY_UNESCAPED = "!'()*";

function toHex(byte: number, lowercase: boolean): string {
  const hex = byte.toString(16).padStart(2, '0');
  return '%' + (lowercase ? hex : hex.toUpperCase());
}

function percentEncodeBytes(text: string, keep: (ch: string) => boolean, lowercase: boolean): string {
  const encoder = new TextEncoder();
  let out = '';
  // Iterating by code point keeps surrogate pairs together.
  for (const ch of text) {
    if (ch.length === 1 && keep(ch)) {
      out += ch;
      continue;
    }
    for (const byte of encoder.encode(ch)) out += toHex(byte, lowercase);
  }
  return out;
}

export function encode(text: string, options: EncodeOptions = {}): string {
  const { mode = 'component', strictRfc3986 = false, lowercaseHex = false } = options;

  if (mode === 'uri') {
    // Preserve the characters that give a URI its structure, exactly as
    // encodeURI does, so the result is still a parseable URL.
    const reserved = '#$&+,/:;=?@[]';
    return percentEncodeBytes(
      text,
      (ch) => UNRESERVED.test(ch) || reserved.includes(ch) || LEGACY_UNESCAPED.includes(ch),
      lowercaseHex,
    );
  }

  if (mode === 'form') {
    // application/x-www-form-urlencoded, as the URL Standard defines it:
    // space becomes '+', and only * - . _ survive alongside alphanumerics.
    let out = '';
    const encoder = new TextEncoder();
    for (const ch of text) {
      if (ch === ' ') {
        out += '+';
      } else if (ch.length === 1 && /[A-Za-z0-9*\-._]/.test(ch)) {
        out += ch;
      } else {
        for (const byte of encoder.encode(ch)) out += toHex(byte, lowercaseHex);
      }
    }
    return out;
  }

  return percentEncodeBytes(
    text,
    (ch) => UNRESERVED.test(ch) || (!strictRfc3986 && LEGACY_UNESCAPED.includes(ch)),
    lowercaseHex,
  );
}

function hexValue(ch: string | undefined): number {
  if (ch === undefined) return -1;
  const code = ch.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
}

export function decode(text: string, options: DecodeOptions = {}): string {
  const { mode = 'component', onMalformed = 'throw' } = options;
  const source = mode === 'form' ? text.replace(/\+/g, ' ') : text;

  const bytes: number[] = [];
  const decoder = new TextDecoder('utf-8');
  let out = '';

  const flush = () => {
    if (bytes.length === 0) return;
    out += decoder.decode(new Uint8Array(bytes));
    bytes.length = 0;
  };

  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (ch !== '%') {
      flush();
      out += ch;
      continue;
    }
    const hi = hexValue(source[i + 1]);
    const lo = hexValue(source[i + 2]);
    if (hi < 0 || lo < 0) {
      const snippet = source.slice(i, i + 3);
      if (onMalformed === 'throw') {
        flush();
        throw new UrlCodecError(
          `Malformed escape "${snippet}" at position ${i}. A percent sign must be followed by two hexadecimal digits, or written as %25.`,
          i,
        );
      }
      flush();
      out += ch;
      continue;
    }
    bytes.push(hi * 16 + lo);
    i += 2;
  }
  flush();
  return out;
}

export interface EncodingReport {
  mode: UrlEncodingMode;
  output: string;
}

/** Runs all three encodings so the differences between them are visible at once. */
export function encodeAll(text: string, options: Omit<EncodeOptions, 'mode'> = {}): EncodingReport[] {
  return (['component', 'uri', 'form'] as const).map((mode) => ({
    mode,
    output: encode(text, { ...options, mode }),
  }));
}

/** True when the text contains no character that would need escaping in the given mode. */
export function isAlreadyEncoded(text: string, mode: UrlEncodingMode = 'component'): boolean {
  return encode(decode(text, { mode, onMalformed: 'keep' }), { mode }) === text;
}

/** Counts how many characters the encoding would change, for a size estimate. */
export function expansion(text: string, mode: UrlEncodingMode = 'component'): { from: number; to: number } {
  return { from: text.length, to: encode(text, { mode }).length };
}
