# Gzip, Zlib & Deflate Codec

Compress text to gzip, zlib or raw deflate as Base64 or hex, and decompress it back, with integrity checks and a size cap.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Decompresses a gzip, zlib or raw deflate blob pasted as Base64, hex or URL-encoded Base64 (for example a SAML SAMLRequest value), verifying every checksum the container defines rather than trusting the bytes. It can also compress text or hex bytes to gzip, zlib or raw deflate at a chosen level, deterministically. Use it to inspect or rebuild a compressed value by hand, not to compress large files: a decompressed result over 64 MiB is refused rather than risk freezing the tab.

## Supported

- Decompress from Base64 (standard or URL-safe), hex, or URL-encoded (percent-decoded) Base64
- Auto-detect gzip, zlib or raw deflate, or force the container
- gzip: CRC-32 and ISIZE verified per member; concatenated members decoded and concatenated; header fields shown (modification time, OS, original name, comment, extra field)
- zlib: Adler-32 verified; CINFO/window size and FLEVEL compression-level hint shown
- Compress to gzip, zlib or raw deflate at level 0-9, output as Base64, Base64url (unpadded) or hex, with optional percent-encoding
- Deterministic gzip output: MTIME is always 0 and no file name is written, so compressing the same input twice gives byte-identical bytes

## Limits

- Decompressed output is capped at 64 MiB; a larger result is refused with the cap named, rather than risk exhausting the browser tab.
- Pasted text only: there is no file upload, and no archive format (ZIP, TAR) is read.
- A zlib stream that needs a preset dictionary (FDICT) is refused: this tool cannot supply one.
- Raw deflate carries no checksum of its own, so damaged raw deflate input can decode to the wrong bytes without any error being raised.
- The bundled decoder does not check that a stored (uncompressed) DEFLATE block's NLEN field is the one's complement of LEN, unlike some other implementations; a block with a mismatched NLEN still decodes here.
- Compressed output is valid gzip/zlib/deflate but is not guaranteed to be byte-identical to another compressor's output at the same level, only to this tool's own output for the same input.
- gzip compress output always has MTIME 0, no file name, and OS byte 3 (Unix), regardless of what produced the original data.
- Base64url output is never padded.
- The page shows at most the first 1,048,576 characters of decompressed text; the download holds the complete result.

## Ambiguous cases, and what this does about them

- A raw deflate stream can, by chance, look like a valid zlib header; when auto-detection guesses wrong, force the container explicitly instead.
- Bytes found after the last gzip member, or after a zlib/raw deflate stream, are reported as a warning naming their count (as the gzip(1) command warns about trailing garbage) rather than treated as an error.
- A literal + in URL-encoded Base64 input is read as a Base64 plus, never as a space: Base64 text never contains a literal space, and SAML's HTTP-Redirect binding always encodes a real + as %2B.
- gzip FNAME and FCOMMENT are shown decoded as ISO 8859-1, exactly as RFC 1952 specifies, even though some compressors write UTF-8 bytes there instead.

## Defined by

- [RFC 1950 — ZLIB Compressed Data Format Specification version 3.3](https://www.rfc-editor.org/rfc/rfc1950)
- [RFC 1951 — DEFLATE Compressed Data Format Specification version 1.3](https://www.rfc-editor.org/rfc/rfc1951)
- [RFC 1952 — GZIP file format specification version 4.3](https://www.rfc-editor.org/rfc/rfc1952)
- [RFC 4648 — The Base16, Base32, and Base64 Data Encodings, sections 4 and 5](https://www.rfc-editor.org/rfc/rfc4648)
- [RFC 3986 — Uniform Resource Identifier (URI), section 2.1 Percent-Encoding](https://www.rfc-editor.org/rfc/rfc3986#section-2.1)
- [SAML 2.0 Bindings, section 3.4.4.1 DEFLATE Encoding](https://docs.oasis-open.org/security/saml/v2.0/saml-bindings-2.0-os.pdf)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/gzip-deflate gzip-deflate
cd gzip-deflate
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/gzip-deflate
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { decompress, compress } from '@fodt/gzip-deflate';

const d = decompress(base64Text, { inputEncoding: 'base64', container: 'auto' });
d.text; // decompressed text, or null when the bytes are not valid UTF-8

const c = compress('hello', { inputKind: 'text', format: 'gzip', level: 6, outputEncoding: 'base64', percentEncode: false });
```

`decompress`/`decompressBytes` return `{ bytes, text, container, detected, members, zlibHeader?, checks, compressedBytes, trailingBytes, warnings }`. Every checksum mismatch, truncation, or the output cap throws a `GzipDeflateError` with a `kind` naming which ('input' | 'container' | 'checksum' | 'truncated' | 'corrupt' | 'output-cap') and, for an input-decoding error, a `position` into the pasted text; the output-cap kind also carries `producedBytes`. `MAX_OUTPUT_BYTES` (64 MiB) and `FEED_CHUNK_BYTES` (1 KiB) are exported constants.

## Dependencies

- `fflate` 0.8.3

## Tests

```sh
npm test
```

RFC 1951 section 3.2 stored and fixed-Huffman vectors are built by hand and cross-checked with Node's own zlib. Node's gunzipSync/inflateSync/inflateRawSync and gzipSync/deflateSync/deflateRawSync are used as a second opinion in both directions across a text, Unicode, large and random-byte corpus. A crafted decompression bomb (200 MiB of zeros, fed through Node's own gzip stream so the test never holds 200 MiB itself) proves the 64 MiB output cap stops it. A roughly 935 KB Node-gzipped text, whose final DEFLATE block spans many 1 KiB pushes, pins the corrected `s.f && !s.l` end-of-stream check against the archive-toolkit reader's own `s.f`-alone defect, found and documented (not fixed there) while building this tool.

## Licence

MIT. See [LICENSE](./LICENSE).
