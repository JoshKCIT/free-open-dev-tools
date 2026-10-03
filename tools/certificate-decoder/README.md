# X.509 Certificate & CSR Decoder

Paste an X.509 certificate, chain or signing request and read its names, dates, key, extensions and fingerprints.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Reads certificates and certification requests you paste or open as a file, as PEM or as DER (written in Base64 or hex, or the binary file itself), with a small strict DER reader written for this page, and shows each one field by field: who it was issued to and by in two forms, its serial number, its dates and whether it is current by this device's clock, its public key, its signature algorithm, every subject alternative name, every extension with its name, identifier, critical flag and decoded value, and its fingerprints. A pasted set of certificates is also shown in issuing order, whatever order it was pasted in. The digests are made by the audited @noble/hashes library over the exact bytes. Nothing you paste or open is sent, stored or logged, and nothing a certificate or request names is ever fetched.

## Supported

- X.509 certificates in PEM form (BEGIN CERTIFICATE blocks, with any line width and either kind of line end, and any text around them), or one certificate's DER as Base64 or hex (with spaces, colons and line breaks), or a DER or PEM file of up to 1 MiB opened through the file picker
- PKCS #10 certification requests (RFC 2986) as PEM (BEGIN CERTIFICATE REQUEST or BEGIN NEW CERTIFICATE REQUEST) or DER: the subject, the public key, the signature algorithm, every attribute, the extensions the request asks for, and the SHA-256 of the request DER as openssl dgst prints it; a challenge password is reported as present and never shown
- A pasted chain of certificates in issuing order (leaf, each issuer, ending at a self-issued certificate or a note that the issuer is not in the paste) whatever order it was pasted in, with each certificate's role, repeats reported once, unrelated certificates as their own groups, and two certificates that share a subject told apart by their authority and subject key identifiers
- Subject and issuer as written in the certificate and as the RFC 4514 string with its section 2.4 escaping, for names in UTF8String, PrintableString, IA5String, TeletexString (as Latin-1), BMPString, UniversalString, NumericString and VisibleString; bytes that do not belong to a string's type are shown as U+FFFD with a warning
- The serial number without its sign octet, the version, the validity dates in UTC (UTCTime and GeneralizedTime) and the status against this device's clock
- The public key: RSA and RSA-PSS size and exponent, EC curve and size, Ed25519, Ed448, X25519, X448, DSA and ML-DSA; the signature algorithm with the hash, mask function and salt length of RSASSA-PSS; warnings for RSA keys under 2,048 bits and for MD2, MD5 and SHA-1 signatures
- Subject alternative names of all nine kinds RFC 5280 defines (DNS names, email addresses, URIs, IPv4 and IPv6 addresses with the IPv6 written as RFC 5952 asks, directory names, registered identifiers, other names with the user principal name decoded, and X.400 and EDI party names as hex), listed one per row
- Every extension with its name, object identifier and critical flag: basic constraints, key usage, extended key usage, the subject and authority key identifiers, subject and issuer alternative names, CRL distribution points, authority information access, certificate policies with their qualifiers, name constraints and TLS feature are decoded; any other is shown as hex up to 256 bytes
- SHA-256, SHA-1 and MD5 fingerprints in the form openssl x509 -fingerprint prints, the SHA-256 pin of the public key in Base64, and the public key as PEM

## Limits

- A paste or file of up to 1 MiB (1,048,576 characters or bytes) holding at most 100 certificates or requests is read; a larger file is refused by its size before any of it is read, and a larger paste or more items before anything is parsed.
- The issuing order is found by comparing the exact bytes of issuer and subject names, and key identifiers when two certificates share a name, so it is not a verified chain: no signature, date or constraint is checked, a name written with a different string type counts as a different name, and an order stops at 50 certificates or when it would repeat a certificate.
- The page does not check signatures, trust, revocation or host names: a certificate shown here may be forged, revoked or not meant for the site you have in mind.
- Addresses a certificate names (CRL, OCSP, CA issuers, policy statements, URI names) are shown as text and are never fetched, loaded or requested.
- Private key blocks in a paste are ignored and never shown.
- Each table shows at most 5,000 rows across the page, an extension shows at most 200 lines, and the bytes of an extension this page does not decode are shown to 256 bytes; every cut says how much was left out.
- A request's own signature is not checked, and a request says nothing about whether any authority has issued or would issue a certificate for it.
- A file that begins with the byte 0x30 is read as DER and any other file as text (PEM, or Base64 or hex), so a binary file of any other kind is refused.

## Ambiguous cases, and what this does about them

- The status compares the certificate's dates with this device's clock, so a wrong clock gives a wrong status
- IPv6 addresses are written in the compressed form of RFC 5952, which differs from the text OpenSSL prints for the same bytes
- A name attribute with a short name (CN, O, emailAddress, serialNumber and the rest) is written with it, as OpenSSL does; one without a short name is written as its dotted identifier and the hex of its value, as RFC 4514 section 2.4 says
- The serial number is shown in upper case hex without the zero byte DER adds when the first bit is set, so 00AB shows as AB; a serial of zero shows as 00
- A BOOLEAN written as 01 instead of FF is read as true, because real certificates contain it
- Fingerprints are made over the exact bytes of the certificate, so the width, line ends and Base64 wrapping of a paste never change them
- A certificate that is in more than one chain is labelled with the role it has in the first one listed
- Two certificates that share a subject are told apart by key identifiers; when the certificate being followed names a key identifier and every certificate with that subject has a different one, the order stops there rather than guessing

## Defined by

- [RFC 5280: Internet X.509 Public Key Infrastructure Certificate and CRL Profile](https://www.rfc-editor.org/rfc/rfc5280)
- [RFC 2986: PKCS #10: Certification Request Syntax Specification](https://www.rfc-editor.org/rfc/rfc2986)
- [RFC 4514: Lightweight Directory Access Protocol (LDAP): String Representation of Distinguished Names](https://www.rfc-editor.org/rfc/rfc4514)
- [RFC 5952: A Recommendation for IPv6 Address Text Representation](https://www.rfc-editor.org/rfc/rfc5952)
- [RFC 7468: Textual Encodings of PKIX, PKCS, and CMS Structures](https://www.rfc-editor.org/rfc/rfc7468)
- [ITU-T X.690: ASN.1 encoding rules (BER, CER and DER)](https://www.itu.int/rec/T-REC-X.690)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/certificate-decoder certificate-decoder
cd certificate-decoder
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/certificate-decoder
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { decodeInput } from '@fodt/certificate-decoder';

const { items, chains } = decodeInput(pemText, { nowMs: Date.now() });
const cert = items[0];
if (cert.kind === 'certificate') {
  cert.subject.rfc4514;       // 'CN=example.com,O=Example Ltd'
  cert.sans;                  // [{ type: 'dNSName', value: 'example.com' }, ...]
  cert.fingerprints.sha256;   // '5C:16:DB:...' as openssl x509 -fingerprint prints it
  cert.status.state;          // 'valid' | 'expired' | 'not-yet-valid'
}
chains[0].order;             // positions in items, leaf first

// A file: check its size first, then pass its bytes (DER, or PEM and other text)
checkFileSize(file.size);
decodeInput(new Uint8Array(await file.arrayBuffer()), { nowMs: Date.now() });
```

`decodeInput(input, { nowMs })` reads a paste (a string: PEM blocks, or Base64 or hex DER with no armour) or a file (a `Uint8Array`: DER, or text read the same way as a paste) and returns `{ items, chains, duplicates, ignored, warnings }`. Each item is a certificate model (`kind: 'certificate'`) or a request model (`kind: 'request'`, from `readCsr`); `chains` lists the certificates in issuing order by position in `items`, each with `order`, `roles`, `complete` and a `stopReason` of `self-issued`, `issuer-not-in-paste`, `cycle` or `cap`; `duplicates` lists the positions of exact repeats; `ignored` counts private key blocks that were skipped without being looked at. `orderChains` can be called on its own with certificate models. `checkFileSize(byteLength)` throws for a file over `MAX_FILE_BYTES` (1,048,576) and is meant to be called with the file's size before its bytes are read. The clock is passed in, so the package never reads it, and nothing is kept between calls. A paste is measured (at most 1,048,576 characters) and the items counted (at most 100) before any is parsed, and the two long tables are cut to 5,000 rows across the paste with a note in the item's warnings. Every failure is a `CertificateError`, `DerError` or `PemError` whose message is a plain sentence that names a position, a line or the shape of the problem, never a pasted value; anything else becomes one fixed sentence. `readCertificate(der, nowMs)` reads one certificate from its DER bytes, `readExtensions` reads an extensions sequence, `readName` a distinguished name and `readGeneralNames` a list of alternative names; `EXTENSION_DECODERS` and `OID_NAMES` are Maps, so no identifier can be mistaken for a prototype member.

## Dependencies

- `@noble/hashes` 2.4.0

## Tests

```sh
npm test
```

OpenSSL 3.5.5 made seven fresh certificates (RSA 2048 and 3072, P-256, P-384, P-521, Ed25519 and RSA-PSS), two more (an RSA 1024 SHA-1 certificate with a 300 byte unknown extension, and one naming local addresses everywhere), four certification requests (RSA with an extension request, P-256, Ed25519, and one with a challenge password) and the certificates the chain tests need (two intermediates sharing one subject with a leaf each, and a pair that name each other as issuer), and printed every value the tests compare with: the three fingerprints, serial, subject and issuer in two forms, dates, key size, signature algorithm, extension names and values, the alternative names, the key identifiers, and the SHA-256 of each request's DER as openssl dgst prints it. They are recorded as literals by test/fixtures/make-fixtures.sh with its versions. Node's own X509Certificate is the second opinion for every root certificate Node ships (fingerprints, serial, dates, names, key size, exponent and curve). RFC 4514 section 4 and RFC 5952 section 4 give published examples. The reader is fuzzed with 20,000 seeded mutations of certificates and 8,000 of requests, half of them changing bytes and half changing the shape of the DER while keeping every length right, and the limits, the time for 500 certificates, the time for 500 KiB of BEGIN lines, the 1 MiB file limit, the six orderings of a chain, a cycle and a chain of 51 links are tested.

## Licence

MIT. See [LICENSE](./LICENSE).
