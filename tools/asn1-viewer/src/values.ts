import type { Asn1Node } from './ber';
import { MAX_DECIMAL_BYTES, MAX_DEPTH, MAX_HEX_SHOWN, MAX_OID_BYTES, MAX_TEXT_SHOWN, withCommas } from './limits';
import { oidName } from './oids';
import { visible } from './visible';

/** What a primitive element holds, written for a person. */
export interface ValueInfo {
  /** The value as shown after the type name. Empty when the type name says it all (NULL, SEQUENCE). */
  text: string;
  /** The decoded character string, or the text of content that is all printable ASCII; already made safe to show. */
  string?: string;
  /** The exact value of an INTEGER or ENUMERATED of up to 64 content bytes. */
  integer?: bigint;
  /** The dotted digits of an OBJECT IDENTIFIER, and the name from the built-in lists when there is one. */
  oid?: string;
  name?: string;
  /** Facts about the content that are wrong or odd, each a short sentence without the content in it. */
  problems: string[];
}

/** The universal tag numbers X.680 assigns, by name. */
export const UNIVERSAL_NAMES: ReadonlyMap<number, string> = new Map([
  [1, 'BOOLEAN'],
  [2, 'INTEGER'],
  [3, 'BIT STRING'],
  [4, 'OCTET STRING'],
  [5, 'NULL'],
  [6, 'OBJECT IDENTIFIER'],
  [7, 'ObjectDescriptor'],
  [8, 'EXTERNAL'],
  [9, 'REAL'],
  [10, 'ENUMERATED'],
  [11, 'EMBEDDED PDV'],
  [12, 'UTF8String'],
  [13, 'RELATIVE-OID'],
  [14, 'TIME'],
  [16, 'SEQUENCE'],
  [17, 'SET'],
  [18, 'NumericString'],
  [19, 'PrintableString'],
  [20, 'TeletexString'],
  [21, 'VideotexString'],
  [22, 'IA5String'],
  [23, 'UTCTime'],
  [24, 'GeneralizedTime'],
  [25, 'GraphicString'],
  [26, 'VisibleString'],
  [27, 'GeneralString'],
  [28, 'UniversalString'],
  [29, 'CHARACTER STRING'],
  [30, 'BMPString'],
  [31, 'DATE'],
  [32, 'TIME-OF-DAY'],
  [33, 'DATE-TIME'],
  [34, 'DURATION'],
  [35, 'OID-IRI'],
  [36, 'RELATIVE-OID-IRI'],
]);

/** The type of an element: its universal name, or `[n]` with the class for any other class, as ASN.1 writes a tag. */
export function typeName(node: Asn1Node): string {
  if (node.eoc) return 'end-of-contents';
  if (node.cls === 'universal') return UNIVERSAL_NAMES.get(node.tag) ?? `universal tag ${node.tag}`;
  if (node.cls === 'context') return `[${node.tag}]`;
  return `[${node.cls.toUpperCase()} ${node.tag}]`;
}

/** Lower case hex of the bytes. */
export function hexOf(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i]!.toString(16).padStart(2, '0');
  return out;
}

/** Hex of at most 64 bytes, with the size when it was cut. */
function shownHex(content: Uint8Array): string {
  if (content.length === 0) return 'empty';
  if (content.length <= MAX_HEX_SHOWN) return hexOf(content);
  return `${hexOf(content.subarray(0, MAX_HEX_SHOWN))}... (${withCommas(content.length)} bytes)`;
}

function printable(content: Uint8Array): boolean {
  if (content.length === 0) return false;
  for (let i = 0; i < content.length; i++) {
    const octet = content[i]!;
    if (octet < 0x20 || octet > 0x7e) return false;
  }
  return true;
}

function countCharacters(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    // A high surrogate followed by a low surrogate is one character.
    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i++;
    }
    count++;
  }
  return count;
}

/** A character string made safe to show, quoted, with its length when it was cut. */
function shownString(text: string): { shown: string; label: string } {
  const shown = visible(text, MAX_TEXT_SHOWN);
  const cutShort = text.length > MAX_TEXT_SHOWN && countCharacters(text) > MAX_TEXT_SHOWN;
  return { shown, label: `"${shown}"${cutShort ? ` (${withCommas(countCharacters(text))} characters)` : ''}` };
}

const REPLACEMENT = String.fromCodePoint(0xfffd);

/** One byte per character, bytes above 127 written as U+FFFD when `strict` is set. */
function singleByteText(content: Uint8Array, strict: boolean): { text: string; replaced: boolean } {
  const pieces: string[] = [];
  let replaced = false;
  for (let i = 0; i < content.length; i += 4096) {
    const part = content.subarray(i, Math.min(content.length, i + 4096));
    if (!strict) {
      pieces.push(String.fromCharCode(...part));
      continue;
    }
    let chunk = '';
    for (const octet of part) {
      if (octet > 127) {
        replaced = true;
        chunk += REPLACEMENT;
      } else {
        chunk += String.fromCharCode(octet);
      }
    }
    pieces.push(chunk);
  }
  return { text: pieces.join(''), replaced };
}

function bmpText(content: Uint8Array): { text: string; replaced: boolean } {
  const pieces: string[] = [];
  let replaced = false;
  for (let i = 0; i < content.length; i += 2) {
    if (i + 1 >= content.length) {
      replaced = true;
      pieces.push(REPLACEMENT);
      break;
    }
    const unit = (content[i]! << 8) | content[i + 1]!;
    if (unit >= 0xd800 && unit <= 0xdbff && i + 3 < content.length) {
      const next = (content[i + 2]! << 8) | content[i + 3]!;
      if (next >= 0xdc00 && next <= 0xdfff) {
        pieces.push(String.fromCharCode(unit, next));
        i += 2;
        continue;
      }
    }
    if (unit >= 0xd800 && unit <= 0xdfff) {
      replaced = true;
      pieces.push(REPLACEMENT);
    } else {
      pieces.push(String.fromCharCode(unit));
    }
  }
  return { text: pieces.join(''), replaced };
}

function universalText(content: Uint8Array): { text: string; replaced: boolean } {
  const pieces: string[] = [];
  let replaced = false;
  for (let i = 0; i < content.length; i += 4) {
    if (i + 3 >= content.length) {
      replaced = true;
      pieces.push(REPLACEMENT);
      break;
    }
    const point = ((content[i]! << 24) | (content[i + 1]! << 16) | (content[i + 2]! << 8) | content[i + 3]!) >>> 0;
    if (point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) {
      replaced = true;
      pieces.push(REPLACEMENT);
    } else {
      pieces.push(String.fromCodePoint(point));
    }
  }
  return { text: pieces.join(''), replaced };
}

function utf8Text(content: Uint8Array): { text: string; replaced: boolean } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content), replaced: false };
  } catch {
    return { text: new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(content), replaced: true };
  }
}

/** The text of a character string type, or null when the tag is not one. */
function decodeCharacters(tag: number, content: Uint8Array): { text: string; replaced: boolean } | null {
  switch (tag) {
    case 12:
      return utf8Text(content);
    case 18:
    case 19:
    case 22:
    case 26:
      return singleByteText(content, true);
    case 20:
    case 21:
    case 25:
    case 27:
      return singleByteText(content, false);
    case 28:
      return universalText(content);
    case 30:
      return bmpText(content);
    default:
      return null;
  }
}

/** An INTEGER's content as a two's complement number (X.690 clause 8.3.3). */
export function integerOf(content: Uint8Array): bigint {
  if (content.length === 0) return 0n;
  let value = BigInt('0x' + hexOf(content));
  if ((content[0]! & 0x80) !== 0) value -= 1n << BigInt(content.length * 8);
  return value;
}

function describeInteger(content: Uint8Array, name: string): ValueInfo {
  const problems: string[] = [];
  if (content.length === 0) {
    problems.push(`${name} has no content octets (X.690 clause 8.3.1).`);
    return { text: 'no content octets', problems };
  }
  if (content.length > MAX_DECIMAL_BYTES) {
    return {
      text: `a number of ${withCommas(content.length)} bytes, 0x${hexOf(content.subarray(0, MAX_HEX_SHOWN))}...`,
      problems,
    };
  }
  const value = integerOf(content);
  return { text: `${value.toString(10)} (0x${hexOf(content)})`, integer: value, problems };
}

/** The arcs of an OBJECT IDENTIFIER (first two from the first subidentifier, X.690 clause 8.19.4) or RELATIVE-OID. */
function describeObjectIdentifier(content: Uint8Array, relative: boolean): ValueInfo {
  const problems: string[] = [];
  const label = relative ? 'relative object identifier' : 'object identifier';
  if (content.length === 0) {
    problems.push(`The ${label} has no content octets.`);
    return { text: 'no content octets', problems };
  }
  if (content.length > MAX_OID_BYTES) {
    problems.push(`The ${label} is longer than ${MAX_OID_BYTES} bytes, so it is not decoded.`);
    return { text: `${withCommas(content.length)} bytes, not decoded`, problems };
  }
  if ((content[content.length - 1]! & 0x80) !== 0) {
    problems.push(`The ${label} ends in the middle of an arc (X.690 clause 8.19.2).`);
  }
  const arcs: bigint[] = [];
  let value = 0n;
  let fresh = true;
  let padded = false;
  for (const octet of content) {
    if (fresh && octet === 0x80) padded = true;
    fresh = false;
    value = (value << 7n) | BigInt(octet & 0x7f);
    if ((octet & 0x80) === 0) {
      if (!relative && arcs.length === 0) {
        const head = value < 40n ? 0n : value < 80n ? 1n : 2n;
        arcs.push(head, value - head * 40n);
      } else {
        arcs.push(value);
      }
      value = 0n;
      fresh = true;
    }
  }
  if (padded) problems.push(`An arc of the ${label} starts with a padding octet 80 (X.690 clause 8.19.2).`);
  const dotted = arcs.join('.');
  if (relative) return { text: dotted === '' ? 'no complete arc' : dotted, oid: dotted, problems };
  const name = oidName(dotted);
  return {
    text: name === undefined ? dotted : `${dotted} (${name})`,
    oid: dotted,
    ...(name === undefined ? {} : { name }),
    problems,
  };
}

function describeBitString(content: Uint8Array): ValueInfo {
  const problems: string[] = [];
  if (content.length === 0) {
    problems.push('The BIT STRING has no content octets, not even the unused-bits octet (X.690 clause 8.6.2.2).');
    return { text: 'no content octets', problems };
  }
  const unused = content[0]!;
  if (unused > 7 || (content.length === 1 && unused !== 0)) {
    problems.push('The BIT STRING gives an impossible number of unused bits (X.690 clauses 8.6.2.2 and 8.6.2.3).');
  }
  const bits = (content.length - 1) * 8 - (unused > 7 ? 0 : unused);
  const body = content.subarray(1);
  return {
    text: `${withCommas(bits)} bits${unused > 0 ? `, ${unused} unused` : ''}: ${shownHex(body)}`,
    problems,
  };
}

/** The value of one element, in words. Reads only the element's own content and never throws. */
export function describeValue(bytes: Uint8Array, node: Asn1Node): ValueInfo {
  const problems: string[] = [];
  if (node.eoc) return { text: '', problems };
  if (node.notRead !== undefined) {
    return { text: `contents not read: nested more than ${MAX_DEPTH} levels`, problems };
  }
  if (node.length === null) {
    return {
      text: node.overrun !== undefined ? 'its length runs past the end of the data' : 'length not known',
      problems,
    };
  }
  if (node.constructed) return { text: '', problems };
  const content = bytes.subarray(node.offset + node.headerLength, node.end);

  if (node.cls === 'universal') {
    switch (node.tag) {
      case 1: {
        if (content.length !== 1) {
          problems.push('A BOOLEAN has exactly one content octet (X.690 clause 8.2.1).');
          return { text: shownHex(content), problems };
        }
        return { text: content[0] === 0 ? 'FALSE' : 'TRUE', problems };
      }
      case 2:
        return describeInteger(content, 'The INTEGER');
      case 10:
        return describeInteger(content, 'The ENUMERATED');
      case 3:
        return describeBitString(content);
      case 4: {
        const hex = shownHex(content);
        if (!printable(content)) return { text: hex, problems };
        const { shown } = shownString(singleByteText(content, false).text);
        return { text: `${hex} = "${shown}"`, string: shown, problems };
      }
      case 5: {
        if (content.length !== 0) problems.push('A NULL has no content octets (X.690 clause 8.8.2).');
        return { text: content.length === 0 ? '' : shownHex(content), problems };
      }
      case 6:
        return describeObjectIdentifier(content, false);
      default: {
        const characters = decodeCharacters(node.tag, content);
        if (characters !== null) {
          const name = UNIVERSAL_NAMES.get(node.tag) ?? 'string';
          if (characters.replaced) problems.push(`The ${name} holds bytes that are not valid for its type.`);
          const { shown, label } = shownString(characters.text);
          return { text: label, string: shown, problems };
        }
        break;
      }
    }
  }
  // Any other class, and any universal type this page does not decode: the bytes, and their text when all are printable.
  if (printable(content)) {
    const { shown, label } = shownString(singleByteText(content, false).text);
    return { text: label, string: shown, problems };
  }
  return { text: shownHex(content), problems };
}
