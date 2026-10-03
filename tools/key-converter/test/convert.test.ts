import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MAX_PASTE_CHARS, readKeyInput } from '../src/detect';
import { DerError } from '../src/der';
import { readPkcs1Private, readPkcs1Public, readPkcs8, readSec1, readSpki } from '../src/formats';
import { readJwk } from '../src/jwk';
import { KeyConverterError, bytesEqual, isPrivate, keyBits } from '../src/model';
import { readRfc4716, readSshPrivate, readSshPublicLine, sshPublicLine } from '../src/openssh';
import { PemError } from '../src/pem';
import { bitLength, completeRsa, modInverse } from '../src/rsa-math';
import { FIXTURES, armour, bytesOf, hex, shape } from './fixtures/fixture-list';
import * as fx from './fixtures/keys';

/**
 * Specification and second opinions. The inputs are Base64 bodies recorded from OpenSSL 3.5.5 and ssh-keygen (OpenSSH
 * 10.2p1) by make-fixtures.sh, with the armour put round them here from pieces; the published JWKs are RFC 8037 appendix
 * A.1 and RFC 7515 appendix A.2; Node's own crypto (OpenSSL-backed, not this package) gives every RSA number a second time.
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

const PASSPHRASE_SENTENCE =
  'This key is protected by a passphrase. This page does not decrypt keys. Remove the passphrase on your own machine first (for example openssl pkey -in key.pem -out plain.pem), then paste the unprotected key.';
const PSS_SENTENCE = 'This is an RSA-PSS key restricted to one hash. Only unrestricted RSA keys are converted.';
const CURVE_SENTENCE = 'Only P-256, P-384, P-521 and Ed25519 elliptic curve keys are supported.';
const NO_PRIMES_SENTENCE =
  'This JWK has no prime factors (p and q), so it cannot be written as PKCS#1, PKCS#8 or OpenSSH.';
const CERTIFICATE_SENTENCE = 'This is a certificate, not a key. Its public key can be read with a certificate decoder.';
const MISMATCH_SENTENCE = 'The public key does not belong to this private key.';
const NET_SENTENCE = 'This key could not be read. Check that it is whole and in one of the forms listed above.';
const SHORT_RSA_WARNING = 'This RSA key is shorter than 2048 bits, which is too short for new use.';

function thrown(call: () => unknown, what = 'the call'): unknown {
  try {
    call();
  } catch (err) {
    return err;
  }
  throw new Error(what + ' did not throw');
}

function refusal(text: string): string {
  const err = thrown(() => readKeyInput(text));
  expect(err, 'a refusal is a KeyConverterError').toBeInstanceOf(KeyConverterError);
  return (err as KeyConverterError).message;
}

/** Whether any 12 character window of the message is found in one of the secret texts. */
function holdsFragment(message: string, secrets: string[]): boolean {
  for (let i = 0; i + 12 <= message.length; i++) {
    const window = message.slice(i, i + 12);
    if (secrets.some((secret) => secret.includes(window))) return true;
  }
  return false;
}

// RFC 8037 appendix A.1 and A.2, and RFC 8032 section 7.1 TEST 1.
const RFC8037_PRIVATE_JWK =
  '{"kty":"OKP","crv":"Ed25519","d":"nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A","x":"11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"}';
const RFC8037_PUBLIC_JWK = '{"kty":"OKP","crv":"Ed25519","x":"11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"}';
const TEST1_SEED = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const TEST1_PUBLIC = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';

// RFC 7515 appendix A.2 (the RSA key of the RS256 example), joined from the lines of the RFC.
const RFC7515_RSA_JWK = {
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

it('PKCS8, PKCS1 and SEC1 fixtures made by OpenSSL read into the same key model as their OpenSSH private file', () => {
  for (const f of FIXTURES) {
    const fromOpenssh = readKeyInput(armour('OPENSSH PRIVATE KEY', f.openssh, 70));
    expect(fromOpenssh.source, f.name).toBe('OpenSSH private key');
    expect(fromOpenssh.comment, f.name).toBe('fixture');
    expect(isPrivate(fromOpenssh.key), f.name).toBe(true);

    const fromPkcs8 = readKeyInput(armour('PRIVATE KEY', f.pkcs8));
    expect(fromPkcs8.source, f.name).toBe('PKCS#8 private key');
    expect(fromPkcs8.comment, f.name).toBeUndefined();
    expect(shape(fromPkcs8.key), `${f.name}: PKCS8 and OpenSSH`).toEqual(shape(fromOpenssh.key));
    expect(shape(readPkcs8(bytesOf(f.pkcs8))), `${f.name}: reader`).toEqual(shape(fromOpenssh.key));

    if (f.pkcs1Private !== undefined) {
      const fromPkcs1 = readKeyInput(armour('RSA PRIVATE KEY', f.pkcs1Private));
      expect(fromPkcs1.source, f.name).toBe('PKCS#1 RSA private key');
      expect(shape(fromPkcs1.key), `${f.name}: PKCS1 and OpenSSH`).toEqual(shape(fromOpenssh.key));
      expect(shape(readPkcs1Private(bytesOf(f.pkcs1Private))), `${f.name}: reader`).toEqual(shape(fromOpenssh.key));
    }
    if (f.sec1 !== undefined) {
      const fromSec1 = readKeyInput(armour('EC PRIVATE KEY', f.sec1));
      expect(fromSec1.source, f.name).toBe('SEC1 EC private key');
      expect(shape(fromSec1.key), `${f.name}: SEC1 and OpenSSH`).toEqual(shape(fromOpenssh.key));
      expect(shape(readSec1(bytesOf(f.sec1))), `${f.name}: reader`).toEqual(shape(fromOpenssh.key));
    }
    // The model gives back the public line ssh-keygen printed for the same file.
    expect(sshPublicLine(fromOpenssh.key, fx.FIXTURE_COMMENT), f.name).toBe(f.yLine);
    // The reader of the file alone says the same, and reports the check value the file carries.
    const direct = readSshPrivate(armour('OPENSSH PRIVATE KEY', f.openssh, 70));
    expect(shape(direct.key), f.name).toEqual(shape(fromOpenssh.key));
    expect(direct.comment, f.name).toBe('fixture');
    expect(hex(direct.check), f.name).toBe(f.check);
  }
  // Windows line ends and any line width are accepted.
  const crlf = armour('PRIVATE KEY', fx.P256_PKCS8_DER_B64, 76).replace(/\n/g, '\r\n');
  expect(shape(readKeyInput(crlf).key)).toEqual(shape(readPkcs8(bytesOf(fx.P256_PKCS8_DER_B64))));
});

it('SPKI, PKCS1 public, OpenSSH public lines and RFC 4716 files read as public keys', () => {
  for (const f of FIXTURES) {
    const reference = readSpki(bytesOf(f.spki));
    const fromSpki = readKeyInput(armour('PUBLIC KEY', f.spki));
    expect(fromSpki.source, f.name).toBe('SubjectPublicKeyInfo public key');
    expect(isPrivate(fromSpki.key), f.name).toBe(false);
    expect(shape(fromSpki.key), f.name).toEqual(shape(reference));

    if (f.pkcs1Public !== undefined) {
      const fromPkcs1 = readKeyInput(armour('RSA PUBLIC KEY', f.pkcs1Public));
      expect(fromPkcs1.source, f.name).toBe('PKCS#1 RSA public key');
      expect(isPrivate(fromPkcs1.key), f.name).toBe(false);
      expect(shape(fromPkcs1.key), f.name).toEqual(shape(reference));
      expect(shape(readPkcs1Public(bytesOf(f.pkcs1Public))), f.name).toEqual(shape(reference));
    }

    // An OpenSSH public line, with and without its comment.
    const withComment = readKeyInput(f.yLine + '\n');
    expect(withComment.source, f.name).toBe('OpenSSH public key line');
    expect(withComment.comment, f.name).toBe('fixture');
    expect(isPrivate(withComment.key), f.name).toBe(false);
    expect(shape(withComment.key), f.name).toEqual(shape(reference));
    const bare = readKeyInput('  ' + f.publicLine + '  ');
    expect(bare.comment, f.name).toBeUndefined();
    expect(shape(bare.key), f.name).toEqual(shape(reference));
    expect(readSshPublicLine(f.yLine).comment, f.name).toBe('fixture');
    // A comment with spaces is kept whole.
    expect(readKeyInput(f.publicLine + ' my laptop, 2026').comment, f.name).toBe('my laptop, 2026');

    // RFC 4716: the recorded file has no Comment header; a quoted one and a continued one are read too.
    const plain = readKeyInput(f.rfc4716);
    expect(plain.source, f.name).toBe('RFC 4716 public key');
    expect(plain.comment, f.name).toBeUndefined();
    expect(isPrivate(plain.key), f.name).toBe(false);
    expect(shape(plain.key), f.name).toEqual(shape(reference));
    const lines = f.rfc4716.split('\n');
    const withHeader = [lines[0], 'Comment: "my \\"laptop\\" key"', ...lines.slice(1)].join('\n');
    expect(readKeyInput(withHeader).comment, f.name).toBe('my "laptop" key');
    expect(readRfc4716(withHeader).comment, f.name).toBe('my "laptop" key');
    const continued = [lines[0], 'Comment: "one \\', 'two"', ...lines.slice(1)].join('\n');
    expect(readKeyInput(continued).comment, f.name).toBe('one two');
  }
});

it('the RFC 8037 Appendix A.1 private JWK reads as the RFC 8032 test 1 key and a JWK set gives its first key with a note', () => {
  const read = readKeyInput(RFC8037_PRIVATE_JWK);
  expect(read.source).toBe('JWK');
  expect(read.key.type).toBe('ed25519');
  if (read.key.type !== 'ed25519') return;
  expect(hex(read.key.seed!)).toBe(TEST1_SEED);
  expect(hex(read.key.pub)).toBe(TEST1_PUBLIC);
  expect(read.warnings).toEqual([]);
  expect(sshPublicLine(read.key, '')).toBe(
    'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINdamAGCsQq31Uv+08lkBzoO4XLz2qYjJa8CGmj3B1Ea',
  );

  // A.2 is the same key without d.
  const publicOnly = readKeyInput(RFC8037_PUBLIC_JWK);
  expect(isPrivate(publicOnly.key)).toBe(false);
  expect(publicOnly.key.type === 'ed25519' && hex(publicOnly.key.pub)).toBe(TEST1_PUBLIC);
  expect(readJwk(RFC8037_PUBLIC_JWK).key.type).toBe('ed25519');

  // A set converts its first key and says so.
  const second = '{"kty":"OKP","crv":"Ed25519","x":"11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"}';
  const set = readKeyInput(`{"keys":[${RFC8037_PRIVATE_JWK},${second}]}`);
  expect(set.source).toBe('JWK set (first key)');
  expect(hex((set.key as { seed: Uint8Array }).seed)).toBe(TEST1_SEED);
  expect(set.warnings.join(' ')).toMatch(/2 keys/);
  expect(set.warnings.join(' ')).toMatch(/first key/);
  expect(readJwk(`{"keys":[${RFC8037_PRIVATE_JWK}]}`).note).toBeDefined();
  expect(readJwk(RFC8037_PRIVATE_JWK).note).toBeUndefined();

  // The published RSA JWK of RFC 7515 appendix A.2 reads with every number it names.
  const rsa = readKeyInput(JSON.stringify(RFC7515_RSA_JWK)).key;
  expect(rsa.type).toBe('rsa');
  if (rsa.type !== 'rsa') return;
  expect(keyBits(rsa)).toBe(2048);
  const bytes = (member: string): string => Buffer.from(member, 'base64url').toString('hex');
  expect(hex(rsa.n)).toBe(bytes(RFC7515_RSA_JWK.n));
  expect(hex(rsa.d!)).toBe(bytes(RFC7515_RSA_JWK.d));
  expect(hex(rsa.dp!)).toBe(bytes(RFC7515_RSA_JWK.dp));
  expect(hex(rsa.dq!)).toBe(bytes(RFC7515_RSA_JWK.dq));
  expect(hex(rsa.qi!)).toBe(bytes(RFC7515_RSA_JWK.qi));
  expect(hex(rsa.e)).toBe('010001');
});

it('passphrase-protected PKCS8, legacy PEM and OpenSSH keys are refused with the passphrase sentence', () => {
  const protectedKeys: [string, string, string][] = [
    ['encrypted PKCS8', armour('ENCRYPTED PRIVATE KEY', fx.ENCRYPTED_PKCS8_DER_B64), fx.ENCRYPTED_PKCS8_DER_B64],
    [
      'legacy encrypted PEM',
      armour('RSA PRIVATE KEY', fx.ENCRYPTED_RSA_PEM_BODY_B64, 64, fx.ENCRYPTED_RSA_PEM_HEADER_LINES),
      fx.ENCRYPTED_RSA_PEM_BODY_B64,
    ],
    [
      'OpenSSH key with a cipher',
      armour('OPENSSH PRIVATE KEY', fx.ENCRYPTED_OPENSSH_FILE_B64, 70),
      fx.ENCRYPTED_OPENSSH_FILE_B64,
    ],
  ];
  for (const [name, text, body] of protectedKeys) {
    const message = refusal(text);
    expect(message, name).toBe(PASSPHRASE_SENTENCE);
    expect(holdsFragment(message, [body]), name).toBe(false);
  }
  // The same headers on an EC PRIVATE KEY block are refused the same way, and the file reader says the same.
  expect(
    refusal(
      armour('EC PRIVATE KEY', fx.ENCRYPTED_RSA_PEM_BODY_B64, 64, [
        'Proc-Type: 4,ENCRYPTED',
        'DEK-Info: AES-128-CBC,00',
      ]),
    ),
  ).toBe(PASSPHRASE_SENTENCE);
  const direct = thrown(() => readSshPrivate(armour('OPENSSH PRIVATE KEY', fx.ENCRYPTED_OPENSSH_FILE_B64, 70)));
  expect((direct as KeyConverterError).message).toBe(PASSPHRASE_SENTENCE);
});

it('RSA-PSS restricted keys, unsupported curves, JWKs without primes, certificates and mismatched public parts are refused without key bytes', () => {
  const rsa = RFC7515_RSA_JWK;
  const noPrimes = JSON.stringify({ kty: 'RSA', n: rsa.n, e: rsa.e, d: rsa.d });
  // The x of another, valid Ed25519 key: the last 32 bytes of its SubjectPublicKeyInfo.
  const otherX = Buffer.from(fx.ED25519_SPKI_DER_B64, 'base64').subarray(12).toString('base64url');
  const flippedX = RFC8037_PRIVATE_JWK.replace('11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo', otherX);
  const cases: [string, string, string, string[]][] = [
    [
      'an RSA-PSS private key',
      armour('PRIVATE KEY', fx.RSA_PSS_RESTRICTED_PKCS8_DER_B64),
      PSS_SENTENCE,
      [fx.RSA_PSS_RESTRICTED_PKCS8_DER_B64],
    ],
    [
      'an RSA-PSS public key',
      armour('PUBLIC KEY', fx.RSA_PSS_RESTRICTED_SPKI_DER_B64),
      PSS_SENTENCE,
      [fx.RSA_PSS_RESTRICTED_SPKI_DER_B64],
    ],
    [
      'a secp256k1 private key',
      armour('PRIVATE KEY', fx.SECP256K1_PKCS8_DER_B64),
      CURVE_SENTENCE,
      [fx.SECP256K1_PKCS8_DER_B64],
    ],
    [
      'a secp256k1 public key',
      armour('PUBLIC KEY', fx.SECP256K1_SPKI_DER_B64),
      CURVE_SENTENCE,
      [fx.SECP256K1_SPKI_DER_B64],
    ],
    ['a JWK on another curve', '{"kty":"EC","crv":"secp256k1","x":"AA","y":"AA"}', CURVE_SENTENCE, []],
    ['an RSA JWK with n, e and d only', noPrimes, NO_PRIMES_SENTENCE, [rsa.n, rsa.d]],
    ['a certificate', armour('CERTIFICATE', fx.P256_SPKI_DER_B64), CERTIFICATE_SENTENCE, [fx.P256_SPKI_DER_B64]],
    [
      'a private key with the public key of another key',
      armour('PRIVATE KEY', fx.P256_PKCS8_DER_B64) + armour('PUBLIC KEY', fx.P384_SPKI_DER_B64),
      MISMATCH_SENTENCE,
      [fx.P256_PKCS8_DER_B64, fx.P384_SPKI_DER_B64],
    ],
    [
      'an RSA private key with the public key of another RSA key',
      armour('RSA PRIVATE KEY', fx.RSA2048_PKCS1_PRIVATE_DER_B64) + armour('PUBLIC KEY', fx.RSA3072_SPKI_DER_B64),
      MISMATCH_SENTENCE,
      [fx.RSA2048_PKCS1_PRIVATE_DER_B64, fx.RSA3072_SPKI_DER_B64],
    ],
    [
      'a JWK whose x does not match d',
      flippedX,
      MISMATCH_SENTENCE,
      ['nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A', '21qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo'],
    ],
  ];
  for (const [name, text, sentence, secrets] of cases) {
    const message = refusal(text);
    expect(message, name).toBe(sentence);
    expect(holdsFragment(message, secrets), name).toBe(false);
  }
  // A key whose algorithm is not RSA or an EC curve is refused too, and so is text that is no key at all.
  for (const text of [
    'hello',
    '-----' + 'BEGIN X509 CRL-----\nAAAA\n-----' + 'END X509 CRL-----\n',
    '[1,2]',
    '{"a":1}',
    '{"kty":"oct","k":"AAAA"}',
    'ssh-dss AAAAB3NzaC1kc3M=',
  ]) {
    expect(typeof refusal(text)).toBe('string');
  }
  expect(thrown(() => readKeyInput(''))).toBeInstanceOf(KeyConverterError);
  expect(thrown(() => readKeyInput('   \n'))).toBeInstanceOf(KeyConverterError);
});

it('an EC PKCS8 without its public key gets the point OpenSSL derives', () => {
  for (const f of FIXTURES.filter((candidate) => candidate.kind === 'ec')) {
    // The OpenSSL SubjectPublicKeyInfo of the same key is the second opinion for the point.
    const expected = readSpki(bytesOf(f.spki));
    if (expected.type !== 'ec') throw new Error('not an EC key');
    const fromPkcs8 = readKeyInput(armour('PRIVATE KEY', f.pkcs8NoPublic!));
    expect(fromPkcs8.key.type, f.name).toBe('ec');
    expect(hex((fromPkcs8.key as { point: Uint8Array }).point), `${f.name}: PKCS8 without public key`).toBe(
      hex(expected.point),
    );
    const fromSec1 = readKeyInput(armour('EC PRIVATE KEY', f.sec1NoPublic!));
    expect(hex((fromSec1.key as { point: Uint8Array }).point), `${f.name}: SEC1 without public key`).toBe(
      hex(expected.point),
    );
    expect(sshPublicLine(fromPkcs8.key, 'fixture'), f.name).toBe(f.yLine);
    expect(isPrivate(fromPkcs8.key), f.name).toBe(true);
  }
  // openssl ecparam -genkey writes an EC PARAMETERS block in front of the key; both are in one paste.
  const both = fx.ECPARAM_OUTPUT_BLOCKS.map(([label, body]) => armour(label!, body!)).join('');
  const read = readKeyInput(both);
  expect(read.key.type).toBe('ec');
  expect(isPrivate(read.key)).toBe(true);
});

/** A DER element, built here by hand so the large keys below do not depend on the package's own writers. */
function tlv(tag: number, ...parts: Uint8Array[]): Uint8Array {
  const body = Buffer.concat(parts);
  const length =
    body.length < 128
      ? [body.length]
      : body.length < 256
        ? [0x81, body.length]
        : body.length < 65536
          ? [0x82, body.length >> 8, body.length & 255]
          : [0x83, body.length >> 16, (body.length >> 8) & 255, body.length & 255];
  return new Uint8Array(Buffer.concat([Buffer.from([tag, ...length]), body]));
}

/** The SubjectPublicKeyInfo of an RSA public key whose modulus is `size` bytes with its top bit set and exponent 65537. */
function rsaPublicOfSize(size: number): Uint8Array {
  const modulus = new Uint8Array(size);
  for (let i = 0; i < size; i++) modulus[i] = (i * 131 + 7) & 255;
  modulus[0] = 0x80;
  modulus[size - 1] = modulus[size - 1]! | 1;
  const integer = (bytes: Uint8Array) => tlv(0x02, bytes[0]! >= 0x80 ? Uint8Array.of(0, ...bytes) : bytes);
  const publicKey = tlv(0x30, integer(modulus), integer(Uint8Array.of(1, 0, 1)));
  const algorithm = tlv(
    0x30,
    tlv(0x06, Uint8Array.of(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01)),
    Uint8Array.of(5, 0),
  );
  return tlv(0x30, algorithm, tlv(0x03, Uint8Array.of(0), publicKey));
}

it('pastes are read up to 65536 characters and RSA keys up to 16384 bits, smaller RSA keys warn', () => {
  expect(MAX_PASTE_CHARS).toBe(65536);
  const key = armour('PUBLIC KEY', fx.P256_SPKI_DER_B64);
  // Exactly 65,536 characters: the key, then blank space. It is read.
  const exact = key + ' '.repeat(65536 - key.length);
  expect(exact.length).toBe(65536);
  expect(readKeyInput(exact).key.type).toBe('ec');
  // One character more is refused with the size sentence before anything is parsed, whatever the text is.
  const over = key + ' '.repeat(65537 - key.length);
  expect(over.length).toBe(65537);
  const sentence = 'This paste is 65,537 characters. The limit is 65,536 because larger pastes are not keys.';
  expect(refusal(over)).toBe(sentence);
  expect(refusal('A'.repeat(65537))).toBe(sentence);
  expect(refusal('{' + '['.repeat(65536))).toBe(sentence);
  const parse = vi.spyOn(JSON, 'parse');
  try {
    expect(refusal('{' + ' '.repeat(65536))).toBe(sentence);
    expect(parse).not.toHaveBeenCalled();
  } finally {
    parse.mockRestore();
  }

  // RSA public keys at the limit and one byte over it (a public key needs no primes, so fixed bytes make the modulus).
  const atLimit = readKeyInput(armour('PUBLIC KEY', Buffer.from(rsaPublicOfSize(2048)).toString('base64')));
  expect(atLimit.key.type).toBe('rsa');
  expect(keyBits(atLimit.key)).toBe(16384);
  expect(atLimit.warnings).toEqual([]);
  const tooLarge = refusal(armour('PUBLIC KEY', Buffer.from(rsaPublicOfSize(2049)).toString('base64')));
  expect(tooLarge).toBe('This RSA key is larger than 16384 bits, which is the most this page reads.');

  // A 1024 bit RSA key made by Node reads, with a warning; a 2048 bit one does not warn.
  const small = generateKeyPairSync('rsa', { modulusLength: 1024 });
  const smallPem = armour(
    'PRIVATE KEY',
    Buffer.from(small.privateKey.export({ type: 'pkcs8', format: 'der' })).toString('base64'),
  );
  const smallRead = readKeyInput(smallPem);
  expect(keyBits(smallRead.key)).toBe(1024);
  expect(smallRead.warnings).toEqual([SHORT_RSA_WARNING]);
  expect(readKeyInput(armour('PRIVATE KEY', fx.RSA2048_PKCS8_DER_B64)).warnings).toEqual([]);

  // The big-number helpers stay fast at the size of the largest prime this page can meet (8192 bits).
  const a = (1n << 8192n) - 1n;
  const m = (1n << 8191n) - 19n;
  const toBytes = (v: bigint): Uint8Array =>
    new Uint8Array(
      Buffer.from(v.toString(16).padStart(v.toString(16).length + (v.toString(16).length % 2), '0'), 'hex'),
    );
  const started = performance.now();
  const inverse = modInverse(toBytes(a), toBytes(m));
  const elapsed = performance.now() - started;
  const inverseValue = BigInt('0x' + Buffer.from(inverse).toString('hex'));
  expect((a * inverseValue) % m).toBe(1n);
  expect(bitLength(toBytes(a))).toBe(8192);
  expect(bitLength(Uint8Array.of(0, 0, 0))).toBe(0);
  expect(bitLength(Uint8Array.of(0, 1))).toBe(1);
  expect(elapsed).toBeLessThan(10_000);
}, 60_000);

it('dp, dq and qi computed with BigInt for an OpenSSH or JWK RSA key equal OpenSSL PKCS1 values', () => {
  for (const [name, pkcs1, openssh] of [
    ['RSA 2048', fx.RSA2048_PKCS1_PRIVATE_DER_B64, fx.RSA2048_OPENSSH_FILE_B64],
    ['RSA 3072', fx.RSA3072_PKCS1_PRIVATE_DER_B64, fx.RSA3072_OPENSSH_FILE_B64],
  ] as const) {
    // Node's own JSON Web Key of the OpenSSL file is the second reading of every number.
    const node = createPrivateKey({ key: Buffer.from(pkcs1, 'base64'), format: 'der', type: 'pkcs1' }).export({
      format: 'jwk',
    });
    const fromOpenssh = readSshPrivate(armour('OPENSSH PRIVATE KEY', openssh, 70)).key;
    expect(fromOpenssh.type, name).toBe('rsa');
    if (fromOpenssh.type !== 'rsa') return;
    // An OpenSSH RSA key carries n, e, d, iqmp, p and q: dp and dq were worked out, and qi was read.
    for (const member of ['n', 'e', 'd', 'p', 'q', 'dp', 'dq', 'qi'] as const) {
      expect(hex(fromOpenssh[member]!), `${name}: ${member}`).toBe(
        Buffer.from(node[member]!, 'base64url').toString('hex'),
      );
    }

    // The same numbers as a JWK without dp, dq and qi.
    const stripped = JSON.stringify({ kty: 'RSA', n: node.n, e: node.e, d: node.d, p: node.p, q: node.q });
    const fromJwk = readKeyInput(stripped).key;
    expect(shape(fromJwk), name).toEqual(shape(fromOpenssh));
    // And with only p and q missing their helpers one at a time.
    for (const missing of ['dp', 'dq', 'qi']) {
      const members: Record<string, string | undefined> = {
        kty: 'RSA',
        n: node.n,
        e: node.e,
        d: node.d,
        p: node.p,
        q: node.q,
        dp: node.dp,
        dq: node.dq,
        qi: node.qi,
      };
      members[missing] = undefined;
      expect(shape(readKeyInput(JSON.stringify(members)).key), `${name}: without ${missing}`).toEqual(
        shape(fromOpenssh),
      );
    }
    // A number that is given and wrong is refused, not replaced.
    const wrong = JSON.stringify({
      kty: 'RSA',
      n: node.n,
      e: node.e,
      d: node.d,
      p: node.p,
      q: node.q,
      dp: node.dq,
      dq: node.dq,
      qi: node.qi,
    });
    expect(refusal(wrong)).toBe('The numbers of this RSA key do not agree.');
  }

  // completeRsa checks the product and fills in what is missing.
  const reference = readPkcs1Private(bytesOf(fx.RSA2048_PKCS1_PRIVATE_DER_B64));
  const { dp, dq, qi, ...rest } = reference;
  expect(dp).toBeDefined();
  expect(dq).toBeDefined();
  expect(qi).toBeDefined();
  expect(shape(completeRsa(rest))).toEqual(shape(reference));
  const publicOnly = completeRsa({ type: 'rsa', n: reference.n, e: reference.e });
  expect(isPrivate(publicOnly)).toBe(false);
  expect(() => completeRsa({ ...rest, p: reference.q!, q: reference.p! })).not.toThrow();
  const brokenProduct = thrown(() => completeRsa({ ...rest, q: reference.q!.map((b, i) => (i === 3 ? b ^ 1 : b)) }));
  expect(brokenProduct).toBeInstanceOf(KeyConverterError);
  expect((brokenProduct as KeyConverterError).message).toBe('The numbers of this RSA key do not agree.');
  const brokenExponent = thrown(() => completeRsa({ ...rest, d: reference.d!.map((b, i) => (i === 5 ? b ^ 1 : b)) }));
  expect(brokenExponent).toBeInstanceOf(KeyConverterError);
  const lonelyD = thrown(() => completeRsa({ type: 'rsa', n: reference.n, e: reference.e, d: reference.d }));
  expect((lonelyD as KeyConverterError).message).toBe(NO_PRIMES_SENTENCE);
});

it('prototype-named JWK members and PEM labels are refused as unknown', () => {
  const x = '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo';
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    expect(typeof refusal(JSON.stringify({ kty: name })), `kty ${name}`).toBe('string');
    expect(typeof refusal(JSON.stringify({ kty: 'EC', crv: name, x, y: x })), `crv ${name}`).toBe('string');
    expect(refusal(JSON.stringify({ kty: 'OKP', crv: name, x })), `OKP crv ${name}`).toBe(CURVE_SENTENCE);
  }
  // A member called __proto__ is an own property of the parsed object; it must not stand in for a missing member.
  const trick = '{"kty":"OKP","crv":"Ed25519","__proto__":{"x":"' + x + '"}}';
  expect(typeof refusal(trick)).toBe('string');
  const rsaTrick = '{"kty":"RSA","e":"AQAB","__proto__":{"n":"AQAB"},"constructor":{"n":"AQAB"}}';
  expect(typeof refusal(rsaTrick)).toBe('string');
  expect(() => readJwk(trick)).toThrow(KeyConverterError);
  // Labels: only capital letters, digits and spaces make a label, and no label finds anything on Object.prototype.
  for (const label of ['CONSTRUCTOR', 'TOSTRING', 'PROTO', 'HASOWNPROPERTY', 'VALUEOF']) {
    const message = refusal(armour(label, 'AAAA'));
    expect(message).not.toContain(label);
  }
  expect(typeof refusal(armour('__PROTO__', 'AAAA'))).toBe('string');
  // A pasted OpenSSH public line with a prototype name as its type is refused the same way.
  expect(typeof refusal('constructor AAAA')).toBe('string');
});

it('no refusal message holds a fragment of the pasted key', () => {
  const marker = 'FODT-MARKER-0123456789-ABCDEFGHIJKLMNOP';
  const markerBase64 = Buffer.from(marker).toString('base64');
  const texts = [
    armour('PRIVATE KEY', 'QUJD' + marker),
    armour('PRIVATE KEY', markerBase64 + markerBase64),
    armour('RSA PRIVATE KEY', markerBase64),
    armour('OPENSSH PRIVATE KEY', markerBase64, 70),
    armour('PUBLIC KEY', markerBase64),
    '{"kty":"EC","crv":"P-256","x":"' + marker + '","y":"AA"}',
    '{"kty":"RSA","n":"' + marker + '$","e":"AQAB"}',
    '{"kty":"' + marker + '"}',
    '{"kty":"EC","crv":"' + marker + '"}',
    '{' + marker,
    'ssh-ed25519 ' + marker,
    'ssh-rsa ' + markerBase64 + ' ' + marker,
    '---- BEGIN SSH2 PUBLIC KEY ----\nComment: "' + marker + '"\n' + markerBase64 + '\n---- END SSH2 PUBLIC KEY ----\n',
    marker,
  ];
  const windows = (text: string, size: number): string[] =>
    Array.from({ length: Math.max(0, text.length - size + 1) }, (_, i) => text.slice(i, i + size));
  for (const text of texts) {
    const err = thrown(() => readKeyInput(text), text.slice(0, 40));
    expect(err).toBeInstanceOf(KeyConverterError);
    const message = (err as KeyConverterError).message;
    for (const piece of [...windows(marker, 8), ...windows(markerBase64, 12)]) {
      expect(message.includes(piece), `${text.slice(0, 30)}: ${message}`).toBe(false);
    }
  }
  // The same holds for a marker inside an otherwise valid key: a comment is not an error and never reaches a warning.
  const read = readKeyInput(fx.P256_SSH_PUBLIC_LINE + ' ' + 'x'.repeat(300));
  expect(read.comment).toBeUndefined();
  expect(read.warnings.join(' ')).not.toContain('xxxxxxxx');
  expect(read.warnings.join(' ')).toMatch(/comment/i);
});

it('OpenSSH files that are cut, padded wrongly or inconsistent are refused', () => {
  const good = Buffer.from(fx.ED25519_OPENSSH_FILE_B64, 'base64');
  const asText = (bytes: Uint8Array): string =>
    armour('OPENSSH PRIVATE KEY', Buffer.from(bytes).toString('base64'), 70);
  expect(readKeyInput(asText(good)).key.type).toBe('ed25519');
  // Cut at several places, from inside the magic to one byte short.
  for (const length of [3, 14, 15, 20, 40, 100, good.length - 9, good.length - 1]) {
    expect(typeof refusal(asText(good.subarray(0, length))), `cut at ${length}`).toBe('string');
  }
  // The padding must be 1, 2, 3 ...: change its last byte.
  const badPadding = Uint8Array.from(good);
  badPadding[badPadding.length - 1] = badPadding[badPadding.length - 1]! ^ 0x40;
  expect(typeof refusal(asText(badPadding))).toBe('string');
  // The two check values must be equal: the section starts after the public key; find it by the magic and the strings.
  const view = new DataView(good.buffer, good.byteOffset, good.byteLength);
  let at = 15;
  for (let i = 0; i < 3; i++) at += 4 + view.getUint32(at); // cipher, kdf and kdf options
  at += 4; // number of keys
  at += 4 + view.getUint32(at); // public key
  const section = at + 4;
  const badCheck = Uint8Array.from(good);
  badCheck[section + 7] = badCheck[section + 7]! ^ 0x01;
  expect(typeof refusal(asText(badCheck))).toBe('string');
  // The outer public key must be the public key of the private part: change a byte of it.
  const badPublic = Uint8Array.from(good);
  badPublic[at - 1] = badPublic[at - 1]! ^ 0x01;
  expect(typeof refusal(asText(badPublic))).toBe('string');
  // More than one key in the file is refused.
  const two = Uint8Array.from(good);
  two[15 + 4 + 4 + 4 + 4 + 4 + 4 + 3] = 2;
  expect(typeof refusal(asText(two))).toBe('string');
  // Extra data after the file, and after the key on a public line, is refused.
  expect(typeof refusal(asText(Buffer.concat([good, Buffer.from([0])])))).toBe('string');
  const [lineType, lineData] = fx.ED25519_SSH_PUBLIC_LINE.split(' ');
  const longer = Buffer.concat([Buffer.from(lineData!, 'base64'), Buffer.from([0])]).toString('base64');
  expect(typeof refusal(lineType + ' ' + longer)).toBe('string');
  // Not an OpenSSH file at all.
  expect(typeof refusal(armour('OPENSSH PRIVATE KEY', 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo='))).toBe('string');
});

it('mutated pastes are refused or read and never fail in any other way', () => {
  // A small seeded generator (mulberry32), so a failure is repeatable.
  let state = 0x14020001;
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const sources: string[] = [
    armour('PRIVATE KEY', fx.P256_PKCS8_DER_B64),
    armour('PRIVATE KEY', fx.ED25519_PKCS8_DER_B64),
    armour('PRIVATE KEY', fx.RSA2048_PKCS8_DER_B64),
    armour('OPENSSH PRIVATE KEY', fx.P384_OPENSSH_FILE_B64, 70),
    armour('OPENSSH PRIVATE KEY', fx.ED25519_OPENSSH_FILE_B64, 70),
    armour('EC PRIVATE KEY', fx.P521_SEC1_DER_B64),
    armour('PUBLIC KEY', fx.RSA2048_SPKI_DER_B64),
    fx.P256_SSH_Y_LINE,
    fx.P256_RFC4716_TEXT,
    RFC8037_PRIVATE_JWK,
    JSON.stringify(RFC7515_RSA_JWK),
  ];
  let read = 0;
  let refused = 0;
  for (let round = 0; round < 3000; round++) {
    const source = sources[round % sources.length]!;
    const chars = Array.from(source);
    const edits = 1 + Math.floor(next() * 3);
    for (let i = 0; i < edits; i++) {
      const at = Math.floor(next() * chars.length);
      const kind = Math.floor(next() * 3);
      if (kind === 0) chars[at] = String.fromCharCode(32 + Math.floor(next() * 95));
      else if (kind === 1) chars.splice(at, 1);
      else chars.splice(at, 0, String.fromCharCode(32 + Math.floor(next() * 95)));
    }
    try {
      readKeyInput(chars.join(''));
      read++;
    } catch (err) {
      expect(err, `round ${round}`).toBeInstanceOf(KeyConverterError);
      expect(err).not.toBeInstanceOf(DerError);
      expect(err).not.toBeInstanceOf(PemError);
      // The catch-all sentence is only a net: a reader that needs it has thrown an error of its own kind.
      expect((err as KeyConverterError).message, `round ${round}`).not.toBe(NET_SENTENCE);
      refused++;
    }
  }
  expect(read + refused).toBe(3000);
  expect(refused).toBeGreaterThan(1000);
}, 60_000);

it('two private keys in one paste, and a public key read next to a matching private key, behave as stated', () => {
  const two = armour('PRIVATE KEY', fx.P256_PKCS8_DER_B64) + armour('PRIVATE KEY', fx.P384_PKCS8_DER_B64);
  expect(typeof refusal(two)).toBe('string');
  const pair = readKeyInput(armour('PRIVATE KEY', fx.P256_PKCS8_DER_B64) + armour('PUBLIC KEY', fx.P256_SPKI_DER_B64));
  expect(isPrivate(pair.key)).toBe(true);
  const reversed = readKeyInput(
    armour('PUBLIC KEY', fx.RSA2048_SPKI_DER_B64) + armour('RSA PRIVATE KEY', fx.RSA2048_PKCS1_PRIVATE_DER_B64),
  );
  expect(isPrivate(reversed.key)).toBe(true);
  expect(
    bytesEqual(
      (readSpki(bytesOf(fx.RSA2048_SPKI_DER_B64)) as { n: Uint8Array }).n,
      (reversed.key as { n: Uint8Array }).n,
    ),
  ).toBe(true);
});

it('an EC private scalar of zero or not below the curve order is refused, and one is accepted', () => {
  // The group orders of FIPS 186-4 appendix D.1.2 (the same numbers as SEC 2 section 2.4), as hex.
  const orders: [string, string, string][] = [
    ['P-256', fx.P256_SEC1_NO_PUBLIC_DER_B64, 'ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551'],
    [
      'P-384',
      fx.P384_SEC1_NO_PUBLIC_DER_B64,
      'ffffffffffffffffffffffffffffffffffffffffffffffffc7634d81f4372ddf581a0db248b0a77aecec196accc52973',
    ],
    [
      'P-521',
      fx.P521_SEC1_NO_PUBLIC_DER_B64,
      '1fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffa51868783bf2f966b7fcc0148f709a5d03bb5c9b8899c47aebb6fb71e91386409',
    ],
  ];
  for (const [name, sec1, order] of orders) {
    const der = Buffer.from(sec1, 'base64');
    // ECPrivateKey: SEQUENCE { INTEGER 1, OCTET STRING d, [0] curve }; the private number starts at byte 7 for these sizes.
    expect(der[5], name).toBe(4);
    const size = der[6]!;
    const withNumber = (value: bigint): string => {
      const copy = Buffer.from(der);
      Buffer.from(value.toString(16).padStart(size * 2, '0'), 'hex').copy(copy, 7);
      return copy.toString('base64');
    };
    const n = BigInt('0x' + order);
    for (const [what, value] of [
      ['zero', 0n],
      ['the order', n],
      ['the order plus one', n + 1n],
      ['the largest value that fits', (1n << BigInt(size * 8)) - 1n],
    ] as const) {
      const message = refusal(armour('EC PRIVATE KEY', withNumber(value)));
      expect(message, `${name}: ${what}`).toBe('The private number is not a valid private key for this curve.');
    }
    // One below the order and one are keys.
    for (const value of [1n, n - 1n]) {
      const read = readKeyInput(armour('EC PRIVATE KEY', withNumber(value)));
      expect(isPrivate(read.key), `${name}: ${value === 1n ? 'one' : 'order minus one'}`).toBe(true);
    }
  }
});
