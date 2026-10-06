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

/** The request headers whose names the standard allows without a preflight, before their values are looked at. */
const SAFELISTED_NAMES: ReadonlySet<string> = new Set([
  'accept',
  'accept-language',
  'content-language',
  'content-type',
]);

/** Whether a request header (name and value) is CORS-safelisted. */
export function isCorsSafelistedRequestHeader(name: string, value: string): boolean {
  void value;
  return SAFELISTED_NAMES.has(asciiLower(name));
}

/**
 * The CORS-unsafe request-header names of a header list: the names of the headers that are not safelisted, lower-cased,
 * each once, sorted by byte.
 */
export function corsUnsafeRequestHeaderNames(headers: readonly { name: string; value: string }[]): string[] {
  const unsafe = new Set<string>();
  for (const header of headers) {
    if (!isCorsSafelistedRequestHeader(header.name, header.value)) unsafe.add(asciiLower(header.name));
  }
  return [...unsafe].sort();
}
