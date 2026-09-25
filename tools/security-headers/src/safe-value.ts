/**
 * The canonical single-line value guard (D-94/AA). Refuses any value that
 * could inject a new HTTP header or a new server-configuration directive by
 * carrying a line break or a control character.
 *
 * RFC 9110 section 5.5's field-value grammar allows only HTAB, SP, VCHAR
 * (printable US-ASCII, 0x21-0x7E) and obs-text (0x80-0xFF) inside a field
 * value, and says plainly: "Field values containing CR, LF, or NUL
 * characters are invalid and dangerous... Field values containing other CTL
 * characters are also invalid." This module refuses every C0 control
 * character except the allowed horizontal tab, plus DEL, and three
 * characters outside RFC 9110's own byte-oriented grammar that this project
 * treats as line-breaking too because they are read from a JavaScript
 * string, not raw bytes: U+0085 (NEL, a line terminator in several text
 * encodings), and U+2028/U+2029 (the Unicode line and paragraph
 * separators, which some servers and parsers treat as line breaks).
 *
 * Copied byte for byte into every phase 6 tool that writes a header, a
 * server directive or a configuration line from a value a visitor typed
 * (AC): this file's own header names only the specification it implements,
 * never a tool.
 */

export class UnsafeValueError extends Error {
  readonly field: string;
  readonly position: number;

  constructor(field: string, position: number) {
    super(
      `${field} contains a line break or control character at position ${position}, so it was refused: it could start a new header or directive.`,
    );
    this.name = 'UnsafeValueError';
    this.field = field;
    this.position = position;
  }
}

/**
 * The first code unit in `value` that RFC 9110's field-value grammar (plus
 * this project's own JavaScript-string additions, see the header comment)
 * refuses, or null when every code unit is safe. Horizontal tab (U+0009) is
 * allowed, as RFC 9110 section 5.5 allows it inside a field value.
 */
export function findUnsafeCharacter(value: string): { index: number; codePoint: number } | null {
  for (let i = 0; i < value.length; i++) {
    const codePoint = value.charCodeAt(i);
    const isC0ControlExceptTab = codePoint <= 0x08 || (codePoint >= 0x0a && codePoint <= 0x1f);
    const isDel = codePoint === 0x7f;
    const isNel = codePoint === 0x85;
    const isUnicodeLineOrParagraphSeparator = codePoint === 0x2028 || codePoint === 0x2029;
    if (isC0ControlExceptTab || isDel || isNel || isUnicodeLineOrParagraphSeparator) {
      return { index: i, codePoint };
    }
  }
  return null;
}

/**
 * Returns `value` unchanged when it carries no unsafe character, or throws
 * `UnsafeValueError` naming `field` and a 1-based position. The message
 * never repeats the value itself.
 */
export function assertSingleLine(value: string, field: string): string {
  const unsafe = findUnsafeCharacter(value);
  if (unsafe) throw new UnsafeValueError(field, unsafe.index + 1);
  return value;
}
