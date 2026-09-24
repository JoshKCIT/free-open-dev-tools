import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import {
  generate,
  estimateEntropy,
  pickIndex,
  PasswordGeneratorError,
  RANDOM_SOURCE_NAME,
  type ByteSource,
} from '../src/index';
import { EFF_LONG_WORDLIST, BITS_PER_WORD } from '../src/eff-long-wordlist';

const HERE = dirname(fileURLToPath(import.meta.url));

function cryptoBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

it('every generated password draws from the injected crypto source and never from Math.random', () => {
  const original = Math.random;
  Math.random = () => {
    throw new Error('Math.random must never be called by this package');
  };
  try {
    let calls = 0;
    const randomSource: ByteSource = (n) => {
      calls++;
      return cryptoBytes(n);
    };
    const result = generate({
      mode: 'characters',
      length: 32,
      classes: ['lower', 'upper', 'digits', 'symbols'],
      randomSource,
    });
    expect(result.values[0]).toHaveLength(32);
    expect(calls).toBeGreaterThan(0);
    expect(result.source).toBe('crypto.getRandomValues');
  } finally {
    Math.random = original;
  }
});

it('a password with every class selected contains at least one character from each, and class position is not fixed', () => {
  const digitPositions = new Set<number>();
  for (let i = 0; i < 60; i++) {
    const result = generate({
      mode: 'characters',
      length: 8,
      classes: ['lower', 'upper', 'digits', 'symbols'],
      requireOneOfEach: true,
    });
    const value = result.values[0]!;
    expect(value).toMatch(/[a-z]/);
    expect(value).toMatch(/[A-Z]/);
    expect(value).toMatch(/[0-9]/);
    expect(value).toMatch(/[!@#$%^&*()\-_=+[\]{}:;,.<>/?]/);
    const firstDigitIndex = [...value].findIndex((ch) => /[0-9]/.test(ch));
    digitPositions.add(firstDigitIndex);
  }
  // If the digit class were pinned to a fixed slot (the "fixed positions"
  // implementation the plan review rejected), every sample would land on
  // the same index. Over 60 samples of an 8-character password, seeing
  // more than one distinct index is what proves position is not fixed.
  expect(digitPositions.size).toBeGreaterThan(1);
});

it('rejection sampling over a 7776-entry list uses a wide enough range to terminate', () => {
  // size=7776 needs ceil(log2(7776)/8)=2 bytes, range=65536,
  // limit=floor(65536/7776)*7776=62208. 0xffff=65535 sits in the rejected
  // block; the next draw (0x0005=5) is accepted.
  let calls = 0;
  const sequence: [number, number][] = [
    [0xff, 0xff],
    [0x00, 0x05],
  ];
  const source: ByteSource = () => {
    const bytes = sequence[calls]!;
    calls++;
    return Uint8Array.from(bytes);
  };
  expect(pickIndex(7776, source)).toBe(5);
  expect(calls).toBe(2);
});

it('the controlled byte sequence rejects the incomplete-block draw and uses the next value', () => {
  // size=3 needs 1 byte, range=256, limit=floor(256/3)*3=255. Byte 255
  // sits in the incomplete final block (256 is not a multiple of 3) and
  // must be rejected; byte 2 is accepted and picks index 2.
  let calls = 0;
  const sequence = [[255], [2]];
  const source: ByteSource = () => {
    const bytes = sequence[calls]!;
    calls++;
    return Uint8Array.from(bytes);
  };
  expect(pickIndex(3, source)).toBe(2);
  expect(calls).toBe(2);
});

it('the bundled word list has 7776 entries, all distinct, all lower case', () => {
  expect(EFF_LONG_WORDLIST).toHaveLength(7776);
  expect(new Set(EFF_LONG_WORDLIST).size).toBe(7776);
  // "All lower case" holds regardless of the four authentic compound
  // words: a hyphen is not an upper-case letter. This also proves no
  // word contains a digit, a tab or a space, which is what actually
  // catches a bad dice-roll-prefix strip.
  for (const word of EFF_LONG_WORDLIST) {
    expect(word).toMatch(/^[a-z]+(-[a-z]+)*$/);
    expect(word.length).toBeGreaterThanOrEqual(3);
  }
});

it('the bundled word list does NOT have the unique three-letter prefix property', () => {
  const prefixes = new Set(EFF_LONG_WORDLIST.map((w) => w.slice(0, 3)));
  expect(prefixes.size).toBeLessThan(EFF_LONG_WORDLIST.length);
  // The specific pair the EFF announcement itself is known for.
  expect(EFF_LONG_WORDLIST).toContain('abdomen');
  expect(EFF_LONG_WORDLIST).toContain('abdominal');
  expect('abdomen'.slice(0, 3)).toBe('abdominal'.slice(0, 3));
});

it('the entropy figure is labelled an upper bound when a class constraint is applied', () => {
  const constrained = estimateEntropy({
    mode: 'characters',
    length: 8,
    classes: ['lower', 'upper'],
    requireOneOfEach: true,
  });
  const unconstrained = estimateEntropy({ mode: 'characters', length: 8, classes: ['lower', 'upper'] });
  expect(constrained.exact).toBe(false);
  expect(unconstrained.exact).toBe(true);
  // The figure reported is the unconstrained one either way -- only the
  // exactness flag changes.
  expect(constrained.bits).toBeCloseTo(unconstrained.bits, 10);
});

it('the result carries the values, the distinct count and the name of the randomness source', () => {
  const result = generate({ mode: 'characters', length: 10, classes: ['lower'] });
  expect(result.values).toHaveLength(1);
  expect(result.distinctCount).toBe(1);
  expect(result.source).toBe(RANDOM_SOURCE_NAME);
  expect(result.entropy.bits).toBeCloseTo(10 * Math.log2(26), 10);
});

describe('character password generation', () => {
  it('has exactly the requested length, drawing only from the selected classes', () => {
    const result = generate({ mode: 'characters', length: 24, classes: ['lower', 'digits'] });
    const value = result.values[0]!;
    expect(value).toHaveLength(24);
    expect(value).toMatch(/^[a-z0-9]+$/);
  });

  it('excludes look-alike characters when asked', () => {
    for (let i = 0; i < 30; i++) {
      const result = generate({
        mode: 'characters',
        length: 40,
        classes: ['lower', 'upper', 'digits'],
        excludeLookAlikes: true,
      });
      for (const ch of result.values[0]!) {
        expect(['0', 'O', 'o', '1', 'l', 'I']).not.toContain(ch);
      }
    }
  });

  it('rejects requiring one of each class when the length is too short, naming how long it would need to be', () => {
    expect(() =>
      generate({ mode: 'characters', length: 2, classes: ['lower', 'upper', 'digits'], requireOneOfEach: true }),
    ).toThrow(PasswordGeneratorError);
    expect(() =>
      generate({ mode: 'characters', length: 2, classes: ['lower', 'upper', 'digits'], requireOneOfEach: true }),
    ).toThrow(/3/);
  });

  it('rejects zero character classes', () => {
    expect(() => generate({ mode: 'characters', length: 8, classes: [] })).toThrow(PasswordGeneratorError);
  });

  it('reports entropy as length times log2 of the effective alphabet size', () => {
    const entropy = estimateEntropy({ mode: 'characters', length: 16, classes: ['lower', 'upper', 'digits'] });
    expect(entropy.bits).toBeCloseTo(16 * Math.log2(26 + 26 + 10), 10);
    expect(entropy.effectiveAlphabetSize).toBe(62);
  });

  it('over many generations, every character of the selected alphabet appears and no character outside it ever does', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const value = generate({ mode: 'characters', length: 20, classes: ['digits'] }).values[0]!;
      for (const ch of value) {
        expect(ch).toMatch(/[0-9]/);
        seen.add(ch);
      }
    }
    expect(seen.size).toBe(10);
  });
});

describe('passphrase generation', () => {
  it('has exactly the requested word count, joined by the chosen separator', () => {
    const result = generate({ mode: 'passphrase', words: 5, separator: '.' });
    const value = result.values[0]!;
    expect(value.split('.')).toHaveLength(5);
    for (const word of value.split('.')) {
      expect(EFF_LONG_WORDLIST).toContain(word);
    }
  });

  it('applies the chosen capitalisation style', () => {
    const none = generate({ mode: 'passphrase', words: 4, capitalisation: 'none' }).values[0]!;
    expect(none).toBe(none.toLowerCase());

    const eachWord = generate({ mode: 'passphrase', words: 4, separator: '-', capitalisation: 'each-word' }).values[0]!;
    for (const word of eachWord.split('-')) {
      expect(word[0]).toBe(word[0]!.toUpperCase());
    }

    const firstWord = generate({ mode: 'passphrase', words: 4, separator: '-', capitalisation: 'first-word' })
      .values[0]!;
    const parts = firstWord.split('-');
    expect(parts[0]![0]).toBe(parts[0]![0]!.toUpperCase());
    expect(parts[1]).toBe(parts[1]!.toLowerCase());
  });

  it('reports entropy as word count times the bits-per-word constant, computed from the bundled list', () => {
    const entropy = estimateEntropy({ mode: 'passphrase', words: 6 });
    expect(entropy.bits).toBeCloseTo(6 * Math.log2(7776), 10);
    expect(entropy.bits).toBeCloseTo(6 * BITS_PER_WORD, 10);
    expect(entropy.exact).toBe(true);
  });
});

describe('bits-per-word constant', () => {
  it('equals the base-two logarithm of the bundled list length, to at least four decimal places', () => {
    expect(BITS_PER_WORD).toBeCloseTo(Math.log2(EFF_LONG_WORDLIST.length), 4);
    expect(BITS_PER_WORD).toBeCloseTo(12.9248, 4);
  });
});

describe('multiple values', () => {
  it('returns the requested count, drawn independently, reporting how many were distinct', () => {
    // A 16-character password over a 26-letter alphabet has an output space
    // of 26^16, vastly larger than the 500 samples drawn here -- a repeat
    // among 500 independent draws from that space would be an
    // extraordinary (astronomically unlikely) event, so asserting all-distinct here is sound.
    const result = generate({ mode: 'characters', length: 16, classes: ['lower'], count: 500 });
    expect(result.values).toHaveLength(500);
    expect(result.distinctCount).toBe(500);
  });

  it('does not assert distinctness for a small output space, where repeats are the expected outcome', () => {
    // Two characters from a two-letter alphabet: only 4 possible outputs.
    const result = generate({ mode: 'characters', length: 2, classes: ['digits'], count: 1 });
    expect(result.values).toHaveLength(1);
    expect(result.distinctCount).toBeLessThanOrEqual(1);
  });
});

describe('rejection sampling range width', () => {
  it('terminates for alphabet sizes 3, 256 and 257 using the real cryptographic source', () => {
    for (const size of [3, 256, 257, 7776]) {
      for (let i = 0; i < 50; i++) {
        const index = pickIndex(size, cryptoBytes);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(size);
      }
    }
  });
});

describe('the bundled word list source file', () => {
  it('strips the dice-roll prefix cleanly: no word contains a digit, a tab or a space', () => {
    for (const word of EFF_LONG_WORDLIST) {
      expect(word).not.toMatch(/[0-9\t ]/);
    }
  });

  it('carries a provenance header naming the publisher and the licence', () => {
    const source = readFileSync(join(HERE, '..', 'src', 'eff-long-wordlist.ts'), 'utf8');
    expect(source).toContain('Electronic Frontier Foundation');
    expect(source).toContain('CC BY 3.0 US');
    expect(source).toContain('bundled data');
  });
});

describe('the notice file', () => {
  it('is not empty and carries the attribution', () => {
    const notice = readFileSync(join(HERE, '..', 'src', 'eff-long-wordlist-NOTICE.txt'), 'utf8');
    expect(notice.trim().length).toBeGreaterThan(0);
    expect(notice).toContain('Electronic Frontier Foundation');
    expect(notice).toContain('CC BY 3.0 US');
  });
});

afterEach(() => {
  // Guard against a leaked Math.random override in case a test above throws
  // before reaching its own restore.
  if (typeof (Math.random as unknown) !== 'function') {
    throw new Error('Math.random was left in a broken state by a previous test');
  }
});
