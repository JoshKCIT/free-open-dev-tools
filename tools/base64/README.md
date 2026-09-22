# Base64 Encoder & Decoder

Encode and decode Base64 and Base64url, for text and files, with explicit UTF-8 handling and padding control.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Converts between bytes and Base64 text exactly as RFC 4648 defines it, including the URL-safe alphabet used by JSON Web Tokens. Text is treated as UTF-8 before encoding, which is where most Base64 tools quietly disagree with each other on anything outside ASCII. Decoding is strict by default and tells you exactly what is wrong rather than returning something that looks plausible.

## Supported

- The standard alphabet (+ and /) and the URL-safe alphabet (- and _), or automatic acceptance of either
- Padded and unpadded output, and line wrapping at any width for MIME
- Full Unicode via UTF-8, including emoji and other characters outside the Basic Multilingual Plane
- Arbitrary binary data, with a hex view of the decoded bytes
- Strict decoding that rejects whitespace, bad padding and non-canonical trailing bits, and a lenient mode that accepts them

## Limits

- Decoded bytes that are not valid UTF-8 are shown with U+FFFD replacement characters in the text view. The hex view shows the real bytes, and the download gives you the exact bytes.
- A lone surrogate in the input cannot be encoded as UTF-8 and becomes U+FFFD, so that round trip is lossy. This is a property of UTF-8, not a bug here.
- This is an encoding, not encryption. Base64 provides no confidentiality whatsoever.
- Very large inputs are held in memory in full. Files beyond a few hundred megabytes may exhaust the tab.

## Ambiguous cases, and what this does about them

- Unpadded Base64 is common in the wild but is not valid under RFC 4648 section 3.2 unless the specification using it says padding is omitted. Strict mode rejects it and says so; lenient mode accepts it.
- Non-canonical encodings, where the unused bits of the final character are not zero, decode to the same bytes in most libraries. RFC 4648 section 3.5 says a strict decoder should reject them, and strict mode does.

## Defined by

- [RFC 4648 — The Base16, Base32, and Base64 Data Encodings](https://www.rfc-editor.org/rfc/rfc4648)
- [RFC 2045 section 6.8 — Base64 Content-Transfer-Encoding (line wrapping)](https://www.rfc-editor.org/rfc/rfc2045#section-6.8)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/base64 base64
cd base64
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/base64
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { encodeText, decodeToText, encodeBytes, decodeToBytes } from '@fodt/base64';

encodeText('foobar');                            // 'Zm9vYmFy'
decodeToText('Zm9vYmFy');                        // 'foobar'
encodeText('foo', { alphabet: 'url', padding: false });
decodeToBytes('Zg==', { mode: 'lenient' });      // Uint8Array [ 0x66 ]
```

`decodeToBytes` and `decodeToText` throw `Base64Error`, which carries a `position` field pointing at the offending character in the input. `encodeBytes` is the primitive; the text helpers are thin wrappers that run the input through `TextEncoder` first.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The seven normative test vectors from RFC 4648 section 10 are asserted in both directions. Beyond those: every byte value 0 to 255, non-canonical trailing bits, padding errors, lone surrogates, a 400 KB input, and a differential check of 300 random buffers against Node's own `Buffer.toString('base64')` and `'base64url'`.

## Licence

MIT. See [LICENSE](./LICENSE).
