import { it, expect, describe } from 'vitest';
import { escapeLiteral, unescapeLiteral, StringEscapeError } from '../src/index';

// ECMA-262 SyntaxCharacter list, transcribed by hand from
// https://tc39.es/ecma262/#prod-SyntaxCharacter
const SYNTAX_CHARACTERS = ['^', '$', '\\', '.', '*', '+', '?', '(', ')', '[', ']', '{', '}', '|'];

describe('regex SyntaxCharacter and / escaping', () => {
  for (const ch of [...SYNTAX_CHARACTERS, '/']) {
    it(`escapes and unescapes ${JSON.stringify(ch)}`, () => {
      const escaped = escapeLiteral(ch, { language: 'regex' });
      expect(escaped.value).toBe('\\' + ch);
      expect(unescapeLiteral(escaped.value, { language: 'regex' }).value).toBe(ch);
    });
  }

  it('unescape of \\d throws "not a literal character"', () => {
    expect(() => unescapeLiteral('\\d', { language: 'regex' })).toThrow(/not a literal character/);
  });

  it('unescape of a bare . throws', () => {
    expect(() => unescapeLiteral('.', { language: 'regex' })).toThrow(StringEscapeError);
  });

  it('a bare / is accepted', () => {
    expect(unescapeLiteral('/', { language: 'regex' }).value).toBe('/');
  });
});

describe('regex escape output matches the original via RegExp', () => {
  const CORPUS = ['price: $4.99 (approx.)', 'a.b*c', 'x[y]{2,3}', 'tab\ttab', 'plain text', '', '/path/to/thing'];
  for (const flags of ['', 'u', 'v']) {
    for (const s of CORPUS) {
      it(`^(?:escaped)$ matches the original for flags "${flags}" on ${JSON.stringify(s)}`, () => {
        const escaped = escapeLiteral(s, { language: 'regex' }).value;
        const re = new RegExp('^(?:' + escaped + ')$', flags);
        expect(re.test(s)).toBe(true);
      });
    }
  }
});
