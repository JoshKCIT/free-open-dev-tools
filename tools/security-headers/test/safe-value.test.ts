import { it, expect } from 'vitest';
import { assertSingleLine, findUnsafeCharacter, UnsafeValueError } from '../src/safe-value';

it('a line feed, carriage return, NUL or other control character is refused with the field and position as RFC 9110 field values require', () => {
  expect(() => assertSingleLine('a\nb', 'CSP')).toThrow(UnsafeValueError);
  try {
    assertSingleLine('a\nb', 'CSP');
  } catch (err) {
    expect(err).toBeInstanceOf(UnsafeValueError);
    const e = err as UnsafeValueError;
    expect(e.field).toBe('CSP');
    expect(e.position).toBe(2);
    expect(e.message).toBe(
      'CSP contains a line break or control character at position 2, so it was refused: it could start a new header or directive.',
    );
    expect(e.message).not.toContain('a\nb');
  }

  expect(() => assertSingleLine('a\rb', 'value')).toThrow(UnsafeValueError);
  expect(() => assertSingleLine('a\u0000b', 'value')).toThrow(UnsafeValueError);
  expect(() => assertSingleLine('a\u0001b', 'value')).toThrow(UnsafeValueError);
  expect(() => assertSingleLine('a\u001fb', 'value')).toThrow(UnsafeValueError);
  expect(() => assertSingleLine('a\u007fb', 'value')).toThrow(UnsafeValueError);

  const found = findUnsafeCharacter('ab\ncd');
  expect(found).toEqual({ index: 2, codePoint: 10 });
});

it('a horizontal tab and ordinary text including non-ASCII letters pass through unchanged', () => {
  expect(findUnsafeCharacter('a\tb')).toBeNull();
  expect(assertSingleLine('a\tb', 'value')).toBe('a\tb');
  expect(assertSingleLine("default-src 'self'; img-src 'self' data:", 'CSP')).toBe(
    "default-src 'self'; img-src 'self' data:",
  );
  const accented = 'caf' + String.fromCharCode(0xe9) + ' na' + String.fromCharCode(0xef) + 've';
  expect(assertSingleLine(accented, 'value')).toBe(accented);
  expect(findUnsafeCharacter('')).toBeNull();
});

it('next line and the Unicode line and paragraph separators are refused too', () => {
  // Built with String.fromCharCode rather than a literal escape in the
  // string: ES2019 permits U+2028/U+2029 unescaped inside a string literal,
  // which would let a formatter silently render them as literal invisible
  // characters in this source file.
  const nel = 'a' + String.fromCharCode(0x85) + 'b';
  const withLineSeparator = 'a' + String.fromCharCode(0x2028) + 'b';
  const withParagraphSeparator = 'a' + String.fromCharCode(0x2029) + 'b';

  expect(() => assertSingleLine(nel, 'value')).toThrow(UnsafeValueError);
  expect(() => assertSingleLine(withLineSeparator, 'value')).toThrow(UnsafeValueError);
  expect(() => assertSingleLine(withParagraphSeparator, 'value')).toThrow(UnsafeValueError);

  expect(findUnsafeCharacter(nel)).toEqual({ index: 1, codePoint: 0x85 });
  expect(findUnsafeCharacter(withLineSeparator)).toEqual({ index: 1, codePoint: 0x2028 });
  expect(findUnsafeCharacter(withParagraphSeparator)).toEqual({ index: 1, codePoint: 0x2029 });
});
