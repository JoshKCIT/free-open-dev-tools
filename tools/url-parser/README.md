# URL & Query String Parser

Split a URL into its parts and turn query strings into structured data.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Splits a URL into every part the WHATWG URL Standard defines (scheme, credentials, host, port, path, query and fragment) and turns its query string into ordered name/value pairs and a JSON object, or does the same for a bare query string on its own. Results come from the platform's own URL and URLSearchParams, which implement the standard directly, so this tool answers exactly what a browser's own address bar would.

## Supported

- Splitting a full URL into scheme, username, password, host, hostname, port, path, path segments, query string and fragment
- Parsing a query string on its own, with or without a leading question mark
- Structuring the query into ordered name/value pairs and a JSON object, with a repeated name becoming an array
- Resolving a relative reference against a base URL
- Flagging a URL that carries a user name or password
- Flagging input the parser silently cleaned up: a leading or trailing control character or space, or a tab or newline anywhere in the input
- A query key such as __proto__ or constructor kept as an ordinary own key, never touching Object.prototype

## Limits

- Results follow the running engine's own URL parser. On a small, named set of official web-platform-tests URL test cases that set differs from the standard's own answer; the exact failing set on this build's Node version and the engine version are recorded in the test file's own KNOWN_DIFFERENCES list
- A bracket-style query key such as a[b]=1 stays a literal key. The WHATWG URL Standard defines no nesting for query strings, and frameworks disagree on how to interpret one, so this tool does not guess
- This tool cannot tell whether the URL it parsed actually exists, what a server at that address would return, or where it would redirect, because answering any of that needs a real request to a server

## Ambiguous cases, and what this does about them

- A repeated query name becomes an array in queryObject; a name that appears once stays a plain string, so the shape of a value depends on how many times its name repeats in the input

## Defined by

- [WHATWG URL Standard — URL parsing (basic URL parser)](https://url.spec.whatwg.org/#url-parsing)
- [WHATWG URL Standard — application/x-www-form-urlencoded parsing](https://url.spec.whatwg.org/#urlencoded-parsing)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/url-parser url-parser
cd url-parser
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/url-parser
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { parseUrl, parseQuery } from '@fodt/url-parser';

parseUrl('https://user:pw@example.com:8080/a/b?x=1&x=2#frag');
parseQuery('?a=1&a=2&b=hi');
```

`parseUrl` throws `UrlParserError` when the platform's own URL constructor cannot parse the input; the message names the relative-reference case specifically when no base was given and the input has no scheme. `parseQuery` accepts a leading question mark and strips it before parsing.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every non-failure object entry in the vendored web-platform-tests url/resources/urltestdata.json is asserted to parse to the fields the test data expects, and every entry marked failure is asserted to throw; a small, named KNOWN_DIFFERENCES list in the test file covers the running Node build's own known departures from that data (IDNA edge cases and an opaque-path whitespace-percent-encoding case), each checked against the vendored file so the list cannot silently grow stale.

## Licence

MIT. See [LICENSE](./LICENSE).
