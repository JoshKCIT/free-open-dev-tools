import type { Asn1Node } from './ber';
import { MAX_DECIMAL_BYTES, MAX_DEPTH, MAX_HEX_SHOWN, MAX_OID_BYTES, MAX_TEXT_SHOWN, withCommas } from './limits';
import { lookupOidName } from './oids-extra';
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
  /** The value of a REAL as a number (infinity, not-a-number and minus zero included). */
  number?: number;
  /** A UTCTime or GeneralizedTime as ISO text. */
  time?: string;
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
  const name = lookupOidName(dotted);
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
  return { text: bitStringText(content.subarray(1), unused), problems };
}

/** The text of a BIT STRING: its size in bits, the unused bits, and the bytes as hex. */
function bitStringText(body: Uint8Array, unused: number): string {
  const bits = body.length * 8 - (unused > 7 ? 0 : unused);
  return `${withCommas(Math.max(0, bits))} bits${unused > 0 ? `, ${unused} unused` : ''}: ${shownHex(body)}`;
}

/** A number as text: minus zero is written as such, and the others as JavaScript writes them. */
function numberText(value: number): string {
  return Object.is(value, -0) ? '-0' : String(value);
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

/** A decimal REAL of form NR1, NR2 or NR3 of ISO 6093: the number, or null when the characters do not fit the form. */
function decimalReal(text: string, form: number): number | null {
  const trimmed = text.trim();
  let i = 0;
  if (trimmed.charAt(i) === '+' || trimmed.charAt(i) === '-') i++;
  let before = 0;
  let after = 0;
  let mark = false;
  let exponent = false;
  while (i < trimmed.length && isDigit(trimmed.charCodeAt(i))) {
    i++;
    before++;
  }
  if (trimmed.charAt(i) === '.' || trimmed.charAt(i) === ',') {
    mark = true;
    i++;
    while (i < trimmed.length && isDigit(trimmed.charCodeAt(i))) {
      i++;
      after++;
    }
  }
  if (trimmed.charAt(i) === 'E' || trimmed.charAt(i) === 'e') {
    exponent = true;
    i++;
    if (trimmed.charAt(i) === '+' || trimmed.charAt(i) === '-') i++;
    let digits = 0;
    while (i < trimmed.length && isDigit(trimmed.charCodeAt(i))) {
      i++;
      digits++;
    }
    if (digits === 0) return null;
  }
  if (i !== trimmed.length || before + after === 0) return null;
  if (form === 1 && (mark || exponent)) return null;
  if (form === 2 && (!mark || exponent)) return null;
  if (form === 3 && !exponent) return null;
  return Number(trimmed.replace(',', '.'));
}

/** A REAL (X.690 clause 8.5): binary with base 2, 8 or 16 and a scaling factor, decimal NR1 to NR3, or a special value. */
function describeReal(content: Uint8Array): ValueInfo {
  const problems: string[] = [];
  if (content.length === 0) return { text: '0', number: 0, problems };
  const first = content[0]!;
  if ((first & 0x80) !== 0) {
    const sign = (first & 0x40) !== 0 ? -1 : 1;
    const baseBits = (first >> 4) & 3;
    if (baseBits === 3) {
      problems.push('The REAL uses the base bits 11, which are reserved (X.690 clause 8.5.7.2).');
      return { text: shownHex(content), problems };
    }
    const base = baseBits === 0 ? 2 : baseBits === 1 ? 8 : 16;
    const scale = (first >> 2) & 3;
    let at = 1;
    let exponentLength = (first & 3) + 1;
    if ((first & 3) === 3) {
      exponentLength = content[1] ?? 0;
      at = 2;
      if (exponentLength === 0) {
        problems.push('The REAL gives the number of exponent octets as zero (X.690 clause 8.5.7.4).');
        return { text: shownHex(content), problems };
      }
    }
    if (at + exponentLength > content.length) {
      problems.push('The REAL ends inside its exponent (X.690 clause 8.5.7.4).');
      return { text: shownHex(content), problems };
    }
    const exponentBytes = content.subarray(at, at + exponentLength);
    const mantissaBytes = content.subarray(at + exponentLength);
    if (mantissaBytes.length === 0) problems.push('The REAL has no mantissa octets (X.690 clause 8.5.7.5).');
    if (exponentBytes.length > 8 || mantissaBytes.length > MAX_DECIMAL_BYTES) {
      return {
        text: `a binary REAL with an exponent of ${exponentBytes.length} bytes and a mantissa of ${withCommas(mantissaBytes.length)} bytes`,
        problems,
      };
    }
    const exponent = BigInt.asIntN(exponentBytes.length * 8, BigInt('0x' + hexOf(exponentBytes)));
    const mantissa = mantissaBytes.length === 0 ? 0n : BigInt('0x' + hexOf(mantissaBytes));
    const power = exponent * BigInt(base === 2 ? 1 : base === 8 ? 3 : 4) + BigInt(scale);
    let value: number;
    if (mantissa === 0n) value = sign * 0;
    else if (power > 2300n) value = sign * Infinity;
    else if (power < -2900n) value = sign * 0;
    else {
      // Two halves, so a result that fits is never lost to a power of two that does not.
      const whole = Number(power);
      const half = Math.trunc(whole / 2);
      value = sign * Number(mantissa) * 2 ** half * 2 ** (whole - half);
    }
    const detail = `binary base ${base}, mantissa ${mantissa}, exponent ${exponent}${scale > 0 ? `, scaling factor ${scale}` : ''}`;
    return { text: `${numberText(value)} (${detail})`, number: value, problems };
  }
  if ((first & 0x40) !== 0) {
    // X.690 clause 8.5.9: PLUS-INFINITY, MINUS-INFINITY, NOT-A-NUMBER and minus zero are one octet each.
    const special = new Map<number, [string, number]>([
      [0x40, ['PLUS-INFINITY', Infinity]],
      [0x41, ['MINUS-INFINITY', -Infinity]],
      [0x42, ['NOT-A-NUMBER', NaN]],
      [0x43, ['minus zero', -0]],
    ]).get(first);
    if (special === undefined || content.length !== 1) {
      problems.push('The REAL has a reserved special value (X.690 clause 8.5.9).');
      return { text: shownHex(content), problems };
    }
    return { text: special[0], number: special[1], problems };
  }
  const form = first & 0x3f;
  if (form < 1 || form > 3) {
    problems.push('The REAL has a decimal form other than NR1, NR2 and NR3 (X.690 clause 8.5.8).');
    return { text: shownHex(content), problems };
  }
  const body = singleByteText(content.subarray(1), false).text;
  const value = decimalReal(body, form);
  if (value === null) {
    problems.push(`The REAL does not fit the decimal form NR${form} of ISO 6093 (X.690 clause 8.5.8).`);
    return { text: shownHex(content), problems };
  }
  return { text: `${numberText(value)} (decimal NR${form} ${visible(body, MAX_TEXT_SHOWN)})`, number: value, problems };
}

/** A UTCTime or GeneralizedTime as it was written. */
export interface ParsedTime {
  /** ISO text: date, time, the fraction when there is one, and Z or the offset when there is one. */
  iso: string;
  /** Whether the seconds are written. */
  seconds: boolean;
  /** `Z`, an `offset` such as +0530, or `local` for a GeneralizedTime with no zone. */
  zone: 'Z' | 'offset' | 'local';
  /** The digits after the decimal mark, and whether the mark is a comma. */
  fraction: string;
  comma: boolean;
}

function daysIn(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * Reads the characters of a UTCTime (YYMMDDhhmm, seconds optional, then Z or +hhmm) or a GeneralizedTime (YYYYMMDDhh,
 * minutes and seconds optional, a fraction after the seconds, then Z, an offset or nothing), or returns null. Two-digit
 * years from 50 to 99 are 19xx and the others 20xx, as RFC 5280 reads them. The ranges are checked: month, day in its month,
 * hour 0 to 23 (24 is not allowed, X.690 clause 11.7.5), minute and second 0 to 59.
 */
export function parseTime(content: Uint8Array, generalized: boolean): ParsedTime | null {
  let at = 0;
  const read = (count: number): number => {
    if (at + count > content.length) return -1;
    let value = 0;
    for (let i = 0; i < count; i++) {
      const code = content[at + i]!;
      if (!isDigit(code)) return -1;
      value = value * 10 + (code - 48);
    }
    at += count;
    return value;
  };
  const digitNext = (): boolean => at < content.length && isDigit(content[at]!);
  let year: number;
  if (generalized) year = read(4);
  else {
    const short = read(2);
    year = short < 0 ? -1 : short >= 50 ? 1900 + short : 2000 + short;
  }
  const month = read(2);
  const day = read(2);
  const hour = read(2);
  if (year < 0 || month < 1 || month > 12 || day < 1 || day > daysIn(year, month) || hour < 0 || hour > 23) return null;
  let minute = 0;
  let second = 0;
  let seconds = false;
  if (!generalized || digitNext()) {
    minute = read(2);
    if (minute < 0 || minute > 59) return null;
    if (digitNext()) {
      second = read(2);
      if (second < 0 || second > 59) return null;
      seconds = true;
    }
  }
  let fraction = '';
  let comma = false;
  if (generalized && seconds && (content[at] === 0x2e || content[at] === 0x2c)) {
    comma = content[at] === 0x2c;
    at++;
    while (digitNext()) fraction += String.fromCharCode(content[at++]!);
    if (fraction === '') return null;
  }
  let zone: ParsedTime['zone'] = 'local';
  let suffix = '';
  if (content[at] === 0x5a) {
    at++;
    zone = 'Z';
    suffix = 'Z';
  } else if (content[at] === 0x2b || content[at] === 0x2d) {
    const sign = String.fromCharCode(content[at++]!);
    const offsetHour = read(2);
    let offsetMinute = 0;
    if (offsetHour < 0 || offsetHour > 23) return null;
    if (digitNext() || !generalized) {
      offsetMinute = read(2);
      if (offsetMinute < 0 || offsetMinute > 59) return null;
    }
    zone = 'offset';
    suffix = `${sign}${String(offsetHour).padStart(2, '0')}:${String(offsetMinute).padStart(2, '0')}`;
  } else if (!generalized) {
    return null;
  }
  if (at !== content.length) return null;
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  const iso = `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}${fraction === '' ? '' : `.${fraction}`}${suffix}`;
  return { iso, seconds, zone, fraction, comma };
}

function describeTime(content: Uint8Array, generalized: boolean): ValueInfo {
  const problems: string[] = [];
  const name = generalized ? 'GeneralizedTime' : 'UTCTime';
  const parsed = parseTime(content, generalized);
  const original = singleByteText(content, true).text;
  if (parsed === null) {
    problems.push(`The ${name} is not a time in the form X.680 gives, or holds a date or time that does not exist.`);
    return { text: `"${visible(original, MAX_TEXT_SHOWN)}"`, problems };
  }
  const note = parsed.zone === 'local' ? ', local time' : '';
  return { text: `${parsed.iso} (${visible(original, MAX_TEXT_SHOWN)}${note})`, time: parsed.iso, problems };
}

/** The universal tags of the string types whose constructed form is segments of OCTET STRING (X.690 clause 8.23.6). */
const SEGMENTED_TAGS: ReadonlySet<number> = new Set([4, 12, 18, 19, 20, 21, 22, 25, 26, 27, 28, 30]);

/** Whether a node is a constructed BIT STRING, OCTET STRING or restricted character string. */
export function isConstructedString(node: Asn1Node): boolean {
  return node.constructed && node.cls === 'universal' && (node.tag === 3 || SEGMENTED_TAGS.has(node.tag));
}

/**
 * The value of a constructed string (X.690 clauses 8.6.4, 8.7.3 and 8.23.6): the segments below it, in order, put end to
 * end. A segment is a primitive OCTET STRING, or a primitive BIT STRING for a BIT STRING; a constructed segment is read
 * through to its own segments. A different kind of element below it is a problem.
 */
export function describeConstructedString(bytes: Uint8Array, nodes: readonly Asn1Node[], index: number): ValueInfo {
  const node = nodes[index]!;
  const problems: string[] = [];
  const wanted = node.tag === 3 ? 3 : 4;
  const parts: Uint8Array[] = [];
  let total = 0;
  let unused = 0;
  let wrong = false;
  let lastUnusedSeen = false;
  for (let i = index + 1; i < nodes.length && nodes[i]!.depth > node.depth; i++) {
    const child = nodes[i]!;
    if (child.eoc || child.constructed || child.length === null) continue;
    if (child.cls !== 'universal' || child.tag !== wanted) {
      wrong = true;
      continue;
    }
    const content = bytes.subarray(child.offset + child.headerLength, child.end);
    if (wanted === 3) {
      if (content.length === 0) continue;
      if (lastUnusedSeen && unused !== 0)
        problems.push('Only the last segment of a constructed BIT STRING may have unused bits (X.690 clause 8.6.4).');
      unused = content[0]!;
      lastUnusedSeen = true;
      parts.push(content.subarray(1));
      total += content.length - 1;
    } else {
      parts.push(content);
      total += content.length;
    }
  }
  if (wrong)
    problems.push('A segment of a constructed string is not an OCTET STRING (X.690 clauses 8.7.3.2 and 8.23.6).');
  if (index + 1 >= nodes.length || nodes[index + 1]!.depth <= node.depth) return { text: '', problems };
  const joined = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.length;
  }
  if (wanted === 3) return { text: bitStringText(joined, unused), problems };
  if (node.tag === 4) {
    const hex = shownHex(joined);
    if (!printable(joined)) return { text: hex, problems };
    const { shown } = shownString(singleByteText(joined, false).text);
    return { text: `${hex} = "${shown}"`, string: shown, problems };
  }
  const characters = decodeCharacters(node.tag, joined);
  if (characters === null) return { text: shownHex(joined), problems };
  if (characters.replaced)
    problems.push(`The ${UNIVERSAL_NAMES.get(node.tag) ?? 'string'} holds bytes that are not valid for its type.`);
  const { shown, label } = shownString(characters.text);
  return { text: label, string: shown, problems };
}

/** The value of a constructed string inside another one: the outermost string shows every segment put end to end. */
export const INNER_STRING_VALUE = 'part of the constructed string that holds it, whose value is shown there';

/**
 * Describes the elements of one reading-order list, in order, and hands each to `each`. A constructed string inside
 * another constructed string gets a short value that points to the outermost one, which already puts every segment below
 * it end to end and finds every wrong segment: the bytes are joined once however deep the strings are nested (joining each
 * level's own segments again cost 38 times the work for 38 levels).
 */
export function describeInOrder(bytes: Uint8Array, nodes: readonly Asn1Node[], each: (node: Asn1Node) => void): void {
  // The depth of the outermost constructed string still open, or -1 when none is.
  let openString = -1;
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!;
    if (openString >= 0 && node.depth <= openString) openString = -1;
    if (!isConstructedString(node)) node.value = describeValue(bytes, node);
    else if (openString >= 0) node.value = { text: INNER_STRING_VALUE, problems: [] };
    else {
      node.value = describeConstructedString(bytes, nodes, index);
      openString = node.depth;
    }
    each(node);
  }
}

/** Universal types whose encoding is always primitive, with the clause that says so. */
const PRIMITIVE_ONLY: ReadonlyMap<number, [string, string]> = new Map([
  [1, ['BOOLEAN', '8.2.1']],
  [2, ['INTEGER', '8.3.1']],
  [5, ['NULL', '8.8.1']],
  [6, ['OBJECT IDENTIFIER', '8.19.1']],
  [9, ['REAL', '8.5.1']],
  [10, ['ENUMERATED', '8.4']],
  [13, ['RELATIVE-OID', '8.20.1']],
]);

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
  if (node.constructed) {
    const rule = node.cls === 'universal' ? PRIMITIVE_ONLY.get(node.tag) : undefined;
    if (rule !== undefined)
      problems.push(`The ${rule[0]} must be primitive (X.690 clause ${rule[1]}), but this one is constructed.`);
    return { text: '', problems };
  }
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
      case 9:
        return describeReal(content);
      case 13:
        return describeObjectIdentifier(content, true);
      case 23:
        return describeTime(content, false);
      case 24:
        return describeTime(content, true);
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
