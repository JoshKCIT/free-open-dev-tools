import { it, expect, describe } from 'vitest';
import { escapeLiteral, unescapeLiteral, StringEscapeError } from '../src/index';

// Python Language Reference 2.4.2 escape sequence table, transcribed by
// hand from https://docs.python.org/3/reference/lexical_analysis.html#string-and-bytes-literals
const PY_ESCAPES: { char: string; escape: string }[] = [
  { char: '\\', escape: '\\\\' },
  { char: '\x07', escape: '\\a' },
  { char: '\b', escape: '\\b' },
  { char: '\f', escape: '\\f' },
  { char: '\n', escape: '\\n' },
  { char: '\r', escape: '\\r' },
  { char: '\t', escape: '\\t' },
  { char: '\v', escape: '\\v' },
];

describe('Python escape sequence table', () => {
  for (const { char, escape } of PY_ESCAPES) {
    it(`unescapes ${JSON.stringify(escape)}`, () => {
      expect(unescapeLiteral(escape, { language: 'python', wrap: false }).value).toBe(char);
    });
  }
  it('\\\\ round trips through escape too', () => {
    expect(escapeLiteral('\\', { language: 'python', wrap: false }).value).toBe('\\\\');
  });
});

describe('Python unescape', () => {
  it('\\N{DASH} throws with the no-name-table message', () => {
    expect(() => unescapeLiteral('\\N{DASH}', { language: 'python', wrap: false })).toThrow(/name table/);
  });

  it('\\q keeps two characters and warns', () => {
    const r = unescapeLiteral('\\q', { language: 'python', wrap: false });
    expect(r.value).toBe('\\q');
    expect(r.warnings.length).toBe(1);
  });

  it('\\777 reads as U+01FF with a warning', () => {
    const r = unescapeLiteral('\\777', { language: 'python', wrap: false });
    expect(r.value).toBe('ǿ');
    expect(r.warnings.length).toBe(1);
  });

  it('\\U0001F600 reads as the astral character', () => {
    expect(unescapeLiteral('\\U0001F600', { language: 'python', wrap: false }).value).toBe('\u{1F600}');
  });

  it('u"x" prefix is accepted', () => {
    expect(unescapeLiteral('u"x"', { language: 'python', wrap: true }).value).toBe('x');
  });

  it('r"x" prefix is refused', () => {
    expect(() => unescapeLiteral('r"x"', { language: 'python', wrap: true })).toThrow(StringEscapeError);
  });

  it('b"x" and f"x" prefixes are refused', () => {
    expect(() => unescapeLiteral('b"x"', { language: 'python', wrap: true })).toThrow(StringEscapeError);
    expect(() => unescapeLiteral('f"x"', { language: 'python', wrap: true })).toThrow(StringEscapeError);
  });

  it('triple-quoted strings are refused', () => {
    expect(() => unescapeLiteral('"""x"""', { language: 'python', wrap: true })).toThrow(StringEscapeError);
  });
});

describe('Python escape with astral and escapeNonAscii', () => {
  it('astral with escapeNonAscii escapes to \\U0001F600', () => {
    expect(escapeLiteral('\u{1F600}', { language: 'python', wrap: false, escapeNonAscii: true }).value).toBe(
      '\\U0001F600',
    );
  });
});

describe('Python round trip', () => {
  const CORPUS = ['', '\0', '\t', '\n', '\r\n', '"', "'", '\\', 'café', '\u{1F600}', '\u{10FFFF}', '\uD800'];
  for (const s of CORPUS) {
    it(`round trips ${JSON.stringify(s)}`, () => {
      const escaped = escapeLiteral(s, { language: 'python', wrap: true });
      expect(unescapeLiteral(escaped.value, { language: 'python', wrap: true }).value).toBe(s);
    });
  }
});
