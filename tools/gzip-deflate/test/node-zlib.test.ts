import { it, expect, describe } from 'vitest';
import * as nodeZlib from 'node:zlib';
import { decompressBytes, compressBytes, compress, decompress, crc32, adler32 } from '../src/index';

function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBytes(length: number, seed: number): Uint8Array {
  const rand = mulberry32(seed);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = Math.floor(rand() * 256);
  return out;
}

// Small, cheap corpus items tested at every level; two larger items (defined
// below, used more sparingly across fewer levels) keep this file's total
// synchronous CPU time modest -- a long single-threaded run was observed to
// occasionally trip vitest's own worker-RPC "onTaskUpdate" heartbeat, a
// tooling glitch unrelated to correctness (this repo's own environment notes
// document the same class of transient slowness for other CPU-heavy tests).
const LIGHT_CORPUS: { label: string; bytes: Uint8Array }[] = [
  { label: 'empty', bytes: new Uint8Array(0) },
  { label: 'ascii', bytes: new TextEncoder().encode('The quick brown fox jumps over the lazy dog.') },
  { label: 'utf-8 with an astral character', bytes: new TextEncoder().encode('hello \u{1F600} world') },
];
const HEAVY_CORPUS: { label: string; bytes: Uint8Array; levels: number[] }[] = [
  { label: '1 MiB repetitive text', bytes: new TextEncoder().encode('abcdefghij'.repeat(1024 * 105)), levels: [1, 9] },
  { label: '64 KiB fixed-seed random bytes', bytes: randomBytes(64 * 1024, 42), levels: [0, 1, 6, 9] },
];
const ALL_CORPUS = [...LIGHT_CORPUS, ...HEAVY_CORPUS];

describe('checksums: standard check value and Node cross-check', () => {
  it('CRC-32 of "123456789" is 0xCBF43926 (the standard check value)', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('crc32 equals the trailer of a Node gzipSync output', () => {
    for (const { bytes } of ALL_CORPUS) {
      const gz = nodeZlib.gzipSync(Buffer.from(bytes), { level: 6 });
      const trailer = gz.subarray(gz.length - 8, gz.length - 4);
      const expected = trailer.readUInt32LE(0);
      expect(crc32(bytes)).toBe(expected);
    }
  });

  it('crc32 equals Node zlib.crc32 on random inputs, when that function exists (Node 22.2+)', () => {
    const nodeCrc32 = (nodeZlib as unknown as { crc32?: (b: Buffer) => number }).crc32;
    if (typeof nodeCrc32 !== 'function') return;
    for (let i = 0; i < 20; i++) {
      const bytes = randomBytes(1000, i);
      expect(crc32(bytes)).toBe(nodeCrc32(Buffer.from(bytes)));
    }
  });

  it('adler32 equals the trailer of a Node deflateSync (zlib) output', () => {
    for (const { bytes } of ALL_CORPUS) {
      const z = nodeZlib.deflateSync(Buffer.from(bytes), { level: 6 });
      const trailer = z.subarray(z.length - 4);
      const expected = trailer.readUInt32BE(0);
      expect(adler32(bytes)).toBe(expected);
    }
  });

  it('streaming CRC-32 over any chunk split equals a one-shot call', async () => {
    const { crc32Update } = await import('../src/checksums');
    const bytes = randomBytes(10_000, 7);
    let running = 0;
    for (let i = 0; i < bytes.length; i += 777) {
      running = crc32Update(running, bytes.subarray(i, i + 777));
    }
    expect(running).toBe(crc32(bytes));
  });
});

describe('this tool decompresses Node output (both directions)', () => {
  for (const { label, bytes } of LIGHT_CORPUS) {
    for (const level of [0, 1, 6, 9]) {
      it(`gzipSync(${label}, level ${level}) decodes back to the original, auto and forced container`, () => {
        const gz = new Uint8Array(nodeZlib.gzipSync(Buffer.from(bytes), { level }));
        expect(decompressBytes(gz).bytes).toEqual(bytes);
        expect(decompressBytes(gz, { container: 'gzip' }).bytes).toEqual(bytes);
      });

      it(`deflateSync(${label}, level ${level}) decodes back to the original`, () => {
        const z = new Uint8Array(nodeZlib.deflateSync(Buffer.from(bytes), { level }));
        expect(decompressBytes(z).bytes).toEqual(bytes);
      });

      it(`deflateRawSync(${label}, level ${level}) decodes back to the original`, () => {
        const raw = new Uint8Array(nodeZlib.deflateRawSync(Buffer.from(bytes), { level }));
        expect(decompressBytes(raw, { container: 'raw' }).bytes).toEqual(bytes);
      });
    }
  }

  for (const { label, bytes, levels } of HEAVY_CORPUS) {
    for (const level of levels) {
      it(`gzipSync(${label}, level ${level}) decodes back to the original, auto and forced container`, () => {
        const gz = new Uint8Array(nodeZlib.gzipSync(Buffer.from(bytes), { level }));
        expect(decompressBytes(gz).bytes).toEqual(bytes);
        expect(decompressBytes(gz, { container: 'gzip' }).bytes).toEqual(bytes);
      }, 20_000);

      it(`deflateSync(${label}, level ${level}) decodes back to the original`, () => {
        const z = new Uint8Array(nodeZlib.deflateSync(Buffer.from(bytes), { level }));
        expect(decompressBytes(z).bytes).toEqual(bytes);
      }, 20_000);

      it(`deflateRawSync(${label}, level ${level}) decodes back to the original`, () => {
        const raw = new Uint8Array(nodeZlib.deflateRawSync(Buffer.from(bytes), { level }));
        expect(decompressBytes(raw, { container: 'raw' }).bytes).toEqual(bytes);
      }, 20_000);
    }
  }
});

describe('final-block boundary regression', () => {
  it('a ~900 KB low-compressibility text, gzipped by Node, whose compressed final block spans many 1 KiB pushes, decodes with CRC and ISIZE matching', () => {
    // Random lowercase "words" compress poorly (unlike repetitive text), so the
    // compressed body stays large -- hundreds of 1 KiB pushes -- which is what
    // actually exercises a final DEFLATE block spanning multiple pushes.
    const rand = mulberry32(123);
    const words: string[] = [];
    let total = 0;
    while (total < 900_000) {
      const len = 3 + Math.floor(rand() * 8);
      let w = '';
      for (let i = 0; i < len; i++) w += String.fromCharCode(97 + Math.floor(rand() * 26));
      words.push(w);
      total += len + 1;
    }
    const text = words.join(' ');
    const gz = nodeZlib.gzipSync(Buffer.from(text), { level: 6 });
    expect(gz.length).toBeGreaterThan(300 * 1024);
    const result = decompressBytes(new Uint8Array(gz));
    expect(Buffer.from(result.bytes).toString('utf-8')).toBe(text);
    expect(result.members[0]!.crc32).toBe(crc32(new TextEncoder().encode(text)));
  }, 20_000);
});

describe('determinism', () => {
  it('compressing the same input twice gives identical bytes', () => {
    const bytes = new TextEncoder().encode('deterministic please');
    const a = compressBytes(bytes, { format: 'gzip', level: 6 });
    const b = compressBytes(bytes, { format: 'gzip', level: 6 });
    expect(a).toEqual(b);
  });

  it('the gzip header has MTIME bytes 0, FLG 0 and OS 3', () => {
    const out = compressBytes(new TextEncoder().encode('x'), { format: 'gzip', level: 6 });
    expect(out[3]).toBe(0); // FLG
    expect(out[4]).toBe(0);
    expect(out[5]).toBe(0);
    expect(out[6]).toBe(0);
    expect(out[7]).toBe(0); // MTIME (4 bytes)
    expect(out[9]).toBe(3); // OS
  });
});

describe('compress/decompress text round trip via the text API', () => {
  it('round trips text through gzip, base64', () => {
    const c = compress('Hello from gzip.\nCompressed in the browser.\n', {
      inputKind: 'text',
      format: 'gzip',
      level: 6,
      outputEncoding: 'base64',
      percentEncode: false,
    });
    const d = decompress(c.text, { inputEncoding: 'base64', container: 'auto' });
    expect(d.text).toBe('Hello from gzip.\nCompressed in the browser.\n');
  });
});
