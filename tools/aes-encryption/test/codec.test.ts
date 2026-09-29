import { describe, it, expect } from 'vitest';
import { parseHex, parseBase64, toHex, toBase64, decodeUtf8Strict, AesError } from '../src/codec';

describe('parseHex', () => {
  it('decodes a plain hex string', () => {
    expect(toHex(parseHex('deadbeef', 'ciphertext'))).toBe('deadbeef');
  });

  it('ignores whitespace anywhere', () => {
    expect(toHex(parseHex(' de ad\tbe\nef\r', 'ciphertext'))).toBe('deadbeef');
  });

  it('accepts uppercase and mixed case', () => {
    expect(toHex(parseHex('DeAdBeEf', 'ciphertext'))).toBe('deadbeef');
  });

  it('empty input decodes to zero bytes', () => {
    expect(parseHex('', 'ciphertext')).toHaveLength(0);
  });

  it('throws naming the position of the first non-hex character', () => {
    try {
      parseHex('deadXbeef', 'ciphertext');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AesError);
      expect((err as AesError).position).toBe(4);
      expect((err as AesError).message).toContain('position 4');
    }
  });

  it('never quotes the offending character when the field is "key"', () => {
    try {
      parseHex('deadXbeef', 'key');
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain('X');
    }
  });

  it('rejects an odd number of hex digits', () => {
    expect(() => parseHex('abc', 'ciphertext')).toThrow(/odd number/);
  });
});

describe('parseBase64', () => {
  it('round trips through toBase64', () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    expect(parseBase64(toBase64(bytes), 'ciphertext')).toEqual(bytes);
  });

  it('ignores whitespace, including newlines (openssl -a without -A)', () => {
    const unwrapped = 'U2FsdGVkX1/ABg==';
    const wrapped = 'U2Fs\ndGVk\r\nX1/A Bg==';
    expect(parseBase64(wrapped, 'ciphertext')).toEqual(parseBase64(unwrapped, 'ciphertext'));
  });

  it('accepts the URL-safe alphabet', () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf]);
    const standard = toBase64(bytes); // "+/+/"-ish
    const urlSafe = standard.replace(/\+/g, '-').replace(/\//g, '_');
    expect(parseBase64(urlSafe, 'ciphertext')).toEqual(bytes);
  });

  it('accepts padding as optional', () => {
    expect(parseBase64('YQ', 'ciphertext')).toEqual(parseBase64('YQ==', 'ciphertext'));
  });

  it('rejects a mix of standard and URL-safe alphabets', () => {
    expect(() => parseBase64('+abc-def', 'ciphertext')).toThrow(/mixes/);
  });

  it('rejects a length that does not divide into groups of four', () => {
    expect(() => parseBase64('YWJj Y', 'ciphertext')).toThrow(/does not divide/);
  });

  it('rejects a character after padding', () => {
    expect(() => parseBase64('YQ==YQ==', 'ciphertext')).toThrow(/follows padding/);
  });

  it('throws naming the position of the first invalid character', () => {
    try {
      parseBase64('YQ!=', 'ciphertext');
      expect.unreachable();
    } catch (err) {
      expect((err as AesError).message).toContain('position 2');
    }
  });

  it('never quotes the offending character when the field is "key"', () => {
    try {
      parseBase64('YQ!=', 'key');
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain('!');
    }
  });
});

describe('toHex / toBase64', () => {
  it('toHex is lowercase', () => {
    expect(toHex(new Uint8Array([0xab, 0xcd]))).toBe('abcd');
  });

  it('toBase64 produces standard padded Base64', () => {
    expect(toBase64(new Uint8Array([102, 111, 111]))).toBe('Zm9v');
  });
});

describe('decodeUtf8Strict', () => {
  it('decodes valid UTF-8, including astral characters', () => {
    const bytes = new TextEncoder().encode('café 𝄞');
    expect(decodeUtf8Strict(bytes)).toBe('café 𝄞');
  });

  it('returns null, never throws, for invalid UTF-8', () => {
    expect(decodeUtf8Strict(new Uint8Array([0xff, 0xfe]))).toBeNull();
  });

  it('returns null for a truncated multi-byte sequence', () => {
    expect(decodeUtf8Strict(new Uint8Array([0xe2, 0x82]))).toBeNull();
  });
});
