/**
 * The serialized origin of an address or of a page origin, as the browser writes it in the Origin header and compares it
 * with Access-Control-Allow-Origin: lower-case scheme and host, the default port left out, an international host name
 * written in its ASCII form. Only http and https are read. The word `null` (an opaque origin, such as a sandboxed frame or
 * a page opened from a file) is kept as `null`. Anything else gives `null` in the return value, meaning "not an origin".
 */
export function serializeOrigin(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === 'null') return 'null';
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.host === '') return null;
  return parsed.origin;
}

/** True when two serialized origins are the same origin. An opaque origin (`null`) is the same as no other. */
export function isSameOrigin(a: string, b: string): boolean {
  return a !== 'null' && b !== 'null' && a === b;
}
