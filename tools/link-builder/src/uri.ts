/**
 * Percent-encoding for email links (RFC 6068), phone links (RFC 3966) and text message links (RFC 5724).
 *
 * - RFC 3986 section 2.3: letters, digits and - . _ ~ never need encoding; every other character is written as the
 *   percent sign and the two uppercase hexadecimal digits of each UTF-8 byte (RFC 6068 section 2, point 4 and 5).
 * - RFC 6068 section 5: a line break in the body is encoded as a carriage return and line feed.
 *
 * Pure functions only: no DOM, no clock, no network, no storage.
 */
const UNRESERVED = /[A-Za-z0-9\-._~]/;

/** RFC 6068 section 2 some-delims without the plus sign, which this encoder always writes as an encoded plus. */
const HEADER_KEPT = "!$'(),*;:@";

/** The delimiters kept literal inside the local part and domain of an address (RFC 6068 section 2, point 1). */
const ADDRESS_KEPT = "!$'()*";

function toHex(byte: number): string {
  return '%' + byte.toString(16).padStart(2, '0').toUpperCase();
}

/**
 * Writes `text` as UTF-8 bytes, each one percent-encoded with uppercase hex, except the characters `keep` accepts.
 * Iterating by code point keeps a surrogate pair together, so an emoji becomes four bytes.
 */
export function percentEncode(text: string, keep: (ch: string) => boolean): string {
  const encoder = new TextEncoder();
  let out = '';
  for (const ch of text) {
    if (ch.length === 1 && keep(ch)) {
      out += ch;
      continue;
    }
    for (const byte of encoder.encode(ch)) out += toHex(byte);
  }
  return out;
}

/**
 * A header field value or body of an email link (RFC 6068 hfvalue): unreserved characters and the delimiters of
 * section 2 are kept, a plus sign is written as an encoded plus (section 5 allows it, and no handler can then read it as
 * a space), and everything else, including a space, a question mark, an equals sign, an ampersand and a number sign,
 * is percent-encoded.
 */
export function encodeHeaderValue(text: string): string {
  return percentEncode(text, (ch) => UNRESERVED.test(ch) || HEADER_KEPT.includes(ch));
}

/**
 * The local part of an address (RFC 6068 section 2, point 1 and 5): only unreserved characters and ! $ ' ( ) * are kept,
 * so a percent sign, an ampersand, a question mark, a quote, a backslash, a space, an at sign, a number sign, a
 * slash, a bracket, an equals sign and a comma inside a quoted local part are all encoded.
 */
export function encodeLocalPart(text: string): string {
  return percentEncode(text, (ch) => UNRESERVED.test(ch) || ADDRESS_KEPT.includes(ch));
}

/** Line breaks (carriage return and line feed, a lone line feed, a lone carriage return) as the one form given. */
function normalizeBreaks(text: string, to: string): string {
  return text.replace(/\r\n|\r|\n/g, to);
}

/**
 * One address written for the address part of an email link: split at its last at sign, each side encoded. An address
 * is always written as typed (encoded); whether it is a valid address is for the caller to warn about.
 */
function encodeAddress(address: string): string {
  const at = address.lastIndexOf('@');
  if (at === -1) return encodeLocalPart(address);
  return `${encodeLocalPart(address.slice(0, at))}@${encodeLocalPart(address.slice(at + 1))}`;
}

export interface MailtoParts {
  to?: string[];
  body?: string;
}

/** The address of an email link, as RFC 6068 section 2 writes it, with the ampersands left bare. */
export function buildMailto(parts: MailtoParts): string {
  const recipients = (parts.to ?? []).map(encodeAddress);
  const fields: string[] = [];
  const body = parts.body ?? '';
  if (body !== '') fields.push(`body=${encodeHeaderValue(normalizeBreaks(body, '\r\n'))}`);
  return `mailto:${recipients.join(',')}${fields.length > 0 ? '?' + fields.join('&') : ''}`;
}
