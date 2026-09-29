/**
 * The "Node decompresses this tool output" half of the Node zlib second
 * opinion (node-zlib.test.ts has the "this tool decompresses Node output"
 * half plus checksums, determinism and the final-block regression). Split
 * into its own file so vitest can run the two heavy files as separate
 * workers rather than one long single-threaded run.
 */
import { it, expect, describe } from 'vitest';
import * as nodeZlib from 'node:zlib';
import { compressBytes } from '../src/index';

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

const LIGHT_CORPUS: { label: string; bytes: Uint8Array }[] = [
  { label: 'empty', bytes: new Uint8Array(0) },
  { label: 'ascii', bytes: new TextEncoder().encode('The quick brown fox jumps over the lazy dog.') },
  { label: 'utf-8 with an astral character', bytes: new TextEncoder().encode('hello \u{1F600} world') },
];
const HEAVY_CORPUS: { label: string; bytes: Uint8Array; levels: number[] }[] = [
  { label: '1 MiB repetitive text', bytes: new TextEncoder().encode('abcdefghij'.repeat(1024 * 105)), levels: [1, 9] },
  { label: '64 KiB fixed-seed random bytes', bytes: randomBytes(64 * 1024, 42), levels: [0, 1, 6, 9] },
];

describe('Node decompresses this tool output (both directions)', () => {
  for (const { label, bytes } of LIGHT_CORPUS) {
    for (const level of [0, 1, 6, 9]) {
      it(`compressBytes(${label}, gzip, level ${level}) is read back correctly by Node gunzipSync`, () => {
        const out = compressBytes(bytes, { format: 'gzip', level });
        expect(new Uint8Array(nodeZlib.gunzipSync(Buffer.from(out)))).toEqual(bytes);
      });

      it(`compressBytes(${label}, zlib, level ${level}) is read back correctly by Node inflateSync`, () => {
        const out = compressBytes(bytes, { format: 'zlib', level });
        expect(new Uint8Array(nodeZlib.inflateSync(Buffer.from(out)))).toEqual(bytes);
      });

      it(`compressBytes(${label}, raw, level ${level}) is read back correctly by Node inflateRawSync`, () => {
        const out = compressBytes(bytes, { format: 'raw', level });
        expect(new Uint8Array(nodeZlib.inflateRawSync(Buffer.from(out)))).toEqual(bytes);
      });
    }
  }

  for (const { label, bytes, levels } of HEAVY_CORPUS) {
    for (const level of levels) {
      it(`compressBytes(${label}, gzip, level ${level}) is read back correctly by Node gunzipSync`, () => {
        const out = compressBytes(bytes, { format: 'gzip', level });
        expect(new Uint8Array(nodeZlib.gunzipSync(Buffer.from(out)))).toEqual(bytes);
      }, 20_000);

      it(`compressBytes(${label}, zlib, level ${level}) is read back correctly by Node inflateSync`, () => {
        const out = compressBytes(bytes, { format: 'zlib', level });
        expect(new Uint8Array(nodeZlib.inflateSync(Buffer.from(out)))).toEqual(bytes);
      }, 20_000);

      it(`compressBytes(${label}, raw, level ${level}) is read back correctly by Node inflateRawSync`, () => {
        const out = compressBytes(bytes, { format: 'raw', level });
        expect(new Uint8Array(nodeZlib.inflateRawSync(Buffer.from(out)))).toEqual(bytes);
      }, 20_000);
    }
  }
});
