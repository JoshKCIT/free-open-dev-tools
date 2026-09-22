import { describe, it, expect } from 'vitest';
import { encode, decode, encodeAll, isAlreadyEncoded, UrlCodecError } from '../src/index';

describe('component encoding', () => {
  it('escapes the characters that would otherwise split a query string', () => {
    expect(encode('a&b=c?d#e')).toBe('a%26b%3Dc%3Fd%23e');
    expect(encode('path/to/thing')).toBe('path%2Fto%2Fthing');
  });

  it('leaves the RFC 3986 unreserved set alone', () => {
    const unreserved = 'ABCyz019-._~';
    expect(encode(unreserved)).toBe(unreserved);
  });

  it('matches encodeURIComponent by default', () => {
    const samples = ['hello world', "a'b(c)d*e!f", 'π≈3.14', '100%', 'a+b', '<script>'];
    for (const s of samples) expect(encode(s)).toBe(encodeURIComponent(s));
  });

  it('escapes the legacy sub-delimiters when strict RFC 3986 is requested', () => {
    expect(encode("!'()*", { strictRfc3986: true })).toBe('%21%27%28%29%2A');
    expect(encode("!'()*")).toBe("!'()*");
  });

  it('uses uppercase hex by default, as the RFC prefers', () => {
    expect(encode('/')).toBe('%2F');
    expect(encode('/', { lowercaseHex: true })).toBe('%2f');
  });
});

describe('full URI encoding', () => {
  it('keeps the structure of a URL intact', () => {
    const url = 'https://example.com/a path/b?x=1&y=2#frag';
    expect(encode(url, { mode: 'uri' })).toBe('https://example.com/a%20path/b?x=1&y=2#frag');
  });

  it('matches encodeURI', () => {
    const samples = ['https://example.com/a b', 'http://x/?q=a b&r=c', 'https://é.example/ü'];
    for (const s of samples) expect(encode(s, { mode: 'uri' })).toBe(encodeURI(s));
  });
});

describe('form encoding', () => {
  it('turns a space into a plus sign', () => {
    expect(encode('hello world', { mode: 'form' })).toBe('hello+world');
  });

  it('escapes a literal plus so it survives the round trip', () => {
    expect(encode('a+b', { mode: 'form' })).toBe('a%2Bb');
    expect(decode('a%2Bb', { mode: 'form' })).toBe('a+b');
  });

  it('escapes the tilde, which component mode does not', () => {
    expect(encode('~', { mode: 'form' })).toBe('%7E');
    expect(encode('~', { mode: 'component' })).toBe('~');
  });

  it('agrees with URLSearchParams', () => {
    // URLSearchParams is the platform's own implementation of this encoding.
    for (const s of ['a b', 'a+b', 'ü', 'a&b', '100%', '~*-._']) {
      const expected = new URLSearchParams({ k: s }).toString().slice(2);
      expect(encode(s, { mode: 'form' })).toBe(expected);
    }
  });

  it('decodes a plus as a space only in form mode', () => {
    expect(decode('a+b', { mode: 'form' })).toBe('a b');
    expect(decode('a+b', { mode: 'component' })).toBe('a+b');
  });
});

describe('Unicode', () => {
  it('encodes as UTF-8 bytes', () => {
    // é is U+00E9, two bytes in UTF-8.
    expect(encode('é')).toBe('%C3%A9');
    expect(decode('%C3%A9')).toBe('é');
  });

  it('handles characters outside the Basic Multilingual Plane', () => {
    // U+1F44B is four UTF-8 bytes and a surrogate pair in JavaScript.
    expect(encode('👋')).toBe('%F0%9F%91%8B');
    expect(decode('%F0%9F%91%8B')).toBe('👋');
  });

  it('round-trips a multi-code-point emoji sequence', () => {
    const wave = '👋🏽';
    expect(decode(encode(wave))).toBe(wave);
  });

  it('reassembles a multi-byte character split across escapes', () => {
    expect(decode('%E6%97%A5%E6%9C%AC')).toBe('日本');
  });

  it('round-trips newlines and tabs', () => {
    const s = 'line1\nline2\ttabbed\r\n';
    expect(decode(encode(s))).toBe(s);
  });
});

describe('malformed escapes', () => {
  it('throws with a position by default', () => {
    try {
      decode('abc%zz');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UrlCodecError);
      expect((err as UrlCodecError).position).toBe(3);
      expect((err as Error).message).toContain('%25');
    }
  });

  it('throws on a trailing percent sign', () => {
    expect(() => decode('abc%')).toThrow(UrlCodecError);
    expect(() => decode('abc%4')).toThrow(UrlCodecError);
  });

  it('keeps a malformed escape when asked to be lenient', () => {
    expect(decode('100% sure', { onMalformed: 'keep' })).toBe('100% sure');
    expect(decode('a%zzb', { onMalformed: 'keep' })).toBe('a%zzb');
  });

  it('is more forgiving than decodeURIComponent, which throws on this', () => {
    expect(() => decodeURIComponent('100%')).toThrow();
    expect(decode('100%', { onMalformed: 'keep' })).toBe('100%');
  });

  it('accepts lowercase and mixed case hex digits', () => {
    expect(decode('%c3%a9')).toBe('é');
    expect(decode('%C3%a9')).toBe('é');
  });

  it('substitutes for invalid UTF-8 byte sequences rather than throwing', () => {
    // %FF is never a valid UTF-8 lead byte. TextDecoder substitutes U+FFFD.
    expect(decode('%FF')).toBe('�');
  });
});

describe('round trips', () => {
  it('survives every mode for a demanding sample', () => {
    const samples = [
      '',
      'plain',
      'a b c',
      'a+b',
      '100%',
      'key=value&other=thing',
      '/path/with spaces/',
      'ünïcödé',
      '👋🏽 emoji',
      '"quoted" and <tagged>',
      "single'quote",
      '\u0000\u001f control',
      'a'.repeat(5000),
    ];
    for (const mode of ['component', 'form'] as const) {
      for (const s of samples) {
        expect(decode(encode(s, { mode }), { mode })).toBe(s);
      }
    }
  });

  it('empty input stays empty', () => {
    expect(encode('')).toBe('');
    expect(decode('')).toBe('');
  });
});

describe('helpers', () => {
  it('shows all three encodings side by side', () => {
    const report = encodeAll('a b/c?d');
    expect(report.map((r) => r.mode)).toEqual(['component', 'uri', 'form']);
    expect(report[0]!.output).toBe('a%20b%2Fc%3Fd');
    expect(report[1]!.output).toBe('a%20b/c?d');
    expect(report[2]!.output).toBe('a+b%2Fc%3Fd');
  });

  it('detects text that is already encoded', () => {
    expect(isAlreadyEncoded('a%20b')).toBe(true);
    expect(isAlreadyEncoded('a b')).toBe(false);
  });
});
