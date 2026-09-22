# Text Hash Generator

Compute MD5, SHA-1, SHA-256, SHA-384, SHA-512 and CRC32 over text.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Computes every common digest over the same input at once, so you can find the one that matches a value you are trying to reproduce. Each algorithm is labelled with whether it is still safe to rely on, because MD5 and SHA-1 are still offered by nearly every tool site with no warning attached.

## Supported

- MD5, SHA-1, SHA-224, SHA-256, SHA-384, SHA-512, SHA3-256, SHA3-512, Keccak-256, RIPEMD-160 and CRC-32
- Input read as UTF-8 text, as hexadecimal bytes, or as Base64
- Output as lowercase hex, uppercase hex, Base64 or Base64url
- Comparing a computed digest against one you paste in, ignoring case and separators
- Keccak-256 as distinct from SHA3-256, which matters if you work with Ethereum

## Limits

- A hash is not encryption and not a password store. For passwords use a purpose-built function such as bcrypt, scrypt or Argon2; the bcrypt tool here is the right one for that.
- MD5 and SHA-1 are cryptographically broken. They are included because you will meet them in existing systems, and they are labelled accordingly.
- CRC-32 is an error-detection code, not a hash. It is trivial to construct a collision on purpose.
- This hashes text. For a file, use the file hash tool, which streams rather than loading the whole file into a string.
- Hashing a secret does not protect it here in any meaningful sense: the secret is already in your clipboard and your browser memory.

## Ambiguous cases, and what this does about them

- Text must be turned into bytes before it can be hashed, and the encoding chosen changes the result. This uses UTF-8, which is what nearly every modern system means. If you are trying to reproduce a value from an older system that used Latin-1, paste the bytes as hex instead.
- What Ethereum calls sha3 is original Keccak, not the FIPS 202 SHA-3 that was standardised later with different padding. Both are offered and they are labelled separately.

## Defined by

- [RFC 1321 — The MD5 Message-Digest Algorithm](https://www.rfc-editor.org/rfc/rfc1321)
- [FIPS 180-4 — Secure Hash Standard (SHA-1, SHA-2)](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf)
- [FIPS 202 — SHA-3 Standard](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.202.pdf)
- [ISO/IEC 13239 — CRC-32 (ISO-HDLC)](https://reveng.sourceforge.io/crc-catalogue/17plus.htm#crc.cat.crc-32-iso-hdlc)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/hash-text hash-text
cd hash-text
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/hash-text
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { hashText, hashAll, hashBytes, crc32 } from '@fodt/hash-text';

hashText('abc', 'sha256');            // 'ba7816bf…'
hashText('abc', 'md5', 'base64');     // digest in Base64
hashAll(new TextEncoder().encode('abc')); // every algorithm at once
crc32(new Uint8Array([1, 2, 3]));     // a number
```

Hashing is synchronous. The cryptographic work is done by `@noble/hashes`, which is audited and has no dependencies of its own; only CRC-32, which is not cryptographic, is implemented here. `ALGORITHMS` exports the security note shown beside each result.

## Dependencies

- `@noble/hashes` ^2.4.0

## Tests

```sh
npm test
```

Asserted against the published vectors: the full RFC 1321 appendix A.5 MD5 suite, FIPS 180-4 samples for SHA-1 and SHA-2 including the multi-block case, FIPS 202 samples for SHA-3, the reference RIPEMD-160 vectors, and the documented CRC-32 check value 0xCBF43926. A differential pass then compares every algorithm against Node's own `crypto` module over 200 random buffers and at every block boundary from 0 to 256 bytes, where padding bugs hide.

## Licence

MIT. See [LICENSE](./LICENSE).
