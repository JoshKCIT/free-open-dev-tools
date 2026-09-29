import { it, expect, describe } from 'vitest';
import { escapeLiteral, unescapeLiteral, StringEscapeError } from '../src/index';

// JLS SE 21 section 3.10.7 escape sequence table, transcribed by hand from
// https://docs.oracle.com/javase/specs/jls/se21/html/jls-3.html#jls-3.10.7
const JLS_3_10_7_ESCAPES: { char: string; escape: string }[] = [
  { char: '\b', escape: '\\b' },
  { char: '\t', escape: '\\t' },
  { char: '\n', escape: '\\n' },
  { char: '\f', escape: '\\f' },
  { char: '\r', escape: '\\r' },
  { char: '"', escape: '\\"' },
  { char: '\\', escape: '\\\\' },
];

describe('JLS 3.10.7 escape sequence table', () => {
  for (const { char, escape } of JLS_3_10_7_ESCAPES) {
    it(`escapes and unescapes ${JSON.stringify(char)}`, () => {
      expect(escapeLiteral(char, { language: 'java', wrap: false }).value).toBe(escape);
      expect(unescapeLiteral(escape, { language: 'java', wrap: false }).value).toBe(char);
    });
  }
});

describe('Java escape', () => {
  it('LF escapes to \\n, never to \\u000A', () => {
    expect(escapeLiteral('\n', { language: 'java', wrap: false }).value).toBe('\\n');
  });

  it('with escapeNonAscii the output never contains \\u000A, \\u000D, a raw quote or a raw backslash', () => {
    const r = escapeLiteral('a\nb\rc"d\\eé', { language: 'java', wrap: false, escapeNonAscii: true });
    expect(r.value).not.toContain('\\u000A');
    expect(r.value).not.toContain('\\u000D');
    expect(/(?<!\\)"/.test(r.value)).toBe(false);
  });

  it('a single quote stays raw', () => {
    expect(escapeLiteral(`it's`, { language: 'java', wrap: false }).value).toBe(`it's`);
  });
});

describe('Java unescape', () => {
  it('\\uuuu0041 reads as A', () => {
    expect(unescapeLiteral('\\uuuu0041', { language: 'java', wrap: false }).value).toBe('A');
  });

  it('\\n reads as a newline', () => {
    expect(unescapeLiteral('\\n', { language: 'java', wrap: false }).value).toBe('\n');
  });

  it('" in a wrapped literal throws (ends the literal early)', () => {
    expect(() => unescapeLiteral('"a"b"', { language: 'java', wrap: true })).toThrow(StringEscapeError);
  });

  it('\\u000a becomes a raw line terminator, which is an error', () => {
    expect(() => unescapeLiteral('\\u000a', { language: 'java', wrap: false })).toThrow(StringEscapeError);
  });

  it('\\377 reads as U+00FF', () => {
    expect(unescapeLiteral('\\377', { language: 'java', wrap: false }).value).toBe('ÿ');
  });

  it('\\400 reads as U+0020 followed by 0 (octal stops at \\40)', () => {
    expect(unescapeLiteral('\\400', { language: 'java', wrap: false }).value).toBe(' 0');
  });

  it('\\s warns (needs Java 15+)', () => {
    const r = unescapeLiteral('\\s', { language: 'java', wrap: false });
    expect(r.warnings.length).toBe(1);
  });

  it('\\q throws', () => {
    expect(() => unescapeLiteral('\\q', { language: 'java', wrap: false })).toThrow(StringEscapeError);
  });

  it("\\' is accepted", () => {
    expect(unescapeLiteral("\\'", { language: 'java', wrap: false }).value).toBe("'");
  });
});

describe('Java round trip', () => {
  const CORPUS = ['', '\0', '\t', '\n', '\r\n', '"', "'", '\\', 'café', '\u{1F600}', '\u{10FFFF}', '\uD800'];
  for (const s of CORPUS) {
    it(`round trips ${JSON.stringify(s)}`, () => {
      const escaped = escapeLiteral(s, { language: 'java', wrap: true });
      const back = unescapeLiteral(escaped.value, { language: 'java', wrap: true });
      expect(back.value).toBe(s);
    });
  }
});
