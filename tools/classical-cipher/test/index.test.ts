import { it, expect } from 'vitest';
import { encipher, decipher, CIPHERS, ClassicalCipherError } from '../src/index';

// The six mandated top-level tests.

it('ROT47 maps the exclamation mark to P', () => {
  expect(encipher('!', { cipher: 'rot47' })).toBe('P');
});

it('ROT47 maps the tilde to O', () => {
  expect(encipher('~', { cipher: 'rot47' })).toBe('O');
});

it('ROT47 leaves a space, a tab and a newline unchanged', () => {
  expect(encipher(' \t\n', { cipher: 'rot47' })).toBe(' \t\n');
});

it('ROT47 applied twice returns the original', () => {
  const text = 'Hello, World! 123 ~`';
  expect(encipher(encipher(text, { cipher: 'rot47' }), { cipher: 'rot47' })).toBe(text);
});

it('Caesar with the default shift matches its hand-written worked example', () => {
  // Hand-computed: A(0)+3=D, t(19)+3=22=w, t+3=w, a(0)+3=d, c(2)+3=f, k(10)+3=n,
  // (space), a+3=d, t+3=w, (space), d(3)+3=g, a+3=d, w(22)+3=25=z, n(13)+3=16=q.
  expect(encipher('Attack at dawn', { cipher: 'caesar', shift: 3 })).toBe('Dwwdfn dw gdzq');
});

it('every cipher deciphers what it enciphers', () => {
  const sample = 'The Quick, Brown Fox! Jumps over 42 lazy dogs. Café.';
  for (const c of CIPHERS) {
    const options =
      c.id === 'caesar'
        ? { cipher: c.id, shift: 7 }
        : c.id === 'vigenere'
          ? { cipher: c.id, key: 'lemon' }
          : { cipher: c.id };
    expect(decipher(encipher(sample, options), options)).toBe(sample);
  }
});

// Additional coverage beyond the six mandated titles.

it('CIPHERS has exactly five entries', () => {
  expect(CIPHERS).toHaveLength(5);
  expect(CIPHERS.map((c) => c.id).sort()).toEqual(['atbash', 'caesar', 'rot13', 'rot47', 'vigenere']);
});

it('Caesar with shift thirteen produces the same output as ROT13', () => {
  const text = 'The Quick Brown Fox';
  expect(encipher(text, { cipher: 'caesar', shift: 13 })).toBe(encipher(text, { cipher: 'rot13' }));
});

it('ROT13 applied twice returns the original', () => {
  const text = 'Hello, World!';
  expect(encipher(encipher(text, { cipher: 'rot13' }), { cipher: 'rot13' })).toBe(text);
});

it('Atbash maps A to Z and a to z within case, and is its own inverse', () => {
  expect(encipher('Az', { cipher: 'atbash' })).toBe('Za');
  const text = 'Attack at Dawn!';
  expect(encipher(encipher(text, { cipher: 'atbash' }), { cipher: 'atbash' })).toBe(text);
});

it('Vigenere with a key of a single letter produces the same output as Caesar with the matching shift', () => {
  const text = 'Attack at dawn';
  // Key 'd' is shift 3 (d is the fourth letter, index 3).
  expect(encipher(text, { cipher: 'vigenere', key: 'd' })).toBe(encipher(text, { cipher: 'caesar', shift: 3 }));
});

it('Vigenere with an empty key, or a key with no letters, is rejected with a message about needing a letter', () => {
  expect(() => encipher('hello', { cipher: 'vigenere', key: '' })).toThrow(ClassicalCipherError);
  expect(() => encipher('hello', { cipher: 'vigenere', key: '123' })).toThrow(/at least one letter/);
});

it('Vigenere leaves non-letters untouched and does not advance the key position for them', () => {
  // Key "abc" has shifts [0, 1, 2]. With three letters separated by
  // non-letters, each letter must use the NEXT key shift in order (0, 1, 2)
  // -- if a non-letter wrongly consumed a key position, the third letter
  // would get shift 1 instead of 2.
  expect(encipher('a!a!a', { cipher: 'vigenere', key: 'abc' })).toBe('a!b!c');
});

it('a Vigenere key with non-letters mixed in behaves like the letters-only key', () => {
  const text = 'attackatdawn';
  expect(encipher(text, { cipher: 'vigenere', key: 'sun-shine' })).toBe(
    encipher(text, { cipher: 'vigenere', key: 'sunshine' }),
  );
});

it('every cipher round trips a string with both cases, digits, punctuation and a non-ASCII character', () => {
  const sample = "Wéird Input: 42! Don't panic.";
  for (const c of CIPHERS) {
    const options: Parameters<typeof encipher>[1] =
      c.id === 'caesar'
        ? { cipher: c.id, shift: 11 }
        : c.id === 'vigenere'
          ? { cipher: c.id, key: 'zebra' }
          : { cipher: c.id };
    expect(decipher(encipher(sample, options), options)).toBe(sample);
  }
});
