# Base58 Encoder & Decoder

Encode and decode Base58 and Base58Check using the Bitcoin, Ripple and Flickr alphabets.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Converts between bytes and Base58 text, the alphanumeric encoding Bitcoin addresses and several other systems use to avoid the visually confusable characters Base64 allows. Also offers Base58Check, which appends a four-byte checksum so a mistyped or corrupted value can be detected before it is used.

## Supported

- The Bitcoin, Ripple (XRP Ledger) and Flickr Base58 alphabets, each a distinct ordering of the same 58 characters
- Arbitrary binary data in either direction, not only values that happen to look like an address
- Base58Check: a version byte plus payload, checksummed with a double SHA-256 and its first four bytes, matching how Bitcoin addresses and private keys (WIF) are built
- Exact preservation of leading zero bytes, which the plain Base58 integer conversion cannot recover on its own and must be handled as a separate step
- Detection of a corrupted Base58Check value, reported as a checksum mismatch rather than a generic decode failure
- A version byte separate from the payload on decode, matching how Bitcoin addresses and the wallet import format (WIF) split those two pieces

## Limits

- Only the Bitcoin alphabet has an implementation that defines it normatively (the Bitcoin Core source). The Ripple and Flickr alphabets are de facto conventions used by their respective ecosystems' own libraries, not documents published by a standards body.
- This tool does not interpret what a decoded payload means. It will happily decode a Base58Check value into a version byte and a payload with no opinion on whether that payload is a valid address, a private key, or something else entirely.
- Base58Check's four-byte checksum is meant to catch accidental transcription errors, not deliberate tampering. It is not a cryptographic signature and provides no authentication.
- This is an encoding, not encryption. Base58 and Base58Check provide no confidentiality whatsoever.

## Ambiguous cases, and what this does about them

- The three alphabets are the same 58 characters in three different orders, so a Base58 string decoded on the wrong alphabet produces different bytes with no error at all. Pick the alphabet the source system actually used.
- A Base58Check value with a valid checksum still is not proof the payload is a real, spendable address. Checksum validity means the string was transcribed correctly, nothing more.

## Defined by

- [Bitcoin Core — base58.cpp (defines the Bitcoin alphabet)](https://github.com/bitcoin/bitcoin/blob/master/src/base58.cpp)
- [Bitcoin Wiki — Base58Check encoding](https://en.bitcoin.it/wiki/Base58Check_encoding)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/base58 base58
cd base58
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/base58
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { encodeBytes, decodeToBytes, encodeCheck, decodeCheck } from '@fodt/base58';

encodeBytes(new Uint8Array([0, 1, 2]));                     // '1Ahz2'
decodeToBytes('1Ahz2');                                      // Uint8Array [0, 1, 2]
encodeCheck(0x00, hexBytes);                                 // 'Base58Check address'
decodeCheck('1PMycacnJaSqwwJqjawXBErnLsZ7RkXUAs');           // { version: 0, payload: Uint8Array }
```

`decodeToBytes` and `decodeCheck` throw `Base58Error`, which carries a `position` field where a bad character was found. `encodeCheck` takes a version byte and a payload and returns the full checksummed string; `decodeCheck` returns `{ version, payload }` separately rather than one joined array. The checksum in `encodeCheck`/`decodeCheck` is computed with `sha256` from `@noble/hashes`, applied twice.

## Dependencies

- `@noble/hashes` ^2.4.0

## Tests

```sh
npm test
```

The Bitcoin alphabet is transcribed character for character from `bitcoin/bitcoin`'s own `base58.cpp`. The Ripple alphabet is transcribed from `@scure/base`'s `base58xrp` export, which is the alphabet the XRP Ledger's own `ripple-address-codec` library (via `xrpl.js`) actually uses at runtime — an independent second source from Bitcoin's. The Flickr alphabet is transcribed from the same `@scure/base` library's `base58flickr` export. All three are asserted against an independently transcribed copy in the test file, not merely checked for length and uniqueness. The Base58Check known-answer triple (version 0x00, payload `f54a5851e9372b87810a8e60cdd2e7cfd80b6e31`, encoded `1PMycacnJaSqwwJqjawXBErnLsZ7RkXUAs`) is taken from the Bitcoin Wiki's 'Technical background of version 1 Bitcoin addresses' worked example and independently recomputed with Node's own `crypto` module before being fixed as a test vector.

## Licence

MIT. See [LICENSE](./LICENSE).
