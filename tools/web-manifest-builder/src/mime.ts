import { asciiLowercase } from './ascii';

function isHttpWhitespace(unit: number): boolean {
  return unit === 0x09 || unit === 0x0a || unit === 0x0d || unit === 0x20;
}

/** The HTTP token code points of the Fetch Standard: ASCII letters and digits and !#$%&'*+-.^_`|~ . */
function isTokenCharacter(unit: number): boolean {
  if ((unit >= 0x30 && unit <= 0x39) || (unit >= 0x41 && unit <= 0x5a) || (unit >= 0x61 && unit <= 0x7a)) return true;
  return unit < 0x80 && "!#$%&'*+-.^_`|~".includes(String.fromCharCode(unit));
}

function isToken(text: string): boolean {
  if (text.length === 0) return false;
  for (let i = 0; i < text.length; i++) if (!isTokenCharacter(text.charCodeAt(i))) return false;
  return true;
}

/**
 * Parses a MIME type as the MIME Sniffing Standard does for its type and subtype, and returns its essence (the type and
 * subtype in lower case, without parameters), or null when it is not a MIME type. Parameters are not read: a MIME type
 * never fails to parse because of them, and a manifest keeps only the essence.
 */
export function parseMimeEssence(text: string): string | null {
  let start = 0;
  let end = text.length;
  while (start < end && isHttpWhitespace(text.charCodeAt(start))) start++;
  while (end > start && isHttpWhitespace(text.charCodeAt(end - 1))) end--;
  const input = text.slice(start, end);
  const slash = input.indexOf('/');
  if (slash < 0) return null;
  const type = input.slice(0, slash);
  const semicolon = input.indexOf(';', slash + 1);
  let subtype = semicolon < 0 ? input.slice(slash + 1) : input.slice(slash + 1, semicolon);
  let subtypeEnd = subtype.length;
  while (subtypeEnd > 0 && isHttpWhitespace(subtype.charCodeAt(subtypeEnd - 1))) subtypeEnd--;
  subtype = subtype.slice(0, subtypeEnd);
  if (!isToken(type) || !isToken(subtype)) return null;
  return `${asciiLowercase(type)}/${asciiLowercase(subtype)}`;
}
