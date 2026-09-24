# Base32 Encoder & Decoder

Encode and decode RFC 4648 Base32, Base32hex and Crockford Base32.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Converts between bytes and Base32 text under three distinct alphabets: the two RFC 4648 alphabets (Base32 and its extended-hex variant) and Crockford's own alphabet, which encodes a number rather than a byte stream and adds an optional check symbol. Decoding tells you exactly what is wrong rather than returning something that looks plausible.

## Supported

- RFC 4648 section 6 Base32 (A-Z, 2-7) with = padding, and its extended-hex variant from section 7 (0-9, A-V)
- Crockford's Base32 in byte mode (RFC-style bit packing over arbitrary bytes) and number mode (the payload read as a single unsigned integer)
- Crockford's case-insensitive decoding of I, L and O as 1, 1 and 0, and its convention of ignoring hyphens used as separators
- Crockford's optional check symbol, computed as the payload value modulo 37 over an extended 37-symbol alphabet
- Padded and unpadded output for the two RFC alphabets, with unpadded input always accepted on decode
- Text input and output through UTF-8, alongside a raw bytes mode for arbitrary binary data

## Limits

- Crockford Base32 is not an RFC and has no official conformance test vectors; its data alphabet and checksum rule come directly from Douglas Crockford's own published page, and the tests here are constructed from that rule and verified by round trip rather than against a published vector table.
- Crockford's checksum is optional and detects transcription and transposition errors; it is not a cryptographic integrity check and provides no protection against a deliberate change.
- The RFC padding-length validation (rejecting a string whose length cannot be a valid padded or unpadded Base32 group) applies only to the two RFC alphabets. Crockford has no such rule because it zero-extends rather than groups in fixed quanta.
- This is an encoding, not encryption. Base32 in any of its three forms provides no confidentiality whatsoever.

## Ambiguous cases, and what this does about them

- Crockford byte mode and Crockford number mode produce different strings for the same input bytes, because number mode strips leading zero digits the way an integer does and byte mode does not. Both are offered and labelled so the difference is a documented choice, not a discovered bug.
- A Crockford value with a checksum that does not match its payload is rejected outright rather than repaired, because guessing at the intended correction would silently accept a different value than the one that was typed.

## Defined by

- [RFC 4648 — The Base16, Base32, and Base64 Data Encodings](https://www.rfc-editor.org/rfc/rfc4648)
- [Douglas Crockford — Base 32](https://www.crockford.com/base32.html)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/base32 base32
cd base32
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/base32
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { encodeText, decodeToText, encodeBytes, decodeToBytes } from '@fodt/base32';

encodeText('foobar');                                   // 'MZXW6YTBOI======' (Base32)
encodeText('foobar', { alphabet: 'base32hex' });        // 'CPNMUOJ1E8======'
encodeBytes(new Uint8Array([1]), { alphabet: 'crockford', crockfordMode: 'number' }); // '1'
decodeToBytes('MZXW6YTBOI======');                     // Uint8Array of 'foobar'
```

`decodeToBytes` and `decodeToText` throw `Base32Error`, which carries a `position` field pointing at the offending character. `encodeBytes`/`decodeToBytes` are the primitives; the text helpers wrap them through `TextEncoder`/`TextDecoder`. The `Base32Alphabet` union names all three alphabets, and `ALPHABETS` exports each one's symbol string.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

RFC 4648 section 10 publishes the complete test-vector table for both the Base32 and Base32hex alphabets; all seven rows of both columns are asserted verbatim in both directions. Crockford publishes its alphabet, its three decoding aliases and its modulo-37 checksum rule, but no vector table, so the Crockford cases are constructed from the rule itself (including a hand-computed checksum example) and proven by round trip.

## Licence

MIT. See [LICENSE](./LICENSE).
