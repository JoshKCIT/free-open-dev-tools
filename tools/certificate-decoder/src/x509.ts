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
import { readName, type NameInfo } from './names';
import { CURVE_BITS, FIXED_KEY_BITS, KEY_TYPE_NAMES, oidLabel } from './oids';
import { bytesToBase64 } from './pem';

export interface ExtensionInfo {
  oid: string;
  name?: string;
  critical: boolean;
  value: string;
  decoded: boolean;
  note?: string;
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
  publicKey: { type: string; bits?: number; curve?: string; exponent?: string; spkiDer: Uint8Array };
  extensions: ExtensionInfo[];
  sans: { type: string; value: string }[];
  ski?: string;
  aki?: string;
  fingerprints: { sha256: string; sha1: string; md5: string; spkiSha256: string };
  der: Uint8Array;
  warnings: string[];
}

const DAY_MS = 86_400_000;

/** Upper case hex pairs with colons, the form openssl x509 -fingerprint prints. */
function colonHex(bytes: Uint8Array): string {
  const pieces: string[] = [];
  for (const octet of bytes) pieces.push(octet.toString(16).padStart(2, '0').toUpperCase());
  return pieces.join(':');
}

/** The number of bits in an unsigned big-endian number whose leading zero bytes were already removed. */
function bitLength(magnitude: Uint8Array): number {
  const first = magnitude[0] ?? 0;
  if (first === 0) return 0;
  return (magnitude.length - 1) * 8 + (32 - Math.clz32(first));
}

function serialText(content: Uint8Array): string {
  let skip = 0;
  while (skip < content.length - 1 && content[skip] === 0) skip++;
  let text = '';
  for (let i = skip; i < content.length; i++) text += content[i]!.toString(16).padStart(2, '0').toUpperCase();
  return text;
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

/** The type, size and curve of a SubjectPublicKeyInfo. A key that cannot be read in detail still gets its type. */
function readPublicKey(
  bytes: Uint8Array,
  node: DerNode,
  warnings: string[],
): { type: string; bits?: number; curve?: string; exponent?: string; spkiDer: Uint8Array } {
  derExpect(node, 16, 'universal', true);
  const algorithm = readAlgorithm(bytes, derChild(node, 0));
  const keyBits = derBitString(bytes, derChild(node, 1));
  const spkiDer = bytes.subarray(node.start, node.end);
  const type = KEY_TYPE_NAMES.get(algorithm.oid) ?? oidLabel(algorithm.oid);
  const result: { type: string; bits?: number; curve?: string; exponent?: string; spkiDer: Uint8Array } = {
    type,
    spkiDer,
  };
  const fixed = FIXED_KEY_BITS.get(algorithm.oid);
  if (fixed !== undefined) result.bits = fixed;
  try {
    if (algorithm.oid === '1.2.840.113549.1.1.1' || algorithm.oid === '1.2.840.113549.1.1.10') {
      const inner = keyBits.bytes;
      const root = readDer(inner);
      derExpect(root, 16, 'universal', true);
      result.bits = bitLength(derUnsigned(inner, derChild(root, 0)));
    } else if (algorithm.oid === '1.2.840.10045.2.1') {
      const params = algorithm.node.children[1];
      if (params !== undefined && params.cls === 'universal' && params.tag === 6) {
        const curveOid = derOid(bytes, params);
        result.curve = oidLabel(curveOid);
        const bits = CURVE_BITS.get(curveOid);
        if (bits !== undefined) result.bits = bits;
      } else {
        result.curve = 'the curve is written out in full, not named';
      }
    }
  } catch (err) {
    if (!(err instanceof DerError)) throw err;
    warnings.push('The public key could not be read in detail, so its size is not shown.');
  }
  return result;
}

/** Reads one certificate. Throws a DerError when the bytes are not a DER certificate. */
export function readCertificate(der: Uint8Array, nowMs: number): CertificateInfo {
  const root = readDer(der);
  derExpect(root, 16, 'universal', true);
  const tbs = derChild(root, 0);
  const outerAlgorithm = readAlgorithm(der, derChild(root, 1));
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
  const innerAlgorithm = readAlgorithm(der, derChild(tbs, at++));
  const issuer = readName(der, derChild(tbs, at++));
  const validity = derChild(tbs, at++);
  derExpect(validity, 16, 'universal', true);
  const notBefore = derTime(der, derChild(validity, 0));
  const notAfter = derTime(der, derChild(validity, 1));
  const subject = readName(der, derChild(tbs, at++));
  const publicKey = readPublicKey(der, derChild(tbs, at++), warnings);

  const sameAlgorithm =
    innerAlgorithm.oid === outerAlgorithm.oid &&
    sameBytes(
      der.subarray(innerAlgorithm.node.start, innerAlgorithm.node.end),
      der.subarray(outerAlgorithm.node.start, outerAlgorithm.node.end),
    );
  if (!sameAlgorithm) warnings.push('The signature algorithm inside the certificate differs from the one beside it.');

  const signature = derChild(root, 2);
  derBitString(der, signature);

  return {
    kind: 'certificate',
    version,
    serialHex: serialText(serialContent),
    signatureAlgorithm: { name: oidLabel(outerAlgorithm.oid), oid: outerAlgorithm.oid },
    issuer,
    subject,
    notBefore,
    notAfter,
    status: readStatus(notBefore.epochMs, notAfter.epochMs, nowMs),
    publicKey,
    extensions: [],
    sans: [],
    fingerprints: {
      sha256: colonHex(sha256(der)),
      sha1: colonHex(sha1(der)),
      md5: colonHex(md5(der)),
      spkiSha256: bytesToBase64(sha256(publicKey.spkiDer)),
    },
    der,
    warnings,
  };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
