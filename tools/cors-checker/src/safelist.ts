import { trimSpaceAndTab } from './headers';
import { parseMimeEssence } from './mime';

/*
 * The request-header and method rules of the Fetch Standard, read from fetch.bs at commit e9460d1:
 *  - methods: "CORS-safelisted method", "forbidden method" and "normalize" (lines 580 to 600);
 *  - "CORS-safelisted request-header" with its unsafe-byte list, "CORS-unsafe request-header names" with the 1,024-byte
 *    total, "no-CORS-safelisted request-header" and "forbidden request-header" (lines 1014 to 1260);
 *  - "parse a single range header value" (line 1371) and "get, decode, and split" (line 806).
 *
 * A header value is counted one byte for each character, as the fetch API counts the ByteString it is given; a value with
 * a character above U+00FF is refused before any of these rules is asked (see request.ts).
 */

/** The most bytes a safelisted request-header value may hold. */
export const MAX_SAFELISTED_VALUE_BYTES = 128;
/** The most bytes the safelisted values of one request may add up to before every one of them counts as unsafe. */
export const MAX_SAFELISTED_TOTAL_BYTES = 1_024;

/** The methods the Fetch Standard writes in capitals whatever letters were typed (its "normalize a method"). */
const NORMALISED_METHODS: ReadonlySet<string> = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT']);

/** Upper-cases the ASCII letters only, so a character that has an upper-case form in another script is never changed. */
export function asciiUpper(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out += code >= 97 && code <= 122 ? String.fromCharCode(code - 32) : text[i];
  }
  return out;
}

/** Lower-cases the ASCII letters only. */
export function asciiLower(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : text[i];
  }
  return out;
}

/**
 * The method as a browser sends it: DELETE, GET, HEAD, OPTIONS, POST and PUT are upper-cased whatever their letter case,
 * every other name (`patch`, for example) is kept exactly as written.
 */
export function normalizeMethod(method: string): string {
  const upper = asciiUpper(method);
  return NORMALISED_METHODS.has(upper) ? upper : method;
}

/** A CORS-safelisted method: GET, HEAD or POST, compared byte for byte (so give it a normalised method). */
export function isCorsSafelistedMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'POST';
}

/** A forbidden method: CONNECT, TRACE or TRACK in any letter case. */
export function isForbiddenMethod(method: string): boolean {
  const upper = asciiUpper(method);
  return upper === 'CONNECT' || upper === 'TRACE' || upper === 'TRACK';
}

/** A CORS-unsafe request-header byte: below 0x20 but not tab, one of " ( ) : < > ? @ [ \ ] { } or DEL. */
function isUnsafeByte(code: number): boolean {
  if (code < 0x20) return code !== 0x09;
  switch (code) {
    case 0x22:
    case 0x28:
    case 0x29:
    case 0x3a:
    case 0x3c:
    case 0x3e:
    case 0x3f:
    case 0x40:
    case 0x5b:
    case 0x5c:
    case 0x5d:
    case 0x7b:
    case 0x7d:
    case 0x7f:
      return true;
    default:
      return false;
  }
}

function hasUnsafeByte(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (isUnsafeByte(value.charCodeAt(i))) return true;
  }
  return false;
}

/** The bytes accept-language and content-language allow: 0-9 A-Z a-z, space, * , - . ; = (and nothing else). */
function isLanguageByte(code: number): boolean {
  if (code >= 0x30 && code <= 0x39) return true;
  if (code >= 0x41 && code <= 0x5a) return true;
  if (code >= 0x61 && code <= 0x7a) return true;
  return (
    code === 0x20 || code === 0x2a || code === 0x2c || code === 0x2d || code === 0x2e || code === 0x3b || code === 0x3d
  );
}

function onlyLanguageBytes(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (!isLanguageByte(value.charCodeAt(i))) return false;
  }
  return true;
}

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

/** Compares two strings of decimal digits as numbers, however long: a negative, zero or positive number. */
function compareDigits(a: string, b: string): number {
  let i = 0;
  while (i < a.length - 1 && a.charCodeAt(i) === 0x30) i += 1;
  let j = 0;
  while (j < b.length - 1 && b.charCodeAt(j) === 0x30) j += 1;
  const lengthA = a.length - i;
  const lengthB = b.length - j;
  if (lengthA !== lengthB) return lengthA - lengthB;
  for (let k = 0; k < lengthA; k++) {
    const difference = a.charCodeAt(i + k) - b.charCodeAt(j + k);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The Fetch Standard's "parse a single range header value" without white space: `bytes=`, an optional start, `-`, an
 * optional end and nothing after. Both missing fails, and so does a start that is greater than the end. Returns the digits
 * of the start and of the end (empty when missing), or null for failure.
 */
function parseSingleRange(value: string): { start: string; end: string } | null {
  if (!value.startsWith('bytes')) return null;
  let position = 5;
  if (value.charCodeAt(position) !== 0x3d) return null;
  position += 1;
  let from = position;
  while (position < value.length && isDigit(value.charCodeAt(position))) position += 1;
  const start = value.slice(from, position);
  if (value.charCodeAt(position) !== 0x2d) return null;
  position += 1;
  from = position;
  while (position < value.length && isDigit(value.charCodeAt(position))) position += 1;
  const end = value.slice(from, position);
  if (position < value.length) return null;
  if (start === '' && end === '') return null;
  if (start !== '' && end !== '' && compareDigits(start, end) > 0) return null;
  return { start, end };
}

const SAFELISTED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
]);

/**
 * Whether a request header (name and value) is CORS-safelisted, which is what lets a cross-origin request skip the
 * preflight. A value of more than 128 bytes is unsafe first; then the name decides: accept (no unsafe byte),
 * accept-language and content-language (a small set of bytes), content-type (no unsafe byte and the parsed type is a form or
 * plain text type), range (a single range with a start); any other name is unsafe.
 */
export function isCorsSafelistedRequestHeader(name: string, value: string): boolean {
  if (value.length > MAX_SAFELISTED_VALUE_BYTES) return false;
  switch (asciiLower(name)) {
    case 'accept':
      return !hasUnsafeByte(value);
    case 'accept-language':
    case 'content-language':
      return onlyLanguageBytes(value);
    case 'content-type': {
      if (hasUnsafeByte(value)) return false;
      const essence = parseMimeEssence(value);
      return essence !== null && SAFELISTED_CONTENT_TYPES.has(essence);
    }
    case 'range': {
      const range = parseSingleRange(value);
      return range !== null && range.start !== '';
    }
    default:
      return false;
  }
}

/** Whether a request header is no-CORS-safelisted: one of four names, and CORS-safelisted by its value. */
export function isNoCorsSafelistedRequestHeader(name: string, value: string): boolean {
  const lower = asciiLower(name);
  if (lower !== 'accept' && lower !== 'accept-language' && lower !== 'content-language' && lower !== 'content-type') {
    return false;
  }
  return isCorsSafelistedRequestHeader(name, value);
}

/** What the CORS-unsafe request-header names rule found in a header list. */
export interface UnsafeAnalysis {
  /** Every unsafe name: lower-cased, each once, sorted by byte. */
  names: string[];
  /** The names that are unsafe only because the safelisted values add up to more than 1,024 bytes. */
  totalNames: string[];
  /** The bytes the safelisted values add up to. */
  safelistedBytes: number;
}

/**
 * The Fetch Standard's "CORS-unsafe request-header names": every header that is not safelisted is unsafe, and when the
 * values of the safelisted ones add up to more than 1,024 bytes all of them become unsafe too.
 */
export function analyseRequestHeaders(headers: readonly { name: string; value: string }[]): UnsafeAnalysis {
  const unsafe = new Set<string>();
  const safelisted = new Set<string>();
  let safelistedBytes = 0;
  for (const header of headers) {
    if (isCorsSafelistedRequestHeader(header.name, header.value)) {
      safelisted.add(asciiLower(header.name));
      safelistedBytes += header.value.length;
    } else {
      unsafe.add(asciiLower(header.name));
    }
  }
  const totalNames: string[] = [];
  if (safelistedBytes > MAX_SAFELISTED_TOTAL_BYTES) {
    for (const name of safelisted) {
      if (!unsafe.has(name)) totalNames.push(name);
      unsafe.add(name);
    }
  }
  return { names: [...unsafe].sort(), totalNames: totalNames.sort(), safelistedBytes };
}

/** The CORS-unsafe request-header names of a header list: lower-cased, each once, sorted by byte. */
export function corsUnsafeRequestHeaderNames(headers: readonly { name: string; value: string }[]): string[] {
  return analyseRequestHeaders(headers).names;
}

/**
 * The Fetch Standard's "get, decode, and split" of one header value: the comma separated items, with the text of a quoted
 * string kept whole (a comma inside quotes does not split) and the spaces and tabs around each item removed.
 */
export function splitHeaderValue(input: string): string[] {
  const values: string[] = [];
  let position = 0;
  let temporary = '';
  for (;;) {
    let stop = position;
    while (stop < input.length && input.charCodeAt(stop) !== 0x22 && input.charCodeAt(stop) !== 0x2c) stop += 1;
    temporary += input.slice(position, stop);
    position = stop;
    if (position < input.length && input.charCodeAt(position) === 0x22) {
      // An HTTP quoted string, kept with its quotes: it ends at the next quote, a backslash takes the character after it.
      const start = position;
      position += 1;
      for (;;) {
        let scan = position;
        while (scan < input.length && input.charCodeAt(scan) !== 0x22 && input.charCodeAt(scan) !== 0x5c) scan += 1;
        position = scan;
        if (position >= input.length) break;
        const code = input.charCodeAt(position);
        position += 1;
        if (code === 0x5c) {
          if (position >= input.length) break;
          position += 1;
        } else break;
      }
      temporary += input.slice(start, position);
      if (position < input.length) continue;
    }
    values.push(trimSpaceAndTab(temporary));
    temporary = '';
    if (position >= input.length) return values;
    position += 1;
  }
}

/** Names the browser keeps for itself: a header with one of them is dropped without a message. */
const FORBIDDEN_NAMES: ReadonlySet<string> = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
]);

/** The headers some servers read as the real method; a forbidden method in their value makes them forbidden. */
const OVERRIDE_NAMES: ReadonlySet<string> = new Set(['x-http-method', 'x-http-method-override', 'x-method-override']);

/** A forbidden request-header: a name the browser keeps for itself, a Proxy- or Sec- name, or a method override naming a forbidden method. */
export function isForbiddenRequestHeader(name: string, value: string): boolean {
  const lower = asciiLower(name);
  if (FORBIDDEN_NAMES.has(lower)) return true;
  if (lower.startsWith('proxy-') || lower.startsWith('sec-')) return true;
  if (OVERRIDE_NAMES.has(lower)) {
    for (const method of splitHeaderValue(value)) {
      if (isForbiddenMethod(method)) return true;
    }
  }
  return false;
}

/** The response headers script never receives, whatever Access-Control-Expose-Headers says. */
export function isForbiddenResponseHeaderName(name: string): boolean {
  const lower = asciiLower(name);
  return lower === 'set-cookie' || lower === 'set-cookie2';
}

/** The seven response headers every cross-origin response shows to script. */
const SAFELISTED_RESPONSE_NAMES: ReadonlySet<string> = new Set([
  'cache-control',
  'content-language',
  'content-length',
  'content-type',
  'expires',
  'last-modified',
  'pragma',
]);

/** A CORS-safelisted response-header name (the seven names, before Access-Control-Expose-Headers is looked at). */
export function isCorsSafelistedResponseHeaderName(name: string): boolean {
  return SAFELISTED_RESPONSE_NAMES.has(asciiLower(name));
}
