# Text Hash Generator

Compute MD5, SHA-1, SHA-2, SHA-3, BLAKE and CRC32 digests, CRC-16, CRC-32C and Adler-32 checksums, SHAKE, MD4 and NTLM over text.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Computes every common digest over the same input at once, so you can find the one that matches a value you are trying to reproduce. Each algorithm is labelled with whether it is still safe to rely on, because MD5 and SHA-1 are still offered by nearly every tool site with no warning attached. A second choice, What to compute, adds the CRC-16 and CRC-32 checksums of the CRC catalogue (CRC-32C among them) and Adler-32, SHAKE128 and SHAKE256 at a length you pick, and the old MD4 and NTLM hashes for matching values that older systems still hold.

## Supported

- MD5, SHA-1, SHA-224, SHA-256, SHA-384, SHA-512, SHA-512/224, SHA-512/256, SHA3-224, SHA3-256, SHA3-384, SHA3-512, Keccak-256, BLAKE2b-512, BLAKE2s-256, BLAKE3, RIPEMD-160 and CRC-32
- Input read as UTF-8 text, as hexadecimal bytes, or as Base64
- Output as lowercase hex, uppercase hex, Base64 or Base64url
- Comparing a computed digest against one you paste in: a hex digest is compared ignoring case and separators; a Base64 or Base64url digest is compared exactly, letter case and the hyphen and underscore included
- Keccak-256 as distinct from SHA3-256, which matters if you work with Ethereum
- BLAKE2b-512 and BLAKE2s-256 unkeyed at their full default output length; BLAKE3 in its plain hashing mode at its default 256-bit output
- Checksums: all 31 CRC-16 and 12 CRC-32 algorithms of the CRC catalogue with their other names (for example CRC-16/IBM-3740 is also called CRC-16/CCITT-FALSE, and CRC-32/ISCSI is CRC-32C), and Adler-32
- SHAKE128 and SHAKE256 at any output length from 1 to 4,096 bytes
- MD4, and the NTLM (NT) hash, which is MD4 of the text as UTF-16LE

## Limits

- A hash is not encryption and not a password store. For passwords use a purpose-built function such as bcrypt, scrypt or Argon2.
- MD5 and SHA-1 are cryptographically broken. They are included because you will meet them in existing systems, and they are labelled accordingly.
- CRC-32 is an error-detection code, not a hash. It is trivial to construct a collision on purpose.
- This hashes text. A large file is better hashed by something that streams it rather than loading the whole file into a string.
- Hashing a secret does not protect it here in any meaningful sense: the secret is already in your clipboard and your browser memory.
- Keyed BLAKE2, BLAKE3's derive-key mode and BLAKE3's extendable output beyond 256 bits are not offered; BLAKE2 at an output length other than its full default, and BLAKE2b-512/BLAKE2s-256 truncated, are not offered either -- BLAKE2 at a shorter length is a different digest, not a truncation of the full one.
- BLAKE2 and BLAKE3 are not FIPS-approved. Where a standard specifically requires FIPS approval, use SHA-2 or SHA-3 instead.
- Checksums: all 31 CRC-16 and 12 CRC-32 variants of the CRC catalogue (CRC-32C among them) and Adler-32; checksums detect accidental changes and give no security.
- SHAKE128 and SHAKE256 output lengths are 1 to 4,096 bytes.
- MD4 and the NTLM hash are broken and offered only for compatibility; NTLM hashes the text as UTF-16LE and is not shown for hex or Base64 input.

## Ambiguous cases, and what this does about them

- Text must be turned into bytes before it can be hashed, and the encoding chosen changes the result. This uses UTF-8, which is what nearly every modern system means. If you are trying to reproduce a value from an older system that used Latin-1, paste the bytes as hex instead.
- What Ethereum calls sha3 is original Keccak, not the FIPS 202 SHA-3 that was standardised later with different padding. Both are offered and they are labelled separately.
- SHA-512/224 and SHA-512/256 are not the same digest as SHA-224 and SHA-256, even though the bit lengths match: they use SHA-512's compression function with their own distinct initial values, defined alongside it in FIPS 180-4.
- CCITT is the name of two different CRC-16 algorithms. CRC-16/KERMIT (also called CRC-16/CCITT and CRC-CCITT) and CRC-16/IBM-3740 (also called CRC-16/CCITT-FALSE) give different values for the same input, so each row shows its catalogue name and every other name the catalogue lists; compare with the row your specification means.
- The NTLM hash is defined over a password as UTF-16LE text, not over bytes, so it is shown only when the input is read as UTF-8 text. A character outside the Basic Multilingual Plane is written in UTF-16 as a surrogate pair, four bytes, and is hashed that way.

## Defined by

- [RFC 1321 — The MD5 Message-Digest Algorithm](https://www.rfc-editor.org/rfc/rfc1321)
- [FIPS 180-4 — Secure Hash Standard (SHA-1, SHA-2, including SHA-512/t)](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf)
- [FIPS 202: SHA-3 Standard (SHA3-224 to SHA3-512, SHAKE128 and SHAKE256)](https://csrc.nist.gov/pubs/fips/202/final)
- [RFC 7693 — The BLAKE2 Cryptographic Hash and Message Authentication Code (MAC)](https://www.rfc-editor.org/rfc/rfc7693)
- [BLAKE3 specification](https://github.com/BLAKE3-team/BLAKE3-specs/blob/master/blake3.pdf)
- [ISO/IEC 13239 — CRC-32 (ISO-HDLC)](https://reveng.sourceforge.io/crc-catalogue/17plus.htm#crc.cat.crc-32-iso-hdlc)
- [CRC Catalogue: CRC-16 and CRC-32 algorithms with their parameters, other names and check values](https://reveng.sourceforge.io/crc-catalogue/)
- [RFC 3720: iSCSI, appendix B.4 CRC-32C examples](https://www.rfc-editor.org/rfc/rfc3720)
- [RFC 1950: ZLIB Compressed Data Format, Adler-32](https://www.rfc-editor.org/rfc/rfc1950)
- [RFC 1320: The MD4 Message-Digest Algorithm](https://www.rfc-editor.org/rfc/rfc1320)
- [MS-NLMP: NTLM v1 Authentication, NTOWFv1 as MD4 of the UTF-16LE password](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-nlmp/464551a8-9fc4-428e-b3d3-bc5bfb2e73a5)

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
hashText('abc', 'blake3');            // BLAKE3's default 256-bit output
hashAll(new TextEncoder().encode('abc')); // every algorithm at once
crc32(new Uint8Array([1, 2, 3]));     // a number

import { checksumRows, adler32, shake, md4, ntlm } from '@fodt/hash-text';

checksumRows(bytes);                 // every catalogue CRC, then Adler-32
adler32(bytes);                      // a number
shake(bytes, 'shake128', 32);        // 32 bytes of SHAKE128, 1 to 4096 allowed
md4(bytes);                          // 16 bytes
ntlm('password');                    // MD4 of the text as UTF-16LE, 16 bytes
```

Hashing is synchronous. The cryptographic work is done by `@noble/hashes`, which is audited and has no dependencies of its own; only CRC-32, which is not cryptographic, is implemented here. `ALGORITHMS` exports the security note shown beside each result. The CRC catalogue, Adler-32, MD4 and NTLM are implemented here from their specifications, each in its own file, and never touch `Algorithm`, `ALGORITHMS`, `hashBytes` or `hashAll`, whose tests assert whole lists. SHAKE is `@noble/hashes` at an explicit output length from 1 to 4096 bytes, checked before anything is allocated.

## Dependencies

- `@noble/hashes` ^2.4.0

## Tests

```sh
npm test
```

Asserted against the published vectors: the full RFC 1321 appendix A.5 MD5 suite, FIPS 180-4 samples for SHA-1, SHA-2 and SHA-512/t (SHA-512/224, SHA-512/256) including the multi-block case, FIPS 202 samples for SHA-3, RFC 7693 Appendix A and B for BLAKE2b-512 and BLAKE2s-256, the BLAKE3 project's own test_vectors.json for input lengths 0, 1, 1023, 1024 and 1025, the reference RIPEMD-160 vectors, and the documented CRC-32 check value 0xCBF43926. A differential pass then compares every algorithm Node's own `crypto` module also implements against it, over 200 random buffers and at every block boundary from 0 to 256 bytes (plus SHA3-224's and SHA3-384's own rate boundaries), where padding bugs hide; BLAKE3 has no Node `crypto` counterpart, so it rests on the published test vectors and a digest-length check instead. The new functions are asserted against: all 43 check values of the CRC catalogue over 123456789 (31 of 16 bits, 12 of 32 bits) with their parameters and other names, the five CRC-32C examples of RFC 3720 appendix B.4, Adler-32 against zlib values recorded with Python, the seven MD4 values of RFC 1320 appendix A.5 and 200 inputs hashed by OpenSSL through its legacy provider (Node offers no MD4 under OpenSSL 3, so it is not used as a second opinion), the NT hash of Password from MS-NLMP and of password and a character outside the Basic Multilingual Plane from passlib, the NIST SHAKE128 and SHAKE256 examples for the empty message (200 bytes of each), and SHAKE output against Node `crypto` for 234 combinations of output length (1 to 4096) and message size (0 to 300 bytes, around both rates).

## Licence

MIT. See [LICENSE](./LICENSE).
