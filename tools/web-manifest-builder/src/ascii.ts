/**
 * The Infra Standard's ASCII whitespace: U+0009 TAB, U+000A LF, U+000C FF, U+000D CR and U+0020 SPACE. Every "strip
 * leading and trailing ASCII whitespace" and "split on ASCII whitespace" step of the manifest draft means these five
 * characters and no others (not a no-break space, not a vertical tab).
 */
export function isAsciiWhitespace(unit: number): boolean {
  return unit === 0x09 || unit === 0x0a || unit === 0x0c || unit === 0x0d || unit === 0x20;
}

/** Strips leading and trailing ASCII whitespace. */
export function stripAscii(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && isAsciiWhitespace(text.charCodeAt(start))) start++;
  while (end > start && isAsciiWhitespace(text.charCodeAt(end - 1))) end--;
  return text.slice(start, end);
}

/** Splits on ASCII whitespace and leaves out empty parts, in one pass. */
export function splitAscii(text: string): string[] {
  const parts: string[] = [];
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (isAsciiWhitespace(text.charCodeAt(i))) {
      if (start >= 0) {
        parts.push(text.slice(start, i));
        start = -1;
      }
    } else if (start < 0) {
      start = i;
    }
  }
  if (start >= 0) parts.push(text.slice(start));
  return parts;
}

/** ASCII lowercase: only A to Z change (so U+212A KELVIN SIGN never becomes a k). */
export function asciiLowercase(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    out += unit >= 0x41 && unit <= 0x5a ? String.fromCharCode(unit + 32) : text[i];
  }
  return out;
}

/** True when every code unit is an ASCII digit and there is at least one. */
export function isAsciiDigits(text: string): boolean {
  if (text.length === 0) return false;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x30 || unit > 0x39) return false;
  }
  return true;
}
