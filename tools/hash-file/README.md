# File Hash & Checksum

Hash files of any size in a worker and compare against an expected checksum.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Streams a file through every selected digest algorithm in a single pass, in a background thread, so a file of any size can be hashed without loading the whole thing into memory or freezing the tab. Paste a checksum you were given and it tells you whether it matches, ignoring case and separators.

## Supported

- MD5, SHA-1, SHA-224, SHA-256, SHA-384, SHA-512, SHA3-256, SHA3-512, Keccak-256, RIPEMD-160 and CRC-32
- Files of any size, read in fixed-size chunks so memory use stays flat regardless of file size
- Every selected algorithm computed in a single pass over the file, so the file is never read twice
- A progress bar driven by bytes actually read, and a Cancel button that really stops the background work
- Output as lowercase hex, uppercase hex, Base64 or Base64url
- Comparing a computed digest against one you paste in, ignoring case and separators
- Keccak-256 as distinct from SHA3-256, which matters if you work with Ethereum

## Limits

- A hash is not encryption and not a password store. For passwords use a purpose-built function such as bcrypt, scrypt or Argon2.
- MD5 and SHA-1 are cryptographically broken. They are included because you will meet them in existing systems, and they are labelled accordingly.
- CRC-32 is an error-detection code, not a hash. It is trivial to construct a collision on purpose.
- A matching checksum tells you the file arrived unchanged from whatever produced that checksum. It does not tell you the file is safe or came from who you think it did.
- The file never leaves this tab, which also means nothing here can compare a file against a checksum published somewhere else without you typing or pasting that checksum in yourself.

## Ambiguous cases, and what this does about them

- What Ethereum calls sha3 is original Keccak, not the FIPS 202 SHA-3 that was standardised later with different padding. Both are offered and labelled separately.
- Comparison against a pasted checksum ignores case and the separators colon, space, underscore and hyphen, because checksums are copied from many different formatting conventions. A checksum that differs only in digit values, not formatting, is still reported as not matching.

## Defined by

- [RFC 1321 — The MD5 Message-Digest Algorithm](https://www.rfc-editor.org/rfc/rfc1321)
- [FIPS 180-4 — Secure Hash Standard (SHA-1, SHA-2)](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf)
- [FIPS 202 — SHA-3 Standard](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.202.pdf)
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

const state = createHashers(['sha256', 'crc32']);
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

Every algorithm's empty-input and 'abc' digests are asserted against the same RFC 1321/FIPS 180-4/FIPS 202 vectors the text hash tool's tests use, plus Keccak-256's well-known 'abc' digest confirmed this session against go-ethereum's own test suite. The chunk-boundary behaviour is the point of this package: for every algorithm, a multi-block pattern buffer's digest is checked at several split sizes -- including one byte at a time and a split chosen to land inside a block rather than on its edge -- against the library's own one-shot call form (the same call hash-text's tests already validate against the published vectors and against Node's own crypto module), never only against this package's own chunked output. The error-detecting checksum's chunked result is separately checked against Node's zlib.crc32 for the same pattern buffer, since it has no stateful update/digest object of its own and carries a hand-written accumulator instead.

## Licence

MIT. See [LICENSE](./LICENSE).
