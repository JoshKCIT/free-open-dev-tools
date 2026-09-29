import { it, expect, describe } from 'vitest';
import { escapeLiteral, unescapeLiteral, StringEscapeError } from '../src/index';

// ECMA-262 SingleEscapeCharacter table, transcribed by hand from
// https://tc39.es/ecma262/#table-string-single-character-escape-sequences
const SINGLE_ESCAPES: { char: string; escape: string }[] = [
  { char: '\b', escape: '\\b' },
  { char: '\f', escape: '\\f' },
  { char: '\n', escape: '\\n' },
  { char: '\r', escape: '\\r' },
  { char: '\t', escape: '\\t' },
  { char: '\v', escape: '\\v' },
  { char: '"', escape: '\\"' },
  { char: '\\', escape: '\\\\' },
];

describe('ECMA-262 SingleEscapeCharacter table', () => {
  for (const { char, escape } of SINGLE_ESCAPES) {
    it(`escapes and unescapes ${JSON.stringify(char)}`, () => {
      const escaped = escapeLiteral(char, { language: 'javascript', wrap: false });
      expect(escaped.value).toBe(escape);
      const unescaped = unescapeLiteral(escape, { language: 'javascript', wrap: false });
      expect(unescaped.value).toBe(char);
    });
  }
});

describe('JavaScript escape', () => {
  it('NUL escapes to \\x00, never \\0 before a digit', () => {
    expect(escapeLiteral('\0', { language: 'javascript', wrap: false }).value).toBe('\\x00');
  });

  it('U+2028 and U+2029 are always escaped', () => {
    expect(escapeLiteral('  ', { language: 'javascript', wrap: false }).value).toBe('\\u2028\\u2029');
  });

  it('a lone high surrogate escapes to \\uD800', () => {
    expect(escapeLiteral('\uD800', { language: 'javascript', wrap: false }).value).toBe('\\uD800');
  });

  it('escapeNonAscii turns U+1F600 into \\u{1F600} and an accented letter into \\uXXXX', () => {
    const r = escapeLiteral('\u{1F600}é', { language: 'javascript', wrap: false, escapeNonAscii: true });
    expect(r.value).toBe('\\u{1F600}\\u00E9');
  });

  it('without escapeNonAscii the astral character and accented letter stay raw', () => {
    const r = escapeLiteral('\u{1F600}é', { language: 'javascript', wrap: false });
    expect(r.value).toBe('\u{1F600}é');
  });

  it('escaped output with escapeNonAscii is printable ASCII only and never contains an unescaped chosen quote', () => {
    const sample = 'a"b\'cé\u{1F600}\u0007';
    const r = escapeLiteral(sample, { language: 'javascript', wrap: false, escapeNonAscii: true, quote: '"' });
    expect(/^[\x20-\x7e]*$/.test(r.value)).toBe(true);
    expect(/(?<!\\)"/.test(r.value)).toBe(false);
  });

  it('the unchosen quote character stays raw', () => {
    expect(escapeLiteral(`it's`, { language: 'javascript', wrap: false, quote: '"' }).value).toBe(`it's`);
  });
});

describe('JavaScript unescape', () => {
  it('unescape of \\u{110000} throws with a position', () => {
    expect(() => unescapeLiteral('\\u{110000}', { language: 'javascript', wrap: false })).toThrow(StringEscapeError);
    try {
      unescapeLiteral('\\u{110000}', { language: 'javascript', wrap: false });
    } catch (e) {
      expect((e as StringEscapeError).position).toBe(0);
    }
  });

  it('\\01 gives a warning and the character U+0001', () => {
    const r = unescapeLiteral('\\01', { language: 'javascript', wrap: false });
    expect(r.value).toBe('\u0001');
    expect(r.warnings.length).toBe(1);
  });

  it('\\8 gives a warning and the character 8', () => {
    const r = unescapeLiteral('\\8', { language: 'javascript', wrap: false });
    expect(r.value).toBe('8');
    expect(r.warnings.length).toBe(1);
  });

  it('\\q gives q (identity escape)', () => {
    expect(unescapeLiteral('\\q', { language: 'javascript', wrap: false }).value).toBe('q');
  });

  it('backslash-CRLF is removed (line continuation)', () => {
    expect(unescapeLiteral('a\\\r\nb', { language: 'javascript', wrap: false }).value).toBe('ab');
  });

  it('a raw LF in a wrapped literal throws', () => {
    expect(() => unescapeLiteral('"a\nb"', { language: 'javascript', wrap: true })).toThrow(StringEscapeError);
  });

  it('wrap mode requires matching quotes and strips them', () => {
    expect(unescapeLiteral(`'hello'`, { language: 'javascript', wrap: true }).value).toBe('hello');
    expect(unescapeLiteral(`"hello"`, { language: 'javascript', wrap: true }).value).toBe('hello');
  });

  it('refused literal forms: a template literal (backtick) throws at position 0', () => {
    expect(() => unescapeLiteral('`hi`', { language: 'javascript', wrap: true })).toThrow(StringEscapeError);
  });
});

describe('JavaScript round trip (escape then unescape returns the original)', () => {
  const CORPUS = ['', '\0', '\t', '\n', '\r\n', '"', "'", '\\', ' ', ' ', 'café', '\u{1F600}', '\u{10FFFF}'];
  for (const s of CORPUS) {
    it(`round trips ${JSON.stringify(s)}`, () => {
      const escaped = escapeLiteral(s, { language: 'javascript', wrap: true });
      const back = unescapeLiteral(escaped.value, { language: 'javascript', wrap: true });
      expect(back.value).toBe(s);
    });
  }
});

describe('perLine', () => {
  it('splits "a\\nb" into two literals joined by " +" and a newline', () => {
    const r = escapeLiteral('a\nb', { language: 'javascript', perLine: true });
    expect(r.value).toBe('"a\\n" +\n"b"');
  });

  it('a single line gives one literal', () => {
    const r = escapeLiteral('abc', { language: 'javascript', perLine: true });
    expect(r.value).toBe('"abc"');
  });
});
