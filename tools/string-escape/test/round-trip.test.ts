import { it, expect, describe } from 'vitest';
import { escapeLiteral, unescapeLiteral, LANGUAGES, type Language } from '../src/index';

const CONTROLS = Array.from({ length: 32 }, (_, i) => String.fromCharCode(i));
const BASE_CORPUS = [
  '',
  ...CONTROLS,
  '\x7f',
  '"',
  "'",
  '\\',
  '\r\n',
  '\u0085',
  ' ',
  ' ',
  'café',
  '\u{1F600}',
  '\u{10FFFF}',
];
const LONE_HIGH = '\uD800';
const LONE_LOW = '\uDC00';

function corpusFor(language: Language): string[] {
  let corpus = BASE_CORPUS;
  if (language === 'go') {
    // Go cannot represent a lone surrogate at all.
    return corpus;
  }
  corpus = [...corpus, LONE_HIGH, LONE_LOW];
  if (language === 'shell') {
    // A shell argument cannot contain NUL.
    corpus = corpus.filter((s) => !s.includes('\0'));
  }
  return corpus;
}

describe('round trip: unescape(escape(s)) === s, for every language', () => {
  for (const { id } of LANGUAGES) {
    describe(id, () => {
      for (const s of corpusFor(id)) {
        it(`round trips ${JSON.stringify(s)}`, () => {
          const escaped = escapeLiteral(s, { language: id, wrap: true });
          const back = unescapeLiteral(escaped.value, { language: id, wrap: true });
          expect(back.value).toBe(s);
        });
      }
    });
  }
});

describe('round trip: a large mixed string', () => {
  function bigString(): string {
    const parts: string[] = [];
    for (let i = 0; i < 5000; i++) {
      parts.push('word', String(i), '"quote"', "'apos'", '\t', 'café', '\u{1F600}');
    }
    return parts.join(' ');
  }
  const big = bigString();

  for (const { id } of LANGUAGES) {
    it(`round trips a ${big.length}-character string for ${id}`, () => {
      const escaped = escapeLiteral(big, { language: id, wrap: true });
      const back = unescapeLiteral(escaped.value, { language: id, wrap: true });
      expect(back.value).toBe(big);
    });
  }
});
