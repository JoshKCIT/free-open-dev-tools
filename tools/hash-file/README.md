# File Hash & Checksum

Hash files of any size in a worker and compare against an expected checksum.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Streams a file through every selected digest algorithm in a single pass, in a background thread, so a file of any size can be hashed without loading the whole thing into memory or freezing the tab. Paste a checksum you were given and it tells you whether it matches; with a hexadecimal output the checksum is compared ignoring case and separators, with Base64 or Base64url exactly.

## Supported

- MD5, SHA-1, SHA-224, SHA-256, SHA-384, SHA-512, SHA-512/224, SHA-512/256, SHA3-224, SHA3-256, SHA3-384, SHA3-512, Keccak-256, BLAKE2b-512, BLAKE2s-256, BLAKE3, RIPEMD-160 and CRC-32
- Files of any size, read in fixed-size chunks so memory use stays flat regardless of file size
- Every selected algorithm computed in a single pass over the file, so the file is never read twice
- A progress bar driven by bytes actually read, and a Cancel button that really stops the background work
- Output as lowercase hex, uppercase hex, Base64 or Base64url
- Comparing a computed digest against one you paste in, by the output format you chose: hexadecimal ignores case and separators, Base64 and Base64url are compared exactly
- Keccak-256 as distinct from SHA3-256, which matters if you work with Ethereum
- BLAKE2b-512 and BLAKE2s-256 unkeyed at their full default output length; BLAKE3 in its plain hashing mode at its default 256-bit output, streamed incrementally through its own `.create()` the same way every other algorithm here is

## Limits

- A hash is not encryption and not a password store. For passwords use a purpose-built function such as bcrypt, scrypt or Argon2.
- MD5 and SHA-1 are cryptographically broken. They are included because you will meet them in existing systems, and they are labelled accordingly.
- CRC-32 is an error-detection code, not a hash. It is trivial to construct a collision on purpose.
- A matching checksum tells you the file arrived unchanged from whatever produced that checksum. It does not tell you the file is safe or came from who you think it did.
- The file never leaves this tab, which also means nothing here can compare a file against a checksum published somewhere else without you typing or pasting that checksum in yourself.
- Keyed BLAKE2, BLAKE3's derive-key mode and BLAKE3's extendable output beyond 256 bits are not offered; BLAKE2 at an output length other than its full default is not offered either -- BLAKE2 at a shorter length is a different digest, not a truncation of the full one.
- BLAKE2 and BLAKE3 are not FIPS-approved. Where a standard specifically requires FIPS approval, use SHA-2 or SHA-3 instead.

## Ambiguous cases, and what this does about them

- What Ethereum calls sha3 is original Keccak, not the FIPS 202 SHA-3 that was standardised later with different padding. Both are offered and labelled separately.
- Comparison against a pasted checksum ignores white space. The output format you chose decides how the rest is compared, not what the pasted text looks like: with Lowercase hex or Uppercase hex the comparison also ignores letter case and the separators colon, underscore and hyphen; with Base64 or Base64url it is exact, because the letter case and the hyphen and underscore are part of the value, even when a short Base64url checksum happens to be made only of hexadecimal digits, hyphens and underscores.
- SHA-512/224 and SHA-512/256 are not the same digest as SHA-224 and SHA-256, even though the bit lengths match: they use SHA-512's compression function with their own distinct initial values, defined alongside it in FIPS 180-4.

## Defined by

- [RFC 1321 — The MD5 Message-Digest Algorithm](https://www.rfc-editor.org/rfc/rfc1321)
- [FIPS 180-4 — Secure Hash Standard (SHA-1, SHA-2, including SHA-512/t)](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf)
- [FIPS 202 — SHA-3 Standard](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.202.pdf)
- [RFC 7693 — The BLAKE2 Cryptographic Hash and Message Authentication Code (MAC)](https://www.rfc-editor.org/rfc/rfc7693)
- [BLAKE3 specification](https://github.com/BLAKE3-team/BLAKE3-specs/blob/master/blake3.pdf)
- [ISO/IEC 13239 — CRC-32 (ISO-HDLC)](https://reveng.sourceforge.io/crc-catalogue/17plus.htm#crc.cat.crc-32-iso-hdlc)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/hash-file hash-file
cd hash-file
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/hash-file
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { createHashers, updateHashers, finishHashers, formatDigest, digestsMatch } from '@fodt/hash-file';

const state = createHashers(['sha256', 'blake3']);
updateHashers(state, chunkOne);
updateHashers(state, chunkTwo);
const results = finishHashers(state, 'hex'); // one entry per algorithm
digestsMatch(results[0].digest, 'pasted checksum');
```

Pure chunk-at-a-time logic over byte arrays only: create, update, finish, matching the shape update() then digest() already offers on every algorithm here except the error-detecting checksum, whose accumulator this package carries by hand across calls. This package takes no browser-only type anywhere, not even in a comment: the folder is copied out and built and tested in plain Node by a release gate that has no such type available, and the page that wraps this in a background thread lives entirely outside this folder.

## Dependencies

- `@noble/hashes` ^2.4.0

## Tests

```sh
npm test
```

Every algorithm's empty-input and 'abc' digests are asserted against the same RFC 1321/FIPS 180-4/FIPS 202/RFC 7693 vectors, each also re-confirmed against Node's own crypto module, plus Keccak-256's well-known 'abc' digest confirmed when these tests were written against go-ethereum's own test suite and BLAKE3's 'abc' digest confirmed when these tests were written against the official `blake3` Python package (wrapping the BLAKE3 team's own Rust implementation, independent of the `@noble/hashes` implementation this package uses). The chunk-boundary behaviour is the point of this package: for every algorithm, a multi-block pattern buffer's digest is checked at several split sizes -- including one byte at a time, a split chosen to land inside a block rather than on its edge, and (on a longer buffer built for this) every chunk size from 1 byte to 4096 bytes crossing BLAKE3's own 1024-byte chunk boundary twice -- against the library's own one-shot call form (a call whose own digests are checked against the published vectors and against Node's own crypto module), never only against this package's own chunked output. The error-detecting checksum's chunked result is separately checked against Node's zlib.crc32 for the same pattern buffer, since it has no stateful update/digest object of its own and carries a hand-written accumulator instead. The comparison with a pasted checksum is tested with the FIPS 180-4 SHA-256 of 'abc' in hex and, made by Node's crypto module and Buffer, in Base64 and Base64url: hex ignores case and separators, while a wrong letter case in Base64 or Base64url is a mismatch.

## Licence

MIT. See [LICENSE](./LICENSE).
