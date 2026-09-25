# XML Sitemap Generator

Turn a URL list into a valid sitemap, with index splitting past the size limit.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Turns a list of URLs into sitemaps.org 0.9 XML, with exact byte accounting, splitting into more than one file under a sitemap index the moment 50,000 URLs or 52,428,800 uncompressed bytes would be passed, whichever limit a given list hits first. Every output file is proven against the protocol's own official XML Schema.

## Supported

- One URL per line, optionally followed by whitespace and a per-line lastmod value
- A global lastmod, changefreq and priority applied to every URL that has no per-line override
- Splitting past 50,000 URLs or 52,428,800 uncompressed bytes, whichever comes first, into sitemap-1.xml, sitemap-2.xml and so on under a sitemap index
- Exact UTF-8 byte accounting for every file and the index, never estimated
- Ampersands, quotes and angle brackets entity-escaped as the protocol requires; spaces and non-ASCII characters percent-encoded as RFC 3986 requires first
- Duplicate URLs written once and counted
- Every generated file validated in this project's own tests against the sitemaps.org 0.9 sitemap and siteindex XML Schemas

## Limits

- This tool cannot check that a listed URL actually responds, redirects, or is allowed by a robots.txt file, because that needs your server and a real request
- This tool cannot tell whether a search engine actually accepts or uses the file it produces, because that needs the search engine's own tools
- Compressed (gzip) output is not produced; image, video and news sitemap extensions are not generated

## Ambiguous cases, and what this does about them

- A relative URL, a URL over 2,048 characters or a URL on a different host from the first URL is reported with its line number; the first two are left out of the file entirely, the third is kept but flagged, since only the first two would make the file invalid against the sitemaps.org XSD
- A line is split into a URL and a per-line lastmod at the first run of whitespace only when the text after it is a valid W3C Datetime; otherwise the whole line is kept as one URL, so an unencoded space pasted inside a URL does not silently truncate it

## Defined by

- [sitemaps.org protocol 0.9](https://www.sitemaps.org/protocol.html)
- [W3C Datetime (NOTE-datetime)](https://www.w3.org/TR/NOTE-datetime)
- [RFC 3986 — Uniform Resource Identifier (URI): Generic Syntax](https://www.rfc-editor.org/rfc/rfc3986)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/sitemap-generator sitemap-generator
cd sitemap-generator
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/sitemap-generator
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { buildSitemaps, MAX_URLS_PER_FILE, MAX_BYTES_PER_FILE } from '@fodt/sitemap-generator';

const { files, index } = buildSitemaps('https://example.com/\nhttps://example.com/about', { baseUrl: 'https://example.com/' });
```

`buildSitemaps` never throws for an individual bad URL line (it is reported in `problems` and skipped); it throws `SitemapError` only when the whole input is too large to process safely, or when the sitemap index itself would pass either limit.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Asserts a two-URL list validates against the vendored sitemap.xsd with xmllint-wasm (devDependency-only, Node-test-only), that 60,000 URLs split into exactly the files the 50,000-URL limit requires, that a byte-heavy list splits on the byte limit before the count limit, that every reported byte count is exact, and that ampersands, quotes, angle brackets, spaces and non-ASCII characters are all written as the sitemaps.org protocol and RFC 3986 require.

## Licence

MIT. See [LICENSE](./LICENSE).
