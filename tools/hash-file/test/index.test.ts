import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { crc32 as nodeCrc32 } from 'node:zlib';
import { md5, sha1, ripemd160 } from '@noble/hashes/legacy.js';
import { sha256, sha384, sha512, sha224, sha512_224, sha512_256 } from '@noble/hashes/sha2.js';
import { sha3_256, sha3_512, keccak_256, sha3_224, sha3_384 } from '@noble/hashes/sha3.js';
import { blake2b, blake2s } from '@noble/hashes/blake2.js';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import {
  createHashers,
  updateHashers,
  finishHashers,
  formatDigest,
  digestsMatch,
  ALGORITHMS,
  HashFileError,
  type Algorithm,
} from '../src/index';

/**
 * Published empty-input digests. md5/sha1/sha224/sha256/sha384/sha512
 * reproduce the same RFC 1321 / FIPS 180-4 values `tools/hash-text`'s own
 * test file asserts (and this session re-confirmed every one, byte for
 * byte, against Node's own `crypto` module). sha3-224/sha3-256/sha3-384/
 * sha3-512 reproduce the FIPS 202 values, also re-confirmed against Node
 * `crypto` and, for sha3-256, cross-checked this session against the XKCP
 * project's own ShortMsgKAT_SHA3-256.txt (`Len = 0` entry). keccak-256
 * reproduces the well-known Keccak (pre-FIPS-202-padding) empty digest,
 * cross-checked this session against emn178/js-sha3's own published test
 * table. sha512-224/sha512-256 have no widely published empty-input
 * example (FIPS 180-4's own SHA-512/t examples use "abc"), so these two
 * are recorded from Node's own `crypto` module, this session, with this
 * comment saying so. blake2b-512/blake2s-256 likewise have no published
 * empty-input example in RFC 7693's own appendices, so these are also
 * recorded from Node `crypto` this session. blake3 reproduces the BLAKE3
 * project's own test_vectors.json `input_len: 0` entry (the empty input is
 * exactly what that vector's `i % 251` byte pattern degenerates to at
 * length zero), independently re-confirmed this session against the
 * official `blake3` Python package (PyPI `blake3` 1.0.10, which wraps the
 * BLAKE3 team's own Rust implementation, not the `@noble/hashes`
 * implementation this package uses). ripemd160 reproduces the reference
 * vector, re-confirmed against Node `crypto`. crc32 is zero for the empty
 * input by definition of the algorithm (no bytes to advance the
 * accumulator).
 */
const EMPTY_VECTORS: Record<Algorithm, string> = {
  md5: 'd41d8cd98f00b204e9800998ecf8427e',
  sha1: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
  sha224: 'd14a028c2a3a2bc9476102bb288234c415a2b01f828ea62ac5b3e42f',
  sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  sha384: '38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b',
  sha512:
    'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e',
  'sha512-224': '6ed0dd02806fa89e25de060c19d3ac86cabb87d6a0ddd05c333b84f4',
  'sha512-256': 'c672b8d1ef56ed28ab87c3622c5114069bdd3ad7b8f9737498d0c01ecef0967a',
  'sha3-224': '6b4e03423667dbb73b6e15454f0eb1abd4597f9a1b078e3f5b5a6bc7',
  'sha3-256': 'a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a',
  'sha3-384': '0c63a75b845e4f7d01107d852e4c2485c51a50aaaa94fc61995e71bbee983a2ac3713831264adb47fb6bd1e058d5f004',
  'sha3-512':
    'a69f73cca23a9ac5c8b567dc185a756e97c982164fe25859e0d1dcc1475c80a615b2123af1f5f94c11e3e9402c3ac558f500199d95b6d3e301758586281dcd26',
  'keccak-256': 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
  'blake2b-512':
    '786a02f742015903c6c6fd852552d272912f4740e15847618a86e217f71f5419d25e1031afee585313896444934eb04b903a685b1448b755d56f701afe9be2ce',
  'blake2s-256': '69217a3079908094e11121d042354a7c1f55b6482ca1a51e1b250dfd1ed0eef9',
  blake3: 'af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262',
  ripemd160: '9c1185a5c5e9fc54612808977ee8f548b2258d31',
  crc32: '00000000',
};

/**
 * Published digests for the input "abc". Same provenance as EMPTY_VECTORS
 * above. keccak-256's value was additionally cross-checked this session
 * against go-ethereum's own `crypto/crypto_test.go` (`TestKeccak256Hash`),
 * an independent, mature implementation used as a second opinion per this
 * project's correctness constraint. crc32's value was computed this
 * session against Node's own `zlib.crc32` -- the same differential oracle
 * `tools/hash-text`'s own test file already uses for CRC-32. sha512-224
 * and sha512-256 reproduce FIPS 180-4's own SHA-512/t examples (also NIST
 * CSRC's published example values). sha3-224 and sha3-384 reproduce FIPS
 * 202's own examples. blake2b-512 and blake2s-256 reproduce RFC 7693
 * Appendix A and B respectively. blake3 was independently re-confirmed
 * this session against the official `blake3` Python package (PyPI
 * `blake3` 1.0.10, wrapping the BLAKE3 team's own Rust implementation),
 * not derived from test_vectors.json (whose `i % 251` byte pattern for a
 * 3-byte input is 0x00 0x01 0x02, not the literal bytes of "abc").
 */
const ABC_VECTORS: Record<Algorithm, string> = {
  md5: '900150983cd24fb0d6963f7d28e17f72',
  sha1: 'a9993e364706816aba3e25717850c26c9cd0d89d',
  sha224: '23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7',
  sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  sha384: 'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7',
  sha512:
    'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
  'sha512-224': '4634270f707b6a54daae7530460842e20e37ed265ceee9a43e8924aa',
  'sha512-256': '53048e2681941ef99b2e29b76b4c7dabe4c2d0c634fc6d46e0e2f13107e7af23',
  'sha3-224': 'e642824c3f8cf24ad09234ee7d3c766fc9a3a5168d0c94ad73b46fdf',
  'sha3-256': '3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532',
  'sha3-384': 'ec01498288516fc926459f58e2c6ad8df9b473cb0fc08c2596da7cf0e49be4b298d88cea927ac7f539f1edf228376d25',
  'sha3-512':
    'b751850b1a57168a5693cd924b6b096e08f621827444f70d884f5d0240d2712e10e116e9192af3c91a7ec57647e3934057340b4cf408d5a56592f8274eec53f0',
  'keccak-256': '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45',
  'blake2b-512':
    'ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923',
  'blake2s-256': '508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982',
  blake3: '6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85',
  ripemd160: '8eb208f7e05d987a9b044a8e98c6b087f15a0bfc',
  crc32: '352441c2',
};

/** Calls this package's create/update/finish shape exactly once, covering the whole input in a single update. */
function oneShotViaPackage(algorithm: Algorithm, bytes: Uint8Array): string {
  const state = createHashers([algorithm]);
  updateHashers(state, bytes);
  return finishHashers(state, 'hex')[0]!.digest;
}

/**
 * Calls this package's create/update/finish shape across several chunks,
 * one updateHashers call per entry in chunkSizes. If chunkSizes covers
 * less than the whole input, the remainder is sent in one final chunk --
 * this is what lets a single oversized entry stand in for "one chunk
 * larger than the input".
 */
function chunkedViaPackage(algorithm: Algorithm, bytes: Uint8Array, chunkSizes: number[]): string {
  const state = createHashers([algorithm]);
  let offset = 0;
  for (const size of chunkSizes) {
    updateHashers(state, bytes.slice(offset, offset + size));
    offset += size;
  }
  if (offset < bytes.length) updateHashers(state, bytes.slice(offset));
  return finishHashers(state, 'hex')[0]!.digest;
}

/**
 * The library's own one-shot call form for each algorithm -- the same call
 * `tools/hash-text`'s `hashBytes` makes, already validated there against
 * the published vectors and against Node's own `crypto` module. Used as
 * the anchor for the chunk-boundary test below, so that test proves the
 * chunked path against an implementation it does not share any code with,
 * not only against itself.
 */
function libraryOneShotHex(algorithm: Algorithm, bytes: Uint8Array): string {
  switch (algorithm) {
    case 'md5':
      return bytesToHex(md5(bytes));
    case 'sha1':
      return bytesToHex(sha1(bytes));
    case 'sha224':
      return bytesToHex(sha224(bytes));
    case 'sha256':
      return bytesToHex(sha256(bytes));
    case 'sha384':
      return bytesToHex(sha384(bytes));
    case 'sha512':
      return bytesToHex(sha512(bytes));
    case 'sha512-224':
      return bytesToHex(sha512_224(bytes));
    case 'sha512-256':
      return bytesToHex(sha512_256(bytes));
    case 'sha3-224':
      return bytesToHex(sha3_224(bytes));
    case 'sha3-256':
      return bytesToHex(sha3_256(bytes));
    case 'sha3-384':
      return bytesToHex(sha3_384(bytes));
    case 'sha3-512':
      return bytesToHex(sha3_512(bytes));
    case 'keccak-256':
      return bytesToHex(keccak_256(bytes));
    case 'blake2b-512':
      return bytesToHex(blake2b(bytes));
    case 'blake2s-256':
      return bytesToHex(blake2s(bytes));
    case 'blake3':
      return bytesToHex(blake3(bytes));
    case 'ripemd160':
      return bytesToHex(ripemd160(bytes));
    case 'crc32':
      return nodeCrc32(Buffer.from(bytes)).toString(16).padStart(8, '0');
  }
}

/**
 * A deterministic 300-byte pattern, long enough to span several blocks for
 * every algorithm here (MD5/SHA-1/SHA-2-256 use 64-byte blocks, SHA-2-512
 * uses 128-byte blocks, the SHA-3/Keccak family's rate is smaller still).
 * Not random: a fixed formula so a failure is reproducible without needing
 * to capture the failing input.
 */
const PATTERN = (() => {
  const bytes = new Uint8Array(300);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) & 0xff;
  return bytes;
})();

it('every selected algorithm matches its published digest for the empty input', () => {
  for (const info of ALGORITHMS) {
    expect(oneShotViaPackage(info.id, new Uint8Array(0)), info.id).toBe(EMPTY_VECTORS[info.id]);
  }
});

it('every selected algorithm matches its published digest for the abc input', () => {
  for (const info of ALGORITHMS) {
    expect(oneShotViaPackage(info.id, utf8ToBytes('abc')), info.id).toBe(ABC_VECTORS[info.id]);
  }
});

it('a stream split at an awkward boundary produces the same digest as one whole pass', () => {
  const oneByteChunks = Array<number>(PATTERN.length).fill(1);
  // 37 lands inside every algorithm's first block: it is not a multiple of
  // 64 (MD5/SHA-1/SHA-256), 128 (SHA-512), or any SHA-3/Keccak rate.
  const midBlockSplit = [37, PATTERN.length - 37];
  for (const info of ALGORITHMS) {
    const expected = libraryOneShotHex(info.id, PATTERN);
    expect(chunkedViaPackage(info.id, PATTERN, oneByteChunks), `${info.id}, one byte at a time`).toBe(expected);
    expect(chunkedViaPackage(info.id, PATTERN, midBlockSplit), `${info.id}, split at 37 bytes`).toBe(expected);
  }
});

it('the error-detecting checksum carries its accumulator across chunk boundaries', () => {
  const expected = nodeCrc32(Buffer.from(PATTERN)).toString(16).padStart(8, '0');
  const splits: number[][] = [
    Array<number>(PATTERN.length).fill(1),
    [37, PATTERN.length - 37],
    [1, 2, 3, 5, 8, 13, 21, PATTERN.length - (1 + 2 + 3 + 5 + 8 + 13 + 21)],
  ];
  for (const split of splits) {
    expect(chunkedViaPackage('crc32', PATTERN, split), JSON.stringify(split)).toBe(expected);
  }
  // The documented ISO-HDLC check value for "123456789" (hash-text's own
  // testNotes cites this exact value), split across an awkward boundary.
  const checkInput = utf8ToBytes('123456789');
  expect(chunkedViaPackage('crc32', checkInput, [4, 5])).toBe('cbf43926');
});

it('an expected checksum comparison ignores case and separators', () => {
  expect(digestsMatch('ABC123', 'abc123')).toBe(true);
  expect(digestsMatch('ab:c1 23', 'abc123')).toBe(true);
  expect(digestsMatch('ab_c1-23', 'ABC123')).toBe(true);
  expect(digestsMatch('abc123', 'abc124')).toBe(false);
  expect(digestsMatch('abc', 'abcd')).toBe(false);
});

it('a chunk size larger than the input is handled in a single pass', () => {
  const bytes = utf8ToBytes('abc');
  for (const info of ALGORITHMS) {
    const state = createHashers([info.id]);
    // Slicing past the end of a TypedArray in JavaScript just returns
    // everything available, so this is a single update call carrying a
    // "chunk" far larger than the whole input -- exactly what a caller
    // who overestimates its chunk size actually sends.
    updateHashers(state, bytes.slice(0, 1_000_000));
    const [result] = finishHashers(state, 'hex');
    expect(result!.digest, info.id).toBe(ABC_VECTORS[info.id]);
  }
});

describe('additional coverage', () => {
  it('advancing over an empty chunk changes nothing', () => {
    const withEmptyChunk = createHashers(['sha256']);
    updateHashers(withEmptyChunk, utf8ToBytes('a'));
    updateHashers(withEmptyChunk, new Uint8Array(0));
    updateHashers(withEmptyChunk, utf8ToBytes('bc'));
    const [withEmpty] = finishHashers(withEmptyChunk, 'hex');

    expect(withEmpty!.digest).toBe(ABC_VECTORS.sha256);
  });

  it('finishing without ever updating produces the digest of the empty input', () => {
    const state = createHashers(['md5', 'crc32']);
    const results = finishHashers(state, 'hex');
    expect(results.find((r) => r.algorithm === 'md5')!.digest).toBe(EMPTY_VECTORS.md5);
    expect(results.find((r) => r.algorithm === 'crc32')!.digest).toBe(EMPTY_VECTORS.crc32);
  });

  it('rejects finishing the same state twice, naming that it has already finished', () => {
    const state = createHashers(['sha256']);
    updateHashers(state, utf8ToBytes('abc'));
    finishHashers(state, 'hex');
    expect(() => finishHashers(state, 'hex')).toThrow(/already been finished/);
  });

  it('rejects updating a state after it has already finished', () => {
    const state = createHashers(['sha256']);
    finishHashers(state, 'hex');
    expect(() => updateHashers(state, utf8ToBytes('x'))).toThrow(/already been finished/);
  });

  it('rejects a request for an algorithm that is not in the list, naming it and listing what is available', () => {
    expect(() => createHashers(['not-a-real-algorithm' as Algorithm])).toThrow(HashFileError);
    try {
      createHashers(['not-a-real-algorithm' as Algorithm]);
      throw new Error('createHashers did not throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HashFileError);
      const message = (err as Error).message;
      expect(message).toContain('not-a-real-algorithm');
      for (const info of ALGORITHMS) expect(message).toContain(info.id);
    }
  });

  it('rejects creating a state with no algorithms at all', () => {
    expect(() => createHashers([])).toThrow(HashFileError);
  });

  it('offers every algorithm the text hash tool offers, with the same identifier, bit length and security classification', () => {
    // Independently transcribed from tools/hash-text/src/index.ts's own
    // ALGORITHMS array by hand, not derived by iterating this package's
    // own table -- a check that iterates the same table a tool is built
    // from proves consistency, not correctness.
    const expected: { id: Algorithm; bits: number; security: string }[] = [
      { id: 'md5', bits: 128, security: 'broken' },
      { id: 'sha1', bits: 160, security: 'broken' },
      { id: 'sha224', bits: 224, security: 'ok' },
      { id: 'sha256', bits: 256, security: 'ok' },
      { id: 'sha384', bits: 384, security: 'ok' },
      { id: 'sha512', bits: 512, security: 'ok' },
      { id: 'sha512-224', bits: 224, security: 'ok' },
      { id: 'sha512-256', bits: 256, security: 'ok' },
      { id: 'sha3-224', bits: 224, security: 'ok' },
      { id: 'sha3-256', bits: 256, security: 'ok' },
      { id: 'sha3-384', bits: 384, security: 'ok' },
      { id: 'sha3-512', bits: 512, security: 'ok' },
      { id: 'keccak-256', bits: 256, security: 'ok' },
      { id: 'blake2b-512', bits: 512, security: 'ok' },
      { id: 'blake2s-256', bits: 256, security: 'ok' },
      { id: 'blake3', bits: 256, security: 'ok' },
      { id: 'ripemd160', bits: 160, security: 'legacy' },
      { id: 'crc32', bits: 32, security: 'checksum' },
    ];
    expect(ALGORITHMS.map((a) => a.id)).toEqual(expected.map((e) => e.id));
    for (const e of expected) {
      const found = ALGORITHMS.find((a) => a.id === e.id)!;
      expect(found.bits, e.id).toBe(e.bits);
      expect(found.security, e.id).toBe(e.security);
    }
  });

  it("formats a digest identically to the text hash tool's own formatter for the same bytes", () => {
    const digest = sha256(utf8ToBytes('abc'));
    expect(formatDigest(digest, 'hex')).toBe(bytesToHex(digest));
    expect(formatDigest(digest, 'HEX')).toBe(bytesToHex(digest).toUpperCase());
    expect(formatDigest(digest, 'base64')).toBe(createHash('sha256').update('abc').digest('base64'));
    expect(formatDigest(digest, 'base64url')).toBe(createHash('sha256').update('abc').digest('base64url'));
  });
});

it('RFC 1321 appendix A.5, FIPS 180-4 and FIPS 202: the published digests of abc, fed in one byte at a time', () => {
  const state = createHashers(['md5', 'sha256', 'sha3-256']);
  for (const byte of utf8ToBytes('abc')) updateHashers(state, Uint8Array.of(byte));
  const byId = Object.fromEntries(finishHashers(state, 'hex').map((r) => [r.algorithm, r.digest]));
  expect(byId.md5).toBe('900150983cd24fb0d6963f7d28e17f72');
  expect(byId.sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(byId['sha3-256']).toBe('3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532');
});

describe('chunk size independence', () => {
  // 3000 bytes crosses BLAKE3's own 1024-byte chunk boundary twice, and is
  // long enough to also cross every other algorithm's own block size more
  // than once.
  const LONG_PATTERN = (() => {
    const bytes = new Uint8Array(3000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 61 + 7) & 0xff;
    return bytes;
  })();

  it('every algorithm gives the same digest at every tested chunk size', () => {
    const expectedByAlgorithm = new Map(ALGORITHMS.map((a) => [a.id, libraryOneShotHex(a.id, LONG_PATTERN)]));
    for (const chunkSize of [1, 63, 64, 65, 1023, 1024, 1025, 4096]) {
      const chunkSizes = Array.from({ length: Math.ceil(LONG_PATTERN.length / chunkSize) }, () => chunkSize);
      for (const info of ALGORITHMS) {
        expect(chunkedViaPackage(info.id, LONG_PATTERN, chunkSizes), `${info.id} at chunk size ${chunkSize}`).toBe(
          expectedByAlgorithm.get(info.id),
        );
      }
    }
  });
});
