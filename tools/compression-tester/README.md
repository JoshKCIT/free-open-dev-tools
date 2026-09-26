# Compression Size Tester

Compare gzip and deflate sizes for a payload using the browser compression API.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Measures how small typed text or a chosen file gets under gzip, deflate and deflate-raw, using this browser's own CompressionStream on bytes that never leave the page. Sizes are checked in tests against Node's own zlib at its default level, and this page states how closely the browser you are using tracks that.

## Supported

- gzip, deflate and deflate-raw, each computed by the running browser's own platform CompressionStream (WHATWG Compression Standard)
- Typed text (encoded as UTF-8) or a chosen file, streamed through in 64 KB chunks so a large input never freezes the tab
- Cancelling a run between chunks
- Downloading the compressed bytes for each selected format
- An empty input, which reports each format's fixed container size rather than an error

## Limits

- Compressed sizes can differ slightly between compressor implementations and compression levels; the browser's own CompressionStream has no level setting, so this tool cannot reproduce another program's exact output or another level -- only running that program can show that.
- This tool cannot check what a server-side compressor or a different browser version would produce; it can only measure the engine actually running this page.
- Only gzip, deflate and deflate-raw are measured; brotli is part of the same platform interface but is not requested here.

## Ambiguous cases, and what this does about them

- For an empty input, output divided by input is mathematically undefined; this tool reports ratio as 0 for every format rather than Infinity or NaN, since the fixed container sizes are still shown separately in bytes.

## Defined by

- [Compression Streams (WHATWG)](https://compression.spec.whatwg.org/)
- [RFC 1950 (ZLIB Compressed Data Format)](https://www.rfc-editor.org/rfc/rfc1950)
- [RFC 1951 (DEFLATE Compressed Data Format)](https://www.rfc-editor.org/rfc/rfc1951)
- [RFC 1952 (GZIP file format specification)](https://www.rfc-editor.org/rfc/rfc1952)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/compression-tester compression-tester
cd compression-tester
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/compression-tester
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { measureCompression } from '@fodt/compression-tester';

const result = await measureCompression(bytes);
for (const r of result.results) {
  console.log(r.format, r.unsupported ? 'unsupported' : r.bytes);
}
```

`measureCompression` returns `{ inputBytes, results }`; each result carries `format`, `bytes`, `ratio`, `output` (the compressed bytes) and `unsupported` (true only when this engine's CompressionStream constructor rejects that format, never for a genuine zero-byte result). It throws `CompressionTesterError` only for input over 256 MB, and an `AbortError` DOMException when `signal` is aborted.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Sizes are checked two ways: exact equality with Node's own zlib (gzipSync/deflateSync/deflateRawSync) at its default level for the same bytes in Node, and, on four real browser engines, within the tolerance SIZE_TOLERANCE states, computed against the same zlib calls run on the same sample payloads in the end-to-end spec.

## Licence

MIT. See [LICENSE](./LICENSE).
