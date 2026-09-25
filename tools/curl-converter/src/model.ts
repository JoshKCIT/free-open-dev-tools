/**
 * The request model this whole package works over. `parseCurl` (from a
 * pasted curl command) and `buildRequest` (from the page's own fields) both
 * produce the same `RequestSpec`, so the six emitters in `emit-*.ts` only
 * ever need to know one shape.
 *
 * Standards this file is grounded in: RFC 9110 sections 5.1 (field names are
 * tokens), 5.5 (field values) and 9.1 (the request method is a token); RFC
 * 7617 (the Basic authentication scheme, section 2: "the user-id and
 * password MUST NOT contain any control characters" and are joined with a
 * single colon, then base64 encoded over the UTF-8 bytes -- see RFC 7617's
 * appendix note on UTF-8 as the recommended charset).
 */
import { assertSingleLine } from './safe-value';

/** RFC 9110 section 5.1: a field name is a `token`. */
const TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function isToken(value: string): boolean {
  return value.length > 0 && TOKEN_RE.test(value);
}

export interface MultipartField {
  name: string;
  /** The literal value typed, or (for a file field) the file name. */
  value: string;
  /** Set when this field came from an `@file` or `name=@file` form: the value is not read here. */
  isFile: boolean;
}

export type RequestBody =
  | { kind: 'none' }
  | { kind: 'raw'; text: string; contentType?: string }
  | { kind: 'json'; text: string }
  | { kind: 'form'; pairs: [string, string][] }
  | { kind: 'multipart'; fields: MultipartField[] };

export type RequestAuth =
  { kind: 'none' } | { kind: 'basic'; user: string; password: string } | { kind: 'bearer'; token: string };

export interface RequestSpec {
  method: string;
  url: string;
  /** Ordered, in the order they should appear; repeats kept. */
  headers: [string, string][];
  body: RequestBody;
  auth: RequestAuth;
  followRedirects: boolean;
  insecure: boolean;
  compressed: boolean;
}

export interface RequestProblem {
  field: string;
  message: string;
  line?: number;
}

export class CurlConverterError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'CurlConverterError';
    this.line = detail.line;
    this.column = detail.column;
  }
}

/**
 * Encodes UTF-8 bytes to base64 by hand (RFC 4648 section 4) so this file
 * works identically in Node (tests) and in a browser tab with no DOM API
 * dependency -- `btoa` only accepts Latin1 text, which would silently
 * mangle a non-ASCII username or password.
 */
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    const [a, b, c] = [bytes[i]!, bytes[i + 1]!, bytes[i + 2]!];
    out += BASE64_ALPHABET[a >> 2];
    out += BASE64_ALPHABET[((a & 0x03) << 4) | (b >> 4)];
    out += BASE64_ALPHABET[((b & 0x0f) << 2) | (c >> 6)];
    out += BASE64_ALPHABET[c & 0x3f];
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const a = bytes[i]!;
    out += BASE64_ALPHABET[a >> 2];
    out += BASE64_ALPHABET[(a & 0x03) << 4];
    out += '==';
  } else if (remaining === 2) {
    const a = bytes[i]!;
    const b = bytes[i + 1]!;
    out += BASE64_ALPHABET[a >> 2];
    out += BASE64_ALPHABET[((a & 0x03) << 4) | (b >> 4)];
    out += BASE64_ALPHABET[(b & 0x0f) << 2];
    out += '=';
  }
  return out;
}

/** RFC 7617 section 2: `user-pass = userid ":" password`, then base64 over the UTF-8 bytes. */
export function basicAuthValue(user: string, password: string): string {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  return bytesToBase64(bytes);
}

export interface BuildRequestFields {
  method: string;
  url: string;
  /** `Name: value` per line. */
  headersText: string;
  /** `name=value` per line, appended to the URL's query with URLSearchParams. */
  queryText: string;
  bodyKind: 'none' | 'raw' | 'json' | 'form' | 'multipart';
  bodyText: string;
  authKind: 'none' | 'basic' | 'bearer';
  username: string;
  password: string;
  token: string;
  followRedirects: boolean;
}

function parseHeadersText(text: string, problems: RequestProblem[]): [string, string][] {
  const headers: [string, string][] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon < 0) {
      problems.push({
        field: 'headers',
        message: `Line ${i + 1} ("${line}") has no colon, so it is not a header.`,
        line: i + 1,
      });
      continue;
    }
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (!isToken(name)) {
      problems.push({
        field: 'headers',
        message: `"${name}" is not a valid header name (RFC 9110 field names are tokens).`,
        line: i + 1,
      });
      continue;
    }
    try {
      headers.push([name, assertSingleLine(value, `Header "${name}"`)]);
    } catch (err) {
      problems.push({ field: 'headers', message: err instanceof Error ? err.message : String(err), line: i + 1 });
    }
  }
  return headers;
}

function parseQueryText(text: string): [string, string][] {
  const pairs: [string, string][] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const eq = line.indexOf('=');
    if (eq < 0) {
      pairs.push([line, '']);
    } else {
      pairs.push([line.slice(0, eq), line.slice(eq + 1)]);
    }
  }
  return pairs;
}

function parseFormBody(text: string): [string, string][] {
  const pairs: [string, string][] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const eq = line.indexOf('=');
    if (eq < 0) pairs.push([line, '']);
    else pairs.push([line.slice(0, eq), line.slice(eq + 1)]);
  }
  return pairs;
}

function parseMultipartBody(text: string): MultipartField[] {
  const fields: MultipartField[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const eq = line.indexOf('=');
    const name = eq < 0 ? line : line.slice(0, eq);
    const rawValue = eq < 0 ? '' : line.slice(eq + 1);
    const isFile = rawValue.startsWith('@');
    fields.push({ name, value: isFile ? rawValue.slice(1) : rawValue, isFile });
  }
  return fields;
}

/** A body carrying a raw NUL character cannot be passed on any target's command line. */
function assertNoNul(text: string, field: string, problems: RequestProblem[]): void {
  if (text.includes('\u0000')) {
    problems.push({
      field,
      message: `${field} contains a NUL character, which no shell or language target here can pass on a command line, so it was refused.`,
    });
  }
}

/**
 * Builds a `RequestSpec` from the page's own field values (the build-mode
 * form), with the same checks `parseCurl` applies to a pasted command.
 * Never throws: problems are collected and returned, and the request is
 * still built as far as it safely can be.
 */
export function buildRequest(fields: BuildRequestFields): { request: RequestSpec; problems: RequestProblem[] } {
  const problems: RequestProblem[] = [];

  let method = (fields.method || 'GET').trim();
  if (!isToken(method)) {
    problems.push({ field: 'method', message: `"${method}" is not a valid HTTP method token (RFC 9110 section 9.1).` });
    method = 'GET';
  }

  let url = fields.url.trim();
  const queryPairs = parseQueryText(fields.queryText);
  if (queryPairs.length > 0) {
    try {
      const u = new URL(url || 'http://placeholder.invalid/');
      for (const [name, value] of queryPairs) u.searchParams.append(name, value);
      url = url ? u.toString() : url;
      if (!url) url = u.toString();
    } catch {
      problems.push({
        field: 'query',
        message: 'The query fields could not be appended because the URL does not parse.',
      });
    }
  }
  if (!url) {
    problems.push({ field: 'url', message: 'A URL is required.' });
  } else {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        problems.push({ field: 'url', message: `The URL scheme "${parsed.protocol}" is not http or https.` });
      }
    } catch {
      problems.push({ field: 'url', message: 'That is not a URL this tool can parse (the WHATWG URL Standard).' });
    }
  }

  const headers = parseHeadersText(fields.headersText, problems);

  let body: RequestBody = { kind: 'none' };
  if (fields.bodyKind === 'raw') {
    assertNoNul(fields.bodyText, 'body', problems);
    body = { kind: 'raw', text: fields.bodyText };
  } else if (fields.bodyKind === 'json') {
    assertNoNul(fields.bodyText, 'body', problems);
    try {
      if (fields.bodyText.trim()) JSON.parse(fields.bodyText);
      body = { kind: 'json', text: fields.bodyText };
    } catch (err) {
      problems.push({
        field: 'body',
        message: `The JSON body does not parse: ${err instanceof Error ? err.message : String(err)}`,
      });
      body = { kind: 'json', text: fields.bodyText };
    }
  } else if (fields.bodyKind === 'form') {
    assertNoNul(fields.bodyText, 'body', problems);
    body = { kind: 'form', pairs: parseFormBody(fields.bodyText) };
  } else if (fields.bodyKind === 'multipart') {
    assertNoNul(fields.bodyText, 'body', problems);
    body = { kind: 'multipart', fields: parseMultipartBody(fields.bodyText) };
  }

  let auth: RequestAuth = { kind: 'none' };
  if (fields.authKind === 'basic') {
    auth = { kind: 'basic', user: fields.username, password: fields.password };
  } else if (fields.authKind === 'bearer') {
    auth = { kind: 'bearer', token: fields.token };
  }

  const request: RequestSpec = {
    method,
    url,
    headers,
    body,
    auth,
    followRedirects: fields.followRedirects,
    insecure: false,
    compressed: false,
  };

  return { request, problems };
}
