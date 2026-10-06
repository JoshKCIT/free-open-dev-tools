import { isToken, trimHttpWhitespace } from './headers';

function isHttpWhitespace(code: number): boolean {
  return code === 9 || code === 10 || code === 13 || code === 32;
}

/**
 * The essence of a MIME type, read the way the WHATWG MIME Sniffing Standard's "parse a MIME type" reads it, reduced to
 * what the CORS safelist needs: remove the HTTP white space around the value, take the type up to the first slash and the
 * subtype up to the first semicolon, and require both to be tokens. The parameters after the semicolon are never needed
 * and never make the parse fail. Returns the lower-cased `type/subtype`, or `null` for failure.
 *
 * The Fetch Standard deliberately uses this strict parse and not the forgiving "extract a MIME type" for content-type, so
 * `text/plain, application/json` (a subtype holding a comma, a space and a slash) fails.
 */
export function parseMimeEssence(value: string): string | null {
  const text = trimHttpWhitespace(value);
  const slash = text.indexOf('/');
  if (slash < 0) return null;
  const type = text.slice(0, slash);
  if (!isToken(type)) return null;
  const semicolon = text.indexOf(';', slash + 1);
  const rawSubtype = semicolon < 0 ? text.slice(slash + 1) : text.slice(slash + 1, semicolon);
  // Only the trailing white space is removed: a space in front of the subtype is not a token character and fails.
  let end = rawSubtype.length;
  while (end > 0 && isHttpWhitespace(rawSubtype.charCodeAt(end - 1))) end -= 1;
  const subtype = rawSubtype.slice(0, end);
  if (!isToken(subtype)) return null;
  return `${type}/${subtype}`.toLowerCase();
}
