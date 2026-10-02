/**
 * XML 1.0 text contexts: element content and attribute values.
 *
 * Rules, from the XML 1.0 (Fifth Edition) recommendation, https://www.w3.org/TR/xml/ :
 * - Section 2.2 (Characters): only tab, line feed, carriage return, U+0020 to U+D7FF, U+E000 to U+FFFD and U+10000 to
 *   U+10FFFF may appear in a document, and a character reference may not name any other character either, so a
 *   control character, U+FFFE, U+FFFF or an unpaired surrogate cannot be written at all and is refused.
 * - Section 2.4 (Character Data and Markup): `&` and `<` must be escaped in content, and `>` is escaped too so the
 *   sequence `]]>` can never appear.
 * - Section 3.3.3 (Attribute-Value Normalization): a raw tab, line feed or carriage return in an attribute value is
 *   read back as a space, so an attribute value writes them as character references to keep them.
 * - Section 4.6 (Predefined Entities): `amp`, `lt`, `gt`, `quot` and `apos` are the only entities that need no
 *   declaration. No DTD is ever read, so unescaping accepts those five and numeric character references only.
 * - Section 2.11 (End-of-Line Handling): a raw carriage return in content is read back as a line feed.
 */
import {
  StringEscapeError,
  WRAP_START_MESSAGE,
  hex4,
  hexBare,
  walkCodePoints,
  type LiteralResult,
  type LiteralWarning,
} from './shared';

export type XmlContext = 'xml-text' | 'xml-attribute';

/** The two XML contexts, kept apart from `LANGUAGES` so the existing list is never edited. */
export const XML_LANGUAGES: readonly { id: XmlContext; label: string }[] = [
  { id: 'xml-text', label: 'XML element content' },
  { id: 'xml-attribute', label: 'XML attribute value' },
];

export interface XmlEscapeOptions {
  context: XmlContext;
  /** The quote an attribute value is written in. Default double quote. */
  quote?: '"' | "'";
  /** Write every character above U+007F as a hexadecimal character reference (one reference per character). */
  escapeNonAscii?: boolean;
  /** Add the quote characters around an attribute value. Default true; element content has no quotes. */
  wrap?: boolean;
}

export interface XmlUnescapeOptions {
  context: XmlContext;
  quote?: '"' | "'";
  /** Read the input as a quoted attribute value. Default true; element content has no quotes. */
  wrap?: boolean;
}

/** XML 1.0 section 2.2, production [2] Char. */
function isXmlChar(code: number): boolean {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

function describeForbidden(code: number): string {
  return `U+${hex4(code)} is not a character XML 1.0 allows, so it cannot be written, not even as a reference`;
}

/** Escapes text for XML element content or an XML attribute value. */
export function escapeXml(text: string, options: XmlEscapeOptions): LiteralResult {
  const attribute = options.context === 'xml-attribute';
  const quote = options.quote ?? '"';
  const escapeNonAscii = options.escapeNonAscii ?? false;
  const warnings: LiteralWarning[] = [];
  let out = '';
  for (const unit of walkCodePoints(text)) {
    if (!isXmlChar(unit.code)) throw new StringEscapeError(describeForbidden(unit.code), unit.index);
    const ch = text.slice(unit.index, unit.index + unit.length);
    if (ch === '&') out += '&amp;';
    else if (ch === '<') out += '&lt;';
    else if (ch === '>') out += '&gt;';
    else if (attribute && ch === quote) out += quote === '"' ? '&quot;' : '&apos;';
    else if (attribute && ch === '\t') out += '&#9;';
    else if (attribute && ch === '\n') out += '&#10;';
    else if (attribute && ch === '\r') out += '&#13;';
    else if (escapeNonAscii && unit.code > 0x7f) out += `&#x${hexBare(unit.code)};`;
    else {
      if (!attribute && ch === '\r') {
        warnings.push({
          message: 'a raw carriage return in element content is read back as a line feed (XML 1.0 section 2.11)',
          position: unit.index,
        });
      }
      out += ch;
    }
  }
  const wrap = attribute && (options.wrap ?? true);
  return { value: wrap ? quote + out + quote : out, warnings };
}

const PREDEFINED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** The longest reference body that can be valid: `#x10FFFF` with room for leading zeros is cut off here. */
const MAX_REFERENCE_LENGTH = 24;

function readReference(body: string, at: number): string {
  const predefined = PREDEFINED[body];
  if (predefined !== undefined) return predefined;
  const decimal = /^#([0-9]+)$/.exec(body);
  const hexadecimal = /^#x([0-9a-fA-F]+)$/.exec(body);
  const digits = decimal?.[1] ?? hexadecimal?.[1];
  if (digits === undefined) {
    throw new StringEscapeError(
      `"&${body};" is not one of the five predefined entities or a numeric character reference, and no DTD is read to declare any other`,
      at,
    );
  }
  const code = decimal ? Number.parseInt(digits, 10) : Number.parseInt(digits, 16);
  if (digits.length > 8 || code > 0x10ffff) {
    throw new StringEscapeError(`"&${body};" names a code point beyond U+10FFFF`, at);
  }
  if (!isXmlChar(code)) {
    throw new StringEscapeError(`"&${body};" names U+${hex4(code)}, a character XML 1.0 does not allow`, at);
  }
  return String.fromCodePoint(code);
}

/**
 * Reads XML element content or an XML attribute value back to plain text. A strict left-to-right reader: only the five
 * predefined entities and numeric character references are read, and a raw `<`, a bare `&`, a character XML 1.0 does
 * not allow, or (in a quoted attribute value) the closing quote itself is refused with its position.
 */
export function unescapeXml(input: string, options: XmlUnescapeOptions): LiteralResult {
  if (input === '') return { value: '', warnings: [] };
  const attribute = options.context === 'xml-attribute';
  let body = input;
  let offset = 0;
  let closing: string | null = null;
  if (attribute && (options.wrap ?? true)) {
    const first = input[0];
    if ((first !== '"' && first !== "'") || input.length < 2 || input[input.length - 1] !== first) {
      throw new StringEscapeError(WRAP_START_MESSAGE, 0);
    }
    closing = first;
    body = input.slice(1, -1);
    offset = 1;
  }

  let out = '';
  let i = 0;
  while (i < body.length) {
    const code = body.codePointAt(i)!;
    const width = code > 0xffff ? 2 : 1;
    const ch = body.slice(i, i + width);
    const at = offset + i;
    if (!isXmlChar(code)) throw new StringEscapeError(describeForbidden(code), at);
    if (ch === '<') {
      throw new StringEscapeError('a raw "<" cannot appear in XML text or an attribute value; write it as &lt;', at);
    }
    if (closing !== null && ch === closing) {
      throw new StringEscapeError(
        `the quote that closes the value cannot appear inside it; write it as ${closing === '"' ? '&quot;' : '&apos;'}`,
        at,
      );
    }
    if (ch === '&') {
      let end = -1;
      const limit = Math.min(body.length, i + 1 + MAX_REFERENCE_LENGTH);
      for (let j = i + 1; j < limit; j++) {
        if (body[j] === ';') {
          end = j;
          break;
        }
      }
      if (end === -1) {
        throw new StringEscapeError('a bare "&" must begin a reference such as &amp; that ends in ";"', at);
      }
      out += readReference(body.slice(i + 1, end), at);
      i = end + 1;
      continue;
    }
    if (ch === '\r' || ch === '\n' || ch === '\t') {
      // XML 1.0 2.11: a carriage return, or a carriage return and line feed, is one line feed; 3.3.3: in an attribute
      // value each raw tab, line feed or carriage return is then read as a space.
      if (ch === '\r' && body[i + 1] === '\n') i++;
      out += attribute ? ' ' : ch === '\t' ? '\t' : '\n';
      i++;
      continue;
    }
    out += ch;
    i += width;
  }
  return { value: out, warnings: [] };
}
