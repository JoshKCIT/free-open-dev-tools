/**
 * Small text helpers the compilers' messages are built from. Pure: no DOM, no clock, nothing logged. Every function is
 * one pass over its input.
 */

const BACKSLASH = String.fromCharCode(92);

/** True for the code units `visible` escapes: control characters other than tab and line feed, and the direction marks. */
function isEscaped(unit: number): boolean {
  if (unit <= 0x1f) return unit !== 0x09 && unit !== 0x0a;
  if (unit >= 0x7f && unit <= 0x9f) return true;
  if (unit === 0x61c || unit === 0x200e || unit === 0x200f) return true;
  if (unit >= 0x202a && unit <= 0x202e) return true;
  return unit >= 0x2066 && unit <= 0x2069;
}

/**
 * The text with U+0000 to U+001F (except tab and line feed), U+007F, U+0080 to U+009F, U+061C, U+200E, U+200F,
 * U+202A to U+202E and U+2066 to U+2069 written as the backslash, `u{`, the code point in capital hexadecimal and `}`,
 * so text from a stylesheet cannot move the cursor, hide text or reorder what a reader sees. One pass, linear in the
 * text.
 */
export function visible(text: string): string {
  let out = '';
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (!isEscaped(unit)) continue;
    out += text.slice(from, i) + BACKSLASH + 'u{' + unit.toString(16).toUpperCase() + '}';
    from = i + 1;
  }
  return out + text.slice(from);
}

/** The first `limit` characters of the text, never ending in the first half of a surrogate pair. */
export function head(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const last = text.charCodeAt(limit - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? limit - 1 : limit;
  return text.slice(0, end);
}

/** The text cut to `limit` characters in all, the last three being `...` when anything was cut. */
export function cutWithEllipsis(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return head(text, limit - 3) + '...';
}

/**
 * The line and column of a character, both counted from 1 as a reader counts them. A line ends at a line feed, a
 * carriage return and line feed, or a lone carriage return; the column counts characters, so a character outside the
 * basic plane (two UTF-16 code units) is one column. `offset` is a UTF-16 offset into `text`, as both compilers
 * report it. One pass from the start of the text.
 */
export function positionAt(text: string, offset: number): { line: number; column: number } {
  const end = Math.max(0, Math.min(Math.floor(offset), text.length));
  let line = 1;
  let column = 0;
  let afterHigh = false;
  for (let i = 0; i < end; i++) {
    const unit = text.charCodeAt(i);
    if (unit === 10 || (unit === 13 && text.charCodeAt(i + 1) !== 10)) {
      line++;
      column = 0;
      afterHigh = false;
      continue;
    }
    if (unit === 13) {
      // The line feed that follows ends this line.
      afterHigh = false;
      continue;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff && afterHigh) {
      afterHigh = false;
      continue;
    }
    column++;
    afterHigh = unit >= 0xd800 && unit <= 0xdbff;
  }
  return { line, column: column + 1 };
}
