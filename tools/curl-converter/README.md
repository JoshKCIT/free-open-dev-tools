# cURL Builder & Code Generator

Build a request visually and emit cURL, fetch, Python, Go, PHP or HTTPie. It never sends the request.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Builds an HTTP request from fields (method, URL, headers, query, body, authentication) or from a pasted curl command, and writes it out as cURL, JavaScript fetch, Python requests, Go net/http, PHP curl and HTTPie code. The request described is never actually sent: every code block is text this page generates for you to run elsewhere.

## Supported

- Building a request from fields: method, URL, headers, query parameters, a raw, JSON, form or multipart body, and Basic or bearer authentication
- Reading a pasted curl command exactly as a POSIX shell and curl itself would, including bash $'...' ANSI-C quoting, backslash-newline line continuation, and every commonly used curl option with the meaning the curl manual documents
- Refusing to evaluate anything the shell could run: variable and command substitution, pipelines, redirection, sequencing and Windows cmd.exe or PowerShell line continuations are refused with a message naming the position, never run
- Writing the same request as cURL, JavaScript fetch, Python requests, Go net/http, PHP curl and HTTPie, with every string literal escaped correctly for that language
- Flagging a password, token, Authorization header or Cookie value present in the request, and replacing it with a placeholder in every generated snippet on request

## Limits

- This tool never sends the request, so it cannot show the response, check that the URL exists, or tell whether a server accepts these headers or this body -- only actually running the generated code against a real server can
- File uploads and any curl option that reads a file from disk (an @file form, a data or form field starting with @) are left out, because this page never reads files from the visitor's machine
- Windows cmd.exe and PowerShell quoting are not read; a pasted command must be POSIX shell / bash syntax, the same syntax curl's own manual examples use
- curl's own implicit defaults (its User-Agent string, its default Accept: */* header) are not copied into the other five languages, since those are curl's own behaviour, not part of the request the visitor described

## Ambiguous cases, and what this does about them

- A curl option this tool does not recognise is listed as a warning naming it, rather than guessed at or silently dropped
- A header value, method or body containing a NUL character is refused outright, since no shell or language target here has a way to pass one on a command line

## Defined by

- [POSIX Shell Command Language, section 2.2 Quoting](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html)
- [Bash Reference Manual, ANSI-C Quoting](https://www.gnu.org/software/bash/manual/bash.html)
- [curl manual](https://curl.se/docs/manpage.html)
- [RFC 9110 -- HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110)
- [RFC 7617 -- The Basic HTTP Authentication Scheme](https://www.rfc-editor.org/rfc/rfc7617)
- [WHATWG Fetch Standard](https://fetch.spec.whatwg.org/)
- [WHATWG URL Standard](https://url.spec.whatwg.org/)
- [Python Requests -- Quickstart](https://requests.readthedocs.io/en/latest/user/quickstart/)
- [Go net/http package documentation](https://pkg.go.dev/net/http)
- [PHP curl_setopt manual page](https://www.php.net/manual/en/function.curl-setopt.php)
- [HTTPie documentation](https://httpie.io/docs/cli)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/curl-converter curl-converter
cd curl-converter
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/curl-converter
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { buildRequest, emitAll } from '@fodt/curl-converter';

const { request } = buildRequest({ method: 'GET', url: 'https://example.invalid/', headersText: '', queryText: '', bodyKind: 'none', bodyText: '', authKind: 'none', username: '', password: '', token: '', followRedirects: false });
const { snippets } = emitAll(request, { redactSecrets: false });
console.log(snippets.curl);
```

`parseCurl` and `buildRequest` throw `CurlConverterError` (optional `line`/`column`) on anything that cannot be turned into a request. `emitAll` never throws for a request it already built; it returns all six snippets plus a plain-language list of any secrets found.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The tokenizer is checked against a 1,000-command generated battery compared with the shell-quote package (a second, independent word splitter) rather than curl's own JavaScript port, which loads a native tree-sitter add-on through an install script; every generated snippet's string literals are decoded back with this tool's own test-only decoders for each language's literal rules and compared with the source values.

## Licence

MIT. See [LICENSE](./LICENSE).
