# Security Headers & CSP Builder

Compose Content-Security-Policy and the other security headers for common servers.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Composes a Content-Security-Policy per CSP Level 3, plus HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, Cross-Origin-Opener-Policy, Cross-Origin-Embedder-Policy and Cross-Origin-Resource-Policy, and writes the same header values out for Apache, nginx, Netlify's _headers file and a plain generic list. Every value passes a single-line safety check before any output is built, so a pasted line break or control character can never start a second header or a server directive.

## Supported

- CSP Level 3 directive and source-list grammar: keyword, scheme, host, nonce and hash source expressions, with line-numbered problems for an unknown directive, a duplicate, 'none' combined with another source, an unquoted keyword or a source that does not match the grammar
- upgrade-insecure-requests, added to the CSP header text (it is defined by the Mixed Content specification, not CSP Level 3 itself)
- HSTS max-age and includeSubDomains per RFC 6797, with preload refused unless the hstspreload.org submission requirements (includeSubDomains and a one-year minimum max-age) are met
- Referrer-Policy, Cross-Origin-Opener-Policy, Cross-Origin-Embedder-Policy and Cross-Origin-Resource-Policy restricted to each specification's own defined token list
- Permissions-Policy written as an RFC 9651 structured-field dictionary, with * for every origin, () for none, and an allowlist of self and quoted origins
- The same header set rendered for Apache (mod_headers), nginx (add_header), Netlify's _headers file and a plain Name: value list
- A value carrying a line break or control character refused before any target is written, naming the field and position

## Limits

- This tool does not run Apache, nginx or Netlify itself, so it cannot tell whether the relevant module is enabled or whether another rule on the real server overrides these headers; the configuration cannot be tested without a real server
- A strict policy can break inline scripts, inline styles and third-party embeds on the visitor's own site; this tool checks the grammar, not whether the policy matches what the site actually needs
- X-Frame-Options and Trusted Types headers are not generated; use the CSP frame-ancestors directive for frame embedding control instead
- Apache values have every percent sign doubled and nginx values refuse a dollar sign outright, because each server's own config-file parser gives that character special meaning; this tool does not attempt every possible escaping trick beyond what each server's own documentation describes

## Ambiguous cases, and what this does about them

- A directive this tool does not recognise (an unknown name, or a fetch directive an earlier CSP version removed) is reported with its line and dropped from the built header text, since re-emitting an unrecognised directive verbatim could not be checked for safety either
- A Permissions-Policy feature name outside the standardised list this tool checked is a warning, not an error, because browsers ship feature names beyond that list

## Defined by

- [CSP Level 3 — Content Security Policy Level 3](https://www.w3.org/TR/CSP3/)
- [Mixed Content — upgrade-insecure-requests](https://www.w3.org/TR/upgrade-insecure-requests/)
- [RFC 6797 — HTTP Strict Transport Security (HSTS)](https://www.rfc-editor.org/rfc/rfc6797)
- [Referrer Policy](https://www.w3.org/TR/referrer-policy/)
- [Fetch Standard — X-Content-Type-Options and Cross-Origin-Resource-Policy headers](https://fetch.spec.whatwg.org/#x-content-type-options-header)
- [HTML Living Standard — Cross-origin opener and embedder policies](https://html.spec.whatwg.org/multipage/browsers.html#cross-origin-opener-policies)
- [Permissions Policy](https://www.w3.org/TR/permissions-policy/)
- [RFC 9651 — Structured Field Values for HTTP](https://www.rfc-editor.org/rfc/rfc9651)
- [RFC 9110 — HTTP Semantics, section 5.5 Field Values](https://www.rfc-editor.org/rfc/rfc9110#section-5.5)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/security-headers security-headers
cd security-headers
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/security-headers
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { buildSecurityHeaders } from '@fodt/security-headers';

buildSecurityHeaders({
  csp: "default-src 'self'\nobject-src 'none'",
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: false },
  nosniff: true,
});
```

`buildSecurityHeaders` throws `SecurityHeadersError` (fields `field`, `line`) for a value a single header cannot carry safely or an option outside a specification's defined token list; CSP grammar problems are reported as line-numbered warnings instead, since a browser ignores an unrecognised directive rather than rejecting the whole policy.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

CSP source-list grammar is checked against the ABNF fetched from CSP Level 3's own "Source Lists" section; HSTS against RFC 6797 sections 6.1 and 8.1 plus the hstspreload.org submission requirements; each token-list header against its own specification's defined values; Permissions-Policy serialisation against RFC 9651 sections 4.1.1.1 and 4.1.6; Apache and nginx escaping against each server's own fetched documentation and, for nginx, its own config-file tokenizer source.

## Licence

MIT. See [LICENSE](./LICENSE).
