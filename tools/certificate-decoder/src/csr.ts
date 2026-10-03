/**
 * A PKCS #10 certification request (RFC 2986 section 4.2) read from its DER bytes with the strict reader in der.ts.
 *
 * The model says what the request asks for: the subject, the public key, the signature algorithm, the attributes and the
 * extensions requested through the extension request attribute. It does not check the request's signature, and a request
 * says nothing about whether any authority has issued or would issue a certificate for it. A challenge password is shown as
 * present and never as its value.
 *
 * RULE (as in der.ts): no message from this file may hold a fragment of a pasted value.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import {
  DerError,
  derBitString,
  derChild,
  derContent,
  derExpect,
  derHex,
  derOid,
  derString,
  readDer,
  type DerNode,
} from './der';
import { readExtensions, type ExtensionInfo } from './extensions';
import { cappedHex } from './hex';
import { readName, type NameInfo } from './names';
import { oidLabel } from './oids';
import { describeSignature, readAlgorithm, readPublicKey, type PublicKeyInfo } from './x509';

export interface CsrAttribute {
  oid: string;
  /** The name when this package knows the identifier, else the dotted identifier. */
  name: string;
  /** The values as lines of text; a challenge password is one line saying it is present. */
  value: string[];
}

export interface CsrInfo {
  kind: 'request';
  /** The version as people count it: 1 for the only version RFC 2986 defines (written as 0 in the request). */
  version: number;
  subject: NameInfo;
  publicKey: PublicKeyInfo;
  signatureAlgorithm: { name: string; oid: string; params?: string };
  attributes: CsrAttribute[];
  /** The extensions asked for through the extension request attribute. */
  extensions: ExtensionInfo[];
  sans: { type: string; value: string }[];
  /** The SHA-256 of the whole request DER as lower case hex, as openssl dgst -sha256 prints it. */
  requestSha256: string;
  der: Uint8Array;
  warnings: string[];
}

const EXTENSION_REQUEST = '1.2.840.113549.1.9.14';
const CHALLENGE_PASSWORD = '1.2.840.113549.1.9.7';
const SUBJECT_ALT_NAME = '2.5.29.17';

/** Attribute types a request can carry (RFC 2985 section 5.4), by object identifier. */
const ATTRIBUTE_NAMES: ReadonlyMap<string, string> = new Map([
  ['1.2.840.113549.1.9.2', 'unstructuredName'],
  ['1.2.840.113549.1.9.7', 'challengePassword'],
  ['1.2.840.113549.1.9.8', 'unstructuredAddress'],
  ['1.2.840.113549.1.9.14', 'extensionRequest'],
  ['1.2.840.113549.1.9.15', 'smimeCapabilities'],
]);

/** The most attributes shown, and the most lines one attribute shows. */
export const MAX_ATTRIBUTES = 200;
export const MAX_ATTRIBUTE_LINES = 20;

/**
 * True when the DER is shaped like a certification request and not a certificate. A certificate's TBS part begins with an
 * optional [0] version, then a serial number, and has at least six fields; a request's information part is a version, a
 * name, a key and an optional [0] attribute set, so it has three or four fields. Anything that cannot be read is not
 * claimed as a request, so the certificate reader gives the plain message for it.
 */
export function isRequestDer(der: Uint8Array): boolean {
  try {
    const root = readDer(der);
    const info = root.children[0];
    if (root.cls !== 'universal' || root.tag !== 16 || info === undefined) return false;
    const first = info.children[0];
    if (first === undefined || (first.cls === 'context' && first.tag === 0)) return false;
    return info.children.length >= 3 && info.children.length <= 4;
  } catch (err) {
    if (err instanceof DerError) return false;
    throw err;
  }
}

/** One attribute value as a line of text: a character string as itself, anything else as capped hex of its DER. */
function valueLine(bytes: Uint8Array, node: DerNode): string {
  try {
    return derString(bytes, node).text;
  } catch (err) {
    if (!(err instanceof DerError)) throw err;
    return cappedHex(bytes.subarray(node.start, node.end));
  }
}

/** Reads one request. Throws a DerError when the bytes are not a DER certification request. */
export function readCsr(der: Uint8Array): CsrInfo {
  const root = readDer(der);
  derExpect(root, 16, 'universal', true);
  const info = derChild(root, 0);
  derExpect(info, 16, 'universal', true);
  const outerAlgorithm = readAlgorithm(der, derChild(root, 1));
  derBitString(der, derChild(root, 2));
  const warnings: string[] = [];

  const versionNode = derChild(info, 0);
  derExpect(versionNode, 2, 'universal', false);
  const versionBytes = derContent(der, versionNode);
  if (versionBytes.length === 0 || versionBytes.length > 2) {
    throw new DerError(`The version number at offset ${versionNode.start} is not valid.`, versionNode.start);
  }
  const written = versionBytes.length === 2 ? versionBytes[0]! * 256 + versionBytes[1]! : versionBytes[0]!;
  const version = written + 1;
  if (version !== 1) warnings.push(`The version number is ${version}, which RFC 2986 does not define.`);

  const subject = readName(der, derChild(info, 1));
  const publicKey = readPublicKey(der, derChild(info, 2), warnings);

  const attributes: CsrAttribute[] = [];
  let extensions: ExtensionInfo[] = [];
  let attributeCount = 0;
  for (const field of info.children.slice(3)) {
    if (field.cls !== 'context' || field.tag !== 0) continue;
    for (const attribute of field.children) {
      attributeCount++;
      derExpect(attribute, 16, 'universal', true);
      const oid = derOid(der, derChild(attribute, 0));
      const values = derChild(attribute, 1);
      derExpect(values, 17, 'universal', true);
      if (oid === EXTENSION_REQUEST) {
        const first = values.children[0];
        if (first !== undefined) extensions = extensions.concat(readExtensions(der, first));
      }
      if (attributes.length >= MAX_ATTRIBUTES) continue;
      const name = ATTRIBUTE_NAMES.get(oid) ?? oidLabel(oid);
      let lines: string[];
      if (oid === CHALLENGE_PASSWORD) {
        // The value is never shown: only that there is one.
        lines = ['present, not shown'];
      } else if (oid === EXTENSION_REQUEST) {
        lines = ['the extensions asked for are listed in their own table'];
      } else {
        lines = values.children.map((node) => valueLine(der, node));
        if (lines.length > MAX_ATTRIBUTE_LINES) {
          const more = lines.length - MAX_ATTRIBUTE_LINES;
          lines = [...lines.slice(0, MAX_ATTRIBUTE_LINES), `and ${more} more values are not shown.`];
        }
      }
      attributes.push({ oid, name, value: lines });
    }
  }
  if (attributeCount > attributes.length) {
    warnings.push(`${attributeCount - attributes.length} of ${attributeCount} attributes are not shown.`);
  }

  const signatureAlgorithm = describeSignature(der, outerAlgorithm, publicKey, warnings);
  const sans = extensions.find((extension) => extension.oid === SUBJECT_ALT_NAME)?.names ?? [];
  if (subject.replaced) {
    warnings.push(
      'Some text in this request holds bytes that do not belong to its string type; they are shown as U+FFFD.',
    );
  }

  return {
    kind: 'request',
    version,
    subject,
    publicKey,
    signatureAlgorithm,
    attributes,
    extensions,
    sans,
    requestSha256: derHex(sha256(der)),
    der,
    warnings,
  };
}
