import { expect, it } from 'vitest';
import { IdentifierError, generateNanoIds } from '../src/index';

// A NanoID alphabet may not hold characters that make an id look shorter or blank: spaces, combining marks and the
// characters that draw nothing. Every one is built here at run time from its code point, so this file holds no
// invisible character itself.

const SPACE_OR_INVISIBLE = 'Alphabet holds a space, combining mark or invisible character, which is not allowed.';
const CONTROL = 'Alphabet holds a control or direction character, which is not allowed.';

function messageOf(alphabet: string): string {
  try {
    generateNanoIds({ count: 1, size: 4, alphabet });
  } catch (error) {
    expect(error).toBeInstanceOf(IdentifierError);
    return (error as Error).message;
  }
  throw new Error(`expected a refusal for ${JSON.stringify(alphabet)}, but the call returned`);
}

const refused = [
  // Spaces (Zs): ASCII space, no-break space, ogham space mark, en and em spaces, narrow no-break, medium math, ideographic.
  0x0020,
  0x00a0,
  0x1680,
  0x2000,
  0x2003,
  0x200a,
  0x202f,
  0x205f,
  0x3000,
  // Combining marks: nonspacing (Mn) and enclosing (Me).
  0x0300,
  0x0301,
  0x036f,
  0x20d0,
  0x20dd,
  0x0488,
  0x0489,
  0x1ab0,
  // Characters that draw nothing: Hangul fillers, the halfwidth Hangul filler, variation selectors, the blank braille cell.
  0x115f,
  0x1160,
  0x3164,
  0xffa0,
  0x2800,
  ...Array.from({ length: 16 }, (_, i) => 0xfe00 + i),
];

it('an alphabet with a space, a combining mark or a character that draws nothing is refused with a fixed sentence', () => {
  for (const code of refused) {
    const symbol = String.fromCodePoint(code);
    expect(messageOf('ab' + symbol), `U+${code.toString(16)}`).toBe(SPACE_OR_INVISIBLE);
    expect(messageOf(symbol + 'ab'), `U+${code.toString(16)} first`).toBe(SPACE_OR_INVISIBLE);
  }
  // The sentence never repeats the alphabet.
  expect(messageOf('FODT-MARKER' + String.fromCodePoint(0x3164))).not.toContain('FODT-MARKER');
});

it('letters, digits, accented letters, symbols and emoji are still allowed, and controls keep their own sentence', () => {
  const allowed = [
    'ab',
    '0123456789abcdef',
    'aéb', // a precomposed e with an acute accent is one letter, not a combining mark
    String.fromCodePoint(0x4e00, 0x4e01, 0x4e02),
    String.fromCodePoint(0x1f600, 0x1f601, 0x2603),
    String.fromCodePoint(0xff21, 0xff22), // full-width letters
  ];
  for (const alphabet of allowed) {
    const ids = generateNanoIds({ count: 3, size: 6, alphabet });
    expect(ids).toHaveLength(3);
    for (const id of ids) expect(Array.from(id).every((ch) => alphabet.includes(ch))).toBe(true);
  }
  // Controls, direction marks and other format characters still get the earlier sentence.
  for (const code of [0x00, 0x07, 0x0a, 0x7f, 0x85, 0x200b, 0x200d, 0x200e, 0x202e, 0x2066, 0x2028]) {
    expect(messageOf('ab' + String.fromCodePoint(code)), `U+${code.toString(16)}`).toBe(CONTROL);
  }
  // Too few, too many and repeated characters keep their sentences too.
  expect(messageOf('a')).toBe('Alphabet must hold 2 to 255 different characters.');
  expect(messageOf('abca')).toBe('Alphabet repeats a character: each character may appear only once.');
});
