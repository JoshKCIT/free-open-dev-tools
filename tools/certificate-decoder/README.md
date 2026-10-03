# X.509 Certificate & CSR Decoder

Paste an X.509 certificate, chain or signing request and read its names, dates, key, extensions and fingerprints.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Reads a certificate you paste, as PEM or as DER written in Base64 or hex, with a small strict DER reader written for this page, and shows it field by field: who it was issued to and by, its serial number, its dates and whether it is current by this device's clock, its public key, its signature algorithm and its fingerprints. The digests are made by the audited @noble/hashes library over the exact bytes of the certificate. Nothing you paste is sent, stored or logged, and nothing a certificate names is ever fetched.

## Supported

- X.509 certificates in PEM form (BEGIN CERTIFICATE blocks, with any line width and either kind of line end), or one certificate's DER as Base64 or hex
- Subject and issuer as written in the certificate, the serial number, the version, the validity dates in UTC with the status against this device's clock, the public key type and size, and the signature algorithm
- SHA-256 and SHA-1 fingerprints in the form openssl x509 -fingerprint prints, computed over the exact DER bytes

## Limits

- A paste or file of up to 1 MiB (1,048,576 characters or bytes) holding at most 100 certificates or requests is read; more is refused before anything is parsed.
- The page does not check signatures, trust, revocation or host names: a certificate shown here may be forged, revoked or not meant for the site you have in mind.
- Addresses a certificate names (CRL, OCSP, CA issuers, policy statements, URI names) are shown as text and are never fetched, loaded or requested.
- Private key blocks in a paste are ignored and never shown.

## Ambiguous cases, and what this does about them

- The status compares the certificate's dates with this device's clock, so a wrong clock gives a wrong status
- IPv6 addresses are written in the compressed form of RFC 5952, which differs from the text OpenSSL prints for the same bytes

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

const { items } = decodeInput(pemText, { nowMs: Date.now() });
const cert = items[0];
cert.subject.rfc4514;       // 'CN=example.com,O=Example Ltd'
cert.fingerprints.sha256;   // '5C:16:DB:...' as openssl x509 -fingerprint prints it
cert.status.state;          // 'valid' | 'expired' | 'not-yet-valid'
```

`decodeInput(text, { nowMs })` reads a paste and returns `{ items, ignored, warnings }`, where each item is a certificate model and `ignored` counts private key blocks that were skipped. The clock is passed in, so the package never reads it. Every failure is a `CertificateError`, `DerError` or `PemError` whose message is a plain sentence that names a position or the shape of the problem, never a pasted value. `readCertificate(der, nowMs)` reads one certificate from its DER bytes.

## Dependencies

- `@noble/hashes` 2.4.0

## Tests

```sh
npm test
```

OpenSSL 3.5.5 made seven fresh certificates (RSA 2048 and 3072, P-256, P-384, P-521, Ed25519 and RSA-PSS) and printed every value the tests compare with, recorded as literals by test/fixtures/make-fixtures.sh with its versions. Node's own X509Certificate is the second opinion for every root certificate Node ships.

## Licence

MIT. See [LICENSE](./LICENSE).
