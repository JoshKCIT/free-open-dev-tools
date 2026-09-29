import { it, expect, describe } from 'vitest';
import { escapeLiteral, unescapeLiteral, StringEscapeError } from '../src/index';

// Go specification escape list, transcribed by hand from
// https://go.dev/ref/spec#String_literals
const GO_ESCAPES: { char: string; escape: string }[] = [
  { char: '\\', escape: '\\\\' },
  { char: '"', escape: '\\"' },
  { char: '\x07', escape: '\\a' },
  { char: '\b', escape: '\\b' },
  { char: '\f', escape: '\\f' },
  { char: '\n', escape: '\\n' },
  { char: '\r', escape: '\\r' },
  { char: '\t', escape: '\\t' },
  { char: '\v', escape: '\\v' },
];

describe('Go escape list', () => {
  for (const { char, escape } of GO_ESCAPES) {
    it(`escapes and unescapes ${JSON.stringify(char)}`, () => {
      expect(escapeLiteral(char, { language: 'go', wrap: false }).value).toBe(escape);
      expect(unescapeLiteral(escape, { language: 'go', wrap: false }).value).toBe(char);
    });
  }
});

describe('Go unescape', () => {
  it('\\xe2\\x9c\\x93 reads as ✓ (UTF-8 bytes for U+2713)', () => {
    expect(unescapeLiteral('\\xe2\\x9c\\x93', { language: 'go', wrap: false }).value).toBe('✓');
  });

  it('\\xff throws naming byte offset 0', () => {
    try {
      unescapeLiteral('\\xff', { language: 'go', wrap: false });
      throw new Error('expected a throw');
    } catch (e) {
      expect(e).toBeInstanceOf(StringEscapeError);
      expect((e as StringEscapeError).byteOffset).toBe(0);
    }
  });

  it("\\' throws", () => {
    expect(() => unescapeLiteral("\\'", { language: 'go', wrap: false })).toThrow(StringEscapeError);
  });

  it('\\400 throws (greater than 255)', () => {
    expect(() => unescapeLiteral('\\400', { language: 'go', wrap: false })).toThrow(StringEscapeError);
  });

  it('\\uD800 throws (surrogate half)', () => {
    expect(() => unescapeLiteral('\\uD800', { language: 'go', wrap: false })).toThrow(StringEscapeError);
  });
});

describe('Go escape refusals', () => {
  it('escape of a lone surrogate throws', () => {
    expect(() => escapeLiteral('\uD800', { language: 'go', wrap: false })).toThrow(StringEscapeError);
  });

  it('escape of U+0085 with escapeNonAscii gives \\u0085, never \\x85', () => {
    const r = escapeLiteral('\u0085', { language: 'go', wrap: false, escapeNonAscii: true });
    expect(r.value).toBe('\\u0085');
  });
});

describe('Go round trip', () => {
  const CORPUS = ['', '\0', '\t', '\n', '\r\n', '"', "'", '\\', 'café', '\u{1F600}', '\u{10FFFF}'];
  for (const s of CORPUS) {
    it(`round trips ${JSON.stringify(s)}`, () => {
      const escaped = escapeLiteral(s, { language: 'go', wrap: true });
      expect(unescapeLiteral(escaped.value, { language: 'go', wrap: true }).value).toBe(s);
    });
  }
});
