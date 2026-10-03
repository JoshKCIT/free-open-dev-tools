import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { md4, ntlm } from '../src/index';
import { MD4_OPENSSL_DIGESTS, MD4_OPENSSL_SEED } from './fixtures/md4-openssl';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const utf8 = (text: string) => new TextEncoder().encode(text);

let spies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
});
afterEach(() => {
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

/** The same seeded generator the recording script uses (mulberry32), so the inputs are the ones OpenSSL hashed. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

it('RFC 1320 test suite values reproduce and MD4 equals the recorded OpenSSL values', () => {
  // RFC 1320 appendix A.5, "MD4 test suite", copied from https://www.rfc-editor.org/rfc/rfc1320 (fetched 2026-10-03).
  const suite: [string, string][] = [
    ['', '31d6cfe0d16ae931b73c59d7e0c089c0'],
    ['a', 'bde52cb31de33e46245e05fbdbd6fb24'],
    ['abc', 'a448017aaf21d8525fc10ae87aa6729d'],
    ['message digest', 'd9130a8164549fe818874806e1c7014b'],
    ['abcdefghijklmnopqrstuvwxyz', 'd79e1c308aa5bbcdeea8ed63df412da9'],
    ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', '043f8582f241db351ce627e153e7f0e4'],
    ['1234567890'.repeat(8), 'e33b4ddc9c38f2199c3e7b164fcc0536'],
  ];
  expect(suite).toHaveLength(7);
  for (const [text, expected] of suite) {
    expect(hex(md4(utf8(text))), JSON.stringify(text)).toBe(expected);
  }

  // 200 inputs of 0 to 600 bytes (every length from 0 to 140, so each padding boundary, then 59 longer ones), hashed by
  // OpenSSL 3.5.5 through its legacy provider and recorded in test/fixtures/md4-openssl.ts by make-fixtures.mjs. Node's
  // own crypto module offers no MD4 under OpenSSL 3 (on Node 22.14 and 22.23.3), so it cannot be the second opinion here.
  expect(MD4_OPENSSL_DIGESTS).toHaveLength(200);
  const next = seeded(MD4_OPENSSL_SEED);
  for (let i = 0; i < 200; i++) {
    const length = i <= 140 ? i : 141 + Math.floor(next() * 460);
    const bytes = new Uint8Array(length);
    for (let k = 0; k < length; k++) bytes[k] = Math.floor(next() * 256);
    expect(hex(md4(bytes)), `input ${i} of ${length} bytes`).toBe(MD4_OPENSSL_DIGESTS[i]);
  }
});

it('NTLM of Password and password gives the MS-NLMP and passlib values and astral characters use surrogate pairs', () => {
  // MS-NLMP section 4.2.2.1.2, NTOWFv1("Password", "User", "Domain"): a4 f4 9c 40 65 10 bd ca b6 82 4e e7 c3 0f d8 52
  // (https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-nlmp/0fb94d19-16d2-481d-9121-112defbaac0b, fetched
  // 2026-10-03); section 3.3.1 defines NTOWFv1 as MD4(UNICODE(Passwd)).
  expect(hex(ntlm('Password'))).toBe('a4f49c406510bdcab6824ee7c30fd852');
  // passlib 1.7.4 nthash.hash on Python 3.14.3 (scratch virtual environment venv-14, 2026-10-03):
  expect(hex(ntlm('password'))).toBe('8846f7eaee8fb117ad06bdd830b7586c');
  expect(hex(ntlm(''))).toBe('31d6cfe0d16ae931b73c59d7e0c089c0');
  expect(hex(ntlm('é'))).toBe('e77286d072c7858e9110cc3a011d2ac8');
  // U+1F600 is written as the pair D83D DE00 in UTF-16, which is the bytes 3d d8 00 de in little-endian order.
  const astral = String.fromCodePoint(0x1f600);
  expect(astral).toHaveLength(2);
  expect(hex(ntlm(astral))).toBe(hex(md4(Uint8Array.from([0x3d, 0xd8, 0x00, 0xde]))));
  expect(hex(ntlm('p' + astral + 'ss'))).toBe('b1847a4f90ec6e6793d813f9992e54a5');
  // It is not the hash of the UTF-8 bytes.
  expect(hex(ntlm('password'))).not.toBe(hex(md4(utf8('password'))));
});
