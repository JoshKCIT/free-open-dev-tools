import { it, expect, describe } from 'vitest';
import { escapeLiteral, unescapeLiteral, StringEscapeError } from '../src/index';

describe('POSIX shell escape', () => {
  it("it's becomes 'it'\\''s'", () => {
    expect(escapeLiteral("it's", { language: 'shell' }).value).toBe("'it'\\''s'");
  });

  it("empty becomes ''", () => {
    expect(escapeLiteral('', { language: 'shell' }).value).toBe("''");
  });

  it('NUL is refused', () => {
    expect(() => escapeLiteral('a\0b', { language: 'shell' })).toThrow(StringEscapeError);
  });
});

describe('POSIX shell unescape', () => {
  it(`a'b'"c" gives abc`, () => {
    expect(unescapeLiteral(`a'b'"c"`, { language: 'shell' }).value).toBe('abc');
  });

  it('refuses $HOME at position 0', () => {
    try {
      unescapeLiteral('$HOME', { language: 'shell' });
      throw new Error('expected a throw');
    } catch (e) {
      expect(e).toBeInstanceOf(StringEscapeError);
      expect((e as StringEscapeError).position).toBe(0);
    }
  });

  it('refuses `x` (backtick)', () => {
    expect(() => unescapeLiteral('`x`', { language: 'shell' })).toThrow(StringEscapeError);
  });

  it('refuses *', () => {
    expect(() => unescapeLiteral('*', { language: 'shell' })).toThrow(StringEscapeError);
  });

  it('refuses a;b at the ; position', () => {
    try {
      unescapeLiteral('a;b', { language: 'shell' });
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as StringEscapeError).position).toBe(1);
    }
  });

  it('refuses a b (unquoted space)', () => {
    expect(() => unescapeLiteral('a b', { language: 'shell' })).toThrow(StringEscapeError);
  });

  it('refuses a leading ~', () => {
    expect(() => unescapeLiteral('~root', { language: 'shell' })).toThrow(StringEscapeError);
  });

  it('refuses a leading #', () => {
    expect(() => unescapeLiteral('#comment', { language: 'shell' })).toThrow(StringEscapeError);
  });

  it('"a\\$b" gives a$b', () => {
    expect(unescapeLiteral('"a\\$b"', { language: 'shell' }).value).toBe('a$b');
  });

  it('"a\\qb" gives a\\qb (backslash stays before a non-special char)', () => {
    expect(unescapeLiteral('"a\\qb"', { language: 'shell' }).value).toBe('a\\qb');
  });
});

describe('POSIX shell round trip', () => {
  const CORPUS = ["it's", 'plain', '  spaces inside single quotes  ', 'a"b', ''];
  for (const s of CORPUS) {
    it(`round trips ${JSON.stringify(s)}`, () => {
      const escaped = escapeLiteral(s, { language: 'shell' });
      expect(unescapeLiteral(escaped.value, { language: 'shell' }).value).toBe(s);
    });
  }
});
