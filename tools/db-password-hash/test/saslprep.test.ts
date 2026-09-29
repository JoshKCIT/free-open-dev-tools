import { describe, it, expect } from 'vitest';
import { saslprep } from '../src/saslprep';
import { DbHashError } from '../src/errors';

describe('RFC 4013 section 3 examples', () => {
  it('example 1: soft hyphen (U+00AD) mapped to nothing: "I\\u00ADX" -> "IX"', () => {
    expect(saslprep('I­X').value).toBe('IX');
  });

  it('example 2: "user" unchanged', () => {
    const result = saslprep('user');
    expect(result.value).toBe('user');
    expect(result.changed).toBe(false);
    expect(result.asciiOnly).toBe(true);
  });

  it('example 3: "USER" unchanged, case preserved', () => {
    const result = saslprep('USER');
    expect(result.value).toBe('USER');
    expect(result.asciiOnly).toBe(true);
  });

  it('example 4: U+00AA (feminine ordinal indicator) NFKC-normalises to "a"', () => {
    expect(saslprep('ª').value).toBe('a');
  });

  it('example 5: U+2168 (Roman numeral nine) NFKC-normalises to "IX"', () => {
    expect(saslprep('Ⅸ').value).toBe('IX');
  });

  it('example 6: U+0007 (BEL) is ASCII, so this tool returns it unchanged (the pure-ASCII fast path; RFC 4013 would prohibit it, which this tool does not check)', () => {
    const result = saslprep('\u0007');
    expect(result.value).toBe('\u0007');
    expect(result.asciiOnly).toBe(true);
  });

  it('example 7: U+0627 U+0031 (an Arabic letter followed by an ASCII digit) is returned unchanged, asciiOnly false (no bidirectional check is performed; PostgreSQL itself falls back to the raw password when its own bidirectional check fails, which is the same string)', () => {
    const result = saslprep('ا1');
    expect(result.value).toBe('ا1');
    expect(result.asciiOnly).toBe(false);
  });
});

describe('PD-07 additional cases', () => {
  it('U+00A0 (non-breaking space) becomes a literal space', () => {
    expect(saslprep('a b').value).toBe('a b');
  });

  it('U+200B (zero width space) becomes a literal space, not nothing, because it is in the space-mapping table applied first', () => {
    expect(saslprep('a​b').value).toBe('a b');
  });

  it('U+FEFF (byte order mark / zero width no-break space) is removed', () => {
    expect(saslprep('a﻿b').value).toBe('ab');
  });

  it('a lone high surrogate is refused', () => {
    expect(() => saslprep('a\ud800b')).toThrow(DbHashError);
  });

  it('a lone low surrogate is refused', () => {
    expect(() => saslprep('a\udc00b')).toThrow(DbHashError);
  });

  it('a genuine astral surrogate pair is not refused', () => {
    expect(() => saslprep('a\u{1F600}b')).not.toThrow();
  });
});
