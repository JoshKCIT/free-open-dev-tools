/**
 * Names for object identifiers. Every lookup in this package goes through a Map (never a plain object), so an identifier
 * or a name that happens to be `__proto__`, `constructor` or `toString` finds nothing instead of a prototype member.
 *
 * Sources (facts, cited here once): RFC 5280 (extensions, key usages, policy qualifiers, access methods, attribute types
 * of appendix A), RFC 4055 and RFC 8017 (RSA and PSS), RFC 5758 and RFC 5480 (ECDSA and curves), RFC 8410 (Ed25519, Ed448,
 * X25519, X448), RFC 3279 (DSA, DH), RFC 6962 (certificate transparency), RFC 7633 (TLS feature), the CA/Browser Forum
 * baseline requirements section 7.1.6.1 (policy identifiers), and for ML-DSA the NIST Computer Security Objects Register,
 * algorithm registration page (id-ml-dsa-44, id-ml-dsa-65 and id-ml-dsa-87 are sigAlgs 17, 18 and 19 under
 * 2.16.840.1.101.3.4, fetched 2026-10-03).
 */

const entries: [string, string][] = [
  // Signature algorithms and the hash and mask functions inside their parameters.
  ['1.2.840.113549.1.1.2', 'md2WithRSAEncryption'],
  ['1.2.840.113549.1.1.4', 'md5WithRSAEncryption'],
  ['1.2.840.113549.1.1.5', 'sha1WithRSAEncryption'],
  ['1.2.840.113549.1.1.11', 'sha256WithRSAEncryption'],
  ['1.2.840.113549.1.1.12', 'sha384WithRSAEncryption'],
  ['1.2.840.113549.1.1.13', 'sha512WithRSAEncryption'],
  ['1.2.840.113549.1.1.14', 'sha224WithRSAEncryption'],
  ['1.2.840.113549.1.1.10', 'RSASSA-PSS'],
  ['1.2.840.113549.1.1.8', 'MGF1'],
  ['1.2.840.10045.4.1', 'ecdsa-with-SHA1'],
  ['1.2.840.10045.4.3.1', 'ecdsa-with-SHA224'],
  ['1.2.840.10045.4.3.2', 'ecdsa-with-SHA256'],
  ['1.2.840.10045.4.3.3', 'ecdsa-with-SHA384'],
  ['1.2.840.10045.4.3.4', 'ecdsa-with-SHA512'],
  ['1.3.101.112', 'Ed25519'],
  ['1.3.101.113', 'Ed448'],
  ['1.2.840.10040.4.3', 'dsa-with-SHA1'],
  ['2.16.840.1.101.3.4.3.1', 'dsa-with-SHA224'],
  ['2.16.840.1.101.3.4.3.2', 'dsa-with-SHA256'],
  ['2.16.840.1.101.3.4.3.17', 'ML-DSA-44'],
  ['2.16.840.1.101.3.4.3.18', 'ML-DSA-65'],
  ['2.16.840.1.101.3.4.3.19', 'ML-DSA-87'],
  ['1.3.14.3.2.26', 'SHA-1'],
  ['2.16.840.1.101.3.4.2.4', 'SHA-224'],
  ['2.16.840.1.101.3.4.2.1', 'SHA-256'],
  ['2.16.840.1.101.3.4.2.2', 'SHA-384'],
  ['2.16.840.1.101.3.4.2.3', 'SHA-512'],
  ['1.2.840.113549.2.5', 'MD5'],
  // Public key algorithms.
  ['1.2.840.113549.1.1.1', 'rsaEncryption'],
  ['1.2.840.10045.2.1', 'id-ecPublicKey'],
  ['1.3.101.110', 'X25519'],
  ['1.3.101.111', 'X448'],
  ['1.2.840.10040.4.1', 'id-dsa'],
  ['1.2.840.113549.1.3.1', 'dhKeyAgreement'],
  // Named curves.
  ['1.2.840.10045.3.1.7', 'P-256'],
  ['1.3.132.0.34', 'P-384'],
  ['1.3.132.0.35', 'P-521'],
  ['1.3.132.0.10', 'secp256k1'],
  ['1.3.132.0.33', 'P-224'],
  ['1.3.36.3.3.2.8.1.1.7', 'brainpoolP256r1'],
  ['1.3.36.3.3.2.8.1.1.11', 'brainpoolP384r1'],
  ['1.3.36.3.3.2.8.1.1.13', 'brainpoolP512r1'],
  // Attribute types of a distinguished name, by the short names RFC 4514 and OpenSSL use.
  ['2.5.4.3', 'CN'],
  ['2.5.4.6', 'C'],
  ['2.5.4.7', 'L'],
  ['2.5.4.8', 'ST'],
  ['2.5.4.9', 'street'],
  ['2.5.4.10', 'O'],
  ['2.5.4.11', 'OU'],
  ['2.5.4.5', 'serialNumber'],
  ['2.5.4.4', 'SN'],
  ['2.5.4.42', 'GN'],
  ['2.5.4.12', 'title'],
  ['2.5.4.13', 'description'],
  ['2.5.4.15', 'businessCategory'],
  ['2.5.4.16', 'postalAddress'],
  ['2.5.4.17', 'postalCode'],
  ['2.5.4.41', 'name'],
  ['2.5.4.43', 'initials'],
  ['2.5.4.44', 'generationQualifier'],
  ['2.5.4.46', 'dnQualifier'],
  ['2.5.4.65', 'pseudonym'],
  ['2.5.4.97', 'organizationIdentifier'],
  ['1.2.840.113549.1.9.1', 'emailAddress'],
  ['0.9.2342.19200300.100.1.25', 'DC'],
  ['0.9.2342.19200300.100.1.1', 'UID'],
  ['1.3.6.1.4.1.311.60.2.1.3', 'jurisdictionC'],
  ['1.3.6.1.4.1.311.60.2.1.2', 'jurisdictionST'],
  ['1.3.6.1.4.1.311.60.2.1.1', 'jurisdictionL'],
  // Extensions.
  ['2.5.29.9', 'subjectDirectoryAttributes'],
  ['2.5.29.14', 'subjectKeyIdentifier'],
  ['2.5.29.15', 'keyUsage'],
  ['2.5.29.16', 'privateKeyUsagePeriod'],
  ['2.5.29.17', 'subjectAltName'],
  ['2.5.29.18', 'issuerAltName'],
  ['2.5.29.19', 'basicConstraints'],
  ['2.5.29.28', 'issuingDistributionPoint'],
  ['2.5.29.30', 'nameConstraints'],
  ['2.5.29.31', 'cRLDistributionPoints'],
  ['2.5.29.32', 'certificatePolicies'],
  ['2.5.29.33', 'policyMappings'],
  ['2.5.29.35', 'authorityKeyIdentifier'],
  ['2.5.29.36', 'policyConstraints'],
  ['2.5.29.37', 'extKeyUsage'],
  ['2.5.29.46', 'freshestCRL'],
  ['2.5.29.54', 'inhibitAnyPolicy'],
  ['1.3.6.1.5.5.7.1.1', 'authorityInfoAccess'],
  ['1.3.6.1.5.5.7.1.3', 'qcStatements'],
  ['1.3.6.1.5.5.7.1.11', 'subjectInfoAccess'],
  ['1.3.6.1.5.5.7.1.24', 'tlsFeature'],
  ['1.3.6.1.4.1.11129.2.4.2', 'signedCertificateTimestamps'],
  ['1.3.6.1.4.1.11129.2.4.3', 'ctPoison'],
  ['2.16.840.1.113730.1.1', 'netscapeCertType'],
  ['1.3.6.1.4.1.311.20.2', 'microsoftCertificateTemplateName'],
  ['1.3.6.1.4.1.311.21.1', 'microsoftCaVersion'],
  // Extended key usages.
  ['1.3.6.1.5.5.7.3.1', 'serverAuth'],
  ['1.3.6.1.5.5.7.3.2', 'clientAuth'],
  ['1.3.6.1.5.5.7.3.3', 'codeSigning'],
  ['1.3.6.1.5.5.7.3.4', 'emailProtection'],
  ['1.3.6.1.5.5.7.3.5', 'ipsecEndSystem'],
  ['1.3.6.1.5.5.7.3.6', 'ipsecTunnel'],
  ['1.3.6.1.5.5.7.3.7', 'ipsecUser'],
  ['1.3.6.1.5.5.7.3.8', 'timeStamping'],
  ['1.3.6.1.5.5.7.3.9', 'OCSPSigning'],
  ['2.5.29.37.0', 'anyExtendedKeyUsage'],
  ['1.3.6.1.4.1.311.20.2.2', 'smartcardLogon'],
  // Policy identifiers and qualifiers.
  ['2.5.29.32.0', 'anyPolicy'],
  ['2.23.140.1.1', 'extended-validation'],
  ['2.23.140.1.2.1', 'domain-validated'],
  ['2.23.140.1.2.2', 'organization-validated'],
  ['2.23.140.1.2.3', 'individual-validated'],
  ['1.3.6.1.5.5.7.2.1', 'CPS'],
  ['1.3.6.1.5.5.7.2.2', 'userNotice'],
  // Access methods of authorityInfoAccess and subjectInfoAccess.
  ['1.3.6.1.5.5.7.48.1', 'OCSP'],
  ['1.3.6.1.5.5.7.48.2', 'CA Issuers'],
  ['1.3.6.1.5.5.7.48.3', 'timeStamping'],
  ['1.3.6.1.5.5.7.48.5', 'CA Repository'],
  // The name of an otherName.
  ['1.3.6.1.4.1.311.20.2.3', 'userPrincipalName'],
];

/** Dotted object identifier to its name. A name is never looked up on a plain object. */
export const OID_NAMES: ReadonlyMap<string, string> = new Map(entries);

/** What a public key algorithm is called on the page, by the algorithm's object identifier. */
export const KEY_TYPE_NAMES: ReadonlyMap<string, string> = new Map([
  ['1.2.840.113549.1.1.1', 'RSA'],
  ['1.2.840.113549.1.1.10', 'RSA-PSS'],
  ['1.2.840.10045.2.1', 'EC'],
  ['1.3.101.112', 'Ed25519'],
  ['1.3.101.113', 'Ed448'],
  ['1.3.101.110', 'X25519'],
  ['1.3.101.111', 'X448'],
  ['1.2.840.10040.4.1', 'DSA'],
  ['1.2.840.113549.1.3.1', 'DH'],
  ['2.16.840.1.101.3.4.3.17', 'ML-DSA-44'],
  ['2.16.840.1.101.3.4.3.18', 'ML-DSA-65'],
  ['2.16.840.1.101.3.4.3.19', 'ML-DSA-87'],
]);

/** The size in bits of a named curve's field, by the curve's object identifier. */
export const CURVE_BITS: ReadonlyMap<string, number> = new Map([
  ['1.2.840.10045.3.1.7', 256],
  ['1.3.132.0.34', 384],
  ['1.3.132.0.35', 521],
  ['1.3.132.0.10', 256],
  ['1.3.132.0.33', 224],
  ['1.3.36.3.3.2.8.1.1.7', 256],
  ['1.3.36.3.3.2.8.1.1.11', 384],
  ['1.3.36.3.3.2.8.1.1.13', 512],
]);

/** Key sizes that are fixed by the algorithm: Ed25519 is 256 bits, Ed448 456, X25519 255, X448 448 (RFC 8032, RFC 7748). */
export const FIXED_KEY_BITS: ReadonlyMap<string, number> = new Map([
  ['1.3.101.112', 256],
  ['1.3.101.113', 456],
  ['1.3.101.110', 255],
  ['1.3.101.111', 448],
]);

export function oidName(oid: string): string | undefined {
  return OID_NAMES.get(oid);
}

/** The name when there is one, else the dotted identifier itself. */
export function oidLabel(oid: string): string {
  return OID_NAMES.get(oid) ?? oid;
}
