/**
 * RFC 6901 JSON Pointer: encoding and decoding one reference token, and
 * formatting or parsing a whole pointer string.
 */

export class PointerSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PointerSyntaxError';
  }
}

/**
 * Encodes one reference token for use inside a pointer: every `~` becomes
 * `~0`, then every `/` becomes `~1` (RFC 6901 section 3).
 */
export function encodePointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Decodes one reference token read from a pointer. Each `~` must be
 * followed by `0` or `1`; `~0` decodes to `~` and `~1` decodes to `/`. This
 * walks the token once, left to right, deciding each pair as it goes, which
 * gives the same result as RFC 6901 section 4's two-pass rule (turn `~1`
 * into `/` before turning `~0` into `~`) without the trap of running the
 * passes in the wrong order: `~01` decodes to `~1`, never to a slash.
 */
export function decodePointerToken(token: string): string {
  let out = '';
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === '~') {
      const next = token[i + 1];
      if (next !== '0' && next !== '1') {
        throw new PointerSyntaxError(
          `A "~" in a JSON Pointer token must be followed by "0" or "1", found ${
            next === undefined ? 'the end of the token' : `"${next}"`
          }.`,
        );
      }
      out += next === '0' ? '~' : '/';
      i++;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Joins a list of already-decoded reference tokens into one pointer string. Empty list gives the whole-document pointer `''`. */
export function formatPointer(tokens: string[]): string {
  if (tokens.length === 0) return '';
  return '/' + tokens.map(encodePointerToken).join('/');
}

/** Splits a pointer string into its decoded reference tokens. `''` gives no tokens (the whole document). */
export function parsePointer(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) {
    throw new PointerSyntaxError(`A JSON Pointer must be empty or start with "/", got "${pointer}".`);
  }
  return pointer
    .slice(1)
    .split('/')
    .map((token) => decodePointerToken(token));
}

/**
 * True for a reference token that is a valid RFC 6901 array index: `0`, or a
 * run of digits with no leading zero (section 4's `array-index` rule).
 */
export function isArrayIndexToken(token: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(token);
}
