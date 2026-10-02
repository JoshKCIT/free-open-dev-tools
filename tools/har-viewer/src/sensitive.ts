/**
 * The rules that decide which values of a recording are sensitive, and how a sensitive value is masked. The rules are
 * this package's own, are listed on the page, and only catch what they describe. Where a rule has a source, the source
 * is named beside it.
 */

/**
 * Header names (lower case) whose value is always sensitive.
 *  - authorization, proxy-authorization: RFC 7235 section 4.2 and 4.4 (credentials)
 *  - cookie, set-cookie: RFC 6265 section 4.2 and 4.1 (cookies carry sessions)
 *  - x-api-key, x-auth-token, x-csrf-token, x-xsrf-token: the common names of a key, an authentication token and an
 *    anti-forgery token
 */
export const SENSITIVE_HEADERS: readonly string[] = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
  'x-xsrf-token',
];

/**
 * Query and form parameter names (lower case) whose value is sensitive: access_token is the name RFC 6750 sections 2.2
 * and 2.3 give a bearer token in a form body and a query, and the others are the usual names of a token, a key, a
 * secret, a password and a signature.
 */
export const SENSITIVE_PARAMS: readonly string[] = [
  'token',
  'access_token',
  'id_token',
  'refresh_token',
  'api_key',
  'apikey',
  'key',
  'secret',
  'password',
  'passwd',
  'signature',
  'sig',
];

/** A parameter name that holds one of these words is sensitive too (csrf_token, client_secret, new_password). */
export const SENSITIVE_PARAM_WORDS: readonly string[] = ['token', 'secret', 'password', 'passwd'];

/** What a value is read as: a header value, a cookie value, or a query, form or posted parameter value. */
export type ValueKind = 'header' | 'cookie' | 'param';

const BASE64URL = /^[A-Za-z0-9_-]*$/;

/**
 * Whether a value has the shape of a JSON Web Token (RFC 7519 section 3: URL-safe parts separated by periods, three
 * for a signed token and five for an encrypted one, the first part the base64url of a JSON object, so it starts eyJ).
 */
export function looksLikeJwt(value: string): boolean {
  const text = value.trim();
  if (!text.startsWith('eyJ')) return false;
  const parts = text.split('.');
  if (parts.length !== 3 && parts.length !== 5) return false;
  if (parts.some((part) => !BASE64URL.test(part))) return false;
  // The header and, for a signed token, the payload are never empty (the signature of an unsecured token may be).
  if (parts[0]!.length < 4) return false;
  if (parts.length === 3 && parts[1] === '') return false;
  return true;
}

/** Whether a value is a Bearer credential (RFC 6750 section 2.1; RFC 7235: the scheme name is case-insensitive). */
export function looksLikeBearer(value: string): boolean {
  return /^bearer[ \t]+\S/i.test(value.trim());
}

function nameIsSensitive(name: string): boolean {
  const lower = name.trim().toLowerCase();
  if (SENSITIVE_PARAMS.includes(lower)) return true;
  return SENSITIVE_PARAM_WORDS.some((word) => lower.includes(word));
}

/**
 * Whether a value is sensitive. A cookie value always is. A header is by its name, a parameter by its name or by one
 * of the words in its name, and any value is by its shape (a JWT, a Bearer credential). An empty value has nothing to
 * hide.
 */
export function isSensitive(kind: ValueKind, name: string, value: string): boolean {
  if (value === '') return false;
  if (looksLikeJwt(value) || looksLikeBearer(value)) return true;
  if (kind === 'cookie') return true;
  if (kind === 'header') return SENSITIVE_HEADERS.includes(name.trim().toLowerCase());
  return nameIsSensitive(name);
}

/** Whether a name is one of a password (password, passwd, pwd, pass, passcode) or a secret: its value shows no character. */
function namesAPassword(name: string): boolean {
  const lower = name.trim().toLowerCase();
  if (lower.includes('password') || lower.includes('passwd') || lower.includes('secret') || lower.includes('pwd')) {
    return true;
  }
  return lower.split(/[^a-z0-9]+/).some((part) => part === 'pass' || part === 'passcode');
}

/**
 * Masks a value: its first characters then its length, `abcd… (20 characters)`. It keeps min(4, floor(length / 4))
 * characters, so a short value shows few or none of them (four of ten is too much of a ten-character secret), and it
 * keeps none when the name of the value holds password, passwd, secret or pwd, or is pass or passcode. Characters are
 * counted as code points, so a character outside the basic plane counts once.
 */
export function maskValue(value: string, name = ''): string {
  if (value === '') return '';
  const characters = Array.from(value);
  const keep = namesAPassword(name) ? 0 : Math.min(4, Math.floor(characters.length / 4));
  return `${characters.slice(0, keep).join('')}… (${characters.length} characters)`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Addresses

function decode(text: string): string {
  const spaced = text.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(spaced);
  } catch {
    return spaced;
  }
}

/** Masks the sensitive values of a list of `name=value` pairs joined by `&`, and counts them. */
export function maskPairs(text: string): { text: string; count: number } {
  let count = 0;
  const pieces = text.split('&').map((piece) => {
    const equals = piece.indexOf('=');
    if (equals < 0) return piece;
    const name = decode(piece.slice(0, equals));
    const value = decode(piece.slice(equals + 1));
    if (!isSensitive('param', name, value)) return piece;
    count++;
    return `${piece.slice(0, equals + 1)}${maskValue(value, name)}`;
  });
  return { text: pieces.join('&'), count };
}

/**
 * Masks the sensitive parts of an address: the password in its user information (RFC 3986 section 3.2.1: an
 * application should not render as clear text any data after the first colon), the sensitive parameters of its query
 * and, for an address that carries a fragment of parameters, of its fragment. `count` is how many were masked.
 */
export function maskUrl(url: string): { url: string; userinfo: number; params: number } {
  const split = /^([^?#]*)(\?[^#]*)?(#[\s\S]*)?$/.exec(url);
  if (!split) return { url, userinfo: 0, params: 0 };
  let base = split[1]!;
  let query = split[2] ?? '';
  let fragment = split[3] ?? '';
  let userinfo = 0;
  let params = 0;

  const authority = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/@]*)@/.exec(base);
  if (authority) {
    const info = authority[2]!;
    const colon = info.indexOf(':');
    if (colon >= 0 && colon < info.length - 1) {
      userinfo = 1;
      base = `${authority[1]}${info.slice(0, colon + 1)}${maskValue(decode(info.slice(colon + 1)), 'password')}${base.slice(authority[0].length - 1)}`;
    }
  }
  if (query.length > 1) {
    const masked = maskPairs(query.slice(1));
    params += masked.count;
    query = `?${masked.text}`;
  }
  if (fragment.length > 1 && fragment.includes('=')) {
    const masked = maskPairs(fragment.slice(1));
    params += masked.count;
    fragment = `#${masked.text}`;
  }
  return { url: `${base}${query}${fragment}`, userinfo, params };
}

// ---------------------------------------------------------------------------------------------------------------------
// Bodies

/** A JSON string member, `"name": "value"`, with its parts. */
const JSON_MEMBER = /"((?:[^"\\]|\\.)*)"(\s*:\s*)"((?:[^"\\]|\\.)*)"/g;
const BEARER_TEXT = /\bBearer[ \t]+[A-Za-z0-9._~+/-]+=*/gi;
const JWT_TEXT = /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*){1,3}/g;

function unescapeJson(text: string): string {
  try {
    return JSON.parse(`"${text}"`) as string;
  } catch {
    return text;
  }
}

/**
 * Masks the sensitive values inside a body that is shown as text: the fields of a form body, the string members of
 * JSON (or of anything that looks like JSON) whose names are sensitive, and any text shaped like a Bearer credential
 * or a JWT. A secret with another name and no such shape is not found.
 */
export function maskBodyText(text: string, mimeType: string): string {
  let result = text;
  if (/^application\/x-www-form-urlencoded\b/i.test(mimeType.trim())) {
    result = maskPairs(result).text;
  }
  result = result.replace(JSON_MEMBER, (whole, rawName: string, colon: string, rawValue: string) => {
    const value = unescapeJson(rawValue);
    if (!isSensitive('param', unescapeJson(rawName), value)) return whole;
    return `"${rawName}"${colon}"${JSON.stringify(maskValue(value, unescapeJson(rawName))).slice(1, -1)}"`;
  });
  result = result.replace(BEARER_TEXT, (match) => maskValue(match));
  result = result.replace(JWT_TEXT, (match) => maskValue(match));
  return result;
}
