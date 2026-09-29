import { it, expect, describe } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { decompressBytes } from '../src/index';

function hexBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// RFC 1951 section 3.2 hand-built vectors. Each is also confirmed against
// Node's own inflateRawSync as a second opinion.
describe('RFC 1951 section 3.2 vectors', () => {
  it('a stored final block "hello" (BFINAL=1, BTYPE=00) decodes to "hello"', () => {
    // Byte 0: 0000 0101 = BFINAL(1) BTYPE(00) then padding to byte boundary (05 = 0b00000101 -> bits read LSB first: bit0=1 (BFINAL), bits1-2=10->reading LSB-first "00" ... see comment below).
    // 01 = BFINAL=1, BTYPE=00 (stored), rest of byte is padding to align to a byte boundary.
    // 05 00 = LEN = 5 (little-endian 16-bit)
    // FA FF = NLEN = one's complement of LEN
    // 68 65 6C 6C 6F = "hello"
    const bytes = hexBytes('01 05 00 FA FF 68 65 6C 6C 6F');
    const nodeResult = inflateRawSync(Buffer.from(bytes));
    expect(nodeResult.toString('utf-8')).toBe('hello');

    const result = decompressBytes(bytes, { container: 'raw' });
    expect(Buffer.from(result.bytes).toString('utf-8')).toBe('hello');
    expect(result.bytes.length).toBe(5);
  });

  it('an empty fixed-Huffman final block (03 00) decodes to empty output', () => {
    const bytes = hexBytes('03 00');
    const nodeResult = inflateRawSync(Buffer.from(bytes));
    expect(nodeResult.length).toBe(0);

    const result = decompressBytes(bytes, { container: 'raw' });
    expect(result.bytes.length).toBe(0);
  });

  it('a fixed-Huffman "a" (4B 04 00) decodes to "a"', () => {
    const bytes = hexBytes('4B 04 00');
    const nodeResult = inflateRawSync(Buffer.from(bytes));
    expect(nodeResult.toString('utf-8')).toBe('a');

    const result = decompressBytes(bytes, { container: 'raw' });
    expect(Buffer.from(result.bytes).toString('utf-8')).toBe('a');
  });

  it('a non-final stored block "he" followed by a final stored block "llo" gives "hello"', () => {
    // Block 1: BFINAL=0, BTYPE=00 -> first byte 0x00, LEN=2, NLEN=~2, "he"
    // Block 2: BFINAL=1, BTYPE=00 -> first byte 0x01, LEN=3, NLEN=~3, "llo"
    const bytes = hexBytes('00 02 00 FD FF 68 65 01 03 00 FC FF 6C 6C 6F');
    const nodeResult = inflateRawSync(Buffer.from(bytes));
    expect(nodeResult.toString('utf-8')).toBe('hello');

    const result = decompressBytes(bytes, { container: 'raw' });
    expect(Buffer.from(result.bytes).toString('utf-8')).toBe('hello');
  });

  it('BTYPE 11 (reserved, first byte 07) is kind corrupt', () => {
    const bytes = hexBytes('07');
    expect(() => inflateRawSync(Buffer.from(bytes))).toThrow();
    try {
      decompressBytes(bytes, { container: 'raw' });
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as { kind?: string }).kind).toBe('corrupt');
    }
  });

  it('a stream cut mid-block is kind truncated', () => {
    // A fixed-Huffman block header with no data following it at all.
    const bytes = hexBytes('4B');
    try {
      decompressBytes(bytes, { container: 'raw' });
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as { kind?: string }).kind).toBe('truncated');
    }
  });

  it('a stored block whose NLEN is not the one’s complement of LEN still decodes here (documented limit), while Node refuses it', () => {
    // LEN=5 but NLEN is deliberately wrong (should be FA FF).
    const bytes = hexBytes('01 05 00 00 00 68 65 6C 6C 6F');
    expect(() => inflateRawSync(Buffer.from(bytes))).toThrow();

    const result = decompressBytes(bytes, { container: 'raw' });
    expect(Buffer.from(result.bytes).toString('utf-8')).toBe('hello');
  });
});
