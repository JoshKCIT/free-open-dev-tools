import meta from './meta.json';
import { setOwn } from './own-property';

export { meta };

export class UrlParserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UrlParserError';
  }
}

export interface PathSegment {
  /** The path segment exactly as it appeared between slashes. */
  raw: string;
  /** `decodeURIComponent(raw)`, or null when that throws (a malformed percent-escape). */
  decoded: string | null;
}

export interface QueryPair {
  name: string;
  value: string;
}

export interface ParsedUrl {
  href: string;
  origin: string;
  protocol: string;
  username: string;
  password: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  pathSegments: PathSegment[];
  query: QueryPair[];
  queryObject: Record<string, string | string[]>;
  warnings: string[];
}

export interface ParseUrlOptions {
  base?: string;
}

export interface ParsedQuery {
  query: QueryPair[];
  queryObject: Record<string, string | string[]>;
}

// The WHATWG URL Standard's special schemes (the scheme state's own list).
// A URL whose scheme is not one of these has an opaque path: the platform
// parser does not split it into segments the way a special-scheme URL's
// path is split.
const SPECIAL_SCHEMES = new Set(['ftp:', 'file:', 'http:', 'https:', 'ws:', 'wss:']);

function pairsFromSearchParams(search: URLSearchParams): QueryPair[] {
  const pairs: QueryPair[] = [];
  for (const [name, value] of search) pairs.push({ name, value });
  return pairs;
}

/**
 * Builds the query object with `setOwn`, so a name like `__proto__` or
 * `constructor` becomes an ordinary own key instead of reaching the
 * object's own prototype chain.
 */
function queryObjectFromPairs(pairs: QueryPair[]): Record<string, string | string[]> {
  const obj: Record<string, string | string[]> = {};
  for (const { name, value } of pairs) {
    if (Object.hasOwn(obj, name)) {
      const existing = obj[name];
      if (Array.isArray(existing)) existing.push(value);
      else setOwn(obj, name, [existing as string, value]);
    } else {
      setOwn(obj, name, value);
    }
  }
  return obj;
}

function pathSegmentsFrom(pathname: string): PathSegment[] {
  // A non-opaque path always starts with '/', so the first split segment is
  // always empty; drop it. An opaque path may not start with '/' at all.
  const parts = pathname.startsWith('/') ? pathname.slice(1).split('/') : pathname.split('/');
  return parts.map((raw) => {
    let decoded: string | null;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      decoded = null;
    }
    return { raw, decoded };
  });
}

/**
 * Names what the WHATWG URL Standard's basic URL parser silently removed
 * from `input` before parsing it, quoting the two relevant steps: "Remove
 * any leading and trailing C0 control or space from input" and "Remove all
 * ASCII tab or newline from input" (WHATWG URL Standard, basic URL parser).
 * Returns null when input carried neither.
 */
function describeRemovedCharacters(input: string): string | null {
  // eslint-disable-next-line no-control-regex -- deliberately matching control characters, not a typo.
  const hasLeadingOrTrailingControlOrSpace = /^[\u0000- ]|[\u0000- ]$/.test(input);
  const hasTabOrNewline = /[\t\n\r]/.test(input);
  if (!hasLeadingOrTrailingControlOrSpace && !hasTabOrNewline) return null;
  const parts: string[] = [];
  if (hasLeadingOrTrailingControlOrSpace) parts.push('a leading or trailing control character or space');
  if (hasTabOrNewline) parts.push('a tab or newline');
  return `This input carried ${parts.join(' and ')}, which the WHATWG URL Standard's basic URL parser removes before parsing.`;
}

/**
 * A best-effort read of the host exactly as it was typed, taken from the raw
 * input text rather than from any parsed result, so it can be compared
 * against what the platform parser actually returns. Returns null whenever
 * the input does not have a confident scheme-with-authority shape (for
 * example an opaque-path scheme, or a relative reference), so a case this
 * cannot read never produces a false warning.
 */
function extractTypedHost(input: string): string | null {
  const collapsed = input.replace(/[\t\n\r]/g, '');
  // eslint-disable-next-line no-control-regex -- deliberately matching control characters, not a typo.
  const match = collapsed.match(/^[\u0000- ]*[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/);
  if (!match) return null;
  let authority = match[1] ?? '';
  const at = authority.lastIndexOf('@');
  if (at !== -1) authority = authority.slice(at + 1);
  if (authority.startsWith('[')) {
    const close = authority.indexOf(']');
    return close === -1 ? null : authority.slice(1, close);
  }
  const colon = authority.lastIndexOf(':');
  const host = colon === -1 ? authority : authority.slice(0, colon);
  return host.length > 0 ? host : null;
}

/**
 * Splits a URL into every component the WHATWG URL Standard defines, using
 * the platform's own `URL`, which implements that standard directly.
 */
export function parseUrl(input: string, options: ParseUrlOptions = {}): ParsedUrl {
  const { base = '' } = options;
  let url: URL;
  try {
    url = new URL(input, base.trim() ? base : undefined);
  } catch {
    const looksAbsolute = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(input.trim());
    const hint = !base.trim() && !looksAbsolute ? ' A relative reference needs a base URL.' : '';
    throw new UrlParserError(`That is not a URL the WHATWG URL Standard can parse.${hint}`);
  }

  const warnings: string[] = [];

  if (url.username || url.password) {
    warnings.push('This URL carries a user name or password. Anyone who sees this URL sees them too.');
  }

  const removed = describeRemovedCharacters(input);
  if (removed) warnings.push(removed);

  const typedHost = extractTypedHost(input);
  if (typedHost !== null && typedHost !== url.hostname) {
    warnings.push(
      `The host shown ("${url.hostname}") differs from the host typed ("${typedHost}") because the parser normalised it: lower-casing it, converting it to its ASCII (Punycode) form, or removing a trailing dot.`,
    );
  }

  if (!SPECIAL_SCHEMES.has(url.protocol)) {
    warnings.push(
      `The scheme "${url.protocol}" is not one of the WHATWG URL Standard's special schemes, so this URL's path is opaque: it is not split into segments the way a special-scheme URL's path is.`,
    );
  }

  const query = pairsFromSearchParams(url.searchParams);

  return {
    href: url.href,
    origin: url.origin,
    protocol: url.protocol,
    username: url.username,
    password: url.password,
    host: url.host,
    hostname: url.hostname,
    port: url.port,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    pathSegments: pathSegmentsFrom(url.pathname),
    query,
    queryObject: queryObjectFromPairs(query),
    warnings,
  };
}

/**
 * Parses a bare query string (with or without a leading `?`) using the
 * platform's own `URLSearchParams`, which implements the WHATWG URL
 * Standard's `application/x-www-form-urlencoded` parser directly.
 */
export function parseQuery(text: string): ParsedQuery {
  const trimmed = text.startsWith('?') ? text.slice(1) : text;
  const search = new URLSearchParams(trimmed);
  const query = pairsFromSearchParams(search);
  return { query, queryObject: queryObjectFromPairs(query) };
}
