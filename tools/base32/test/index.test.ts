import { describe, it, expect } from 'vitest';
import { encodeBytes, decodeToBytes, encodeText, decodeToText, ALPHABETS, Base32Error } from '../src/index';

// RFC 4648 section 10 test vectors. Quoted verbatim from
// https://www.rfc-editor.org/rfc/rfc4648#section-10.
const RFC_4648_SECTION_10_VECTORS: [string, string, string][] = [
  // [input, BASE32, BASE32-HEX]
  ['', '', ''],
  ['f', 'MY======', 'CO======'],
  ['fo', 'MZXQ====', 'CPNG===='],
  ['foo', 'MZXW6===', 'CPNMU==='],
  ['foob', 'MZXW6YQ=', 'CPNMUOG='],
  ['fooba', 'MZXW6YTB', 'CPNMUOJ1'],
  ['foobar', 'MZXW6YTBOI======', 'CPNMUOJ1E8======'],
];

// The nine mandated top-level tests. Each title below is asserted verbatim
// against a real call to the exported function -- see <check_doctrine> in
// the plan: a vector present in a comment beside an unasserted call is not
// a vector asserted.

it('RFC 4648 section 10: encodeText matches the Base32 column for every row', () => {
  for (const [input, base32] of RFC_4648_SECTION_10_VECTORS) {
    expect(encodeText(input, { alphabet: 'base32' })).toBe(base32);
  }
});

it('RFC 4648 section 10: encodeText matches the Base32hex column for every row', () => {
  for (const [input, , base32hex] of RFC_4648_SECTION_10_VECTORS) {
    expect(encodeText(input, { alphabet: 'base32hex' })).toBe(base32hex);
  }
});

it('RFC 4648 section 10: decodeToText returns the original for every row of both columns', () => {
  for (const [input, base32, base32hex] of RFC_4648_SECTION_10_VECTORS) {
    expect(decodeToText(base32, { alphabet: 'base32' })).toBe(input);
    expect(decodeToText(base32hex, { alphabet: 'base32hex' })).toBe(input);
  }
});

it('Crockford number mode encodes the value 1 as the single symbol 1', () => {
  expect(encodeBytes(new Uint8Array([1]), { alphabet: 'crockford', crockfordMode: 'number' })).toBe('1');
});

it('Crockford byte mode encodes the single byte 0x01 as a different, longer string', () => {
  const byteMode = encodeBytes(new Uint8Array([1]), { alphabet: 'crockford', crockfordMode: 'byte' });
  const numberMode = encodeBytes(new Uint8Array([1]), { alphabet: 'crockford', crockfordMode: 'number' });
  expect(byteMode).toBe('04');
  expect(numberMode).toBe('1');
  expect(byteMode).not.toBe(numberMode);
  expect(byteMode.length).toBeGreaterThan(numberMode.length);
});

it('Crockford decoding maps I, L and O onto their digits and ignores hyphens', () => {
  // Encode byte 0x01 in byte mode ("04"), then exercise every alias and hyphen placement.
  const canonical = decodeToBytes('04', { alphabet: 'crockford', crockfordMode: 'byte' });
  expect(decodeToBytes('O4', { alphabet: 'crockford', crockfordMode: 'byte' })).toEqual(canonical); // O -> 0
  expect(decodeToBytes('o4', { alphabet: 'crockford', crockfordMode: 'byte' })).toEqual(canonical); // o -> 0 (case-insensitive)
  expect(decodeToBytes('0-4', { alphabet: 'crockford', crockfordMode: 'byte' })).toEqual(canonical); // hyphen ignored
  // I and L both alias to the digit 1.
  expect(decodeToBytes('I', { alphabet: 'crockford', crockfordMode: 'number' })).toEqual(
    decodeToBytes('1', { alphabet: 'crockford', crockfordMode: 'number' }),
  );
  expect(decodeToBytes('L', { alphabet: 'crockford', crockfordMode: 'number' })).toEqual(
    decodeToBytes('1', { alphabet: 'crockford', crockfordMode: 'number' }),
  );
  expect(decodeToBytes('l', { alphabet: 'crockford', crockfordMode: 'number' })).toEqual(
    decodeToBytes('1', { alphabet: 'crockford', crockfordMode: 'number' }),
  );
  expect(decodeToBytes('i', { alphabet: 'crockford', crockfordMode: 'number' })).toEqual(
    decodeToBytes('1', { alphabet: 'crockford', crockfordMode: 'number' }),
  );
});

it('the Crockford check symbol is the payload value modulo 37', () => {
  // Byte 0x01 in byte mode packs to "04" (bits 00000 00100 = values 0, 4).
  // Positional value of digits [0, 4] is 0*32 + 4 = 4. 4 mod 37 = 4, and the
  // extended alphabet's symbol at index 4 is the data symbol "4".
  const withChecksum = encodeBytes(new Uint8Array([1]), {
    alphabet: 'crockford',
    crockfordMode: 'byte',
    crockfordChecksum: true,
  });
  expect(withChecksum).toBe('044');
});

it('a Crockford value whose check symbol does not match is rejected', () => {
  const encoded = encodeBytes(new Uint8Array([1]), {
    alphabet: 'crockford',
    crockfordMode: 'byte',
    crockfordChecksum: true,
  }); // "044"
  const corrupted = encoded.slice(0, -1) + '5'; // wrong checksum symbol
  try {
    decodeToBytes(corrupted, { alphabet: 'crockford', crockfordMode: 'byte', crockfordChecksum: true });
    expect.fail('expected to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(Base32Error);
    expect((err as Base32Error).message).toMatch(/checksum/i);
  }
});

it('a character outside the selected alphabet is rejected with its position', () => {
  // 'U' is excluded from the Crockford data alphabet.
  try {
    decodeToBytes('1U', { alphabet: 'crockford', crockfordMode: 'byte' });
    expect.fail('expected to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(Base32Error);
    expect((err as Base32Error).position).toBe(1);
  }
});

// Additional coverage beyond the nine mandated titles.

describe('padding', () => {
  it('unpadded encode matches the padded output with trailing = removed, and decodes', () => {
    for (const [input, base32] of RFC_4648_SECTION_10_VECTORS) {
      const unpadded = encodeText(input, { alphabet: 'base32', padding: false });
      expect(unpadded).toBe(base32.replace(/=+$/, ''));
      expect(decodeToText(unpadded, { alphabet: 'base32' })).toBe(input);
    }
  });
});

describe('RFC decode error handling', () => {
  it('rejects a length that is not a valid Base32 length, naming valid lengths', () => {
    // A single character (remainder 1 mod 8) cannot be a valid Base32 body length.
    try {
      decodeToBytes('M', { alphabet: 'base32' });
      expect.fail('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(Base32Error);
      expect((err as Base32Error).message).toMatch(/multiple of 8|2, 4, 5 or 7/);
    }
  });

  it('rejects a character outside the RFC alphabet, with its position', () => {
    // '1' is not in the Base32 alphabet (only 2-7 among digits).
    try {
      decodeToBytes('MZXW1===', { alphabet: 'base32' });
      expect.fail('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(Base32Error);
      expect((err as Base32Error).position).toBe(4);
    }
  });
});

describe('Crockford — additional coverage', () => {
  it('excludes the four confusable letters I, L, O, U from the data alphabet', () => {
    for (const excluded of ['I', 'L', 'O', 'U']) {
      expect(ALPHABETS.crockford.symbols.includes(excluded)).toBe(false);
    }
    expect(ALPHABETS.crockford.symbols).toHaveLength(32);
    expect(new Set(ALPHABETS.crockford.symbols).size).toBe(32);
  });

  it('Crockford number mode encodes the value 0 as the single symbol 0, with no leading zero digits', () => {
    expect(encodeBytes(new Uint8Array([0]), { alphabet: 'crockford', crockfordMode: 'number' })).toBe('0');
  });

  it('Crockford number mode round trips an arbitrary multi-byte value', () => {
    const input = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
    const encoded = encodeBytes(input, { alphabet: 'crockford', crockfordMode: 'number' });
    const decoded = decodeToBytes(encoded, { alphabet: 'crockford', crockfordMode: 'number' });
    // The integer value round trips; minimal-byte representation may differ
    // in length from the input if the input had leading zero bytes, which is
    // an inherent property of number mode (it encodes an integer, not bytes).
    expect(Buffer.from(decoded).toString('hex').replace(/^0+/, '')).toBe(
      Buffer.from(input).toString('hex').replace(/^0+/, ''),
    );
  });

  it('Crockford byte mode round trips arbitrary bytes, including leading zero bytes', () => {
    const input = new Uint8Array([0x00, 0x01, 0xff, 0x10]);
    const encoded = encodeBytes(input, { alphabet: 'crockford', crockfordMode: 'byte' });
    const decoded = decodeToBytes(encoded, { alphabet: 'crockford', crockfordMode: 'byte' });
    expect(decoded).toEqual(input);
  });

  it('the RFC length check does not apply to Crockford', () => {
    // A single-symbol Crockford string is exactly a valid length-1 RFC-style
    // remainder (which the RFC decoder would reject), and Crockford must
    // accept it because it has no padding-based length constraint.
    expect(() => decodeToBytes('1', { alphabet: 'crockford', crockfordMode: 'number' })).not.toThrow();
  });

  it('a Crockford value whose checksum symbol is the one the checksum alphabet reuses verifies correctly, and the same symbol in a data position is rejected', () => {
    // Number-mode value 36 encodes as digits "14" (1*32 + 4 = 36).
    // 36 mod 37 = 36, and the extended alphabet's symbol at index 36 is "U" --
    // a letter the DATA alphabet deliberately excludes.
    const encoded = encodeBytes(new Uint8Array([36]), {
      alphabet: 'crockford',
      crockfordMode: 'number',
      crockfordChecksum: true,
    });
    expect(encoded).toBe('14U');
    // Verifies correctly in the checksum position:
    expect(() =>
      decodeToBytes(encoded, { alphabet: 'crockford', crockfordMode: 'number', crockfordChecksum: true }),
    ).not.toThrow();
    // The same symbol used in a DATA position is rejected outright:
    expect(() =>
      decodeToBytes('1U4', { alphabet: 'crockford', crockfordMode: 'number', crockfordChecksum: false }),
    ).toThrow(Base32Error);
  });
});
