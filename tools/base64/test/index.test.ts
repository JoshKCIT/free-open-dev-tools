import { describe, it, expect } from 'vitest';
import {
  encodeBytes,
  encodeText,
  decodeToBytes,
  decodeToText,
  detectAlphabet,
  isValidUtf8,
  toHex,
  Base64Error,
} from '../src/index';

const bytes = (...n: number[]) => new Uint8Array(n);

describe('RFC 4648 section 10 test vectors', () => {
  // These are the normative vectors. If any of these change, the codec is wrong.
  const vectors: [string, string][] = [
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ];

  for (const [plain, encoded] of vectors) {
    it(`encodes ${JSON.stringify(plain)} to ${JSON.stringify(encoded)}`, () => {
      expect(encodeText(plain)).toBe(encoded);
    });
    it(`decodes ${JSON.stringify(encoded)} back to ${JSON.stringify(plain)}`, () => {
      expect(decodeToText(encoded)).toBe(plain);
    });
  }
});

describe('alphabets', () => {
  // 0xfb 0xff produces "+/" in the standard alphabet and "-_" in base64url.
  const input = bytes(0xfb, 0xff, 0xfe);

  it('uses + and / for the standard alphabet', () => {
    expect(encodeBytes(input)).toBe('+//+');
  });

  it('uses - and _ for base64url', () => {
    expect(encodeBytes(input, { alphabet: 'url' })).toBe('-__-');
  });

  it('round-trips through base64url', () => {
    expect(decodeToBytes(encodeBytes(input, { alphabet: 'url' }), { alphabet: 'url' })).toEqual(input);
  });

  it('accepts either alphabet when set to auto', () => {
    expect(decodeToBytes('-__-', { alphabet: 'auto' })).toEqual(input);
    expect(decodeToBytes('+//+', { alphabet: 'auto' })).toEqual(input);
  });

  it('rejects the wrong alphabet when one is pinned', () => {
    expect(() => decodeToBytes('-__-', { alphabet: 'standard' })).toThrow(/other alphabet/);
    expect(() => decodeToBytes('+//+', { alphabet: 'url' })).toThrow(/other alphabet/);
  });

  it('detects which alphabet a string uses', () => {
    expect(detectAlphabet('abc+/de')).toBe('standard');
    expect(detectAlphabet('abc-_de')).toBe('url');
    expect(detectAlphabet('abcdef')).toBe('ambiguous');
    expect(detectAlphabet('a+b_c')).toBe('ambiguous');
  });
});

describe('padding', () => {
  it('omits padding when asked', () => {
    expect(encodeText('f', { padding: false })).toBe('Zg');
    expect(encodeText('fo', { padding: false })).toBe('Zm8');
    expect(encodeText('foo', { padding: false })).toBe('Zm9v');
  });

  it('rejects unpadded input in strict mode with an actionable message', () => {
    expect(() => decodeToBytes('Zg')).toThrow(/Missing padding: expected 2/);
    expect(() => decodeToBytes('Zm8')).toThrow(/Missing padding: expected 1/);
  });

  it('accepts unpadded input in lenient mode', () => {
    expect(decodeToText('Zg', { mode: 'lenient' })).toBe('f');
    expect(decodeToText('Zm8', { mode: 'lenient' })).toBe('fo');
  });

  it('rejects a lone trailing character, which can never be valid', () => {
    expect(() => decodeToBytes('Zm9vYg==A', { mode: 'lenient' })).toThrow();
    expect(() => decodeToBytes('A', { mode: 'lenient' })).toThrow(/Truncated/);
  });

  it('rejects more than two padding characters', () => {
    expect(() => decodeToBytes('Zg===')).toThrow(/More than two padding/);
  });

  it('rejects padding in the middle', () => {
    expect(() => decodeToBytes('Zg==Zg==')).toThrow(/before the end/);
  });
});

describe('canonical encoding', () => {
  // "Zh==" has the same first character as "Zg==" but sets a trailing bit that
  // decodes to nothing. Strict decoders reject this; many web tools do not.
  it('rejects non-canonical trailing bits in strict mode', () => {
    expect(() => decodeToBytes('Zh==')).toThrow(/Non-canonical/);
  });

  it('masks non-canonical trailing bits in lenient mode', () => {
    expect(decodeToBytes('Zh==', { mode: 'lenient' })).toEqual(bytes(0x66));
  });

  it('rejects non-canonical bits in the three character tail', () => {
    expect(() => decodeToBytes('Zm9w')).not.toThrow();
    expect(() => decodeToBytes('Zm9=')).toThrow(/Non-canonical/);
  });

  it('round-trips every canonical encoding it produces', () => {
    for (let len = 0; len < 40; len++) {
      const data = new Uint8Array(len);
      for (let i = 0; i < len; i++) data[i] = (i * 37 + len * 11) & 0xff;
      expect(decodeToBytes(encodeBytes(data))).toEqual(data);
    }
  });
});

describe('whitespace', () => {
  it('rejects whitespace in strict mode', () => {
    expect(() => decodeToBytes('Zm9v YmFy')).toThrow(/Whitespace is not allowed/);
    expect(() => decodeToBytes('Zm9v\nYmFy')).toThrow(/Whitespace is not allowed/);
  });

  it('ignores whitespace in lenient mode', () => {
    expect(decodeToText('Zm9v YmFy', { mode: 'lenient' })).toBe('foobar');
    expect(decodeToText('Zm9v\r\nYmFy', { mode: 'lenient' })).toBe('foobar');
  });

  it('wraps output at a given line length', () => {
    const wrapped = encodeText('a'.repeat(120), { lineLength: 76 });
    const lines = wrapped.split('\n');
    expect(lines[0]!.length).toBe(76);
    expect(lines.length).toBe(3);
    expect(decodeToText(wrapped, { mode: 'lenient' })).toBe('a'.repeat(120));
  });

  it('uses CRLF when asked, which is what MIME wants', () => {
    expect(encodeText('a'.repeat(100), { lineLength: 76, newline: '\r\n' })).toContain('\r\n');
  });
});

describe('Unicode', () => {
  it('encodes non-Latin text as UTF-8 first', () => {
    // "日本語" is nine UTF-8 bytes, which is exactly three Base64 groups.
    expect(encodeText('日本語')).toBe('5pel5pys6Kqe');
    expect(decodeToText('5pel5pys6Kqe')).toBe('日本語');
  });

  it('handles emoji, which are surrogate pairs in JavaScript strings', () => {
    expect(decodeToText(encodeText('👋🏽 hello'))).toBe('👋🏽 hello');
  });

  it('handles a lone surrogate by substituting the replacement character', () => {
    // A lone high surrogate is not valid Unicode. TextEncoder substitutes
    // U+FFFD, so the round trip is lossy and that is expected, not a bug.
    const lone = '\ud800';
    expect(decodeToText(encodeText(lone))).toBe('�');
  });

  it('preserves the null byte and other control characters', () => {
    const s = '\u0000\u0001\u001f\u007f';
    expect(decodeToText(encodeText(s))).toBe(s);
  });

  it('reports whether decoded bytes are valid UTF-8', () => {
    expect(isValidUtf8(new TextEncoder().encode('ok'))).toBe(true);
    expect(isValidUtf8(bytes(0xff, 0xfe))).toBe(false);
  });
});

describe('binary payloads', () => {
  it('handles every byte value', () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    expect(decodeToBytes(encodeBytes(all))).toEqual(all);
  });

  it('renders bytes as hex for inspection', () => {
    expect(toHex(bytes(0x00, 0x0f, 0xff))).toBe('000fff');
  });

  it('handles a large input without stack overflow', () => {
    const big = new Uint8Array(400_000);
    for (let i = 0; i < big.length; i++) big[i] = i & 0xff;
    const encoded = encodeBytes(big);
    expect(encoded.length).toBe(Math.ceil(big.length / 3) * 4);
    expect(decodeToBytes(encoded)).toEqual(big);
  });
});

describe('errors', () => {
  it('reports the position of an invalid character', () => {
    try {
      decodeToBytes('Zm9v*mFy');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Base64Error);
      expect((err as Base64Error).position).toBe(4);
      expect((err as Error).message).toContain('"*" is not a Base64 character');
    }
  });

  it('empty input decodes to empty output rather than failing', () => {
    expect(decodeToBytes('')).toEqual(new Uint8Array(0));
    expect(decodeToText('')).toBe('');
  });
});

describe('agreement with the platform codec', () => {
  // Differential check against Node's own Buffer implementation. This is a
  // second opinion, not the specification: the RFC vectors above are.
  it('matches Buffer.toString("base64") across random inputs', () => {
    let seed = 12345;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let trial = 0; trial < 300; trial++) {
      const len = Math.floor(rand() * 64);
      const data = new Uint8Array(len);
      for (let i = 0; i < len; i++) data[i] = Math.floor(rand() * 256);
      expect(encodeBytes(data)).toBe(Buffer.from(data).toString('base64'));
      expect(encodeBytes(data, { alphabet: 'url', padding: false })).toBe(Buffer.from(data).toString('base64url'));
    }
  });
});
