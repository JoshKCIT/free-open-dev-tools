import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { computeHmac, hmacBytes, format, decodeBytes, timingSafeEqual, describeKey, ALGORITHMS } from '../src/index';

const hex = (s: string) => decodeBytes(s, 'hex');
const ascii = (s: string) => new TextEncoder().encode(s);

describe('RFC 4231 test vectors', () => {
  // The normative HMAC-SHA-2 vectors. Each case gives key, data and the
  // expected digest for SHA-224 through SHA-512.
  it('case 1: 20 byte key of 0x0b, data "Hi There"', () => {
    const key = hex('0b'.repeat(20));
    const data = ascii('Hi There');
    expect(format(hmacBytes(key, data, 'sha224'), 'hex')).toBe(
      '896fb1128abbdf196832107cd49df33f47b4b1169912ba4f53684b22',
    );
    expect(format(hmacBytes(key, data, 'sha256'), 'hex')).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    );
    expect(format(hmacBytes(key, data, 'sha384'), 'hex')).toBe(
      'afd03944d84895626b0825f4ab46907f15f9dadbe4101ec682aa034c7cebc59cfaea9ea9076ede7f4af152e8b2fa9cb6',
    );
    expect(format(hmacBytes(key, data, 'sha512'), 'hex')).toBe(
      '87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854',
    );
  });

  it('case 2: short key "Jefe", data "what do ya want for nothing?"', () => {
    const key = ascii('Jefe');
    const data = ascii('what do ya want for nothing?');
    expect(format(hmacBytes(key, data, 'sha256'), 'hex')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
    expect(format(hmacBytes(key, data, 'sha512'), 'hex')).toBe(
      '164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737',
    );
  });

  it('case 3: 20 byte key of 0xaa, 50 bytes of 0xdd', () => {
    const key = hex('aa'.repeat(20));
    const data = hex('dd'.repeat(50));
    expect(format(hmacBytes(key, data, 'sha256'), 'hex')).toBe(
      '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe',
    );
  });

  it('case 4: 25 byte key 0x0102…19, 50 bytes of 0xcd', () => {
    const key = hex('0102030405060708090a0b0c0d0e0f10111213141516171819');
    const data = hex('cd'.repeat(50));
    expect(format(hmacBytes(key, data, 'sha256'), 'hex')).toBe(
      '82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b',
    );
  });

  it('case 6: key longer than the block size is hashed first', () => {
    const key = hex('aa'.repeat(131));
    const data = ascii('Test Using Larger Than Block-Size Key - Hash Key First');
    expect(format(hmacBytes(key, data, 'sha256'), 'hex')).toBe(
      '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54',
    );
    expect(format(hmacBytes(key, data, 'sha512'), 'hex')).toBe(
      '80b24263c7c1a3ebb71493c1dd7be8b49b46d1f41b4aeec1121b013783f8f3526b56d037e05f2598bd0fd2215d6a1e5295e64f73f63f0aec8b915a985d786598',
    );
  });

  it('case 7: 131 byte key with a long message', () => {
    const key = hex('aa'.repeat(131));
    const data = ascii(
      'This is a test using a larger than block-size key and a larger than block-size data. The key needs to be hashed before being used by the HMAC algorithm.',
    );
    expect(format(hmacBytes(key, data, 'sha256'), 'hex')).toBe(
      '9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2',
    );
  });
});

describe('RFC 2202 test vectors for HMAC-MD5 and HMAC-SHA1', () => {
  it('HMAC-MD5 case 1', () => {
    expect(format(hmacBytes(hex('0b'.repeat(16)), ascii('Hi There'), 'md5'), 'hex')).toBe(
      '9294727a3638bb1c13f48ef8158bfc9d',
    );
  });

  it('HMAC-MD5 case 2', () => {
    expect(format(hmacBytes(ascii('Jefe'), ascii('what do ya want for nothing?'), 'md5'), 'hex')).toBe(
      '750c783e6ab0b503eaa86e310a5db738',
    );
  });

  it('HMAC-SHA1 case 1', () => {
    expect(format(hmacBytes(hex('0b'.repeat(20)), ascii('Hi There'), 'sha1'), 'hex')).toBe(
      'b617318655057264e28bc0b6fb378c8ef146be00',
    );
  });

  it('HMAC-SHA1 case 2', () => {
    expect(format(hmacBytes(ascii('Jefe'), ascii('what do ya want for nothing?'), 'sha1'), 'hex')).toBe(
      'effcdf6ae5eb2fa2d27416d5f184df9c259a7c79',
    );
  });
});

describe('agreement with Node crypto', () => {
  it('matches across random keys and messages', () => {
    let seed = 777;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const algos = ['md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512'] as const;
    for (let i = 0; i < 150; i++) {
      const keyLen = Math.floor(rand() * 200);
      const msgLen = Math.floor(rand() * 300);
      const key = new Uint8Array(keyLen);
      const msg = new Uint8Array(msgLen);
      for (let j = 0; j < keyLen; j++) key[j] = Math.floor(rand() * 256);
      for (let j = 0; j < msgLen; j++) msg[j] = Math.floor(rand() * 256);
      for (const a of algos) {
        expect(format(hmacBytes(key, msg, a), 'hex')).toBe(
          createHmac(a, Buffer.from(key)).update(Buffer.from(msg)).digest('hex'),
        );
      }
    }
  });

  it('handles an empty key and an empty message', () => {
    expect(format(hmacBytes(new Uint8Array(0), new Uint8Array(0), 'sha256'), 'hex')).toBe(
      createHmac('sha256', Buffer.alloc(0)).update(Buffer.alloc(0)).digest('hex'),
    );
  });
});

describe('encodings', () => {
  it('reads the key as UTF-8, hex or Base64 and gets the same digest', () => {
    const utf8 = computeHmac('secret', 'message', { keyEncoding: 'utf8' });
    const asHex = computeHmac('736563726574', 'message', { keyEncoding: 'hex' });
    const asB64 = computeHmac('c2VjcmV0', 'message', { keyEncoding: 'base64' });
    expect(asHex).toBe(utf8);
    expect(asB64).toBe(utf8);
  });

  it('a UTF-8 key with non-ASCII characters matches the byte reading', () => {
    expect(computeHmac('clé', 'data')).toBe(
      createHmac('sha256', Buffer.from('clé', 'utf8')).update('data').digest('hex'),
    );
  });

  it('formats output four ways', () => {
    const base = createHmac('sha256', 'k').update('m');
    expect(computeHmac('k', 'm', { output: 'hex' })).toBe(createHmac('sha256', 'k').update('m').digest('hex'));
    expect(computeHmac('k', 'm', { output: 'HEX' })).toBe(
      createHmac('sha256', 'k').update('m').digest('hex').toUpperCase(),
    );
    expect(computeHmac('k', 'm', { output: 'base64' })).toBe(base.digest('base64'));
    expect(computeHmac('k', 'm', { output: 'base64url' })).toBe(
      createHmac('sha256', 'k').update('m').digest('base64url'),
    );
  });
});

describe('verification helpers', () => {
  it('compares digests safely, ignoring case and separators', () => {
    const a = computeHmac('k', 'm');
    expect(timingSafeEqual(a, a.toUpperCase())).toBe(true);
    expect(timingSafeEqual(a, a.slice(0, -1) + '0')).toBe(false);
    expect(timingSafeEqual(a, a + 'ff')).toBe(false);
  });

  it('explains what happens to a key longer than the block size', () => {
    const report = describeKey(new Uint8Array(200), 'sha256');
    expect(report.blockSize).toBe(64);
    expect(report.hashedFirst).toBe(true);
    expect(report.shorterThanDigest).toBe(false);
  });

  it('flags a key shorter than the digest', () => {
    expect(describeKey(new Uint8Array(8), 'sha256').shorterThanDigest).toBe(true);
    expect(describeKey(new Uint8Array(32), 'sha256').shorterThanDigest).toBe(false);
  });

  it('describes every algorithm it offers', () => {
    for (const a of ALGORITHMS) {
      expect(format(hmacBytes(ascii('k'), ascii('m'), a.id), 'hex')).toHaveLength(a.outputBytes * 2);
    }
  });
});
