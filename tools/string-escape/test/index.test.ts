import { it, expect, describe } from 'vitest';
import { escapeLiteral, unescapeLiteral, LANGUAGES, StringEscapeError } from '../src/index';

describe('LANGUAGES', () => {
  it('lists all nine languages in order', () => {
    expect(LANGUAGES.map((l) => l.id)).toEqual([
      'javascript',
      'java',
      'csharp',
      'python',
      'go',
      'sql',
      'csv',
      'shell',
      'regex',
    ]);
  });
});

describe('wrap default', () => {
  it('defaults to wrapping the escaped output in quotes', () => {
    expect(escapeLiteral('hi', { language: 'javascript' }).value).toBe('"hi"');
  });

  it('wrap:false leaves the content unwrapped', () => {
    expect(escapeLiteral('hi', { language: 'javascript', wrap: false }).value).toBe('hi');
  });
});

describe('perLine across languages', () => {
  it('Python gives the parenthesised multi-line form', () => {
    const r = escapeLiteral('a\nb', { language: 'python', perLine: true });
    expect(r.value).toBe('(\n    "a\\n"\n    "b"\n)');
  });

  it('Python single-line input gives one literal, no parentheses', () => {
    const r = escapeLiteral('abc', { language: 'python', perLine: true });
    expect(r.value).toBe('"abc"');
  });

  it('Java joins literals by " +" and a newline', () => {
    const r = escapeLiteral('a\nb', { language: 'java', perLine: true });
    expect(r.value).toBe('"a\\n" +\n"b"');
  });

  it('Go joins literals by " +" and a newline', () => {
    const r = escapeLiteral('a\nb', { language: 'go', perLine: true });
    expect(r.value).toBe('"a\\n" +\n"b"');
  });

  it('C# regular joins literals by " +" and a newline', () => {
    const r = escapeLiteral('a\nb', { language: 'csharp', perLine: true });
    expect(r.value).toBe('"a\\n" +\n"b"');
  });

  it('input ending with \\n gives no empty final literal', () => {
    const r = escapeLiteral('a\n', { language: 'javascript', perLine: true });
    expect(r.value).toBe('"a\\n"');
  });
});

describe('error position reporting', () => {
  it('an unmatched wrap throws at position 0', () => {
    try {
      unescapeLiteral('not a literal', { language: 'javascript', wrap: true });
      throw new Error('expected a throw');
    } catch (e) {
      expect(e).toBeInstanceOf(StringEscapeError);
      expect((e as StringEscapeError).position).toBe(0);
    }
  });
});
