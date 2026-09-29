import { describe, it, expect } from 'vitest';
import * as nodeCrypto from 'node:crypto';
import { encryptRaw, decryptRaw, generateKey } from '../src/raw';
import { AesError } from '../src/codec';

function hex(s: string): Uint8Array {
  const clean = s.replace(/\s+/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function toHex(b: Uint8Array): string {
  return Buffer.from(b).toString('hex');
}

/** A small seeded PRNG (mulberry32) so differential-test failures reproduce. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomBytes(rng: () => number, n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(rng() * 256);
  return out;
}

// The four NIST SP 800-38A Appendix F plaintext blocks (64 bytes total),
// shared by the CBC and CTR key sizes and by both encrypt and decrypt
// directions. Kept as one literal (rather than split into four 32-hex-char
// chunks) because this exact 128-hex-character string is what was
// independently confirmed against Node's aes-128-cbc/aes-128-ctr before
// being pinned in this file; re-chunking it by eye is exactly the kind of
// transcription step that introduced (and then caught) an off-by-one-byte
// error during this session.
const NIST_PLAINTEXT = hex(
  '6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710',
);

describe('NIST SP 800-38A Appendix F.2 CBC-AES128, F.2.5 CBC (Node-confirmed key extension for AES-256)', () => {
  const iv = hex('000102030405060708090a0b0c0d0e0f');

  it('F.2.1 CBC-AES128.Encrypt / F.2.2 CBC-AES128.Decrypt', async () => {
    const key = hex('2b7e151628aed2a6abf7158809cf4f3c');
    const expectedCiphertext = hex(
      '7649abac8119b246cee98e9b12e9197d' +
        '5086cb9b507219ee95db113a917678b2' +
        '73bed6b8e3c1743b7116e69e22229516' +
        '3ff1caa1681fac09120eca307586e1a7',
    );
    const enc = await encryptRaw(NIST_PLAINTEXT, key, { mode: 'cbc', iv });
    // Web Crypto always PKCS#7-pads, so the ciphertext is the 64 NIST bytes
    // plus exactly one 16-byte padding block (independently confirmed
    // against Node's own aes-128-cbc with padding disabled, over just the
    // 64 NIST bytes: the first 64 bytes match byte for byte).
    expect(toHex(enc.ciphertext.slice(0, 64))).toBe(toHex(expectedCiphertext));
    expect(enc.ciphertext).toHaveLength(80);

    const dec = await decryptRaw(enc.ciphertext, key, { mode: 'cbc', iv });
    expect(toHex(dec.plaintext)).toBe(toHex(NIST_PLAINTEXT));
  });

  // F.2.5/F.2.6 use a 256-bit key. This session could not fetch a live,
  // character-verified copy of SP 800-38A to safely transcribe that key, so
  // rather than risk pinning a silently wrong "NIST" literal, AES-256 is
  // instead proven against Node's own aes-256-cbc (a mature, independent,
  // NIST SP 800-38A-compliant implementation, sanctioned as a differential
  // oracle by this project's own CONTRIBUTING.md) over the same genuinely
  // NIST-sourced plaintext and IV, with a plainly-labelled test key.
  it('AES-256-CBC over the NIST F.2 plaintext and IV, differential against Node aes-256-cbc', async () => {
    const key = new Uint8Array(32);
    for (let i = 0; i < 32; i++) key[i] = 0x10 + i; // 10 11 12 ... 2f
    const nodeCipher = nodeCrypto.createCipheriv('aes-256-cbc', Buffer.from(key), Buffer.from(iv));
    nodeCipher.setAutoPadding(false);
    const nodeCiphertext = new Uint8Array(
      Buffer.concat([nodeCipher.update(Buffer.from(NIST_PLAINTEXT)), nodeCipher.final()]),
    );

    const enc = await encryptRaw(NIST_PLAINTEXT, key, { mode: 'cbc', iv });
    expect(toHex(enc.ciphertext.slice(0, 64))).toBe(toHex(nodeCiphertext));

    const dec = await decryptRaw(enc.ciphertext, key, { mode: 'cbc', iv });
    expect(toHex(dec.plaintext)).toBe(toHex(NIST_PLAINTEXT));
  });
});

describe('NIST SP 800-38A Appendix F.5 CTR-AES128, plus AES-256 (Node-confirmed, see the CBC describe block above)', () => {
  const iv = hex('f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff');

  it('F.5.1 CTR-AES128.Encrypt / F.5.2 CTR-AES128.Decrypt', async () => {
    const key = hex('2b7e151628aed2a6abf7158809cf4f3c');
    const expected = hex(
      '874d6191b620e3261bef6864990db6ce' +
        '9806f66b7970fdff8617187bb9fffdff' +
        '5ae4df3edbd5d35e5b4f09020db03eab' +
        '1e031dda2fbe03d1792170a0f3009cee',
    );
    const enc = await encryptRaw(NIST_PLAINTEXT, key, { mode: 'ctr', iv });
    expect(toHex(enc.ciphertext)).toBe(toHex(expected));
    const dec = await decryptRaw(enc.ciphertext, key, { mode: 'ctr', iv });
    expect(toHex(dec.plaintext)).toBe(toHex(NIST_PLAINTEXT));
  });

  it('AES-256-CTR over the NIST F.5 plaintext and IV, differential against Node aes-256-ctr', async () => {
    const key = new Uint8Array(32);
    for (let i = 0; i < 32; i++) key[i] = 0x10 + i;
    const nodeCipher = nodeCrypto.createCipheriv('aes-256-ctr', Buffer.from(key), Buffer.from(iv));
    const nodeCiphertext = new Uint8Array(
      Buffer.concat([nodeCipher.update(Buffer.from(NIST_PLAINTEXT)), nodeCipher.final()]),
    );

    const enc = await encryptRaw(NIST_PLAINTEXT, key, { mode: 'ctr', iv });
    expect(toHex(enc.ciphertext)).toBe(toHex(nodeCiphertext));
    const dec = await decryptRaw(enc.ciphertext, key, { mode: 'ctr', iv });
    expect(toHex(dec.plaintext)).toBe(toHex(NIST_PLAINTEXT));
  });
});

describe('GCM specification (McGrew-Viega) Appendix B test vectors, AES-128', () => {
  it('all-zero 128-bit key, empty plaintext, empty AAD', async () => {
    const key = new Uint8Array(16);
    const iv = new Uint8Array(12);
    const enc = await encryptRaw(new Uint8Array(0), key, { mode: 'gcm', iv });
    expect(toHex(enc.tag!)).toBe('58e2fccefa7e3061367f1d57a4e7455a');
    const dec = await decryptRaw(enc.combined, key, { mode: 'gcm', ivPrepended: true });
    expect(dec.plaintext).toHaveLength(0);
  });

  it('all-zero 128-bit key, 16 zero plaintext bytes, empty AAD', async () => {
    const key = new Uint8Array(16);
    const iv = new Uint8Array(12);
    const plaintext = new Uint8Array(16);
    const enc = await encryptRaw(plaintext, key, { mode: 'gcm', iv });
    expect(toHex(enc.ciphertext)).toBe('0388dace60b6a392f328c2b971b2fe78');
    expect(toHex(enc.tag!)).toBe('ab6e47d42cec13bdf53a67b21257bddf');
    const dec = await decryptRaw(enc.combined, key, { mode: 'gcm', ivPrepended: true });
    expect(toHex(dec.plaintext)).toBe(toHex(plaintext));
  });

  const K128 = hex('feffe9928665731c6d6a8f9467308308');
  const IV96 = hex('cafebabefacedbaddecaf888');
  // The realistic 60-byte plaintext shared by the "no AAD" and "with AAD"
  // GCM spec test cases; the ciphertext (which depends only on K/P/IV, not
  // AAD) is identical between them and matches both this key/IV pair and
  // Node's own aes-128-gcm byte for byte.
  const REALISTIC_P = hex(
    'd9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b39',
  );
  const REALISTIC_CT =
    '42831ec2217774244b7221b784d0d49ce3aa212f2c02a4e035c17e2329aca12e21d514b25466931c7d8f6a5aac84aa051ba30b396a0aac973d58e091';

  it('128-bit key, 60-byte realistic plaintext, empty AAD', async () => {
    const enc = await encryptRaw(REALISTIC_P, K128, { mode: 'gcm', iv: IV96 });
    expect(toHex(enc.ciphertext)).toBe(REALISTIC_CT);
    // Independently confirmed against Node's own aes-128-gcm before being
    // pinned here (this session could not verify the tag against a live
    // copy of the spec text with full confidence).
    expect(toHex(enc.tag!)).toBe('cc15abcc191161501aabab46b8fbac85');
    const dec = await decryptRaw(enc.combined, K128, { mode: 'gcm', ivPrepended: true });
    expect(toHex(dec.plaintext)).toBe(toHex(REALISTIC_P));
  });

  it('128-bit key, 60-byte realistic plaintext, with additional authenticated data', async () => {
    const aad = hex('feedfacedeadbeeffeedfacedeadbeefabaddad2');
    const enc = await encryptRaw(REALISTIC_P, K128, { mode: 'gcm', iv: IV96, aad });
    expect(toHex(enc.ciphertext)).toBe(REALISTIC_CT);
    expect(toHex(enc.tag!)).toBe('5bc94fbc3221a5db94fae95ae7121a47');
    const dec = await decryptRaw(enc.combined, K128, { mode: 'gcm', ivPrepended: true, aad });
    expect(toHex(dec.plaintext)).toBe(toHex(REALISTIC_P));
  });
});

describe('GCM, AES-256 (extended from the same GCM spec plaintext/IV/AAD; see the CBC describe block for why the key is Node-confirmed rather than cited verbatim)', () => {
  const K256 = (() => {
    const k = new Uint8Array(32);
    for (let i = 0; i < 32; i++) k[i] = 0x10 + i;
    return k;
  })();
  const IV96 = hex('cafebabefacedbaddecaf888');
  const REALISTIC_P = hex(
    'd9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b39',
  );
  const AAD = hex('feedfacedeadbeeffeedfacedeadbeefabaddad2');

  it('empty plaintext, empty AAD', async () => {
    const iv = new Uint8Array(12);
    const enc = await encryptRaw(new Uint8Array(0), K256, { mode: 'gcm', iv });
    const nodeCipher = nodeCrypto.createCipheriv('aes-256-gcm', Buffer.from(K256), Buffer.from(iv));
    nodeCipher.final();
    expect(toHex(enc.tag!)).toBe(nodeCipher.getAuthTag().toString('hex'));
  });

  it('60-byte realistic plaintext, no AAD, differential against Node aes-256-gcm', async () => {
    const nodeCipher = nodeCrypto.createCipheriv('aes-256-gcm', Buffer.from(K256), Buffer.from(IV96));
    const nodeCt = Buffer.concat([nodeCipher.update(Buffer.from(REALISTIC_P)), nodeCipher.final()]);
    const nodeTag = nodeCipher.getAuthTag();

    const enc = await encryptRaw(REALISTIC_P, K256, { mode: 'gcm', iv: IV96 });
    expect(toHex(enc.ciphertext)).toBe(nodeCt.toString('hex'));
    expect(toHex(enc.tag!)).toBe(nodeTag.toString('hex'));
    const dec = await decryptRaw(enc.combined, K256, { mode: 'gcm', ivPrepended: true });
    expect(toHex(dec.plaintext)).toBe(toHex(REALISTIC_P));
  });

  it('60-byte realistic plaintext, with AAD, differential against Node aes-256-gcm', async () => {
    const nodeCipher = nodeCrypto.createCipheriv('aes-256-gcm', Buffer.from(K256), Buffer.from(IV96));
    nodeCipher.setAAD(Buffer.from(AAD));
    const nodeCt = Buffer.concat([nodeCipher.update(Buffer.from(REALISTIC_P)), nodeCipher.final()]);
    const nodeTag = nodeCipher.getAuthTag();

    const enc = await encryptRaw(REALISTIC_P, K256, { mode: 'gcm', iv: IV96, aad: AAD });
    expect(toHex(enc.ciphertext)).toBe(nodeCt.toString('hex'));
    expect(toHex(enc.tag!)).toBe(nodeTag.toString('hex'));
    const dec = await decryptRaw(enc.combined, K256, { mode: 'gcm', ivPrepended: true, aad: AAD });
    expect(toHex(dec.plaintext)).toBe(toHex(REALISTIC_P));
  });
});

describe('CTR counter wrap (full 128-bit counter)', () => {
  it('IV of all 0xff, 48 bytes of plaintext, matches Node aes-128-ctr', async () => {
    const key = hex('000102030405060708090a0b0c0d0e0f');
    const iv = new Uint8Array(16).fill(0xff);
    const plaintext = new Uint8Array(48);
    for (let i = 0; i < 48; i++) plaintext[i] = i;

    const enc = await encryptRaw(plaintext, key, { mode: 'ctr', iv });

    const nodeCipher = nodeCrypto.createCipheriv('aes-128-ctr', Buffer.from(key), Buffer.from(iv));
    const nodeCiphertext = Buffer.concat([nodeCipher.update(Buffer.from(plaintext)), nodeCipher.final()]);
    expect(toHex(enc.ciphertext)).toBe(nodeCiphertext.toString('hex'));
  });
});

describe('Node crypto differential', () => {
  const rng = mulberry32(305419896);
  const lengths = [0, 1, 15, 16, 17, 31, 32, 33, 100];

  it('encryptRaw output decrypts with Node, for every mode, key size and length (~30 cases)', async () => {
    let cases = 0;
    for (const keyBytes of [16, 32] as const) {
      for (const mode of ['gcm', 'cbc', 'ctr'] as const) {
        for (const len of lengths) {
          cases++;
          const key = randomBytes(rng, keyBytes);
          const iv = randomBytes(rng, mode === 'gcm' ? 12 : 16);
          const plaintext = randomBytes(rng, len);
          const enc = await encryptRaw(plaintext, key, { mode, iv });

          if (mode === 'gcm') {
            const nodeDecipher = nodeCrypto.createDecipheriv(
              keyBytes === 16 ? 'aes-128-gcm' : 'aes-256-gcm',
              Buffer.from(key),
              Buffer.from(iv),
            );
            nodeDecipher.setAuthTag(Buffer.from(enc.tag!));
            const nodePlain = Buffer.concat([nodeDecipher.update(Buffer.from(enc.ciphertext)), nodeDecipher.final()]);
            expect(toHex(new Uint8Array(nodePlain))).toBe(toHex(plaintext));
          } else if (mode === 'cbc') {
            const nodeDecipher = nodeCrypto.createDecipheriv(
              keyBytes === 16 ? 'aes-128-cbc' : 'aes-256-cbc',
              Buffer.from(key),
              Buffer.from(iv),
            );
            const nodePlain = Buffer.concat([nodeDecipher.update(Buffer.from(enc.ciphertext)), nodeDecipher.final()]);
            expect(toHex(new Uint8Array(nodePlain))).toBe(toHex(plaintext));
          } else {
            const nodeDecipher = nodeCrypto.createDecipheriv(
              keyBytes === 16 ? 'aes-128-ctr' : 'aes-256-ctr',
              Buffer.from(key),
              Buffer.from(iv),
            );
            const nodePlain = Buffer.concat([nodeDecipher.update(Buffer.from(enc.ciphertext)), nodeDecipher.final()]);
            expect(toHex(new Uint8Array(nodePlain))).toBe(toHex(plaintext));
          }
        }
      }
    }
    expect(cases).toBeGreaterThanOrEqual(30);
  });

  it("Node's own ciphertext decrypts with decryptRaw, for every mode and key size (~18 cases)", async () => {
    for (const keyBytes of [16, 32] as const) {
      for (const mode of ['gcm', 'cbc', 'ctr'] as const) {
        for (const len of [0, 16, 33]) {
          const key = randomBytes(rng, keyBytes);
          const iv = randomBytes(rng, mode === 'gcm' ? 12 : 16);
          const plaintext = randomBytes(rng, len);

          if (mode === 'gcm') {
            const nodeCipher = nodeCrypto.createCipheriv(
              keyBytes === 16 ? 'aes-128-gcm' : 'aes-256-gcm',
              Buffer.from(key),
              Buffer.from(iv),
            );
            const ciphertext = Buffer.concat([nodeCipher.update(Buffer.from(plaintext)), nodeCipher.final()]);
            const tag = nodeCipher.getAuthTag();
            const dec = await decryptRaw(new Uint8Array(ciphertext), key, { mode, iv, tag: new Uint8Array(tag) });
            expect(toHex(dec.plaintext)).toBe(toHex(plaintext));
          } else if (mode === 'cbc') {
            const nodeCipher = nodeCrypto.createCipheriv(
              keyBytes === 16 ? 'aes-128-cbc' : 'aes-256-cbc',
              Buffer.from(key),
              Buffer.from(iv),
            );
            const ciphertext = Buffer.concat([nodeCipher.update(Buffer.from(plaintext)), nodeCipher.final()]);
            const dec = await decryptRaw(new Uint8Array(ciphertext), key, { mode, iv });
            expect(toHex(dec.plaintext)).toBe(toHex(plaintext));
          } else {
            const nodeCipher = nodeCrypto.createCipheriv(
              keyBytes === 16 ? 'aes-128-ctr' : 'aes-256-ctr',
              Buffer.from(key),
              Buffer.from(iv),
            );
            const ciphertext = Buffer.concat([nodeCipher.update(Buffer.from(plaintext)), nodeCipher.final()]);
            const dec = await decryptRaw(new Uint8Array(ciphertext), key, { mode, iv });
            expect(toHex(dec.plaintext)).toBe(toHex(plaintext));
          }
        }
      }
    }
  });
});

describe('generateKey', () => {
  it('produces the requested number of bytes and is not all zero (probabilistically) or repeated', () => {
    const k128 = generateKey(128);
    const k256 = generateKey(256);
    expect(k128).toHaveLength(16);
    expect(k256).toHaveLength(32);
    expect(k128.some((b) => b !== 0)).toBe(true);
    expect(generateKey(128)).not.toEqual(generateKey(128));
  });
});

describe('errors', () => {
  const key16 = new Uint8Array(16);
  const key24 = new Uint8Array(24);
  const key20 = new Uint8Array(20);
  const iv12 = new Uint8Array(12);
  const iv16 = new Uint8Array(16);

  it('a 24-byte key gives the AES-192 message', async () => {
    await expect(encryptRaw(new Uint8Array([1]), key24, { mode: 'gcm', iv: iv12 })).rejects.toThrow(/AES-192/);
  });

  it('a 20-byte key gives the length message naming 20', async () => {
    await expect(encryptRaw(new Uint8Array([1]), key20, { mode: 'gcm', iv: iv12 })).rejects.toThrow(/20 bytes/);
  });

  it('raw decrypt with no IV and ivPrepended false gives the IV message', async () => {
    await expect(decryptRaw(new Uint8Array(16), key16, { mode: 'gcm' })).rejects.toThrow(/needs the IV/);
  });

  it('CBC ciphertext of 17 bytes gives the block message', async () => {
    await expect(decryptRaw(new Uint8Array(17), key16, { mode: 'cbc', iv: iv16 })).rejects.toThrow(/16-byte blocks/);
  });

  it('tampered GCM tag (last byte flipped) gives the GCM message', async () => {
    const enc = await encryptRaw(new TextEncoder().encode('hello world'), key16, { mode: 'gcm', iv: iv12 });
    const tampered = enc.tag!.slice();
    const lastIndex = tampered.length - 1;
    tampered[lastIndex] = (tampered[lastIndex] ?? 0) ^ 0xff;
    await expect(decryptRaw(enc.ciphertext, key16, { mode: 'gcm', iv: iv12, tag: tampered })).rejects.toMatchObject({
      message: expect.stringContaining('wrong key, wrong IV, wrong additional data'),
    });
  });

  it('tampered GCM ciphertext gives the GCM message', async () => {
    const enc = await encryptRaw(new TextEncoder().encode('hello world'), key16, { mode: 'gcm', iv: iv12 });
    const tampered = enc.ciphertext.slice();
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    await expect(decryptRaw(tampered, key16, { mode: 'gcm', iv: iv12, tag: enc.tag })).rejects.toThrow(AesError);
  });

  it('NIST CBC ciphertext without its padding block gives the CBC padding message', async () => {
    const key = hex('2b7e151628aed2a6abf7158809cf4f3c');
    const iv = hex('000102030405060708090a0b0c0d0e0f');
    // The real NIST ciphertext for the first block, with no PKCS#7 padding
    // block appended: a valid block length, but Web Crypto's own unpadding
    // will reject it.
    const nistCiphertext = hex('7649abac8119b246cee98e9b12e9197d');
    await expect(decryptRaw(nistCiphertext, key, { mode: 'cbc', iv })).rejects.toThrow(
      /wrong key, wrong IV, or damaged data/,
    );
  });

  it('GCM separate tag not 16 bytes is refused', async () => {
    await expect(
      decryptRaw(new Uint8Array(8), key16, { mode: 'gcm', iv: iv12, tag: new Uint8Array(8) }),
    ).rejects.toThrow(/must be exactly 16 bytes/);
  });

  it('a CBC/CTR IV that is not 16 bytes is refused on encrypt', async () => {
    await expect(encryptRaw(new Uint8Array(1), key16, { mode: 'cbc', iv: new Uint8Array(8) })).rejects.toThrow(
      /exactly 16 bytes/,
    );
  });
});

describe('secret contract', () => {
  it('every CTR decrypt warns that a wrong key gives wrong bytes, not an error (raw mode)', async () => {
    const key16 = new Uint8Array(16);
    const iv16 = new Uint8Array(16);
    const enc = await encryptRaw(new TextEncoder().encode('hello'), key16, { mode: 'ctr', iv: iv16 });
    const dec = await decryptRaw(enc.ciphertext, key16, { mode: 'ctr', iv: iv16 });
    expect(dec.warnings.some((w) => /no integrity check/.test(w))).toBe(true);
  });

  it('warns on GCM encrypt when the IV was visitor-supplied (never reuse)', async () => {
    const key16 = new Uint8Array(16);
    const enc = await encryptRaw(new TextEncoder().encode('hello'), key16, { mode: 'gcm', iv: new Uint8Array(12) });
    expect(enc.warnings.some((w) => /[Nn]ever reuse an IV/.test(w))).toBe(true);
  });

  it('round trip: empty plaintext, astral UTF-8, and 1 MiB, for every mode', async () => {
    const key16 = new Uint8Array(16);
    const cases = [new Uint8Array(0), new TextEncoder().encode('hello 𝄞 world'), new Uint8Array(1024 * 1024).fill(7)];
    for (const mode of ['gcm', 'cbc', 'ctr'] as const) {
      for (const plaintext of cases) {
        const iv = new Uint8Array(mode === 'gcm' ? 12 : 16);
        const enc = await encryptRaw(plaintext, key16, { mode, iv });
        const dec = await decryptRaw(enc.combined, key16, { mode, ivPrepended: true });
        expect(toHex(dec.plaintext)).toBe(toHex(plaintext));
      }
    }
  });
});
