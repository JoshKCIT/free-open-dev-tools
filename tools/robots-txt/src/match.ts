/**
 * RFC 9309 path matching (section 2.2.2, "The Allow and Disallow Lines", and
 * section 2.2.3, "Special Characters").
 *
 * `normalisePath` implements the percent-encoding and selective decoding
 * rule of section 2.2.2 and its Figure 4: an octet outside the ASCII range,
 * or a reserved octet (RFC 3986) that appears as literal data rather than as
 * a URI structural delimiter, is percent-encoded; a percent-encoded ASCII
 * octet is decoded back to its literal character only when that character
 * is itself unreserved. `patternMatches` implements the star and dollar
 * special characters with a linear two-pointer wildcard match that tracks
 * the most recent star so a mismatch can backtrack to it, rather than
 * building a regular expression from a visitor's pattern. `decide` applies
 * section 2.2.2's precedence: the matching rule with the most octets wins,
 * an equal-length allow beats disallow, no match means allowed, and
 * /robots.txt is always allowed.
 */

const HEX_DIGITS = '0123456789ABCDEF';

function isHexDigitChar(ch: string | undefined): boolean {
  if (ch === undefined || ch.length !== 1) return false;
  const c = ch.charCodeAt(0);
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
}

/** RFC 3986 section 2.3's unreserved set: ALPHA / DIGIT / "-" / "." / "_" / "~". */
function isUnreservedAsciiChar(ch: string): boolean {
  if (ch.length !== 1) return false;
  const c = ch.charCodeAt(0);
  return (
    (c >= 65 && c <= 90) ||
    (c >= 97 && c <= 122) ||
    (c >= 48 && c <= 57) ||
    ch === '-' ||
    ch === '.' ||
    ch === '_' ||
    ch === '~'
  );
}

function isUnreservedByte(byte: number): boolean {
  return (
    (byte >= 65 && byte <= 90) ||
    (byte >= 97 && byte <= 122) ||
    (byte >= 48 && byte <= 57) ||
    byte === 45 ||
    byte === 46 ||
    byte === 95 ||
    byte === 126
  );
}

/** Percent-encodes every UTF-8 byte of a single code point, uppercase hex. */
function percentEncodeCodepoint(ch: string): string {
  const bytes = new TextEncoder().encode(ch);
  let out = '';
  for (const b of bytes) {
    out += '%' + HEX_DIGITS[(b >> 4) & 0xf] + HEX_DIGITS[b & 0xf];
  }
  return out;
}

/**
 * Walks `chars` (already split into code points), keeping an existing valid
 * `%XX` triple as-is except for uppercasing its hex digits, and otherwise
 * percent-encoding a code point when `shouldEncode` says to.
 */
function escapeKeepingExistingTriples(chars: string[], shouldEncode: (ch: string) => boolean): string {
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (ch === '%' && isHexDigitChar(chars[i + 1]) && isHexDigitChar(chars[i + 2])) {
      out += '%' + chars[i + 1]!.toUpperCase() + chars[i + 2]!.toUpperCase();
      i += 2;
      continue;
    }
    out += shouldEncode(ch) ? percentEncodeCodepoint(ch) : ch;
  }
  return out;
}

/** A path segment: only a non-ASCII code point is escaped; every ASCII octet, including the structural "/", is kept literal. */
function escapePathSegment(text: string): string {
  return escapeKeepingExistingTriples(Array.from(text), (ch) => ch.charCodeAt(0) > 0x7f);
}

/** A query name or value: anything outside RFC 3986's unreserved set is escaped, matching Figure 4's second row (a URL typed as a query value comes back percent-encoded). */
function escapeQueryComponent(text: string): string {
  return escapeKeepingExistingTriples(Array.from(text), (ch) => !isUnreservedAsciiChar(ch));
}

/** Decodes a `%XX` triple back to its literal character only when that character is unreserved, per section 2.2.2's own rule. */
function decodeUnreservedTriples(text: string): string {
  const chars = Array.from(text);
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (ch === '%' && isHexDigitChar(chars[i + 1]) && isHexDigitChar(chars[i + 2])) {
      const byte = parseInt(chars[i + 1]! + chars[i + 2]!, 16);
      if (isUnreservedByte(byte)) {
        out += String.fromCharCode(byte);
        i += 2;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

/**
 * RFC 9309 section 2.2.2 and its Figure 4: the path part (up to the first
 * literal "?") is escaped for non-ASCII octets only, keeping every
 * structural "/" literal; each query name and value (split on literal "&"
 * then the first "=") is escaped for anything outside the unreserved set,
 * since a value typed as a full URL (for example a query parameter holding
 * "https://foo.bar") is percent-encoded the same way a browser's own query
 * serialiser would encode it. The whole result then has every `%XX` triple
 * that decodes to an unreserved character decoded back to that character.
 */
export function normalisePath(path: string): string {
  const qIndex = path.indexOf('?');
  const pathPart = qIndex === -1 ? path : path.slice(0, qIndex);
  const queryPart = qIndex === -1 ? null : path.slice(qIndex + 1);

  const encodedPath = escapePathSegment(pathPart);

  let combined: string;
  if (queryPart === null) {
    combined = encodedPath;
  } else {
    const encodedQuery = queryPart
      .split('&')
      .map((pair) => {
        const eq = pair.indexOf('=');
        if (eq === -1) return escapeQueryComponent(pair);
        return escapeQueryComponent(pair.slice(0, eq)) + '=' + escapeQueryComponent(pair.slice(eq + 1));
      })
      .join('&');
    combined = `${encodedPath}?${encodedQuery}`;
  }

  return decodeUnreservedTriples(combined);
}

/** A single full match of `pattern` (already split into code points, no special "$" handling here) against the whole of `path`. */
function fullGlobMatch(pattern: string[], path: string[]): boolean {
  let pi = 0;
  let si = 0;
  let starPi = -1;
  let starSi = -1;

  while (si < path.length) {
    if (pi < pattern.length && pattern[pi] === '*') {
      starPi = pi;
      starSi = si;
      pi++;
    } else if (pi < pattern.length && pattern[pi] === path[si]) {
      pi++;
      si++;
    } else if (starPi !== -1) {
      pi = starPi + 1;
      starSi++;
      si = starSi;
    } else {
      return false;
    }
  }

  while (pi < pattern.length && pattern[pi] === '*') pi++;
  return pi === pattern.length;
}

/**
 * RFC 9309 section 2.2.3: "*" designates zero or more of any character; a
 * trailing "$" anchors the end of the match. Without a trailing "$" the
 * pattern only has to match a prefix of `path`, which this implements by
 * appending an implicit trailing "*" before running the same full-match
 * routine used for an anchored pattern.
 */
export function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const effective = anchored ? body : `${body}*`;
  return fullGlobMatch(Array.from(effective), Array.from(path));
}

export interface Rule {
  type: 'allow' | 'disallow';
  pattern: string;
}

export interface Decision<R extends Rule> {
  allowed: boolean;
  rule: R | null;
}

/**
 * RFC 9309 section 2.2.2: the matching rule with the most octets wins; an
 * equal-length allow beats disallow; no match means allowed; /robots.txt is
 * always allowed.
 */
export function decide<R extends Rule>(path: string, rules: R[]): Decision<R> {
  if (path === '/robots.txt') return { allowed: true, rule: null };

  const normalisedPath = normalisePath(path);
  let best: R | null = null;
  let bestLength = -1;

  for (const rule of rules) {
    const normalisedPattern = normalisePath(rule.pattern);
    if (!patternMatches(normalisedPattern, normalisedPath)) continue;
    const length = normalisedPattern.length;
    if (
      best === null ||
      length > bestLength ||
      (length === bestLength && rule.type === 'allow' && best.type === 'disallow')
    ) {
      best = rule;
      bestLength = length;
    }
  }

  if (best === null) return { allowed: true, rule: null };
  return { allowed: best.type === 'allow', rule: best };
}
