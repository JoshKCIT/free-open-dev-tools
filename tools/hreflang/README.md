# Hreflang Tag Generator

Generate reciprocal hreflang tags and check the language and region codes.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Checks every language tag you type against the RFC 5646 grammar and a bundled, dated snapshot of the IANA Language Subtag Registry, then writes reciprocal hreflang annotations for a cluster of alternate-language pages in the three forms Google Search Central documents: HTML link elements, an HTTP Link header and sitemap xhtml links. Every page in the cluster lists every alternate, including itself, so the annotations are reciprocal by construction.

## Supported

- Checking a language tag for well-formedness against the RFC 5646 ABNF grammar and for validity against the bundled IANA Language Subtag Registry snapshot
- Reporting a deprecated subtag or a grandfathered/redundant tag with its registry Preferred-Value
- Suggesting the hyphen form for a common mistake such as en_US
- Writing one set of reciprocal hreflang annotations for a cluster of alternate-language pages, as HTML link elements, an RFC 8288 HTTP Link header and sitemap xhtml links
- An optional x-default fallback entry
- Flagging a repeated language tag or the same URL listed under two tags

## Limits

- This tool cannot fetch your pages, so it cannot confirm each URL actually responds, carries the same annotations back, or is indexed -- a search engine checks all of that on its own servers when it crawls, not something a browser tab can verify without a server
- The registry snapshot is dated (its File-Date is shown on the page); IANA updates the live registry more often than this tool's bundled copy is refreshed
- Extension subtags (the -u- and -t- forms) are checked for syntax only, not against a registry of their own contents
- A variant's registered Prefix is a recommendation, not a hard requirement (RFC 5646 section 2.2.5), so a mismatch is reported as a warning, not refused

## Ambiguous cases, and what this does about them

- A language tag in a form the fetched Google Search Central page does not itself demonstrate is still accepted as valid BCP 47 with a warning citing that page, rather than refused, since RFC 5646 validity and Google's own documented examples are two different questions

## Defined by

- [RFC 5646 (BCP 47) -- Tags for Identifying Languages](https://www.rfc-editor.org/rfc/rfc5646)
- [IANA Language Subtag Registry](https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry)
- [RFC 8288 -- Web Linking (the Link header)](https://www.rfc-editor.org/rfc/rfc8288)
- [Google Search Central -- Tell Google about localized versions of your page](https://developers.google.com/search/docs/specialty/international/localized-versions)
- [HTML Living Standard -- the link element's hreflang attribute](https://html.spec.whatwg.org/multipage/semantics.html#attr-link-hreflang)

## Bundled data

This folder ships a data file that is not an npm dependency, so it travels with the folder when it is
copied out on its own:

- **IANA Language Subtag Registry** (CC0-1.0) — [source](https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry). IANA Language Subtag Registry, dedicated to the public domain by IANA and IETF under CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/legalcode).

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/hreflang hreflang
cd hreflang
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/hreflang
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { buildHreflang, checkLanguageTag } from '@fodt/hreflang';

buildHreflang('en https://example.com/en/\nde https://example.com/de/', { xDefault: 'https://example.com/' });
checkLanguageTag('zh-Hant');
```

`buildHreflang` never throws for a malformed tag or URL on an individual line -- each bad line becomes a `problems` entry naming its line number, and the rest of the input still converts. `HreflangError` is thrown only for input over the 1,000-line cap. `checkLanguageTag` never throws; it always returns a report.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every RFC 5646 Appendix A example (both the valid tags and the 'Some Invalid Tags' list) is asserted as a whitespace-free substring of the vendored RFC text before being checked, so a transcription error in the test fails loudly instead of silently testing the wrong string. The bundled registry snapshot is re-derived from the vendored IANA file at test time and asserted equal record for record, so the bundle can never silently drift from its source.

## Licence

MIT. See [LICENSE](./LICENSE).
