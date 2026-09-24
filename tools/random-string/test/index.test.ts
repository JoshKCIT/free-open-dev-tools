import { describe, it, expect } from 'vitest';
import { generate, pickIndex, ALPHABETS, RandomStringError, RANDOM_SOURCE_NAME, type ByteSource } from '../src/index';

function cryptoBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

it('every generated string draws from the injected crypto source and never from Math.random', () => {
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
    const result = generate({ alphabet: 'alphanumeric', length: 40, randomSource });
    expect(result.values[0]).toHaveLength(40);
    expect(calls).toBeGreaterThan(0);
    expect(result.source).toBe(RANDOM_SOURCE_NAME);
  } finally {
    Math.random = original;
  }
});

it('generation throws if Math.random is called anywhere on the path', () => {
  const original = Math.random;
  Math.random = () => {
    throw new Error('Math.random must never be called by this package');
  };
  try {
    // No randomSource injected: exercises the real default cryptographic
    // path. If anything on this path reached for Math.random, this call
    // would throw instead of returning cleanly.
    expect(() => generate({ alphabet: 'lower', length: 12 })).not.toThrow();
  } finally {
    Math.random = original;
  }
});

it('rejection sampling is exercised for alphabet sizes 3, 256, 257 and 7776 with controlled bytes', () => {
  // size=3 needs 1 byte, range=256, limit=floor(256/3)*3=255. Byte 255 is
  // rejected (the incomplete final block); byte 2 is accepted.
  {
    let calls = 0;
    const sequence = [[255], [2]];
    const source: ByteSource = () => {
      const bytes = sequence[calls]!;
      calls++;
      return Uint8Array.from(bytes);
    };
    expect(pickIndex(3, source)).toBe(2);
    expect(calls).toBe(2);
  }
  // size=256 needs 1 byte, range=256, limit=floor(256/256)*256=256, so
  // every possible byte value is accepted -- no rejection is possible.
  {
    let calls = 0;
    const source: ByteSource = () => {
      calls++;
      return Uint8Array.from([200]);
    };
    expect(pickIndex(256, source)).toBe(200);
    expect(calls).toBe(1);
  }
  // size=257 needs 2 bytes, range=65536, limit=floor(65536/257)*257=65535.
  // The single value 65535 (0xffff) is rejected; the next draw is accepted.
  {
    let calls = 0;
    const sequence: [number, number][] = [
      [0xff, 0xff],
      [0x01, 0x2c],
    ];
    const source: ByteSource = () => {
      const bytes = sequence[calls]!;
      calls++;
      return Uint8Array.from(bytes);
    };
    const value = 0x01 * 256 + 0x2c;
    expect(pickIndex(257, source)).toBe(value % 257);
    expect(calls).toBe(2);
  }
  // size=7776 needs 2 bytes, range=65536, limit=floor(65536/7776)*7776=62208.
  // 0xffff=65535 is rejected; the next draw is accepted.
  {
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
  }
});

it('every character of every value is a member of the selected alphabet', () => {
  const result = generate({ alphabet: 'urlSafe', length: 50, count: 20 });
  const allowed = new Set(ALPHABETS.urlSafe);
  for (const value of result.values) {
    expect(value).toHaveLength(50);
    for (const ch of value) expect(allowed.has(ch)).toBe(true);
  }
});

it('the result carries the values, the distinct count, the entropy and the name of the randomness source', () => {
  const result = generate({ alphabet: 'hex', length: 8 });
  expect(result.values).toHaveLength(1);
  expect(result.distinctCount).toBe(1);
  expect(result.bitsPerValue).toBeCloseTo(8 * Math.log2(16), 10);
  expect(result.totalBits).toBeCloseTo(result.bitsPerValue, 10);
  expect(result.source).toBe(RANDOM_SOURCE_NAME);
});

it('a custom alphabet with fewer than two distinct characters is rejected', () => {
  expect(() => generate({ alphabet: 'custom', customAlphabet: 'a', length: 5 })).toThrow(RandomStringError);
  expect(() => generate({ alphabet: 'custom', customAlphabet: 'aaaa', length: 5 })).toThrow(RandomStringError);
  expect(() => generate({ alphabet: 'custom', customAlphabet: '', length: 5 })).toThrow(RandomStringError);
});

describe('named alphabet presets', () => {
  it('every preset is non-empty and has no repeated character', () => {
    for (const [name, chars] of Object.entries(ALPHABETS)) {
      expect(chars.length, `${name} should be non-empty`).toBeGreaterThan(0);
      expect(new Set(chars).size, `${name} should have no repeated character`).toBe(chars.length);
    }
  });

  it('does not name another tool in this catalog', () => {
    const forbidden = ['uuid', 'base58', 'base32', 'password-generator', 'random-number'];
    for (const name of Object.keys(ALPHABETS)) {
      for (const bad of forbidden) expect(name.toLowerCase()).not.toContain(bad);
    }
  });
});

describe('custom alphabets', () => {
  it('is used exactly as given, after duplicate characters are removed, and the removal is reported', () => {
    const result = generate({ alphabet: 'custom', customAlphabet: 'aabbccXYZ', length: 10 });
    expect(result.alphabet).toBe('abcXYZ');
    expect(result.duplicatesRemoved).toBe(3);
  });

  it('reports zero duplicates removed for an already-distinct custom alphabet', () => {
    const result = generate({ alphabet: 'custom', customAlphabet: 'xyz123', length: 4 });
    expect(result.duplicatesRemoved).toBe(0);
  });
});

describe('length', () => {
  it('produces exactly the requested length', () => {
    expect(generate({ alphabet: 'digits', length: 1 }).values[0]).toHaveLength(1);
    expect(generate({ alphabet: 'digits', length: 100 }).values[0]).toHaveLength(100);
  });

  it('rejects a length below one', () => {
    expect(() => generate({ alphabet: 'digits', length: 0 })).toThrow(RandomStringError);
    expect(() => generate({ alphabet: 'digits', length: -1 })).toThrow(RandomStringError);
  });
});

describe('entropy', () => {
  it('equals length times log2 of the alphabet size', () => {
    const result = generate({ alphabet: 'urlSafe', length: 21 });
    expect(result.bitsPerValue).toBeCloseTo(21 * Math.log2(ALPHABETS.urlSafe.length), 10);
  });
});

describe('character coverage', () => {
  it('over many generations, every character of the alphabet appears and no character outside it ever does', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const value = generate({ alphabet: 'digits', length: 20 }).values[0]!;
      for (const ch of value) {
        expect(ch).toMatch(/[0-9]/);
        seen.add(ch);
      }
    }
    expect(seen.size).toBe(10);
  });
});

describe('multiple values', () => {
  it('returns the requested count, drawn independently, reporting how many were distinct', () => {
    // 24 characters over a 64-character alphabet: an output space of
    // 64^24, vastly larger than the 300 samples drawn here -- a repeat
    // among 300 independent draws would be an extraordinary event.
    const result = generate({ alphabet: 'urlSafe', length: 24, count: 300 });
    expect(result.values).toHaveLength(300);
    expect(result.distinctCount).toBe(300);
  });

  it('does not assert distinctness for a small output space, where repeats are the expected outcome', () => {
    // A two-character alphabet at length one has only two possible values.
    const result = generate({ alphabet: 'custom', customAlphabet: 'ab', length: 1, count: 1 });
    expect(result.values).toHaveLength(1);
  });
});

describe('rejection sampling range width', () => {
  it('terminates for alphabet sizes 3, 256, 257 and 7776 using the real cryptographic source', () => {
    for (const size of [3, 256, 257, 7776]) {
      for (let i = 0; i < 50; i++) {
        const index = pickIndex(size, cryptoBytes);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(size);
      }
    }
  });
});
