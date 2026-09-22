# HMAC Generator

Compute RFC 2104 HMAC using the SHA-2 family and a text or hex key.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Computes a keyed message authentication code, which is what webhook signatures, API request signing and JWT HS256 tokens are all built on. Separate from plain hashing because the key changes everything: getting the key encoding wrong is the usual reason a signature you compute does not match the one you were sent.

## Supported

- HMAC-MD5, HMAC-SHA1, HMAC-SHA224, HMAC-SHA256, HMAC-SHA384, HMAC-SHA512, HMAC-SHA3-256 and HMAC-SHA3-512
- Key and message each read as UTF-8 text, hexadecimal bytes or Base64
- Output as lowercase hex, uppercase hex, Base64 or Base64url
- Comparing against an expected signature using a comparison that does not leak where it differs
- A report of what HMAC will do with your key length, including whether it gets hashed first

## Limits

- This computes a MAC. It does not fetch a request or verify a live webhook; you paste the exact signed payload yourself.
- Getting the signed payload byte-for-byte right is the hard part of signature verification, and every API defines it differently. This tool cannot know your API's canonicalisation rules.
- A MAC proves the holder of the key produced the message. It is not a signature in the public key sense: anyone who can verify can also forge.
- Comparing here is safer than using == in your own code, but the real fix is to compare safely in the code that checks the signature.

## Ambiguous cases, and what this does about them

- Whether a key is text or bytes is the most common trap. A key written as 0b0b0b… may be sixteen bytes of hex or a twelve-character string. Both readings are offered and the byte length is shown so you can tell which one matches.
- HMAC accepts a key of any length: longer than the block size is hashed first, shorter is padded with zeros. The tool reports which is happening, since a silently hashed key surprises people.

## Defined by

- [RFC 2104 — HMAC: Keyed-Hashing for Message Authentication](https://www.rfc-editor.org/rfc/rfc2104)
- [RFC 4231 — HMAC-SHA-224/256/384/512 test vectors](https://www.rfc-editor.org/rfc/rfc4231)
- [RFC 2202 — HMAC-MD5 and HMAC-SHA-1 test cases](https://www.rfc-editor.org/rfc/rfc2202)
- [FIPS 198-1 — The Keyed-Hash Message Authentication Code](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.198-1.pdf)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/hmac hmac
cd hmac
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/hmac
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { computeHmac, hmacBytes, timingSafeEqual } from '@fodt/hmac';

computeHmac('secret', 'payload');
computeHmac('736563726574', 'payload', { keyEncoding: 'hex', algorithm: 'sha512' });
timingSafeEqual(computed, receivedSignature);
```

`hmacBytes` is the primitive and takes `Uint8Array` for both key and message. `describeKey` reports the block size, whether the key will be hashed first, and whether it is shorter than the digest, all of which affect how much security you actually have.

## Dependencies

- `@noble/hashes` ^2.4.0

## Tests

```sh
npm test
```

Asserted against the normative vectors in RFC 4231 (cases 1, 2, 3, 4, 6 and 7, including the over-length key case) and RFC 2202 for HMAC-MD5 and HMAC-SHA1. A differential pass compares every algorithm against Node's own `crypto.createHmac` over 150 random key and message pairs, plus the empty key and empty message case.

## Licence

MIT. See [LICENSE](./LICENSE).
