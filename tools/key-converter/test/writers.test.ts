import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, type JsonWebKey } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { p521 } from '@noble/curves/nist.js';
import { keyOutputs } from '../src/index';
import {
  readPkcs1Private,
  readPkcs8,
  readSpki,
  writePkcs1Private,
  writePkcs1Public,
  writePkcs8,
  writeSec1,
  writeSpki,
} from '../src/formats';
import { sshFingerprints } from '../src/fingerprint';
import { jwkThumbprint, readJwk, writeJwk } from '../src/jwk';
import { isPrivate, type KeyModel } from '../src/model';
import { readRfc4716, readSshPrivate, rfc4716, sshPrivate, sshPublicBlob, sshPublicLine } from '../src/openssh';
import { FIXTURES, armour, bytesOf, hex, shape, type Fixture } from './fixtures/fixture-list';
import * as fx from './fixtures/keys';

/**
 * Second opinions: the bytes OpenSSL 3.5.5 wrote (PKCS#1, SEC1, PKCS#8, SubjectPublicKeyInfo), the files and prints
 * ssh-keygen 10.2p1 wrote (the OpenSSH private file, RFC 4716, fingerprints), Node's own crypto (OpenSSL-backed, not this
 * package) for JWK members and for reading every written format back, and the published vectors of RFC 8037, RFC 7638 and
 * RFC 7515. All recorded as literals by make-fixtures.sh; the tests never run OpenSSL or ssh-keygen.
 */

const spies = {
  log: vi.spyOn(console, 'log'),
  warn: vi.spyOn(console, 'warn'),
  error: vi.spyOn(console, 'error'),
};
beforeEach(() => {
  for (const spy of Object.values(spies)) spy.mockImplementation(() => undefined);
});
afterEach(() => {
  for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  for (const spy of Object.values(spies)) spy.mockReset();
});

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean => Buffer.from(left).equals(Buffer.from(right));
const modelOf = (fixture: Fixture): KeyModel => readPkcs8(bytesOf(fixture.pkcs8));
const SIZE = new Map([
  ['P-256', 32],
  ['P-384', 48],
  ['P-521', 66],
]);

// RFC 7638 section 3.1: the RSA example key and its JWK thumbprint (the lines of the RFC joined).
const RFC7638_N =
  '0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdkt-bFTWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csFCur-kEgU8awapJzKnqDKgw';
const RFC7638_THUMBPRINT = 'NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs';

// RFC 8037 appendix A.1, A.2 and A.3 (the Ed25519 example key and its thumbprint).
const RFC8037_D = 'nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A';
const RFC8037_X = '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo';
const RFC8037_THUMBPRINT = 'kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k';

// RFC 7515 appendix A.2: the RSA key of the RS256 example, as published.
const RFC7515_RSA = {
  kty: 'RSA',
  n: 'ofgWCuLjybRlzo0tZWJjNiuSfb4p4fAkd_wWJcyQoTbji9k0l8W26mPddxHmfHQp-Vaw-4qPCJrcS2mJPMEzP1Pt0Bm4d4QlL-yRT-SFd2lZS-pCgNMsD1W_YpRPEwOWvG6b32690r2jZ47soMZo9wGzjb_7OMg0LOL-bSf63kpaSHSXndS5z5rexMdbBYUsLA9e-KXBdQOS-UTo7WTBEMa2R2CapHg665xsmtdVMTBQY4uDZlxvb3qCo5ZwKh9kG4LT6_I5IhlJH7aGhyxXFvUK-DWNmoudF8NAco9_h9iaGNj8q2ethFkMLs91kzk2PAcDTW9gb54h4FRWyuXpoQ',
  e: 'AQAB',
  d: 'Eq5xpGnNCivDflJsRQBXHx1hdR1k6Ulwe2JZD50LpXyWPEAeP88vLNO97IjlA7_GQ5sLKMgvfTeXZx9SE-7YwVol2NXOoAJe46sui395IW_GO-pWJ1O0BkTGoVEn2bKVRUCgu-GjBVaYLU6f3l9kJfFNS3E0QbVdxzubSu3Mkqzjkn439X0M_V51gfpRLI9JYanrC4D4qAdGcopV_0ZHHzQlBjudU2QvXt4ehNYTCBr6XCLQUShb1juUO1ZdiYoFaFQT5Tw8bGUl_x_jTj3ccPDVZFD9pIuhLhBOneufuBiB4cS98l2SR_RQyGWSeWjnczT0QU91p1DhOVRuOopznQ',
  p: '4BzEEOtIpmVdVEZNCqS7baC4crd0pqnRH_5IB3jw3bcxGn6QLvnEtfdUdiYrqBdss1l58BQ3KhooKeQTa9AB0Hw_Py5PJdTJNPY8cQn7ouZ2KKDcmnPGBY5t7yLc1QlQ5xHdwW1VhvKn-nXqhJTBgIPgtldC-KDV5z-y2XDwGUc',
  q: 'uQPEfgmVtjL0Uyyx88GZFF1fOunH3-7cepKmtH4pxhtCoHqpWmT8YAmZxaewHgHAjLYsp1ZSe7zFYHj7C6ul7TjeLQeZD_YwD66t62wDmpe_HlB-TnBA-njbglfIsRLtXlnDzQkv5dTltRJ11BKBBypeeF6689rjcJIDEz9RWdc',
  dp: 'BwKfV3Akq5_MFZDFZCnW-wzl-CCo83WoZvnLQwCTeDv8uzluRSnm71I3QCLdhrqE2e9YkxvuxdBfpT_PI7Yz-FOKnu1R6HsJeDCjn12Sk3vmAktV2zb34MCdy7cpdTh_YVr7tss2u6vneTwrA86rZtu5Mbr1C1XsmvkxHQAdYo0',
  dq: 'h_96-mK1R_7glhsum81dZxjTnYynPbZpHziZjeeHcXYsXaaMwkOlODsWa7I9xXDoRwbKgB719rrmI2oKr6N3Do9U0ajaHF-NKJnwgjMd2w9cjz3_-kyNlxAr2v4IKhGNpmM5iIgOS1VZnOZ68m6_pbLBSp3nssTdlqvd0tIiTHU',
  qi: 'IYd7DHOhrWvxkwPQsRM2tOgrjbcrfvtQJipd-DlcxyVuuM9sQLdgjVk2oy26F0EmpScGLq2MowX7fhd_QJQ3ydy5cY7YIBi87w93IKLEdfnbJtoOPLUW0ITrJReOgo1cq9SbsxYawBgfp_gh6A5603k2-ZQwVK0JKSHuLFkuQ3U',
};

it('PKCS1 and SEC1 written for the OpenSSL fixture keys equal the OpenSSL bytes', () => {
  for (const f of FIXTURES) {
    const key = modelOf(f);
    // The key written again is OpenSSL's own PKCS#8 and SubjectPublicKeyInfo.
    expect(sameBytes(writePkcs8(key), bytesOf(f.pkcs8)), `${f.name}: PKCS8`).toBe(true);
    expect(sameBytes(writeSpki(key), bytesOf(f.spki)), `${f.name}: SPKI`).toBe(true);
    if (f.pkcs1Private !== undefined && key.type === 'rsa') {
      expect(sameBytes(writePkcs1Private(key), bytesOf(f.pkcs1Private)), `${f.name}: PKCS1 private`).toBe(true);
      expect(sameBytes(writePkcs1Public(key), bytesOf(f.pkcs1Public!)), `${f.name}: PKCS1 public`).toBe(true);
      // The public part of a private key is the same bytes.
      expect(sameBytes(writePkcs1Public(readSpki(bytesOf(f.spki)) as typeof key), bytesOf(f.pkcs1Public!))).toBe(true);
    }
    if (f.sec1 !== undefined && key.type === 'ec') {
      expect(sameBytes(writeSec1(key), bytesOf(f.sec1)), `${f.name}: SEC1`).toBe(true);
      // A key whose input had no public part is written with it, byte for byte as OpenSSL writes the full key.
      const noPublic = readPkcs8(bytesOf(f.pkcs8NoPublic!));
      expect(
        sameBytes(writePkcs8(noPublic), bytesOf(f.pkcs8)),
        `${f.name}: PKCS8 from a key without its public part`,
      ).toBe(true);
      expect(
        sameBytes(writeSec1(noPublic), bytesOf(f.sec1)),
        `${f.name}: SEC1 from a key without its public part`,
      ).toBe(true);
    }
  }
  // A key with no private part cannot be written as a private key, and says so.
  const publicOnly = readSpki(bytesOf(fx.RSA2048_SPKI_DER_B64));
  expect(() => writePkcs8(publicOnly)).toThrow(/no private part/);
  expect(() => writePkcs1Private(publicOnly as Parameters<typeof writePkcs1Private>[0])).toThrow(/no private part/);
  const ecPublic = readSpki(bytesOf(fx.P256_SPKI_DER_B64));
  expect(() => writeSec1(ecPublic as Parameters<typeof writeSec1>[0])).toThrow(/no private part/);
});

/** The JSON Web Key members of a key made by Node, for comparison with the members the package writes. */
function nodeJwk(kind: 'rsa' | 'ed25519' | 'P-256' | 'P-384' | 'P-521'): {
  pkcs8: Uint8Array;
  priv: JsonWebKey;
  pub: JsonWebKey;
} {
  const pair =
    kind === 'rsa'
      ? generateKeyPairSync('rsa', { modulusLength: 2048 })
      : kind === 'ed25519'
        ? generateKeyPairSync('ed25519')
        : generateKeyPairSync('ec', { namedCurve: kind });
  return {
    pkcs8: new Uint8Array(pair.privateKey.export({ type: 'pkcs8', format: 'der' })),
    priv: pair.privateKey.export({ format: 'jwk' }),
    pub: pair.publicKey.export({ format: 'jwk' }),
  };
}

it('JWK members written for Node keys equal Node export and coordinates keep the full curve size', () => {
  let sawShortLeadingPart = false;
  for (const kind of ['rsa', 'ed25519', 'P-256', 'P-384', 'P-521'] as const) {
    for (let n = 0; n < 10; n++) {
      const made = nodeJwk(kind);
      const key = readPkcs8(made.pkcs8);
      const label = `${kind} key ${n}`;
      const ours = JSON.parse(writeJwk(key, { private: true })) as Record<string, string>;
      const theirs = made.priv as Record<string, string>;
      // The same members, with the same values, for kty, n, e, d, p, q, dp, dq, qi, crv, x and y.
      expect(Object.keys(ours).sort(), label).toEqual(Object.keys(theirs).sort());
      for (const member of Object.keys(theirs)) expect(ours[member], `${label}: ${member}`).toBe(theirs[member]);
      const ourPublic = JSON.parse(writeJwk(key, { private: false })) as Record<string, string>;
      const theirPublic = made.pub as Record<string, string>;
      expect(Object.keys(ourPublic).sort(), `${label}: public members`).toEqual(Object.keys(theirPublic).sort());
      for (const member of Object.keys(theirPublic)) {
        expect(ourPublic[member], `${label}: public ${member}`).toBe(theirPublic[member]);
      }
      // A curve key writes x, y and d at the full size of the curve, a leading zero byte included.
      const size = SIZE.get(kind);
      if (size !== undefined) {
        for (const member of ['x', 'y', 'd']) {
          const bytes = Buffer.from(ours[member]!, 'base64url');
          expect(bytes.length, `${label}: ${member}`).toBe(size);
          if (kind === 'P-521' && bytes[0] === 0) sawShortLeadingPart = true;
        }
      }
      // RSA numbers carry no leading zero byte (Base64urlUInt, RFC 7518 section 6.3.1.1).
      if (kind === 'rsa') {
        for (const member of ['n', 'e', 'd', 'p', 'q', 'dp', 'dq', 'qi']) {
          expect(Buffer.from(ours[member]!, 'base64url')[0], `${label}: ${member}`).not.toBe(0);
        }
      }
    }
  }
  // Keys are made until a P-521 value starts with a zero byte: its short leading part must still be 66 bytes long.
  for (let tries = 0; !sawShortLeadingPart && tries < 200; tries++) {
    const made = nodeJwk('P-521');
    const ours = JSON.parse(writeJwk(readPkcs8(made.pkcs8), { private: true })) as Record<string, string>;
    for (const member of ['x', 'y', 'd']) {
      const bytes = Buffer.from(ours[member]!, 'base64url');
      expect(bytes.length).toBe(66);
      if (bytes[0] === 0) sawShortLeadingPart = true;
    }
  }
  expect(sawShortLeadingPart).toBe(true);

  // A private number of 1 on P-521 is one byte long; the JWK holds it as 66 bytes, 65 of them zero.
  const one = Uint8Array.of(1);
  const small: KeyModel = {
    type: 'ec',
    curve: 'P-521',
    point: Uint8Array.from(
      p521.getPublicKey(
        Uint8Array.from({ length: 66 }, (_, i) => (i === 65 ? 1 : 0)),
        false,
      ),
    ),
    d: one,
  };
  const smallJwk = JSON.parse(writeJwk(small, { private: true })) as Record<string, string>;
  expect(Buffer.from(smallJwk['d']!, 'base64url').toString('hex')).toBe('00'.repeat(65) + '01');
  // And back again: the JWK reads as the same key.
  expect(shape(readJwk(JSON.stringify(smallJwk)).key)).toEqual(
    shape({ ...small, d: Uint8Array.from({ length: 66 }, (_, i) => (i === 65 ? 1 : 0)) }),
  );
}, 60_000);

it('RFC 8037 Appendix A.1 and RFC 7638 section 3.1 vectors reproduce', () => {
  // RFC 8037 A.1 and A.2: the key writes the published x and d, and no other member.
  const ed = readJwk(`{"kty":"OKP","crv":"Ed25519","d":"${RFC8037_D}","x":"${RFC8037_X}"}`).key;
  const privateJwk = JSON.parse(writeJwk(ed, { private: true })) as Record<string, string>;
  expect(privateJwk).toEqual({ kty: 'OKP', crv: 'Ed25519', d: RFC8037_D, x: RFC8037_X });
  const publicJwk = JSON.parse(writeJwk(ed, { private: false })) as Record<string, string>;
  expect(publicJwk).toEqual({ kty: 'OKP', crv: 'Ed25519', x: RFC8037_X });
  // A.3: the JWK thumbprint of the Ed25519 key.
  expect(jwkThumbprint(ed)).toBe(RFC8037_THUMBPRINT);

  // RFC 7638 section 3.1: the thumbprint of the RSA example key, and its canonical JSON (members in order, no spaces).
  const rsa = readJwk(`{"kty":"RSA","n":"${RFC7638_N}","e":"AQAB","alg":"RS256","kid":"2011-04-29"}`).key;
  expect(jwkThumbprint(rsa)).toBe(RFC7638_THUMBPRINT);
  const canonical = `{"e":"AQAB","kty":"RSA","n":"${RFC7638_N}"}`;
  expect(JSON.stringify(JSON.parse(writeJwk(rsa, { private: false })))).toBe(canonical);

  // RFC 7515 appendix A.2: the published private RSA key gives the published members back.
  const published = readJwk(JSON.stringify(RFC7515_RSA)).key;
  expect(JSON.parse(writeJwk(published, { private: true }))).toEqual(RFC7515_RSA);
  // The EC thumbprint is the SHA-256 of {"crv":"P-256","kty":"EC","x":...,"y":...} (RFC 7638 section 3.2): Node computes it.
  const made = nodeJwk('P-256');
  const ec = readPkcs8(made.pkcs8);
  const wanted = `{"crv":"P-256","kty":"EC","x":"${made.pub.x}","y":"${made.pub.y}"}`;
  const node = createPublicKey({ key: made.pub, format: 'jwk' }).export({ type: 'spki', format: 'der' });
  expect(sameBytes(writeSpki(ec), new Uint8Array(node))).toBe(true);
  expect(jwkThumbprint(ec)).toBe(createHash('sha256').update(wanted, 'utf8').digest('base64url'));
});

it('the OpenSSH private writer reproduces each ssh-keygen file given its check value and comment', () => {
  for (const f of FIXTURES) {
    const key = modelOf(f);
    const check = bytesOf(Buffer.from(f.check, 'hex').toString('base64'));
    const written = sshPrivate(key, fx.FIXTURE_COMMENT, undefined, check);
    expect(written, f.name).toBe(armour('OPENSSH PRIVATE KEY', f.openssh, 70));
    // The check value may also come from the random source given: four bytes are asked for, once.
    const asked: number[] = [];
    const again = sshPrivate(key, fx.FIXTURE_COMMENT, (count) => {
      asked.push(count);
      return check;
    });
    expect(again, f.name).toBe(written);
    expect(asked, f.name).toEqual([4]);
    // The body wraps at 70 columns and the file ends with one line feed.
    const lines = written.split('\n');
    expect(lines.at(-1)).toBe('');
    for (const line of lines.slice(1, -3)) expect(line.length, f.name).toBe(70);
  }
  // Padding: every comment length gives a section that is a multiple of 8 bytes, padded 1, 2, 3 ..., and reads back.
  const key = readPkcs8(bytesOf(fx.ED25519_PKCS8_DER_B64));
  for (let length = 0; length <= 17; length++) {
    const comment = 'c'.repeat(length);
    const text = sshPrivate(key, comment, undefined, Uint8Array.of(1, 2, 3, 4));
    const back = readSshPrivate(text);
    expect(back.comment).toBe(comment);
    expect(shape(back.key)).toEqual(shape(key));
    expect(hex(back.check)).toBe('01020304');
  }
  // A comment with characters outside ASCII is written as UTF-8 and read back.
  expect(readSshPrivate(sshPrivate(key, 'kéy ☃', undefined, Uint8Array.of(9, 9, 9, 9))).comment).toBe('kéy ☃');
  // With the default random source two files differ in their check value and read as the same key.
  const first = sshPrivate(key, 'x');
  const second = sshPrivate(key, 'x');
  expect(first).not.toBe(second);
  expect(shape(readSshPrivate(first).key)).toEqual(shape(readSshPrivate(second).key));
  // A key with no private part cannot be written, and a check value of the wrong size is refused.
  expect(() => sshPrivate(readSpki(bytesOf(fx.ED25519_SPKI_DER_B64)), '')).toThrow(/no private part/);
  expect(() => sshPrivate(key, '', undefined, Uint8Array.of(1, 2, 3))).toThrow(/check value/);
});

it('RFC 4716 files equal ssh-keygen -e output for the fixture keys', () => {
  for (const f of FIXTURES) {
    const key = modelOf(f);
    // ssh-keygen writes a Comment header naming the machine; apart from it the file is the same.
    expect(rfc4716(key, ''), f.name).toBe(f.rfc4716);
    // With a comment the header follows the BEGIN line, and the file reads back.
    const withComment = rfc4716(key, 'my "laptop" key \\ 2026');
    const lines = withComment.split('\n');
    expect(lines[0], f.name).toBe('---- BEGIN SSH2 PUBLIC KEY ----');
    expect(lines[1], f.name).toBe('Comment: "my \\"laptop\\" key \\\\ 2026"');
    expect(lines.slice(2).join('\n'), f.name).toBe(f.rfc4716.split('\n').slice(1).join('\n'));
    const back = readRfc4716(withComment);
    expect(back.comment, f.name).toBe('my "laptop" key \\ 2026');
    expect(sameBytes(sshPublicBlob(back.key), sshPublicBlob(key)), f.name).toBe(true);
    // The body is wrapped at 70 columns.
    for (const line of lines.slice(2, -2)) expect(line.length, f.name).toBeLessThanOrEqual(70);
  }
  // A comment that ends in a backslash is written so that the line does not look continued.
  const ed = readPkcs8(bytesOf(fx.ED25519_PKCS8_DER_B64));
  const ends = rfc4716(ed, 'ends with \\');
  expect(ends.split('\n')[1]).toBe('Comment: "ends with \\\\"');
  expect(readRfc4716(ends).comment).toBe('ends with \\');
});

it('SSH fingerprints of the six ssh-keygen keys equal ssh-keygen -l output', () => {
  const published: [string, string, string][] = [
    ['RSA 2048', fx.RSA2048_SSH_SHA256, fx.RSA2048_SSH_MD5],
    ['RSA 3072', fx.RSA3072_SSH_SHA256, fx.RSA3072_SSH_MD5],
    ['P-256', fx.P256_SSH_SHA256, fx.P256_SSH_MD5],
    ['P-384', fx.P384_SSH_SHA256, fx.P384_SSH_MD5],
    ['P-521', fx.P521_SSH_SHA256, fx.P521_SSH_MD5],
    ['Ed25519', fx.ED25519_SSH_SHA256, fx.ED25519_SSH_MD5],
  ];
  expect(published.length).toBe(6);
  for (const [name, sha256, md5] of published) {
    const f = FIXTURES.find((candidate) => candidate.name === name)!;
    const key = modelOf(f);
    const prints = sshFingerprints(sshPublicBlob(key));
    expect(prints.sha256, name).toBe(sha256);
    expect(prints.md5, name).toBe(md5);
    // The line ssh-keygen wrote (ssh-keygen -y) is the line written here, and the page shows the same prints.
    expect(sshPublicLine(key, fx.FIXTURE_COMMENT), name).toBe(f.yLine);
    const outputs = keyOutputs(key, { comment: '' });
    expect(outputs.fingerprints[0], name).toEqual(['SHA256', sha256]);
    expect(outputs.fingerprints[1], name).toEqual(['MD5', md5]);
    expect(outputs.fingerprints[2], name).toEqual(['JWK thumbprint', jwkThumbprint(key)]);
  }
  // The RFC 8037 key converts to the OpenSSH line and prints recorded from ssh-keygen 10.2p1 (see README.md).
  const ed = readJwk(`{"kty":"OKP","crv":"Ed25519","x":"${RFC8037_X}"}`).key;
  expect(sshPublicLine(ed, '')).toBe(
    'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINdamAGCsQq31Uv+08lkBzoO4XLz2qYjJa8CGmj3B1Ea',
  );
  expect(sshFingerprints(sshPublicBlob(ed)).sha256).toBe('SHA256:bbXpuKG6zhzdmnxq256TlqzFBzRl2f6OOg722cYNbU8');
});

it('Node reads back every written format as the same key', () => {
  const nodeKeys: [string, KeyModel][] = [];
  for (const kind of ['rsa', 'ed25519', 'P-256', 'P-384', 'P-521'] as const) {
    nodeKeys.push([`Node ${kind}`, readPkcs8(nodeJwk(kind).pkcs8)]);
  }
  for (const f of FIXTURES) nodeKeys.push([f.name, modelOf(f)]);
  for (const [name, key] of nodeKeys) {
    const pkcs8 = writePkcs8(key);
    const spki = writeSpki(key);
    // Node accepts the PKCS#8 and the SubjectPublicKeyInfo and writes the same bytes again.
    const nodePrivate = createPrivateKey({ key: Buffer.from(pkcs8), format: 'der', type: 'pkcs8' });
    expect(
      sameBytes(new Uint8Array(nodePrivate.export({ type: 'pkcs8', format: 'der' })), pkcs8),
      `${name}: PKCS8`,
    ).toBe(true);
    const nodePublic = createPublicKey({ key: Buffer.from(spki), format: 'der', type: 'spki' });
    expect(sameBytes(new Uint8Array(nodePublic.export({ type: 'spki', format: 'der' })), spki), `${name}: SPKI`).toBe(
      true,
    );
    // Node reads the PEM text of the page's blocks.
    const blocks = new Map(keyOutputs(key, { comment: 'c' }).blocks.map((block) => [block.id, block.text]));
    expect(
      sameBytes(new Uint8Array(createPrivateKey(blocks.get('pkcs8')!).export({ type: 'pkcs8', format: 'der' })), pkcs8),
      `${name}: PKCS8 PEM`,
    ).toBe(true);

    if (key.type === 'rsa') {
      const pkcs1 = writePkcs1Private(key);
      const fromPkcs1 = createPrivateKey({ key: Buffer.from(pkcs1), format: 'der', type: 'pkcs1' });
      expect(
        sameBytes(new Uint8Array(fromPkcs1.export({ type: 'pkcs8', format: 'der' })), pkcs8),
        `${name}: PKCS1 private`,
      ).toBe(true);
      const fromPublic = createPublicKey({ key: Buffer.from(writePkcs1Public(key)), format: 'der', type: 'pkcs1' });
      expect(
        sameBytes(new Uint8Array(fromPublic.export({ type: 'spki', format: 'der' })), spki),
        `${name}: PKCS1 public`,
      ).toBe(true);
      expect(shape(readPkcs1Private(pkcs1)), `${name}: PKCS1 read back`).toEqual(shape(key));
      expect(blocks.has('sec1'), name).toBe(false);
    }
    if (key.type === 'ec') {
      const fromSec1 = createPrivateKey({ key: Buffer.from(writeSec1(key)), format: 'der', type: 'sec1' });
      expect(sameBytes(new Uint8Array(fromSec1.export({ type: 'pkcs8', format: 'der' })), pkcs8), `${name}: SEC1`).toBe(
        true,
      );
      expect(blocks.has('pkcs1-private'), name).toBe(false);
    }
    // The JWK, private and public, is accepted by Node and is the same key.
    const privateJwk = JSON.parse(writeJwk(key, { private: true })) as JsonWebKey;
    const fromJwk = createPrivateKey({ key: privateJwk, format: 'jwk' });
    expect(sameBytes(new Uint8Array(fromJwk.export({ type: 'pkcs8', format: 'der' })), pkcs8), `${name}: JWK`).toBe(
      true,
    );
    const publicJwk = JSON.parse(writeJwk(key, { private: false })) as JsonWebKey;
    const fromPublicJwk = createPublicKey({ key: publicJwk, format: 'jwk' });
    expect(
      sameBytes(new Uint8Array(fromPublicJwk.export({ type: 'spki', format: 'der' })), spki),
      `${name}: public JWK`,
    ).toBe(true);
    // The package reads its own JWK, OpenSSH private file, OpenSSH line and RFC 4716 file back as the same key.
    expect(shape(readJwk(writeJwk(key, { private: true })).key), `${name}: JWK read back`).toEqual(shape(key));
    expect(shape(readSshPrivate(sshPrivate(key, 'c')).key), `${name}: OpenSSH private read back`).toEqual(shape(key));
    expect(
      sameBytes(sshPublicBlob(readRfc4716(rfc4716(key, 'c')).key), sshPublicBlob(key)),
      `${name}: RFC 4716 read back`,
    ).toBe(true);
  }
}, 60_000);

it('the key outputs list every block, with labels, download-ready text and the thumbprint', () => {
  const rsa = modelOf(FIXTURES[0]!);
  const ec = modelOf(FIXTURES[2]!);
  const ed = modelOf(FIXTURES[5]!);
  const expected = new Map<string, string[]>([
    [
      'RSA',
      [
        'pkcs8',
        'spki',
        'pkcs1-private',
        'pkcs1-public',
        'jwk-private',
        'jwk-public',
        'ssh-private',
        'ssh-public',
        'rfc4716',
      ],
    ],
    ['EC', ['pkcs8', 'spki', 'sec1', 'jwk-private', 'jwk-public', 'ssh-private', 'ssh-public', 'rfc4716']],
    ['Ed25519', ['pkcs8', 'spki', 'jwk-private', 'jwk-public', 'ssh-private', 'ssh-public', 'rfc4716']],
  ]);
  const labels = new Map([
    ['pkcs8', 'Private key, PKCS#8 (PEM)'],
    ['spki', 'Public key, SubjectPublicKeyInfo (PEM)'],
    ['pkcs1-private', 'RSA private key, PKCS#1 (PEM)'],
    ['pkcs1-public', 'RSA public key, PKCS#1 (PEM)'],
    ['sec1', 'EC private key, SEC1 (PEM)'],
    ['jwk-private', 'Private key, JWK'],
    ['jwk-public', 'Public key, JWK'],
    ['ssh-private', 'OpenSSH private key (no passphrase)'],
    ['ssh-public', 'OpenSSH public key'],
    ['rfc4716', 'Public key, RFC 4716'],
  ]);
  for (const [name, key] of [
    ['RSA', rsa],
    ['EC', ec],
    ['Ed25519', ed],
  ] as const) {
    const result = keyOutputs(key, { comment: 'work laptop' });
    expect(
      result.blocks.map((block) => block.id),
      name,
    ).toEqual(expected.get(name));
    for (const block of result.blocks) {
      expect(block.label, `${name}: ${block.id}`).toBe(labels.get(block.id));
      expect(block.private, `${name}: ${block.id}`).toBe(
        ['pkcs8', 'pkcs1-private', 'sec1', 'jwk-private', 'ssh-private'].includes(block.id),
      );
      expect(block.language, `${name}: ${block.id}`).toBe(block.id.startsWith('jwk') ? 'json' : undefined);
    }
    expect(
      result.fingerprints.map(([label]) => label),
      name,
    ).toEqual(['SHA256', 'MD5', 'JWK thumbprint']);
    expect(result.fingerprints[2]![1], name).toBe(jwkThumbprint(key));
    const ssh = result.blocks.find((block) => block.id === 'ssh-private')!;
    expect(readSshPrivate(ssh.text).comment, name).toBe('work laptop');
    expect(result.blocks.find((block) => block.id === 'ssh-public')!.text, name).toBe(
      sshPublicLine(key, 'work laptop'),
    );
    expect(result.blocks.find((block) => block.id === 'rfc4716')!.text.split('\n')[1], name).toBe(
      'Comment: "work laptop"',
    );
    expect(JSON.parse(result.blocks.find((block) => block.id === 'jwk-private')!.text), name).toEqual(
      JSON.parse(writeJwk(key, { private: true })),
    );
  }
  // A public key gives the public blocks only.
  const publicBlocks = (key: KeyModel): string[] => keyOutputs(key, { comment: '' }).blocks.map((block) => block.id);
  expect(publicBlocks(readSpki(bytesOf(fx.RSA2048_SPKI_DER_B64)))).toEqual([
    'spki',
    'pkcs1-public',
    'jwk-public',
    'ssh-public',
    'rfc4716',
  ]);
  expect(publicBlocks(readSpki(bytesOf(fx.P256_SPKI_DER_B64)))).toEqual([
    'spki',
    'jwk-public',
    'ssh-public',
    'rfc4716',
  ]);
  expect(publicBlocks(readSpki(bytesOf(fx.ED25519_SPKI_DER_B64)))).toEqual([
    'spki',
    'jwk-public',
    'ssh-public',
    'rfc4716',
  ]);
  expect(isPrivate(readSpki(bytesOf(fx.P256_SPKI_DER_B64)))).toBe(false);
  // An RSA key under 2048 bits is converted and warned about.
  const small = generateKeyPairSync('rsa', { modulusLength: 1024 });
  const smallKey = readPkcs8(new Uint8Array(small.privateKey.export({ type: 'pkcs8', format: 'der' })));
  expect(keyOutputs(smallKey, { comment: '' }).warnings).toEqual([
    'This RSA key is shorter than 2048 bits, which is too short for new use.',
  ]);
  expect(keyOutputs(rsa, { comment: '' }).warnings).toEqual([]);
});
