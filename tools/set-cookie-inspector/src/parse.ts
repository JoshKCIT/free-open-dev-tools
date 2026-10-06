import { parseCookieDate } from './date';
import {
  MAX_AGE_LIMIT_SECONDS,
  MAX_ATTRIBUTE_VALUE_OCTETS,
  MAX_NAME_VALUE_OCTETS,
  octetLength,
  withCommas,
} from './limits';

/**
 * The parsing algorithm of draft-ietf-httpbis-rfc6265bis-22 section 5.6, written out step by step. One call reads one
 * Set-Cookie line: a name, a value and the attributes in the order written, each marked used or ignored with the reason.
 * The text is never percent-decoded and never changed except where the draft says so (spaces and tabs stripped from the
 * ends, one leading dot dropped from a Domain, a Domain put in lower case).
 */

export type AttributeKind =
  | 'expires'
  | 'max-age'
  | 'domain'
  | 'path'
  | 'secure'
  | 'httponly'
  | 'samesite'
  | 'partitioned'
  | 'priority'
  | 'unknown';

/** What a SameSite attribute asks for after section 5.6.7: any value that is not None, Strict or Lax is Default. */
export type SameSiteValue = 'Default' | 'None' | 'Strict' | 'Lax';

/** One attribute as written, with what the draft does with it. */
export interface Attribute {
  /** The name as written, spaces and tabs stripped. Empty for a segment such as `=x`. */
  name: string;
  /** The value as written, spaces and tabs stripped. */
  value: string;
  kind: AttributeKind;
  use: 'used' | 'ignored';
  /** Why it is used or ignored, in plain words, never holding more than the attribute itself. */
  reason: string;
}

/** A Max-Age worked out from its digits as text, before any number is formed. */
export interface MaxAge {
  /** The seconds a browser keeps the cookie, never above the 400-day limit. 0 when it is deleted at once. */
  seconds: number;
  /** True when the value asked for more than the limit and was reduced to it (section 5.5). */
  clamped: boolean;
  /** True when the value is zero or negative: the cookie is deleted at once (section 5.6.2 step 7). */
  immediate: boolean;
}

/** A line that holds a cookie. */
export interface ParsedCookie {
  ignored: false;
  name: string;
  value: string;
  /** Name and value together, in UTF-8 octets. */
  octets: number;
  /** Every attribute written, in the order written. */
  attributes: Attribute[];
  /** The Max-Age that counts (the last valid one), or null. */
  maxAge: MaxAge | null;
  /** The Expires that counts (the last valid one, and only when no Max-Age counts) in milliseconds since 1970, or null. */
  expires: number | null;
  /** The last Domain attribute after section 5.6.3: one leading dot dropped, lower case. Null when there is none. */
  domain: string | null;
  /** The last Path attribute as written. Null when there is none. */
  path: string | null;
  secure: boolean;
  httpOnly: boolean;
  sameSite: SameSiteValue;
  /** True when a SameSite attribute was written (even with a value that means Default). */
  sameSiteWritten: boolean;
}

/** A line the draft ignores in its entirety while it is read. */
export interface IgnoredLine {
  ignored: true;
  /** The section and step of the draft that ignores it, for example `section 5.6 step 1`. */
  where: string;
  reason: string;
  /** The name and value as far as they were split, for showing a row. */
  name: string;
  value: string;
  octets: number;
}

const SPACE = 32;
const TAB = 9;

/** Removes spaces and tabs (WSP) from both ends, and only those. */
export function trimWsp(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && (text.charCodeAt(start) === SPACE || text.charCodeAt(start) === TAB)) start += 1;
  while (end > start && (text.charCodeAt(end - 1) === SPACE || text.charCodeAt(end - 1) === TAB)) end -= 1;
  return text.slice(start, end);
}

/** True for a control character other than a tab: %x00-08, %x0A-1F and %x7F (section 5.6 step 1). */
function hasControl(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if ((code <= 8 || (code >= 10 && code <= 31) || code === 127) && code !== 9) return true;
  }
  return false;
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

/** Splits a name-value pair at its first equals sign. Without one the name is empty and the whole text is the value. */
function splitPair(text: string): { name: string; value: string } {
  const equals = text.indexOf('=');
  if (equals < 0) return { name: '', value: text };
  return { name: text.slice(0, equals), value: text.slice(equals + 1) };
}

/**
 * Max-Age, section 5.6.2: empty is ignored; the first character must be a digit, or a minus sign followed by a digit;
 * every character after the first must be a digit. Zero and negative values delete the cookie at once. A positive value
 * is compared with the 400-day limit as text (more digits than the limit has, or a larger number of the same length), so
 * a value of any length is handled before any number is formed.
 */
export function readMaxAge(value: string): { max: MaxAge } | { problem: string } {
  if (value === '') return { problem: 'It is empty, so the draft ignores it (section 5.6.2 step 1).' };
  const first = value.charCodeAt(0);
  const negative = first === 45;
  if (!isDigit(first) && !(negative && value.length > 1 && isDigit(value.charCodeAt(1)))) {
    return {
      problem:
        'It does not start with a digit or a minus sign and a digit, so the draft ignores it (section 5.6.2 step 2).',
    };
  }
  for (let i = 1; i < value.length; i++) {
    if (!isDigit(value.charCodeAt(i))) {
      return { problem: 'It holds a character that is not a digit, so the draft ignores it (section 5.6.2 step 3).' };
    }
  }
  if (negative) return { max: { seconds: 0, clamped: false, immediate: true } };
  let zeros = 0;
  while (zeros < value.length && value.charCodeAt(zeros) === 48) zeros += 1;
  const significant = value.slice(zeros);
  if (significant === '') return { max: { seconds: 0, clamped: false, immediate: true } };
  const limitDigits = String(MAX_AGE_LIMIT_SECONDS).length;
  if (significant.length > limitDigits || Number(significant) > MAX_AGE_LIMIT_SECONDS) {
    return { max: { seconds: MAX_AGE_LIMIT_SECONDS, clamped: true, immediate: false } };
  }
  return { max: { seconds: Number(significant), clamped: false, immediate: false } };
}

function sameSiteOf(value: string): SameSiteValue {
  const lower = value.toLowerCase();
  if (lower === 'none') return 'None';
  if (lower === 'strict') return 'Strict';
  if (lower === 'lax') return 'Lax';
  return 'Default';
}

/** What one attribute carries once it is read, kept beside it so the winners can be picked after the whole line. */
type Payload =
  | { kind: 'expires'; ms: number }
  | { kind: 'max-age'; max: MaxAge }
  | { kind: 'domain'; domain: string }
  | { kind: 'path'; path: string }
  | { kind: 'samesite'; enforcement: SameSiteValue }
  | { kind: 'flag' }
  | { kind: 'none' };

interface Read {
  attribute: Attribute;
  payload: Payload;
}

function readAttribute(name: string, value: string): Read {
  const kindName = name.toLowerCase();
  const make = (kind: AttributeKind, use: 'used' | 'ignored', reason: string, payload: Payload): Read => ({
    attribute: { name, value, kind, use, reason },
    payload,
  });
  if (octetLength(value) > MAX_ATTRIBUTE_VALUE_OCTETS) {
    const kind: AttributeKind = KINDS.get(kindName) ?? 'unknown';
    return make(
      kind,
      'ignored',
      `Its value is ${withCommas(octetLength(value))} octets, over the limit of ${withCommas(MAX_ATTRIBUTE_VALUE_OCTETS)}, so the draft ignores it (section 5.6 step 6).`,
      { kind: 'none' },
    );
  }
  switch (KINDS.get(kindName)) {
    case 'expires': {
      const ms = parseCookieDate(value);
      if (ms === null) {
        return make(
          'expires',
          'ignored',
          'It is not a cookie date (section 5.1.1), so the draft ignores it (section 5.6.1 step 2).',
          { kind: 'none' },
        );
      }
      return make(
        'expires',
        'used',
        'Read as a cookie date (section 5.1.1); it sets the lifetime unless a Max-Age is present, never beyond 400 days (section 5.5).',
        { kind: 'expires', ms },
      );
    }
    case 'max-age': {
      const read = readMaxAge(value);
      if ('problem' in read) return make('max-age', 'ignored', read.problem, { kind: 'none' });
      const reason = read.max.immediate
        ? 'Zero or negative, so the cookie is deleted at once (section 5.6.2 step 7).'
        : read.max.clamped
          ? `More than 400 days, so it is reduced to 400 days, ${withCommas(MAX_AGE_LIMIT_SECONDS)} seconds (section 5.5).`
          : `The cookie lives ${withCommas(read.max.seconds)} seconds from the time of the response.`;
      return make('max-age', 'used', reason, { kind: 'max-age', max: read.max });
    }
    case 'domain': {
      const trimmed = value.startsWith('.') ? value.slice(1) : value;
      return make(
        'domain',
        'used',
        'Sets the cookie for this host and its subdomains if the host matches (section 5.6.3).',
        {
          kind: 'domain',
          domain: trimmed.toLowerCase(),
        },
      );
    }
    case 'path':
      return make('path', 'used', 'Sets the path the cookie is sent for (section 5.6.4).', {
        kind: 'path',
        path: value,
      });
    case 'secure':
      return make(
        'secure',
        'used',
        'The cookie is sent only over a secure connection (section 5.6.5). Any value is ignored.',
        { kind: 'flag' },
      );
    case 'httponly':
      return make('httponly', 'used', 'Page script cannot read the cookie (section 5.6.6). Any value is ignored.', {
        kind: 'flag',
      });
    case 'samesite': {
      const enforcement = sameSiteOf(value);
      const reason =
        enforcement === 'Default'
          ? 'Not None, Strict or Lax, so the draft reads it as Default enforcement (section 5.6.7).'
          : `Read as ${enforcement} enforcement (section 5.6.7).`;
      return make('samesite', 'used', reason, { kind: 'samesite', enforcement });
    }
    case 'partitioned':
      return make('partitioned', 'ignored', 'Partitioned is outside the draft, so it is shown here and not judged.', {
        kind: 'none',
      });
    case 'priority':
      return make('priority', 'ignored', 'Priority is outside the draft, so it is shown here and not judged.', {
        kind: 'none',
      });
    default:
      return make(
        'unknown',
        'ignored',
        'The draft does not know this attribute, so a browser ignores it (section 5.6 step 7).',
        { kind: 'none' },
      );
  }
}

const KINDS: ReadonlyMap<string, AttributeKind> = new Map<string, AttributeKind>([
  ['expires', 'expires'],
  ['max-age', 'max-age'],
  ['domain', 'domain'],
  ['path', 'path'],
  ['secure', 'secure'],
  ['httponly', 'httponly'],
  ['samesite', 'samesite'],
  ['partitioned', 'partitioned'],
  ['priority', 'priority'],
]);

const KIND_LABEL: ReadonlyMap<AttributeKind, string> = new Map<AttributeKind, string>([
  ['expires', 'Expires'],
  ['max-age', 'Max-Age'],
  ['domain', 'Domain'],
  ['path', 'Path'],
  ['secure', 'Secure'],
  ['httponly', 'HttpOnly'],
  ['samesite', 'SameSite'],
]);

/**
 * Picks the winners once the whole line is read: of each attribute that appears more than once the last valid one is
 * used and the earlier ones become ignored (sections 5.7 steps 6, 7, 11 and 17); and when a Max-Age is used, every
 * Expires is ignored because Max-Age decides (step 6).
 */
function pickWinners(reads: Read[]): void {
  const last = new Map<AttributeKind, number>();
  for (let i = 0; i < reads.length; i++) {
    const read = reads[i];
    if (read !== undefined && read.attribute.use === 'used') last.set(read.attribute.kind, i);
  }
  const hasMaxAge = last.has('max-age');
  for (let i = 0; i < reads.length; i++) {
    const read = reads[i];
    if (read === undefined || read.attribute.use !== 'used') continue;
    const kind = read.attribute.kind;
    const label = KIND_LABEL.get(kind) ?? kind;
    if (kind === 'expires' && hasMaxAge) {
      read.attribute.use = 'ignored';
      read.attribute.reason =
        'Max-Age is present, so it decides the lifetime and Expires is not used (section 5.7 step 6).';
    } else if (last.get(kind) !== i) {
      read.attribute.use = 'ignored';
      read.attribute.reason = `A later ${label} attribute is used instead: the last one counts.`;
    }
  }
}

/** Reads one Set-Cookie line (without the `Set-Cookie:` prefix) with the algorithm of section 5.6. */
export function parseSetCookie(line: string): ParsedCookie | IgnoredLine {
  const semicolon = line.indexOf(';');
  const pairText = semicolon < 0 ? line : line.slice(0, semicolon);
  const split = splitPair(pairText);
  const name = trimWsp(split.name);
  const value = trimWsp(split.value);
  const octets = octetLength(name) + octetLength(value);
  if (hasControl(line)) {
    return {
      ignored: true,
      where: 'section 5.6 step 1',
      reason:
        'The line holds a control character other than a tab, so the draft ignores the whole line (section 5.6 step 1).',
      name,
      value,
      octets,
    };
  }
  if (octets > MAX_NAME_VALUE_OCTETS) {
    return {
      ignored: true,
      where: 'section 5.6 step 5',
      reason: `Name and value together are ${withCommas(octets)} octets, over the limit of ${withCommas(MAX_NAME_VALUE_OCTETS)}, so the draft ignores the whole line (section 5.6 step 5).`,
      name,
      value,
      octets,
    };
  }
  const reads: Read[] = [];
  if (semicolon >= 0) {
    const rest = line.slice(semicolon + 1);
    let from = 0;
    for (;;) {
      const next = rest.indexOf(';', from);
      const end = next < 0 ? rest.length : next;
      const segment = rest.slice(from, end);
      // Section 5.6 step 4: without an equals sign the whole segment is the name and the value is empty.
      const equals = segment.indexOf('=');
      const attributeName = trimWsp(equals < 0 ? segment : segment.slice(0, equals));
      const attributeValue = trimWsp(equals < 0 ? '' : segment.slice(equals + 1));
      // A segment with nothing in it (as in `;;`) is not an attribute, so it is not listed.
      if (attributeName !== '' || attributeValue !== '' || equals >= 0) {
        reads.push(readAttribute(attributeName, attributeValue));
      }
      if (next < 0) break;
      from = next + 1;
    }
  }
  pickWinners(reads);
  const cookie: ParsedCookie = {
    ignored: false,
    name,
    value,
    octets,
    attributes: reads.map((read) => read.attribute),
    maxAge: null,
    expires: null,
    domain: null,
    path: null,
    secure: false,
    httpOnly: false,
    sameSite: 'Default',
    sameSiteWritten: false,
  };
  for (const read of reads) {
    if (read.attribute.use !== 'used') continue;
    const payload = read.payload;
    switch (payload.kind) {
      case 'expires':
        cookie.expires = payload.ms;
        break;
      case 'max-age':
        cookie.maxAge = payload.max;
        break;
      case 'domain':
        cookie.domain = payload.domain;
        break;
      case 'path':
        cookie.path = payload.path;
        break;
      case 'samesite':
        cookie.sameSite = payload.enforcement;
        cookie.sameSiteWritten = true;
        break;
      case 'flag':
        if (read.attribute.kind === 'secure') cookie.secure = true;
        else cookie.httpOnly = true;
        break;
      default:
        break;
    }
  }
  return cookie;
}
