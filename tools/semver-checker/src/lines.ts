/** How many characters of a pasted line are shown in a table cell or a list. */
export const MAX_SHOWN_CHARACTERS = 40;

const ELLIPSIS = String.fromCodePoint(0x2026);
const ESCAPE_OPEN = String.fromCodePoint(92) + 'u{';

/**
 * Reads a pasted text one line at a time: lines end at a line feed. Line numbers start at 1 and count every line, blank
 * ones included, so a number shown to the visitor is the number in what they pasted. A carriage return before a line
 * feed and a byte order mark at the start are white space, so the callers' `trim()` takes them off.
 *
 * One pass with `indexOf`, no regular expression, no array of lines: a paste of many line feeds costs one visit each
 * and nothing is kept.
 */
export function forEachLine(text: string, visit: (line: string, number: number) => void): void {
  let start = 0;
  let number = 1;
  for (;;) {
    const lineFeed = text.indexOf('\n', start);
    if (lineFeed < 0) {
      visit(text.slice(start), number);
      return;
    }
    visit(text.slice(start, lineFeed), number);
    start = lineFeed + 1;
    number += 1;
  }
}

/** Every non-blank line of a paste, trimmed, with the line number it has in what was pasted. */
export function splitVersionLines(text: string): { line: number; text: string }[] {
  const lines: { line: number; text: string }[] = [];
  forEachLine(text, (lineText, line) => {
    const trimmed = lineText.trim();
    if (trimmed !== '') lines.push({ line, text: trimmed });
  });
  return lines;
}

/**
 * True for the characters shown as a code point instead of themselves: the control characters, and the characters that
 * change the direction of the text around them (Unicode Standard Annex 9: U+061C, U+200E, U+200F, U+202A to U+202E and
 * U+2066 to U+2069), which can make a version read as a different one.
 */
function needsEscape(point: number): boolean {
  return (
    point <= 0x1f ||
    (point >= 0x7f && point <= 0x9f) ||
    point === 0x61c ||
    point === 0x200e ||
    point === 0x200f ||
    (point >= 0x202a && point <= 0x202e) ||
    (point >= 0x2066 && point <= 0x2069)
  );
}

/**
 * Pasted text made safe to show: control characters and direction-changing characters are written as a backslash, `u`,
 * braces and the code point in hex, and only the first `maxCharacters` characters (code points) are kept, with an
 * ellipsis after them when something was left out.
 */
export function visible(text: string, maxCharacters: number = MAX_SHOWN_CHARACTERS): string {
  let shown = '';
  let count = 0;
  for (const ch of text) {
    if (count === maxCharacters) return shown + ELLIPSIS;
    const point = ch.codePointAt(0) ?? 0;
    shown += needsEscape(point) ? ESCAPE_OPEN + point.toString(16).toUpperCase() + '}' : ch;
    count++;
  }
  return shown;
}
