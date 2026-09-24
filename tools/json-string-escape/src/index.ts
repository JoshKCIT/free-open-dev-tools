import meta from './meta.json';

export { meta };

export class JsonStringError extends Error {
  /** Index into the input where the problem was found. */
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'JsonStringError';
    this.position = position;
  }
}

export interface StringWarning {
  message: string;
  position: number;
}

/** Returned by both {@link escapeString} and {@link unescapeString}. `warnings` is empty in the ordinary case. */
export interface StringResult {
  value: string;
  warnings: StringWarning[];
}

/**
 * The eight two-character escapes RFC 8259 section 7 defines, as a single
 * record from code unit to its escape spelling. Kept as one table (rather
 * than scattered through the walker below) so the meaning of each escape is
 * declared once.
 */
const TWO_CHAR_ESCAPES = new Map<number, string>([
  [0x22, '\\"'], // quotation mark
  [0x5c, '\\\\'], // reverse solidus
  [0x08, '\\b'], // backspace
  [0x0c, '\\f'], // form feed
  [0x0a, '\\n'], // line feed
  [0x0d, '\\r'], // carriage return
  [0x09, '\\t'], // tab
  // Forward slash (0x2F) is deliberately absent: RFC 8259 section 7 permits
  // escaping it but does not require it, so it is handled as its own
  // conditional branch below rather than being unconditional like the seven
  // characters above.
]);
const TWO_CHAR_UNESCAPES = new Map<string, string>([
  ['"', '"'],
  ['\\', '\\'],
  ['/', '/'],
  ['b', '\b'],
  ['f', '\f'],
  ['n', '\n'],
  ['r', '\r'],
  ['t', '\t'],
]);

function toUnicodeEscape(code: number): string {
  return '\\u' + code.toString(16).toUpperCase().padStart(4, '0');
}

function isHighSurrogate(code: number | undefined): boolean {
  return code !== undefined && code >= 0xd800 && code <= 0xdbff;
}
function isLowSurrogate(code: number | undefined): boolean {
  return code !== undefined && code >= 0xdc00 && code <= 0xdfff;
}

export interface EscapeOptions {
  /** Escape the forward slash as \/. RFC 8259 section 7 permits this but does not require it. Default false. */
  escapeForwardSlash?: boolean;
  /** Escape every character above ASCII as \uXXXX (two escapes for a surrogate pair). Default false. */
  escapeAboveAscii?: boolean;
  /** Surround the result in double quotes, as a complete JSON string literal. Default false. */
  wrap?: boolean;
}

/**
 * Escapes a string's contents exactly as RFC 8259 section 7 defines.
 *
 * Walks the input by UTF-16 code unit, never by code point, so a character
 * outside the Basic Multilingual Plane naturally produces its two escapes --
 * exactly what the RFC's own worked example, the G clef character (code
 * point 0x1D11E), shows. This is deliberate: delegating to the engine's own
 * JSON serialiser would give whatever escapes the engine chose, with no
 * control over the forward slash, no control over non-ASCII, and no position
 * on a failure (see `unescapeString` for the failure case).
 *
 * A lone (unpaired) surrogate is ALWAYS escaped, even with `escapeAboveAscii`
 * off -- that option governs ordinary non-ASCII characters; an unpaired
 * surrogate cannot be emitted raw regardless, because the result would not
 * be a valid string literal in the format this function claims to produce.
 * The engine's own JSON serialiser escapes it for the same reason; this
 * package writes its own walk and so does not inherit that behaviour
 * automatically, which is why it is stated here and asserted by a named
 * test.
 */
export function escapeString(text: string, options: EscapeOptions = {}): StringResult {
  const { escapeForwardSlash = false, escapeAboveAscii = false, wrap = false } = options;
  const warnings: StringWarning[] = [];
  let out = '';

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const ch = text[i]!;

    const twoChar = TWO_CHAR_ESCAPES.get(code);
    if (twoChar !== undefined) {
      out += twoChar;
      continue;
    }
    if (ch === '/' && escapeForwardSlash) {
      out += '\\/';
      continue;
    }
    if (code < 0x20) {
      out += toUnicodeEscape(code);
      continue;
    }

    if (code >= 0xd800 && code <= 0xdfff) {
      const pairedProperly =
        (isHighSurrogate(code) && isLowSurrogate(text.charCodeAt(i + 1))) ||
        (isLowSurrogate(code) && i > 0 && isHighSurrogate(text.charCodeAt(i - 1)));
      if (!pairedProperly) {
        warnings.push({
          message: `${toUnicodeEscape(code)} at position ${i} is an unpaired surrogate with no matching half in this text. It has been escaped rather than emitted raw; RFC 8259 section 8.2 permits this in a JSON string but notes it is not interoperable.`,
          position: i,
        });
        out += toUnicodeEscape(code);
        continue;
      }
      if (escapeAboveAscii) {
        out += toUnicodeEscape(code);
        continue;
      }
      out += ch;
      continue;
    }

    if (escapeAboveAscii && code > 0x7f) {
      out += toUnicodeEscape(code);
      continue;
    }
    out += ch;
  }

  return { value: wrap ? `"${out}"` : out, warnings };
}

export interface UnescapeOptions {
  /**
   * Reject a lone (unpaired) surrogate escape instead of accepting it with a
   * warning. RFC 8259 section 8.2 permits a lone surrogate escape in the
   * grammar it defines, so this is stricter than the RFC on purpose. Default
   * false, because the default must match the grammar `standards` cites.
   */
  strict?: boolean;
  /** Expect the input to be a complete, double-quoted string literal and strip the quotes. Default false. */
  wrap?: boolean;
}

/**
 * Unescapes a JSON string literal's contents exactly as RFC 8259 section 7
 * defines. A strict reader: it accepts exactly what the RFC's grammar
 * allows and refuses everything else, naming the offending character and
 * its position.
 *
 * "Exactly what the RFC's grammar allows" includes a lone surrogate escape,
 * and that is not negotiable: RFC 8259 section 8.2 prints "\uDEAD" (a single
 * unpaired UTF-16 surrogate) as a string its own grammar permits, while
 * calling it problematic for interoperability. So a lone surrogate escape
 * is ACCEPTED here, producing the lone code unit, and reported through
 * `warnings` with its position and which half is missing -- never silently
 * dropped, and never rejected by default. The `strict` option exists for a
 * caller that needs well-formed Unicode and is willing to be stricter than
 * the RFC.
 */
export function unescapeString(literal: string, options: UnescapeOptions = {}): StringResult {
  const { strict = false, wrap = false } = options;

  let input = literal;
  let offset = 0;
  if (wrap) {
    if (input.length < 2 || input[0] !== '"' || input[input.length - 1] !== '"') {
      throw new JsonStringError('Expected a complete string literal, starting and ending with a quotation mark.', 0);
    }
    input = input.slice(1, -1);
    offset = 1;
  }

  const warnings: StringWarning[] = [];
  let out = '';
  let i = 0;

  while (i < input.length) {
    const ch = input[i]!;

    if (ch !== '\\') {
      const code = input.charCodeAt(i);
      if (code < 0x20) {
        throw new JsonStringError(
          `Control character U+${code.toString(16).toUpperCase().padStart(4, '0')} must be escaped; it cannot appear raw in a JSON string.`,
          offset + i,
        );
      }
      if (ch === '"') {
        throw new JsonStringError('A quotation mark must be escaped as \\" inside a string literal.', offset + i);
      }
      out += ch;
      i++;
      continue;
    }

    const next = input[i + 1];
    if (next === undefined) {
      throw new JsonStringError('A reverse solidus at the end of the input has nothing to escape.', offset + i);
    }

    if (next === 'u') {
      const hex = input.slice(i + 2, i + 6);
      if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
        throw new JsonStringError(
          `"\\u" must be followed by exactly four hexadecimal digits; found "${hex}".`,
          offset + i,
        );
      }
      const code = parseInt(hex, 16);
      const spelling = '\\u' + hex.toUpperCase();

      if (code >= 0xd800 && code <= 0xdbff) {
        const pairMatch = /^\\u([0-9a-fA-F]{4})$/.exec(input.slice(i + 6, i + 12));
        const low = pairMatch ? parseInt(pairMatch[1]!, 16) : undefined;
        if (pairMatch && low !== undefined && low >= 0xdc00 && low <= 0xdfff) {
          out += String.fromCharCode(code, low);
          i += 12;
          continue;
        }
        if (strict) {
          throw new JsonStringError(
            `${spelling} is a high surrogate with no low surrogate escape following it (the low half is missing). RFC 8259 section 8.2 permits this but the strict-Unicode option is stricter than the RFC on purpose.`,
            offset + i,
          );
        }
        warnings.push({
          message: `${spelling} is a high surrogate with no low surrogate escape following it (the low half is missing). RFC 8259 section 8.2 permits this but notes it is not interoperable.`,
          position: offset + i,
        });
        out += String.fromCharCode(code);
        i += 6;
        continue;
      }

      if (code >= 0xdc00 && code <= 0xdfff) {
        if (strict) {
          throw new JsonStringError(
            `${spelling} is a low surrogate with no high surrogate escape before it (the high half is missing). RFC 8259 section 8.2 permits this but the strict-Unicode option is stricter than the RFC on purpose.`,
            offset + i,
          );
        }
        warnings.push({
          message: `${spelling} is a low surrogate with no high surrogate escape before it (the high half is missing). RFC 8259 section 8.2 permits this but notes it is not interoperable.`,
          position: offset + i,
        });
        out += String.fromCharCode(code);
        i += 6;
        continue;
      }

      out += String.fromCharCode(code);
      i += 6;
      continue;
    }

    const plain = TWO_CHAR_UNESCAPES.get(next);
    if (plain !== undefined) {
      out += plain;
      i += 2;
      continue;
    }

    throw new JsonStringError(`"\\${next}" is not one of the escapes RFC 8259 section 7 defines.`, offset + i);
  }

  return { value: out, warnings };
}
