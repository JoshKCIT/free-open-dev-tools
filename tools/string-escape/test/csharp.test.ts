import { it, expect, describe } from 'vitest';
import { escapeLiteral, unescapeLiteral, StringEscapeError } from '../src/index';

// C# language specification simple-escape-sequence table, transcribed by
// hand from the "Character literals"/"String literals" grammar.
const CSHARP_SIMPLE_ESCAPES: { char: string; escape: string }[] = [
  { char: '"', escape: '\\"' },
  { char: '\\', escape: '\\\\' },
  { char: '\0', escape: '\\0' },
  { char: '\x07', escape: '\\a' },
  { char: '\b', escape: '\\b' },
  { char: '\f', escape: '\\f' },
  { char: '\n', escape: '\\n' },
  { char: '\r', escape: '\\r' },
  { char: '\t', escape: '\\t' },
  { char: '\v', escape: '\\v' },
];

describe('C# simple escape table (regular literal)', () => {
  for (const { char, escape } of CSHARP_SIMPLE_ESCAPES) {
    it(`escapes and unescapes ${JSON.stringify(char)}`, () => {
      expect(escapeLiteral(char, { language: 'csharp', wrap: false }).value).toBe(escape);
      expect(unescapeLiteral(escape, { language: 'csharp', wrap: false }).value).toBe(char);
    });
  }
});

describe('C# regular literal', () => {
  it('U+0085, U+2028, U+2029 always escape to \\uXXXX', () => {
    expect(escapeLiteral('\u0085  ', { language: 'csharp', wrap: false }).value).toBe('\\u0085\\u2028\\u2029');
  });

  it('\\x41BC reads as U+41BC (greedy, up to four hex digits)', () => {
    expect(unescapeLiteral('\\x41BC', { language: 'csharp', wrap: false }).value).toBe('䆼');
  });

  it('\\x41 reads as A', () => {
    expect(unescapeLiteral('\\x41', { language: 'csharp', wrap: false }).value).toBe('A');
  });

  it('\\U0001F600 reads as the astral character', () => {
    expect(unescapeLiteral('\\U0001F600', { language: 'csharp', wrap: false }).value).toBe('\u{1F600}');
  });

  it('\\U00110000 throws (above 10FFFF)', () => {
    expect(() => unescapeLiteral('\\U00110000', { language: 'csharp', wrap: false })).toThrow(StringEscapeError);
  });

  it('\\e reads as U+001B with a warning (C# 13+)', () => {
    const r = unescapeLiteral('\\e', { language: 'csharp', wrap: false });
    expect(r.value).toBe('\x1b');
    expect(r.warnings.length).toBe(1);
  });

  it('never emits \\x for non-ASCII', () => {
    const r = escapeLiteral('\u0085', { language: 'csharp', wrap: false });
    expect(r.value).not.toContain('\\x');
  });
});

describe('C# verbatim literal', () => {
  it('escape of say "hi" wrapped is @"say ""hi"""', () => {
    const r = escapeLiteral('say "hi"', { language: 'csharp', csharpForm: 'verbatim', wrap: true });
    expect(r.value).toBe('@"say ""hi"""');
  });

  it('unescape refuses a lone quote', () => {
    expect(() => unescapeLiteral('@"a"b"', { language: 'csharp', csharpForm: 'verbatim', wrap: true })).toThrow(
      StringEscapeError,
    );
  });

  it('round trips a value containing raw newlines', () => {
    const original = 'line one\nline two';
    const escaped = escapeLiteral(original, { language: 'csharp', csharpForm: 'verbatim', wrap: true });
    expect(unescapeLiteral(escaped.value, { language: 'csharp', csharpForm: 'verbatim', wrap: true }).value).toBe(
      original,
    );
  });
});

describe('C# round trip', () => {
  const CORPUS = ['', '\0', '\t', '\n', '\r\n', '"', "'", '\\', 'café', '\u{1F600}', '\u{10FFFF}', '\uD800'];
  for (const s of CORPUS) {
    it(`round trips ${JSON.stringify(s)} (regular)`, () => {
      const escaped = escapeLiteral(s, { language: 'csharp', wrap: true });
      expect(unescapeLiteral(escaped.value, { language: 'csharp', wrap: true }).value).toBe(s);
    });
  }
});
