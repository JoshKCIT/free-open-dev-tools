/**
 * PKCS#8 (RFC 5958) and SubjectPublicKeyInfo (RFC 5280) read from and written to the package's own key model.
 *
 * Layouts. RSA (RFC 8017 appendix A): PKCS#8 is SEQUENCE { INTEGER 0, SEQUENCE { OID rsaEncryption, NULL }, OCTET
 * STRING { RSAPrivateKey } } and SubjectPublicKeyInfo is SEQUENCE { SEQUENCE { OID rsaEncryption, NULL }, BIT STRING
 * { RSAPublicKey } }. ECDSA (RFC 5915 and RFC 5480): the algorithm is SEQUENCE { OID id-ecPublicKey, OID curve }, the
 * private key is an ECPrivateKey { INTEGER 1, OCTET STRING d, [1] { BIT STRING point } } with the curve parameters left
 * to the algorithm identifier, and the public key is the uncompressed point. Ed25519 (RFC 8410): the algorithm is
 * SEQUENCE { OID 1.3.101.112 } with no parameters, the private key is OCTET STRING { OCTET STRING seed } and the public
 * key is the 32 bytes.
 *
 * Reading is strict DER. A private key is checked: an RSA modulus must equal the product of its two primes, and the
 * public part of an elliptic curve or Ed25519 private key is recomputed with @noble/curves, so a supplied public part
 * that is not the one the private key gives is refused. A public key alone must be a point on its curve.
 *
 * RULE, stated once and enforced by a test: no message thrown or returned from this file may ever contain a fragment
 * of a key, a secret, or a token. Describe the shape of the problem, never the content.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { p256, p384, p521 } from '@noble/curves/nist.js';
import { derBitString, derChild, derContent, derExpect, derOid, derUnsigned, readDer, type DerNode } from './der';
import { NULL_DER, bitString, ctx, octet, oid, seq, smallInt, uint } from './der-write';
import {
  CURVES,
  KeyConverterError,
  RSA_MAX_BITS,
  bytesEqual,
  keyBits,
  type Curve,
  type CurveInfo,
  type EcKey,
  type Ed25519Key,
  type KeyModel,
  type RsaKey,
} from './model';

const RSA_ENCRYPTION = '1.2.840.113549.1.1.1';
const EC_PUBLIC_KEY = '1.2.840.10045.2.1';
const ED25519 = '1.3.101.112';

const DOES_NOT_BELONG = 'The public key does not belong to this private key.';

/** The curve library for each curve, looked up by name. */
const CURVE_LIBS = new Map<Curve, typeof p256>([
  ['P-256', p256],
  ['P-384', p384],
  ['P-521', p521],
]);

/** The curve a curve object identifier names, looked up with a Map so no typed text can reach Object.prototype. */
const CURVE_BY_OID = new Map<string, Curve>(Array.from(CURVES, ([name, info]) => [info.oid, name]));

function curveInfo(curve: Curve): CurveInfo {
  const info = CURVES.get(curve);
  if (info === undefined) throw new KeyConverterError('This elliptic curve is not supported.');
  return info;
}

function curveLib(curve: Curve): typeof p256 {
  const lib = CURVE_LIBS.get(curve);
  if (lib === undefined) throw new KeyConverterError('This elliptic curve is not supported.');
  return lib;
}

function magnitudeToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const octetValue of bytes) value = (value << 8n) | BigInt(octetValue);
  return value;
}

/** A magnitude as exactly `size` bytes: leading zeros removed and the value padded on the left, or refused if larger. */
function padTo(bytes: Uint8Array, size: number): Uint8Array {
  let skip = 0;
  while (skip < bytes.length && bytes[skip] === 0) skip++;
  const trimmed = bytes.subarray(skip);
  if (trimmed.length > size) throw new KeyConverterError('The private number is longer than this curve allows.');
  const out = new Uint8Array(size);
  out.set(trimmed, size - trimmed.length);
  return out;
}

function checkRsaSize(n: Uint8Array): void {
  const key: RsaKey = { type: 'rsa', n, e: Uint8Array.of(1) };
  if (keyBits(key) > RSA_MAX_BITS) {
    throw new KeyConverterError(`This RSA key is larger than ${RSA_MAX_BITS} bits, which is the most this page reads.`);
  }
}

/** An algorithm identifier whose parameters must be NULL or absent (RSA). */
function expectNullOrAbsent(algorithm: DerNode): void {
  if (algorithm.children.length > 2) {
    throw new KeyConverterError('The algorithm identifier holds more than an algorithm and its parameters.');
  }
  const parameters = algorithm.children[1];
  if (parameters !== undefined) derExpect(parameters, 5);
}

/** An algorithm identifier that must carry no parameters (Ed25519, RFC 8410 section 3). */
function expectNoParameters(algorithm: DerNode): void {
  if (algorithm.children.length !== 1) {
    throw new KeyConverterError('An Ed25519 algorithm identifier must not carry parameters.');
  }
}

/** The curve named by the second element of an elliptic curve algorithm identifier. */
function curveOfAlgorithm(der: Uint8Array, algorithm: DerNode): Curve {
  if (algorithm.children.length !== 2) {
    throw new KeyConverterError('An elliptic curve algorithm identifier must name its curve.');
  }
  const curveOid = derOid(der, derChild(algorithm, 1));
  const curve = CURVE_BY_OID.get(curveOid);
  if (curve === undefined) {
    throw new KeyConverterError(`This key uses the curve ${curveOid}, which this page does not read.`);
  }
  return curve;
}

/** The public point of a private number, or a plain refusal when the number is not a valid private key for the curve. */
function ecPublicFromPrivate(curve: Curve, d: Uint8Array): Uint8Array {
  try {
    return Uint8Array.from(curveLib(curve).getPublicKey(d, false));
  } catch (err) {
    if (err instanceof KeyConverterError) throw err;
    throw new KeyConverterError('The private number is not a valid private key for this curve.');
  }
}

/** A public point as the uncompressed encoding, after checking that it is a point on the curve. */
function ecNormalizePoint(curve: Curve, point: Uint8Array): Uint8Array {
  try {
    return Uint8Array.from(curveLib(curve).Point.fromBytes(point).toBytes(false));
  } catch {
    throw new KeyConverterError('The public key is not a point on the curve.');
  }
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

function ecFromEcPrivateKey(bytes: Uint8Array, curve: Curve): EcKey {
  const info = curveInfo(curve);
  const root = readDer(bytes);
  derExpect(root, 16, 'universal', true);
  if (root.children.length < 2) {
    throw new KeyConverterError('The elliptic curve private key does not hold a version and a private number.');
  }
  const version = derUnsigned(bytes, derChild(root, 0));
  if (version.length !== 1 || version[0] !== 1) {
    throw new KeyConverterError('This elliptic curve private key has a version this page does not know.');
  }
  const number = derChild(root, 1);
  derExpect(number, 4, 'universal', false);
  const d = padTo(derContent(bytes, number), info.size);
  let supplied: Uint8Array | undefined;
  for (const extra of root.children.slice(2)) {
    if (extra.cls === 'context' && extra.tag === 0) {
      // Parameters inside the key (RFC 5915): when present they must name the curve of the algorithm identifier.
      if (derOid(bytes, derChild(extra, 0)) !== info.oid) {
        throw new KeyConverterError('The curve inside the private key is not the curve of its algorithm identifier.');
      }
    } else if (extra.cls === 'context' && extra.tag === 1) {
      const bits = derBitString(bytes, derChild(extra, 0));
      if (bits.unusedBits !== 0) throw new KeyConverterError('The public key bits do not end on a byte boundary.');
      supplied = bits.bytes;
    } else {
      throw new KeyConverterError('The elliptic curve private key holds an element this page does not know.');
    }
  }
  const point = ecPublicFromPrivate(curve, d);
  if (supplied !== undefined && !bytesEqual(supplied, point)) {
    // A compressed encoding of the same point is also the same key.
    let same = false;
    try {
      same = bytesEqual(Uint8Array.from(curveLib(curve).Point.fromBytes(supplied).toBytes(false)), point);
    } catch {
      same = false;
    }
    if (!same) throw new KeyConverterError(DOES_NOT_BELONG);
  }
  return { type: 'ec', curve, point, d };
}

function ed25519FromCurvePrivateKey(content: Uint8Array, publicBits: Uint8Array | undefined): Ed25519Key {
  const inner = readDer(content);
  derExpect(inner, 4, 'universal', false);
  const seed = derContent(content, inner);
  if (seed.length !== 32) throw new KeyConverterError('An Ed25519 private key is 32 bytes.');
  const pub = Uint8Array.from(ed25519.getPublicKey(seed));
  if (publicBits !== undefined) {
    if (publicBits.length !== 33 || publicBits[0] !== 0 || !bytesEqual(publicBits.subarray(1), pub)) {
      throw new KeyConverterError(DOES_NOT_BELONG);
    }
  }
  return { type: 'ed25519', pub, seed: Uint8Array.from(seed) };
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
  const content = derContent(der, privateKey);
  if (algorithmOid === RSA_ENCRYPTION) {
    expectNullOrAbsent(algorithm);
    return rsaFromPkcs1Private(content);
  }
  if (algorithmOid === EC_PUBLIC_KEY) {
    return ecFromEcPrivateKey(content, curveOfAlgorithm(der, algorithm));
  }
  if (algorithmOid === ED25519) {
    expectNoParameters(algorithm);
    // Version 1 (RFC 5958) may carry the public key as [1] after the optional attributes [0].
    let publicBits: Uint8Array | undefined;
    for (const extra of root.children.slice(3)) {
      if (extra.cls === 'context' && extra.tag === 1 && !extra.constructed) publicBits = derContent(der, extra);
    }
    return ed25519FromCurvePrivateKey(content, publicBits);
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
  if (algorithmOid === EC_PUBLIC_KEY) {
    const curve = curveOfAlgorithm(der, algorithm);
    return { type: 'ec', curve, point: ecNormalizePoint(curve, bits.bytes) };
  }
  if (algorithmOid === ED25519) {
    expectNoParameters(algorithm);
    if (bits.bytes.length !== 32) throw new KeyConverterError('An Ed25519 public key is 32 bytes.');
    try {
      ed25519.Point.fromBytes(bits.bytes);
    } catch {
      throw new KeyConverterError('The public key is not a valid Ed25519 point.');
    }
    return { type: 'ed25519', pub: Uint8Array.from(bits.bytes) };
  }
  throw new KeyConverterError(`This key uses the algorithm ${algorithmOid}, which this page does not read.`);
}

function requirePrivateRsa(key: RsaKey): Required<RsaKey> {
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
  const k = requirePrivateRsa(key);
  return seq(smallInt(0), uint(k.n), uint(k.e), uint(k.d), uint(k.p), uint(k.q), uint(k.dp), uint(k.dq), uint(k.qi));
}

/** The PKCS#8 PrivateKeyInfo bytes of a private key. */
export function writePkcs8(key: KeyModel): Uint8Array {
  switch (key.type) {
    case 'rsa':
      return seq(smallInt(0), seq(oid(RSA_ENCRYPTION), NULL_DER), octet(rsaPkcs1Private(key)));
    case 'ec': {
      if (key.d === undefined) {
        throw new KeyConverterError('This key has no private part, so it cannot be written as a private key.');
      }
      const info = curveInfo(key.curve);
      // The shape every browser, OpenSSL and Node write: no parameters inside, the public key inside as [1].
      return seq(
        smallInt(0),
        seq(oid(EC_PUBLIC_KEY), oid(info.oid)),
        octet(seq(smallInt(1), octet(padTo(key.d, info.size)), ctx(1, bitString(key.point)))),
      );
    }
    case 'ed25519': {
      if (key.seed === undefined) {
        throw new KeyConverterError('This key has no private part, so it cannot be written as a private key.');
      }
      return seq(smallInt(0), seq(oid(ED25519)), octet(octet(key.seed)));
    }
  }
}

/** The SubjectPublicKeyInfo bytes of the public part of a key. */
export function writeSpki(key: KeyModel): Uint8Array {
  switch (key.type) {
    case 'rsa':
      return seq(seq(oid(RSA_ENCRYPTION), NULL_DER), bitString(seq(uint(key.n), uint(key.e))));
    case 'ec':
      return seq(seq(oid(EC_PUBLIC_KEY), oid(curveInfo(key.curve).oid)), bitString(key.point));
    case 'ed25519':
      return seq(seq(oid(ED25519)), bitString(key.pub));
  }
}
