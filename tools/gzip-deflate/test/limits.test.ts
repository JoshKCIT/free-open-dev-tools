import { it, expect, describe } from 'vitest';
import { createGzip } from 'node:zlib';
import { decompress, compress, MAX_OUTPUT_BYTES, GzipDeflateError } from '../src/index';
import { decodeInput } from '../src/input';
import { compressBytes } from '../src/compress';

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

describe('decompression bomb', () => {
  it('200 MiB of zeros, streamed through Node gzip, stops at the 64 MiB cap without allocating 200 MiB', async () => {
    const gzip = createGzip({ level: 9 });
    const chunks: Buffer[] = [];
    gzip.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<void>((resolve, reject) => {
      gzip.on('end', resolve);
      gzip.on('error', reject);
    });
    const oneMibZeros = Buffer.alloc(1024 * 1024, 0);
    for (let i = 0; i < 200; i++) gzip.write(oneMibZeros);
    gzip.end();
    await done;
    const compressed = Buffer.concat(chunks);
    const base64 = compressed.toString('base64');

    try {
      decompress(base64, { inputEncoding: 'base64' });
      throw new Error('expected a throw');
    } catch (e) {
      expect(e).toBeInstanceOf(GzipDeflateError);
      const err = e as GzipDeflateError;
      expect(err.kind).toBe('output-cap');
      expect(err.producedBytes).toBeGreaterThan(MAX_OUTPUT_BYTES);
      expect(err.producedBytes).toBeLessThan(MAX_OUTPUT_BYTES + 2 * 1024 * 1024);
      expect(err.message).toMatch(/64 MiB/);
    }
  }, 30_000);

  it('a smaller maxOutputBytes option is honoured', () => {
    const gz = compress('x'.repeat(1000), {
      inputKind: 'text',
      format: 'gzip',
      level: 9,
      outputEncoding: 'base64',
      percentEncode: false,
    });
    try {
      decompress(gz.text, { inputEncoding: 'base64', maxOutputBytes: 10 });
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as GzipDeflateError).kind).toBe('output-cap');
    }
  });
});

describe('input decoding', () => {
  it('standard Base64, URL-safe Base64, missing padding and embedded whitespace/newlines all decode', () => {
    const bytes = new TextEncoder().encode('hello world, this is a test of base64');
    const std = Buffer.from(bytes).toString('base64');
    const urlSafe = std.replace(/\+/g, '-').replace(/\//g, '_');
    const noPad = std.replace(/=+$/, '');
    const withWhitespace = std.match(/.{1,8}/g)!.join('\n ');

    for (const text of [std, urlSafe, noPad, withWhitespace]) {
      expect(decodeInput(text, 'base64')).toEqual(bytes);
    }
  });

  it('mixed alphabets, a bad character, length 1 mod 4 and a % in Base64 mode are refused', () => {
    expect(() => decodeInput('a+b-c', 'base64')).toThrow(GzipDeflateError);
    expect(() => decodeInput('a!b', 'base64')).toThrow(GzipDeflateError);
    expect(() => decodeInput('QQQQQ', 'base64')).toThrow(GzipDeflateError); // 5 chars, 5 mod 4 = 1
    expect(() => decodeInput('50%', 'base64')).toThrow(GzipDeflateError);
  });

  it('hex with spaces decodes, odd count and a non-hex character are refused with position', () => {
    expect(decodeInput('68 65 6c 6c 6f', 'hex')).toEqual(new TextEncoder().encode('hello'));
    try {
      decodeInput('abc', 'hex');
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as GzipDeflateError).kind).toBe('input');
    }
    try {
      decodeInput('zz', 'hex');
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as GzipDeflateError).position).toBe(0);
    }
  });

  it('URL-encoded Base64 decodes %2B %2F %3D and refuses %G1 with position', () => {
    const bytes = Uint8Array.of(0xff, 0xfe, 0x00);
    const std = Buffer.from(bytes).toString('base64'); // contains '+' or '/' potentially
    const percentEncoded = std.replace(/\+/g, '%2B').replace(/\//g, '%2F').replace(/=/g, '%3D');
    expect(decodeInput(percentEncoded, 'url-base64')).toEqual(bytes);
    try {
      decodeInput('%G1', 'url-base64');
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as GzipDeflateError).position).toBe(0);
    }
  });

  it('empty input is kind input', () => {
    try {
      decodeInput('', 'base64');
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as GzipDeflateError).kind).toBe('input');
    }
  });
});

describe('output text decoding', () => {
  it('valid UTF-8 gives text, with a leading BOM kept as U+FEFF', () => {
    const bytes = new TextEncoder().encode('﻿hello');
    const compressed = compressBytes(bytes, { format: 'gzip', level: 6 });
    const result = decompress(toBase64(compressed), { inputEncoding: 'base64' });
    expect(result.text).toBe('﻿hello');
  });

  it('bytes FF FE 00 give text null', () => {
    const compressed = compressBytes(Uint8Array.of(0xff, 0xfe, 0x00), { format: 'gzip', level: 6 });
    const result = decompress(toBase64(compressed), { inputEncoding: 'base64' });
    expect(result.text).toBeNull();
  });
});

describe('compress options', () => {
  it('hex input, Base64url output unpadded, hex output upper case, percentEncode', () => {
    const hexIn = compress('68656c6c6f', {
      inputKind: 'hex',
      format: 'raw',
      level: 6,
      outputEncoding: 'hex',
      percentEncode: false,
    });
    expect(/^[0-9A-F]+$/.test(hexIn.text)).toBe(true);
    expect(hexIn.inputBytes).toEqual(new TextEncoder().encode('hello'));

    const urlOut = compress('hello', {
      inputKind: 'text',
      format: 'gzip',
      level: 6,
      outputEncoding: 'base64url',
      percentEncode: false,
    });
    expect(urlOut.text.includes('=')).toBe(false);
    expect(/[+/]/.test(urlOut.text)).toBe(false);

    const percentEncoded = compress('hello', {
      inputKind: 'text',
      format: 'gzip',
      level: 6,
      outputEncoding: 'base64',
      percentEncode: true,
    });
    expect(percentEncoded.text).toBe(encodeURIComponent(Buffer.from(percentEncoded.bytes).toString('base64')));
  });
});
