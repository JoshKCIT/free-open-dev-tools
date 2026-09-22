import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { hashText, hashBytes, hashAll, crc32, format, decodeInput, digestsMatch, ALGORITHMS } from '../src/index';

describe('RFC 1321 appendix A.5 — MD5 test suite', () => {
  // These are the normative MD5 vectors, reproduced from the RFC.
  const vectors: [string, string][] = [
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['a', '0cc175b9c0f1b6a831c399e269772661'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
    ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
    ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 'd174ab98d277d9f5a5611c2c9f419d9f'],
    ['1234567890'.repeat(8), '57edf4a22be3c955ac49da2e2107b67a'],
  ];
  for (const [input, expected] of vectors) {
    it(`MD5(${JSON.stringify(input.slice(0, 24))}${input.length > 24 ? '…' : ''})`, () => {
      expect(hashText(input, 'md5')).toBe(expected);
    });
  }
});

describe('FIPS 180-4 — SHA-1 and SHA-2 sample vectors', () => {
  it('SHA-1 of "abc"', () => {
    expect(hashText('abc', 'sha1')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
  });

  it('SHA-1 of the empty string', () => {
    expect(hashText('', 'sha1')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
  });

  it('SHA-224 of "abc"', () => {
    expect(hashText('abc', 'sha224')).toBe('23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7');
  });

  it('SHA-256 of "abc"', () => {
    expect(hashText('abc', 'sha256')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('SHA-256 of the empty string', () => {
    expect(hashText('', 'sha256')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('SHA-384 of "abc"', () => {
    expect(hashText('abc', 'sha384')).toBe(
      'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7',
    );
  });

  it('SHA-512 of "abc"', () => {
    expect(hashText('abc', 'sha512')).toBe(
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    );
  });

  it('SHA-512 of the 112 character multi-block vector', () => {
    const input =
      'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu';
    expect(hashText(input, 'sha512')).toBe(
      '8e959b75dae313da8cf4f72814fc143f8f7779c6eb9f7fa17299aeadb6889018501d289e4900f7e4331b99dec4b5433ac7d329eeb6dd26545e96e55b874be909',
    );
  });
});

describe('FIPS 202 — SHA-3 and Keccak', () => {
  it('SHA3-256 of the empty string', () => {
    expect(hashText('', 'sha3-256')).toBe('a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a');
  });

  it('SHA3-512 of the empty string', () => {
    expect(hashText('', 'sha3-512')).toBe(
      'a69f73cca23a9ac5c8b567dc185a756e97c982164fe25859e0d1dcc1475c80a615b2123af1f5f94c11e3e9402c3ac558f500199d95b6d3e301758586281dcd26',
    );
  });

  it('Keccak-256 differs from SHA3-256 because the padding differs', () => {
    // This trips people up constantly: Ethereum's "sha3" is original Keccak.
    expect(hashText('', 'keccak-256')).toBe('c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
    expect(hashText('', 'keccak-256')).not.toBe(hashText('', 'sha3-256'));
  });
});

describe('RIPEMD-160', () => {
  it('matches the reference vector for "abc"', () => {
    expect(hashText('abc', 'ripemd160')).toBe('8eb208f7e05d987a9b044a8e98c6b087f15a0bfc');
  });

  it('matches the reference vector for the empty string', () => {
    expect(hashText('', 'ripemd160')).toBe('9c1185a5c5e9fc54612808977ee8f548b2258d31');
  });
});

describe('CRC-32', () => {
  it('matches the standard check value for "123456789"', () => {
    // 0xCBF43926 is the documented check value for CRC-32/ISO-HDLC.
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(hashText('123456789', 'crc32')).toBe('cbf43926');
  });

  it('is zero for empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('agrees with Node zlib for random buffers', async () => {
    const { crc32: nodeCrc } = await import('node:zlib');
    if (typeof nodeCrc !== 'function') return; // older Node without zlib.crc32
    let seed = 99;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 100; i++) {
      const len = Math.floor(rand() * 200);
      const buf = new Uint8Array(len);
      for (let j = 0; j < len; j++) buf[j] = Math.floor(rand() * 256);
      expect(crc32(buf)).toBe(nodeCrc(Buffer.from(buf)));
    }
  });
});

describe('agreement with the Node crypto module', () => {
  // A second independent implementation. The published vectors above are the
  // real oracle; this catches anything they do not reach.
  const pairs: [string, string][] = [
    ['md5', 'md5'],
    ['sha1', 'sha1'],
    ['sha256', 'sha256'],
    ['sha384', 'sha384'],
    ['sha512', 'sha512'],
    ['sha3-256', 'sha3-256'],
    ['sha3-512', 'sha3-512'],
    ['ripemd160', 'ripemd160'],
  ];

  it('matches across 200 random inputs of varying length', () => {
    let seed = 4242;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 200; i++) {
      const len = Math.floor(rand() * 300);
      const buf = new Uint8Array(len);
      for (let j = 0; j < len; j++) buf[j] = Math.floor(rand() * 256);
      for (const [ours, theirs] of pairs) {
        const expected = createHash(theirs).update(Buffer.from(buf)).digest('hex');
        expect(format(hashBytes(buf, ours as never), 'hex')).toBe(expected);
      }
    }
  });

  it('matches at every block boundary, where padding bugs live', () => {
    // SHA-256 blocks are 64 bytes, SHA-512 blocks are 128.
    for (const len of [0, 1, 55, 56, 57, 63, 64, 65, 111, 112, 113, 127, 128, 129, 255, 256]) {
      const buf = new Uint8Array(len).fill(0x61);
      for (const [ours, theirs] of pairs) {
        expect(format(hashBytes(buf, ours as never), 'hex')).toBe(
          createHash(theirs).update(Buffer.from(buf)).digest('hex'),
        );
      }
    }
  });
});

describe('encodings', () => {
  it('hashes text as UTF-8', () => {
    // Two UTF-8 bytes for é, so this differs from a Latin-1 reading.
    expect(hashText('é', 'sha256')).toBe(createHash('sha256').update('é', 'utf8').digest('hex'));
  });

  it('handles astral plane characters', () => {
    expect(hashText('👋🏽', 'sha256')).toBe(createHash('sha256').update('👋🏽', 'utf8').digest('hex'));
  });

  it('formats a digest as uppercase hex, base64 and base64url', () => {
    const digest = hashBytes(new TextEncoder().encode('abc'), 'sha256');
    expect(format(digest, 'HEX')).toBe(format(digest, 'hex').toUpperCase());
    expect(format(digest, 'base64')).toBe(createHash('sha256').update('abc').digest('base64'));
    expect(format(digest, 'base64url')).toBe(createHash('sha256').update('abc').digest('base64url'));
  });

  it('accepts hex input with common separators', () => {
    expect(decodeInput('61 62 63', 'hex')).toEqual(new Uint8Array([97, 98, 99]));
    expect(decodeInput('61:62:63', 'hex')).toEqual(new Uint8Array([97, 98, 99]));
    expect(decodeInput('616263', 'hex')).toEqual(new Uint8Array([97, 98, 99]));
  });

  it('rejects malformed hex input', () => {
    expect(() => decodeInput('abc', 'hex')).toThrow(/even number/);
    expect(() => decodeInput('zz', 'hex')).toThrow(/not a hex digit/);
  });

  it('accepts base64 input with or without padding', () => {
    expect(decodeInput('YWJj', 'base64')).toEqual(new Uint8Array([97, 98, 99]));
    expect(decodeInput('YWJ', 'base64')).toEqual(new Uint8Array([97, 98]));
  });
});

describe('hashAll and comparison', () => {
  it('returns one result per algorithm, in a stable order', () => {
    const results = hashAll(new TextEncoder().encode('abc'));
    expect(results).toHaveLength(ALGORITHMS.length);
    expect(results.map((r) => r.algorithm)).toEqual(ALGORITHMS.map((a) => a.id));
  });

  it('labels MD5 and SHA-1 as broken', () => {
    const results = hashAll(new Uint8Array(0));
    expect(results.find((r) => r.algorithm === 'md5')!.security).toBe('broken');
    expect(results.find((r) => r.algorithm === 'sha1')!.security).toBe('broken');
    expect(results.find((r) => r.algorithm === 'crc32')!.security).toBe('checksum');
  });

  it('compares digests ignoring case and separators', () => {
    expect(digestsMatch('ABC123', 'abc123')).toBe(true);
    expect(digestsMatch('ab:c1 23', 'abc123')).toBe(true);
    expect(digestsMatch('abc123', 'abc124')).toBe(false);
    expect(digestsMatch('abc', 'abcd')).toBe(false);
  });
});

describe('large input', () => {
  it('hashes a megabyte without trouble', () => {
    const big = new Uint8Array(1024 * 1024).fill(0x5a);
    expect(format(hashBytes(big, 'sha256'), 'hex')).toBe(createHash('sha256').update(Buffer.from(big)).digest('hex'));
  });
});
