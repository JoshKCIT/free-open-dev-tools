/**
 * PKCS#8 (RFC 5958) and SubjectPublicKeyInfo (RFC 5280) read from and written to the package's own key model.
 *
 * RSA layouts (RFC 8017 appendix A): PKCS#8 is SEQUENCE { INTEGER 0, SEQUENCE { OID rsaEncryption, NULL }, OCTET STRING
 * { RSAPrivateKey } } and SubjectPublicKeyInfo is SEQUENCE { SEQUENCE { OID rsaEncryption, NULL }, BIT STRING
 * { RSAPublicKey } }. Reading is strict DER, and a private key is checked: the modulus must equal the product of its
 * two primes.
 *
 * RULE, stated once and enforced by a test: no message thrown or returned from this file may ever contain a fragment
 * of a key, a secret, or a token. Describe the shape of the problem, never the content.
 */
import { derBitString, derChild, derContent, derExpect, derOid, derUnsigned, readDer, type DerNode } from './der';
import { NULL_DER, bitString, octet, oid, seq, smallInt, uint } from './der-write';
import { KeyConverterError, RSA_MAX_BITS, keyBits, type KeyModel, type RsaKey } from './model';

const RSA_ENCRYPTION = '1.2.840.113549.1.1.1';

function magnitudeToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const octetValue of bytes) value = (value << 8n) | BigInt(octetValue);
  return value;
}

function checkRsaSize(n: Uint8Array): void {
  const key: RsaKey = { type: 'rsa', n, e: Uint8Array.of(1) };
  if (keyBits(key) > RSA_MAX_BITS) {
    throw new KeyConverterError(`This RSA key is larger than ${RSA_MAX_BITS} bits, which is the most this page reads.`);
  }
}

function expectNullOrAbsent(algorithm: DerNode): void {
  if (algorithm.children.length > 2) {
    throw new KeyConverterError('The algorithm identifier holds more than an algorithm and its parameters.');
  }
  const parameters = algorithm.children[1];
  if (parameters !== undefined) derExpect(parameters, 5);
}

function rsaFromPkcs1Private(bytes: Uint8Array): RsaKey {
  const root = readDer(bytes);
  derExpect(root, 16, 'universal', true);
  if (root.children.length < 9) {
    throw new KeyConverterError('The RSA private key does not hold the nine numbers RFC 8017 requires.');
  }
  const version = derUnsigned(bytes, derChild(root, 0));
  if (version.length !== 1 || version[0] !== 0) {
    throw new KeyConverterError('Only two-prime RSA private keys (version 0) are supported.');
  }
  const [n, e, d, p, q, dp, dq, qi] = [1, 2, 3, 4, 5, 6, 7, 8].map((index) =>
    derUnsigned(bytes, derChild(root, index)),
  );
  checkRsaSize(n!);
  if (magnitudeToBigInt(p!) * magnitudeToBigInt(q!) !== magnitudeToBigInt(n!)) {
    throw new KeyConverterError(
      'The numbers of this RSA key do not agree: the modulus is not the product of the two primes.',
    );
  }
  return { type: 'rsa', n: n!, e: e!, d: d!, p: p!, q: q!, dp: dp!, dq: dq!, qi: qi! };
}

/** Reads an unencrypted PKCS#8 private key (the DER bytes inside a PRIVATE KEY block). */
export function readPkcs8(der: Uint8Array): KeyModel {
  const root = readDer(der);
  derExpect(root, 16, 'universal', true);
  if (root.children.length < 3) {
    throw new KeyConverterError('This PKCS#8 key does not hold a version, an algorithm and a private key.');
  }
  const version = derUnsigned(der, derChild(root, 0));
  if (version.length !== 1 || version[0]! > 1) {
    throw new KeyConverterError('This PKCS#8 key has a version this page does not know.');
  }
  const algorithm = derChild(root, 1);
  derExpect(algorithm, 16, 'universal', true);
  const algorithmOid = derOid(der, derChild(algorithm, 0));
  const privateKey = derChild(root, 2);
  derExpect(privateKey, 4, 'universal', false);
  if (algorithmOid === RSA_ENCRYPTION) {
    expectNullOrAbsent(algorithm);
    return rsaFromPkcs1Private(derContent(der, privateKey));
  }
  throw new KeyConverterError(`This key uses the algorithm ${algorithmOid}, which this page does not read.`);
}

/** Reads a SubjectPublicKeyInfo public key (the DER bytes inside a PUBLIC KEY block). */
export function readSpki(der: Uint8Array): KeyModel {
  const root = readDer(der);
  derExpect(root, 16, 'universal', true);
  if (root.children.length !== 2) {
    throw new KeyConverterError('This public key does not hold an algorithm and a key.');
  }
  const algorithm = derChild(root, 0);
  derExpect(algorithm, 16, 'universal', true);
  const algorithmOid = derOid(der, derChild(algorithm, 0));
  const bits = derBitString(der, derChild(root, 1));
  if (bits.unusedBits !== 0) throw new KeyConverterError('The public key bits do not end on a byte boundary.');
  if (algorithmOid === RSA_ENCRYPTION) {
    expectNullOrAbsent(algorithm);
    const inner = readDer(bits.bytes);
    derExpect(inner, 16, 'universal', true);
    if (inner.children.length !== 2) {
      throw new KeyConverterError('The RSA public key does not hold a modulus and an exponent.');
    }
    const n = derUnsigned(bits.bytes, derChild(inner, 0));
    const e = derUnsigned(bits.bytes, derChild(inner, 1));
    checkRsaSize(n);
    return { type: 'rsa', n, e };
  }
  throw new KeyConverterError(`This key uses the algorithm ${algorithmOid}, which this page does not read.`);
}

function requirePrivate(key: RsaKey): Required<RsaKey> {
  const { d, p, q, dp, dq, qi } = key;
  if (
    d === undefined ||
    p === undefined ||
    q === undefined ||
    dp === undefined ||
    dq === undefined ||
    qi === undefined
  ) {
    throw new KeyConverterError('This key has no private part, so it cannot be written as a private key.');
  }
  return { ...key, d, p, q, dp, dq, qi };
}

/** The PKCS#1 RSAPrivateKey (RFC 8017 A.1.2) of a private key. */
function rsaPkcs1Private(key: RsaKey): Uint8Array {
  const k = requirePrivate(key);
  return seq(smallInt(0), uint(k.n), uint(k.e), uint(k.d), uint(k.p), uint(k.q), uint(k.dp), uint(k.dq), uint(k.qi));
}

/** The PKCS#8 PrivateKeyInfo bytes of a private key. */
export function writePkcs8(key: KeyModel): Uint8Array {
  return seq(smallInt(0), seq(oid(RSA_ENCRYPTION), NULL_DER), octet(rsaPkcs1Private(key)));
}

/** The SubjectPublicKeyInfo bytes of the public part of a key. */
export function writeSpki(key: KeyModel): Uint8Array {
  return seq(seq(oid(RSA_ENCRYPTION), NULL_DER), bitString(seq(uint(key.n), uint(key.e))));
}
