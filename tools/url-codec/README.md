# URL Encoder & Decoder

Percent-encode and decode using component, full-URI and form-encoding rules.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

There are three different things people mean by URL encoding, and using the wrong one is the usual reason a value arrives corrupted. This tool shows all three at once so the difference is visible: encoding one piece of a URL, encoding a whole URL, and encoding a form field. Decoding is tolerant of the malformed escapes that real-world URLs are full of, instead of throwing the way the built-in browser function does.

## Supported

- Component encoding, for a single path segment, query value or fragment
- Full URI encoding, which leaves the structural characters intact so the URL still parses
- Form encoding (application/x-www-form-urlencoded), where a space becomes a plus sign
- A strict RFC 3986 option that also escapes ! ' ( ) * , which some signing schemes require
- Full Unicode via UTF-8, including emoji and other characters above U+FFFF
- Decoding malformed input such as a bare percent sign, either by reporting it or leaving it in place

## Limits

- Internationalised domain names are not converted to Punycode. Percent-encoding a host is not the same as encoding it for DNS; use the URL parser for that.
- Byte sequences that are not valid UTF-8 decode to the U+FFFD replacement character rather than failing, which matches browser behaviour but is lossy.
- This does not parse a URL into parts or validate it. The URL parser does that.
- Percent-encoding is not escaping for HTML, SQL or a shell. Using it for those is a security bug, not a formatting choice.

## Ambiguous cases, and what this does about them

- A plus sign means a space in form encoding and means a literal plus everywhere else. The decoder follows the selected mode, and this is the single most common source of confusion with this format.
- encodeURIComponent leaves ! ' ( ) * unescaped although RFC 3986 lists them as sub-delimiters. Default behaviour matches the browser; the strict option matches the RFC.

## Defined by

- [RFC 3986 — Uniform Resource Identifier (URI): Generic Syntax](https://www.rfc-editor.org/rfc/rfc3986)
- [WHATWG URL Standard — application/x-www-form-urlencoded serialising](https://url.spec.whatwg.org/#urlencoded-serializing)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/url-codec url-codec
cd url-codec
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/url-codec
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { encode, decode, encodeAll } from '@fodt/url-codec';

encode('a b/c');                          // 'a%20b%2Fc'
encode('a b/c', { mode: 'uri' });         // 'a%20b/c'
encode('a b/c', { mode: 'form' });        // 'a+b%2Fc'
decode('100%', { onMalformed: 'keep' });  // '100%'
```

`decode` throws `UrlCodecError` with a `position` field on a malformed escape unless `onMalformed: 'keep'` is passed. `encodeAll` returns all three encodings at once, which is what the web page renders.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Component and URI modes are asserted to agree exactly with the platform's own `encodeURIComponent` and `encodeURI`, and form mode with `URLSearchParams`. On top of that: the RFC 3986 unreserved set, the legacy sub-delimiters, multi-byte and astral-plane characters, malformed escapes, invalid UTF-8, and round trips over a sample that includes control characters and a 5000 character string.

## Licence

MIT. See [LICENSE](./LICENSE).
