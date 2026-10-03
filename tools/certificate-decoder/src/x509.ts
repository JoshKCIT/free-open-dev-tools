/**
 * An X.509 certificate (RFC 5280 section 4.1) read from its DER bytes with the strict reader in der.ts.
 *
 * Nothing here checks a signature, a chain, a revocation or a host name: the model says what the certificate contains and
 * nothing about whether to trust it. The clock is an argument, never read here.
 *
 * RULE (as in der.ts): no message from this file may hold a fragment of a pasted value.
 */
import { sha1, md5 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  DerError,
  derBitString,
  derChild,
  derExpect,
  derIntegerContent,
  derOid,
  derTime,
  derUnsigned,
  readDer,
  type DerNode,
} from './der';
import { readExtensions, type ExtensionInfo } from './extensions';
import { bigIntOf, colonHex, integerHex } from './hex';
import { readName, type NameInfo } from './names';
import { CURVE_BITS, FIXED_KEY_BITS, KEY_TYPE_NAMES, oidLabel } from './oids';
import { bytesToBase64, bytesToPem } from './pem';

export type { ExtensionInfo } from './extensions';

export interface PublicKeyInfo {
  type: string;
  /** The size in bits, for the algorithms that have one. */
  bits?: number;
  curve?: string;
  /** The RSA public exponent in decimal. */
  exponent?: string;
  /** The number of bytes in the key, for an algorithm whose size is not given in bits (ML-DSA, an unknown algorithm). */
  keyBytes?: number;
  /** The DER of the whole SubjectPublicKeyInfo. */
  spkiDer: Uint8Array;
  /** The SubjectPublicKeyInfo as PEM text (a PUBLIC KEY block). */
  pem: string;
}

export interface CertificateInfo {
  kind: 'certificate';
  version: number;
  /** The serial number as upper case hex, without a sign octet or leading zero bytes, as openssl x509 -serial prints it. */
  serialHex: string;
  signatureAlgorithm: { name: string; oid: string; params?: string };
  issuer: NameInfo;
  subject: NameInfo;
  notBefore: { iso: string; epochMs: number };
  notAfter: { iso: string; epochMs: number };
  status: { state: 'not-yet-valid' | 'valid' | 'expired'; days: number };
  publicKey: PublicKeyInfo;
  extensions: ExtensionInfo[];
  sans: { type: string; value: string }[];
  /** The subject key identifier, as colon hex. */
  ski?: string;
  /** The key identifier part of the authority key identifier, as colon hex. */
  aki?: string;
  fingerprints: { sha256: string; sha1: string; md5: string; spkiSha256: string };
  der: Uint8Array;
  warnings: string[];
}

const DAY_MS = 86_400_000;
const REPLACEMENT = String.fromCodePoint(0xfffd);

const RSA = '1.2.840.113549.1.1.1';
const RSA_PSS = '1.2.840.113549.1.1.10';
const EC_PUBLIC_KEY = '1.2.840.10045.2.1';
const DSA = '1.2.840.10040.4.1';
const SUBJECT_ALT_NAME = '2.5.29.17';
const SUBJECT_KEY_IDENTIFIER = '2.5.29.14';
const AUTHORITY_KEY_IDENTIFIER = '2.5.29.35';

/** Signature algorithms built on a hash that is no longer considered safe for signatures, with the hash's name. */
const WEAK_SIGNATURE_HASHES = new Map<string, string>([
  ['1.2.840.113549.1.1.2', 'MD2'],
  ['1.2.840.113549.1.1.4', 'MD5'],
  ['1.2.840.113549.1.1.5', 'SHA-1'],
  ['1.2.840.10045.4.1', 'SHA-1'],
  ['1.2.840.10040.4.3', 'SHA-1'],
]);

/** The number of bits in an unsigned big-endian number whose leading zero bytes were already removed. */
function bitLength(magnitude: Uint8Array): number {
  const first = magnitude[0] ?? 0;
  if (first === 0) return 0;
  return (magnitude.length - 1) * 8 + (32 - Math.clz32(first));
}

interface Algorithm {
  oid: string;
  node: DerNode;
}

function readAlgorithm(bytes: Uint8Array, node: DerNode): Algorithm {
  derExpect(node, 16, 'universal', true);
  return { oid: derOid(bytes, derChild(node, 0)), node };
}

function readStatus(notBefore: number, notAfter: number, nowMs: number): CertificateInfo['status'] {
  if (nowMs < notBefore) return { state: 'not-yet-valid', days: Math.floor((notBefore - nowMs) / DAY_MS) };
  if (nowMs > notAfter) return { state: 'expired', days: Math.floor((nowMs - notAfter) / DAY_MS) };
  return { state: 'valid', days: Math.floor((notAfter - nowMs) / DAY_MS) };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The hash named by an AlgorithmIdentifier, for the parameters of RSASSA-PSS. */
function hashName(bytes: Uint8Array, node: DerNode): string {
  return oidLabel(readAlgorithm(bytes, node).oid);
}

/**
 * The parameters of RSASSA-PSS (RFC 4055 section 3.1) as one line: the hash, the mask generation function with its own
 * hash, and the salt length. A field left out takes the default RFC 4055 gives it: SHA-1, MGF1 with SHA-1 and 20 bytes.
 */
function pssParameters(bytes: Uint8Array, algorithm: Algorithm): string {
  const params = algorithm.node.children[1];
  let hash = 'SHA-1';
  let mask = 'MGF1 with SHA-1';
  let salt = '20';
  if (params !== undefined && !(params.cls === 'universal' && params.tag === 5)) {
    derExpect(params, 16, 'universal', true);
    for (const field of params.children) {
      const inner = field.children[0];
      if (field.cls !== 'context' || inner === undefined) continue;
      if (field.tag === 0) {
        hash = hashName(bytes, inner);
      } else if (field.tag === 1) {
        const generator = readAlgorithm(bytes, inner);
        const hashNode = generator.node.children[1];
        mask = `${oidLabel(generator.oid)}${hashNode === undefined ? '' : ` with ${hashName(bytes, hashNode)}`}`;
      } else if (field.tag === 2) {
        salt = bigIntOf(derUnsigned(bytes, inner)).toString();
      }
    }
  }
  return `hash ${hash}, mask ${mask}, salt length ${salt}`;
}

/** The type, size and curve of a SubjectPublicKeyInfo. A key that cannot be read in detail still gets its type. */
function readPublicKey(bytes: Uint8Array, node: DerNode, warnings: string[]): PublicKeyInfo {
  derExpect(node, 16, 'universal', true);
  const algorithm = readAlgorithm(bytes, derChild(node, 0));
  const keyBits = derBitString(bytes, derChild(node, 1));
  const spkiDer = bytes.subarray(node.start, node.end);
  const type = KEY_TYPE_NAMES.get(algorithm.oid) ?? oidLabel(algorithm.oid);
  const result: PublicKeyInfo = { type, spkiDer, pem: bytesToPem('PUBLIC KEY', spkiDer) };
  const fixed = FIXED_KEY_BITS.get(algorithm.oid);
  if (fixed !== undefined) result.bits = fixed;
  try {
    if (algorithm.oid === RSA || algorithm.oid === RSA_PSS) {
      const inner = keyBits.bytes;
      const root = readDer(inner);
      derExpect(root, 16, 'universal', true);
      result.bits = bitLength(derUnsigned(inner, derChild(root, 0)));
      result.exponent = bigIntOf(derUnsigned(inner, derChild(root, 1))).toString();
    } else if (algorithm.oid === EC_PUBLIC_KEY) {
      const params = algorithm.node.children[1];
      if (params !== undefined && params.cls === 'universal' && params.tag === 6) {
        const curveOid = derOid(bytes, params);
        result.curve = oidLabel(curveOid);
        const bits = CURVE_BITS.get(curveOid);
        if (bits !== undefined) result.bits = bits;
      } else {
        result.curve = 'the curve is written out in full, not named';
      }
    } else if (algorithm.oid === DSA) {
      const params = algorithm.node.children[1];
      if (params !== undefined) {
        derExpect(params, 16, 'universal', true);
        result.bits = bitLength(derUnsigned(bytes, derChild(params, 0)));
      }
    } else if (fixed === undefined) {
      result.keyBytes = keyBits.bytes.length;
    }
  } catch (err) {
    if (!(err instanceof DerError)) throw err;
    warnings.push('The public key could not be read in detail, so its size is not shown.');
  }
  return result;
}

function mentionsReplacement(text: string): boolean {
  return text.includes(REPLACEMENT);
}

/** Reads one certificate. Throws a DerError when the bytes are not a DER certificate. */
export function readCertificate(der: Uint8Array, nowMs: number): CertificateInfo {
  const root = readDer(der);
  derExpect(root, 16, 'universal', true);
  const tbs = derChild(root, 0);
  const outerAlgorithm = readAlgorithm(der, derChild(root, 1));
  derBitString(der, derChild(root, 2));
  derExpect(tbs, 16, 'universal', true);
  const warnings: string[] = [];

  let at = 0;
  let version = 1;
  const first = derChild(tbs, 0);
  if (first.cls === 'context' && first.tag === 0) {
    const number = derUnsigned(der, derChild(first, 0));
    if (number.length > 2) throw new DerError(`The version number at offset ${first.start} is too large.`, first.start);
    version = (number.length === 2 ? number[0]! * 256 + number[1]! : number[0]!) + 1;
    if (version > 3) warnings.push(`The version number is ${version}, which RFC 5280 does not define.`);
    at = 1;
  }
  const serialContent = derIntegerContent(der, derChild(tbs, at++));
  if ((serialContent[0]! & 0x80) !== 0) warnings.push('The serial number is negative, which RFC 5280 does not allow.');
  const innerAlgorithm = readAlgorithm(der, derChild(tbs, at++));
  const issuer = readName(der, derChild(tbs, at++));
  const validity = derChild(tbs, at++);
  derExpect(validity, 16, 'universal', true);
  const notBefore = derTime(der, derChild(validity, 0));
  const notAfter = derTime(der, derChild(validity, 1));
  const subject = readName(der, derChild(tbs, at++));
  const publicKey = readPublicKey(der, derChild(tbs, at++), warnings);

  let extensions: ExtensionInfo[] = [];
  for (const field of tbs.children.slice(at)) {
    if (field.cls === 'context' && field.tag === 3) extensions = readExtensions(der, derChild(field, 0));
  }

  const sameAlgorithm =
    innerAlgorithm.oid === outerAlgorithm.oid &&
    sameBytes(
      der.subarray(innerAlgorithm.node.start, innerAlgorithm.node.end),
      der.subarray(outerAlgorithm.node.start, outerAlgorithm.node.end),
    );
  if (!sameAlgorithm) warnings.push('The signature algorithm inside the certificate differs from the one beside it.');

  const signatureAlgorithm: CertificateInfo['signatureAlgorithm'] = {
    name: oidLabel(outerAlgorithm.oid),
    oid: outerAlgorithm.oid,
  };
  if (outerAlgorithm.oid === RSA_PSS) {
    try {
      signatureAlgorithm.params = pssParameters(der, outerAlgorithm);
    } catch (err) {
      if (!(err instanceof DerError)) throw err;
      warnings.push('The parameters of the signature algorithm could not be read.');
    }
  }

  const weakHash = WEAK_SIGNATURE_HASHES.get(outerAlgorithm.oid);
  if (weakHash !== undefined) {
    warnings.push(`The signature uses ${weakHash}, which is no longer considered safe for signatures.`);
  }
  if (
    (publicKey.type === 'RSA' || publicKey.type === 'RSA-PSS' || publicKey.type === 'DSA') &&
    publicKey.bits !== undefined
  ) {
    if (publicKey.bits < 2048) {
      warnings.push(
        `The ${publicKey.type} public key is ${publicKey.bits} bits. Keys under 2048 bits are considered weak.`,
      );
    }
  }
  if (notAfter.epochMs < notBefore.epochMs) warnings.push('The certificate ends before it starts.');

  const sans = extensions.find((extension) => extension.oid === SUBJECT_ALT_NAME)?.names ?? [];
  const ski = extensions.find((extension) => extension.oid === SUBJECT_KEY_IDENTIFIER)?.keyId;
  const aki = extensions.find((extension) => extension.oid === AUTHORITY_KEY_IDENTIFIER)?.keyId;

  const replaced =
    issuer.replaced ||
    subject.replaced ||
    sans.some((san) => mentionsReplacement(san.value)) ||
    extensions.some((extension) => extension.value.some(mentionsReplacement));
  if (replaced) {
    warnings.push(
      'Some text in this certificate holds bytes that do not belong to its string type; they are shown as U+FFFD.',
    );
  }

  const info: CertificateInfo = {
    kind: 'certificate',
    version,
    serialHex: integerHex(serialContent),
    signatureAlgorithm,
    issuer,
    subject,
    notBefore,
    notAfter,
    status: readStatus(notBefore.epochMs, notAfter.epochMs, nowMs),
    publicKey,
    extensions,
    sans,
    fingerprints: {
      sha256: colonHex(sha256(der)),
      sha1: colonHex(sha1(der)),
      md5: colonHex(md5(der)),
      spkiSha256: bytesToBase64(sha256(publicKey.spkiDer)),
    },
    der,
    warnings,
  };
  if (ski !== undefined) info.ski = ski;
  if (aki !== undefined) info.aki = aki;
  return info;
}
