/**
 * Hex and Base64 encoding, decoding and strict UTF-8 decoding. Built on
 * `atob`/`btoa` (available in every browser and in Node 20+), never Node's
 * `Buffer`, so a copied-out folder needs nothing extra installed.
 *
 * `what` labels the field a parse error is about ("key", "IV", "ciphertext",
 * ...) so a message can say what was wrong without ever quoting the
 * offending character back -- for a field that might be a secret ("key",
 * "passphrase"), the character itself is never part of the message (S2).
 */

/**
 * Thrown by every function in this package. `kind` says what kind of
 * problem it is:
 *  - `'input'`: the visitor's text is not shaped the way this function
 *    needs (bad hex/Base64, wrong length, out-of-range option).
 *  - `'decrypt'`: decryption failed (wrong passphrase/key, tampered data,
 *    bad padding, bad GCM tag). One fixed message per failure class; never
 *    a raw error from `crypto.subtle` or `@noble/hashes`.
 *  - `'unavailable'`: `crypto.subtle` is not available in this context.
 * `position` is a character index into the relevant field, present only
 * when a specific position is known. Never a fragment of a secret.
 */
export class AesError extends Error {
  readonly kind: 'input' | 'decrypt' | 'unavailable';
  readonly position?: number;
  constructor(message: string, kind: 'input' | 'decrypt' | 'unavailable' = 'input', position?: number) {
    super(message);
    this.name = 'AesError';
    this.kind = kind;
    this.position = position;
  }
}

const HEX_DIGITS = /^[0-9a-fA-F]$/;
const B64_STANDARD = /^[A-Za-z0-9+/]$/;
const B64_URL = /^[A-Za-z0-9\-_]$/;

/** True for the whitespace this module ignores when parsing hex or Base64: space, tab, CR, LF. */
function isIgnorableWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n';
}

/** A field label that might itself carry secret content -- never echo the offending character for these. */
function isSecretField(what: string): boolean {
  return what === 'key' || what === 'passphrase';
}

function badCharError(what: string, position: number, ch: string, expected: string): AesError {
  if (isSecretField(what)) {
    return new AesError(
      `The ${what} is not valid: the character at position ${position} is not ${expected}.`,
      'input',
      position,
    );
  }
  return new AesError(
    `The ${what} is not valid: the character "${ch}" at position ${position} is not ${expected}.`,
    'input',
    position,
  );
}

/**
 * Parses hex text into bytes. Whitespace (space, tab, CR, LF) is ignored
 * anywhere. The remaining text must have an even number of hex digits; an
 * error names the character position in the ORIGINAL string (whitespace
 * included) of the first problem.
 */
export function parseHex(text: string, what: string): Uint8Array {
  const digits: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (isIgnorableWhitespace(ch)) continue;
    if (!HEX_DIGITS.test(ch)) {
      throw badCharError(what, i, ch, 'a hex digit');
    }
    digits.push(ch);
  }
  if (digits.length % 2 !== 0) {
    throw new AesError(`The ${what} is not valid hex: it has an odd number of hex digits.`, 'input');
  }
  const bytes = new Uint8Array(digits.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(digits[i * 2]! + digits[i * 2 + 1]!, 16);
  }
  return bytes;
}

/**
 * Parses Base64 text into bytes. Whitespace is ignored anywhere. Accepts
 * either the standard alphabet (`+`/`/`) or the URL-safe alphabet (`-`/`_`)
 * but not a mix of both in the same string; padding (`=`) is optional but,
 * when present, must be correct. An error names the character position in
 * the original string.
 */
export function parseBase64(text: string, what: string): Uint8Array {
  let core = '';
  let sawStandard = false;
  let sawUrlSafe = false;
  let paddingSeen = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (isIgnorableWhitespace(ch)) continue;
    if (ch === '=') {
      paddingSeen++;
      continue;
    }
    if (paddingSeen > 0) {
      throw new AesError(
        `The ${what} is not valid Base64: a character follows padding ("=") at position ${i}.`,
        'input',
        i,
      );
    }
    if (B64_STANDARD.test(ch)) {
      if (ch === '+' || ch === '/') sawStandard = true;
      core += ch;
      continue;
    }
    if (B64_URL.test(ch)) {
      sawUrlSafe = true;
      core += ch === '-' ? '+' : '/';
      continue;
    }
    throw badCharError(what, i, ch, 'a Base64 character');
  }
  if (sawStandard && sawUrlSafe) {
    throw new AesError(`The ${what} is not valid Base64: it mixes the standard and URL-safe alphabets.`, 'input');
  }
  if (paddingSeen > 2) {
    throw new AesError(`The ${what} is not valid Base64: it has more than two padding characters ("=").`, 'input');
  }
  // Padding is optional (RFC 4648 section 3.2): a length of 4n, 4n+2 or
  // 4n+3 characters (before any padding) is valid; a lone leftover
  // character (4n+1) can never be valid Base64, padded or not.
  if (core.length % 4 === 1) {
    throw new AesError(
      `The ${what} is not valid Base64: its length does not divide evenly into groups of four.`,
      'input',
    );
  }
  const padded = core + '='.repeat((4 - (core.length % 4)) % 4);
  let binary: string;
  try {
    binary = padded === '' ? '' : atob(padded);
  } catch {
    throw new AesError(`The ${what} is not valid Base64: it could not be decoded.`, 'input');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Encodes bytes as lowercase hex. */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Encodes bytes as standard Base64 (with `+`/`/` and `=` padding). */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * Decodes bytes as UTF-8, returning `null` (never throwing) when the bytes
 * are not valid UTF-8 -- used to decide whether decrypted plaintext can be
 * shown as text or must fall back to a hex view.
 */
export function decodeUtf8Strict(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * `crypto.subtle` is available only in a secure context in a browser
 * (https, or localhost); Node (tests, the standalone check) is unaffected.
 * Checked at the top of every async entry point, mirroring
 * `tools/jwt-signature/src/keys.ts`'s `requireSecureContext`.
 */
export function requireSubtle(): void {
  const g = globalThis as { crypto?: Crypto };
  if (typeof g.crypto === 'undefined' || typeof g.crypto.subtle === 'undefined') {
    throw new AesError(
      'The browser cryptography interface (crypto.subtle) is not available here. It requires a secure context: https, or localhost.',
      'unavailable',
    );
  }
}
