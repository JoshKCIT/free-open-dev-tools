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

  it('SHA-512/224 of "abc" (FIPS 180-4 section 5.3.6.2 initial value, NIST CSRC example)', () => {
    expect(hashText('abc', 'sha512-224')).toBe('4634270f707b6a54daae7530460842e20e37ed265ceee9a43e8924aa');
  });

  it('SHA-512/256 of "abc" (FIPS 180-4 section 5.3.6.2 initial value, NIST CSRC example)', () => {
    expect(hashText('abc', 'sha512-256')).toBe('53048e2681941ef99b2e29b76b4c7dabe4c2d0c634fc6d46e0e2f13107e7af23');
  });

  it('SHA-512/224 and SHA-512/256 are not truncated SHA-224/SHA-256', () => {
    expect(hashText('abc', 'sha512-224')).not.toBe(hashText('abc', 'sha224').slice(0, 56));
    expect(hashText('abc', 'sha512-256')).not.toBe(hashText('abc', 'sha256'));
  });
});

describe('FIPS 202 — SHA-3 and Keccak', () => {
  it('SHA3-224 of the empty string and of "abc"', () => {
    expect(hashText('', 'sha3-224')).toBe('6b4e03423667dbb73b6e15454f0eb1abd4597f9a1b078e3f5b5a6bc7');
    expect(hashText('abc', 'sha3-224')).toBe('e642824c3f8cf24ad09234ee7d3c766fc9a3a5168d0c94ad73b46fdf');
  });

  it('SHA3-256 of the empty string', () => {
    expect(hashText('', 'sha3-256')).toBe('a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a');
  });

  it('SHA3-384 of the empty string and of "abc"', () => {
    expect(hashText('', 'sha3-384')).toBe(
      '0c63a75b845e4f7d01107d852e4c2485c51a50aaaa94fc61995e71bbee983a2ac3713831264adb47fb6bd1e058d5f004',
    );
    expect(hashText('abc', 'sha3-384')).toBe(
      'ec01498288516fc926459f58e2c6ad8df9b473cb0fc08c2596da7cf0e49be4b298d88cea927ac7f539f1edf228376d25',
    );
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

describe('RFC 7693 Appendix A and B: BLAKE2b-512 and BLAKE2s-256', () => {
  it('BLAKE2b-512 of "abc" (Appendix A)', () => {
    expect(hashText('abc', 'blake2b-512')).toBe(
      'ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923',
    );
  });

  it('BLAKE2s-256 of "abc" (Appendix B)', () => {
    expect(hashText('abc', 'blake2s-256')).toBe('508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982');
  });
});

describe('BLAKE3 official test vectors (test_vectors.json)', () => {
  // input byte i = i % 251, per the BLAKE3 repository's own
  // test_vectors/test_vectors.json generation rule. Only the first 32
  // bytes (64 hex characters) of the "hash" field are asserted, since this
  // tool only offers the default 256-bit output.
  function inputOfLength(len: number): Uint8Array {
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = i % 251;
    return bytes;
  }

  const cases: [number, string][] = [
    [0, 'af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262'],
    [1, '2d3adedff11b61f14c886e35afa036736dcd87a74d27b5c1510225d0f592e213'],
    [1023, '10108970eeda3eb932baac1428c7a2163b0e924c9a9e25b35bba72b28f70bd11'],
    [1024, '42214739f095a406f3fc83deb889744ac00df831c10daa55189b5d121c855af7'],
    [1025, 'd00278ae47eb27b34faecf67b4fe263f82d5412916c1ffd97c8cb7fb814b8444'],
  ];

  for (const [len, expected] of cases) {
    it(`input length ${len}`, () => {
      expect(format(hashBytes(inputOfLength(len), 'blake3'), 'hex')).toBe(expected);
    });
  }

  it('produces a 32-byte (256-bit) digest', () => {
    expect(hashBytes(new Uint8Array(0), 'blake3')).toHaveLength(32);
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
    ['sha512-224', 'sha512-224'],
    ['sha512-256', 'sha512-256'],
    ['sha3-224', 'sha3-224'],
    ['sha3-256', 'sha3-256'],
    ['sha3-384', 'sha3-384'],
    ['sha3-512', 'sha3-512'],
    ['ripemd160', 'ripemd160'],
    ['blake2b-512', 'blake2b512'],
    ['blake2s-256', 'blake2s256'],
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
    // SHA-256 blocks are 64 bytes, SHA-512 blocks are 128, SHA3-384's rate
    // is 104 bytes and SHA3-224's rate is 144 bytes.
    for (const len of [
      0, 1, 55, 56, 57, 63, 64, 65, 103, 104, 105, 111, 112, 113, 127, 128, 129, 143, 144, 145, 255, 256,
    ]) {
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

  it("every algorithm's declared bit length equals 8 times the byte length it actually returns", () => {
    for (const info of ALGORITHMS) {
      expect(hashBytes(new TextEncoder().encode('abc'), info.id), info.id).toHaveLength(info.bits / 8);
    }
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
