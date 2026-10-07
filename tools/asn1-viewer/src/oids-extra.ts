/**
 * Names for object identifiers that the built-in list of the certificate side does not hold: CMS, PKCS #5, #7, #9 and #12,
 * OCSP, time stamping and the AES register of NIST. This table is consulted after the first, so an identifier in both is
 * named by the first. Every lookup goes through a Map (never a plain object), so an identifier or a name that happens to be
 * `__proto__`, `constructor` or `toString` finds nothing instead of a prototype member.
 *
 * Each name is a name OpenSSL 3.5.5 accepts and turns into exactly these digits: test/fixtures/openssl/oid-names.json holds
 * the answer of `openssl asn1parse -genstr 'OID:<name>'` for every entry, and a test compares them. An identifier OpenSSL
 * does not know is not listed here, so no name in this table is a guess.
 */

import { OID_NAMES } from './oids';

const entries: [string, string][] = [
  // RFC 5652 Cryptographic Message Syntax: content types and signed attributes
  ['1.2.840.113549.1.7.1', 'pkcs7-data'],
  ['1.2.840.113549.1.7.2', 'pkcs7-signedData'],
  ['1.2.840.113549.1.7.3', 'pkcs7-envelopedData'],
  ['1.2.840.113549.1.7.5', 'pkcs7-digestData'],
  ['1.2.840.113549.1.7.6', 'pkcs7-encryptedData'],
  ['1.2.840.113549.1.9.16.1.2', 'id-smime-ct-authData'],
  ['1.2.840.113549.1.9.3', 'contentType'],
  ['1.2.840.113549.1.9.4', 'messageDigest'],
  ['1.2.840.113549.1.9.5', 'signingTime'],
  ['1.2.840.113549.1.9.6', 'countersignature'],
  // RFC 2985 PKCS #9: attribute types and certificate and CRL types
  ['1.2.840.113549.1.9.2', 'unstructuredName'],
  ['1.2.840.113549.1.9.7', 'challengePassword'],
  ['1.2.840.113549.1.9.8', 'unstructuredAddress'],
  ['1.2.840.113549.1.9.14', 'Extension Request'],
  ['1.2.840.113549.1.9.15', 'S/MIME Capabilities'],
  ['1.2.840.113549.1.9.20', 'friendlyName'],
  ['1.2.840.113549.1.9.21', 'localKeyID'],
  ['1.2.840.113549.1.9.22.1', 'x509Certificate'],
  ['1.2.840.113549.1.9.22.2', 'sdsiCertificate'],
  ['1.2.840.113549.1.9.23.1', 'x509Crl'],
  // RFC 8018 PKCS #5: key derivation, encryption schemes, HMAC and the cipher identifiers it refers to
  ['1.2.840.113549.1.5.3', 'pbeWithMD5AndDES-CBC'],
  ['1.2.840.113549.1.5.10', 'pbeWithSHA1AndDES-CBC'],
  ['1.2.840.113549.1.5.12', 'PBKDF2'],
  ['1.2.840.113549.1.5.13', 'PBES2'],
  ['1.2.840.113549.1.5.14', 'PBMAC1'],
  ['1.2.840.113549.2.7', 'hmacWithSHA1'],
  ['1.2.840.113549.2.8', 'hmacWithSHA224'],
  ['1.2.840.113549.2.9', 'hmacWithSHA256'],
  ['1.2.840.113549.2.10', 'hmacWithSHA384'],
  ['1.2.840.113549.2.11', 'hmacWithSHA512'],
  ['1.3.14.3.2.7', 'des-cbc'],
  ['1.2.840.113549.3.7', 'des-ede3-cbc'],
  ['1.2.840.113549.3.2', 'rc2-cbc'],
  // RFC 7292 PKCS #12: bag types and the pbeWithSHA1And... algorithms
  ['1.2.840.113549.1.12.10.1.1', 'keyBag'],
  ['1.2.840.113549.1.12.10.1.2', 'pkcs8ShroudedKeyBag'],
  ['1.2.840.113549.1.12.10.1.3', 'certBag'],
  ['1.2.840.113549.1.12.10.1.4', 'crlBag'],
  ['1.2.840.113549.1.12.10.1.5', 'secretBag'],
  ['1.2.840.113549.1.12.10.1.6', 'safeContentsBag'],
  ['1.2.840.113549.1.12.1.1', 'pbeWithSHA1And128BitRC4'],
  ['1.2.840.113549.1.12.1.2', 'pbeWithSHA1And40BitRC4'],
  ['1.2.840.113549.1.12.1.3', 'pbeWithSHA1And3-KeyTripleDES-CBC'],
  ['1.2.840.113549.1.12.1.4', 'pbeWithSHA1And2-KeyTripleDES-CBC'],
  ['1.2.840.113549.1.12.1.5', 'pbeWithSHA1And128BitRC2-CBC'],
  ['1.2.840.113549.1.12.1.6', 'pbeWithSHA1And40BitRC2-CBC'],
  // RFC 6960 Online Certificate Status Protocol: response types and extensions
  ['1.3.6.1.5.5.7.48.1.1', 'Basic OCSP Response'],
  ['1.3.6.1.5.5.7.48.1.2', 'OCSP Nonce'],
  ['1.3.6.1.5.5.7.48.1.3', 'OCSP CRL ID'],
  ['1.3.6.1.5.5.7.48.1.4', 'Acceptable OCSP Responses'],
  ['1.3.6.1.5.5.7.48.1.5', 'OCSP No Check'],
  ['1.3.6.1.5.5.7.48.1.6', 'OCSP Archive Cutoff'],
  ['1.3.6.1.5.5.7.48.1.7', 'OCSP Service Locator'],
  // RFC 3161 Time-Stamp Protocol (the TSTInfo content type) and the S/MIME attribute identifiers that carry a time-stamp token and its signing certificate
  ['1.2.840.113549.1.9.16.1.4', 'id-smime-ct-TSTInfo'],
  ['1.2.840.113549.1.9.16.2.12', 'id-smime-aa-signingCertificate'],
  ['1.2.840.113549.1.9.16.2.14', 'id-smime-aa-timeStampToken'],
  ['1.2.840.113549.1.9.16.2.47', 'id-smime-aa-signingCertificateV2'],
  // NIST Computer Security Objects Register, algorithm registration: AES (modes and key wrap) under 2.16.840.1.101.3.4.1
  ['2.16.840.1.101.3.4.1.1', 'aes-128-ecb'],
  ['2.16.840.1.101.3.4.1.2', 'aes-128-cbc'],
  ['2.16.840.1.101.3.4.1.5', 'id-aes128-wrap'],
  ['2.16.840.1.101.3.4.1.6', 'aes-128-gcm'],
  ['2.16.840.1.101.3.4.1.21', 'aes-192-ecb'],
  ['2.16.840.1.101.3.4.1.22', 'aes-192-cbc'],
  ['2.16.840.1.101.3.4.1.25', 'id-aes192-wrap'],
  ['2.16.840.1.101.3.4.1.26', 'aes-192-gcm'],
  ['2.16.840.1.101.3.4.1.41', 'aes-256-ecb'],
  ['2.16.840.1.101.3.4.1.42', 'aes-256-cbc'],
  ['2.16.840.1.101.3.4.1.45', 'id-aes256-wrap'],
  ['2.16.840.1.101.3.4.1.46', 'aes-256-gcm'],
];

export const EXTRA_OID_NAMES: ReadonlyMap<string, string> = new Map(entries);

/** The name of an object identifier in digits: the first table, then the extra one. Map reads only. */
export function lookupOidName(dotted: string): string | undefined {
  return OID_NAMES.get(dotted) ?? EXTRA_OID_NAMES.get(dotted);
}
