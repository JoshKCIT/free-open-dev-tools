# HAR Viewer

List the requests in a browser network recording with headers, bodies and timings, with cookies and tokens flagged.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Lists the requests a browser recorded in a HAR file, with each request's method, address, status, size and timing, and opens one request to show its headers, query, cookies, posted data and text body. Cookies, authorization headers, tokens and passwords are flagged and masked until you choose to show them. The recording is only read: no request in it is ever sent, replayed or opened, and every address is shown as text, never as a link. Nothing is uploaded.

## Supported

- HAR 1.2 and 1.1 recordings, as exported by browser developer tools and proxies, from a file or pasted text
- A list of requests with start order, method, address, status, size and time, filtered by text in the address, by method and by status (404 or a class such as 4xx), and sorted by time, size or status
- One request opened in full: request and response headers, query parameters, cookies, posted data and the response body as text
- Base64 response bodies decoded before they are shown; only text bodies are shown, and a long body is cut with a note
- Sensitive values flagged and masked: Authorization, Proxy-Authorization, Cookie, Set-Cookie, X-API-Key, X-Auth-Token, X-CSRF-Token and X-XSRF-Token headers, every cookie, parameters named like a token, key, secret or password, a password inside an address, and values shaped like a JSON Web Token or a Bearer credential
- Sizes of -1 shown as unknown and timings of -1 shown as not applicable and left out of the total, as the specification defines them
- Custom fields that start with an underscore are ignored

## Limits

- Files up to 50 MiB; the first 20,000 entries are listed, 500 per page.
- No recorded request is ever sent, replayed or opened (a recording is read and never sent anywhere), and addresses are shown as text, never as links.
- Sensitive values are masked to their first four characters and their length until you choose Show sensitive values; the rules are listed on this page and only catch what they describe.
- Bodies are shown as text, up to 100 KB each; images and other binary bodies are not displayed.
- HAR files only: a recording in another format, or a HAR version before 1.1, is refused.

## Ambiguous cases, and what this does about them

- The total time of a request is the sum of its timings that are not -1 (blocked, dns, connect, send, wait and receive); the ssl timing is part of connect in the specification, so it is not added a second time. When a request has no timings, the recording's own time field is used
- Size is the size of the returned content when the recording has one, otherwise the size of the body as received; a size of -1 means the recording does not have it and is shown as unknown
- The list keeps the order of the recording. The specification prefers entries sorted by start time but says a reader should not rely on it, so this page shows the order the file has; sorting by time, size or status is stable, and requests with equal keys stay in recording order
- The address filter looks at the address as it is shown, so a masked value cannot be found by searching for part of it until Show sensitive values is on
- A value of five to eight characters is masked completely, because showing four characters of it would show most of it; longer values keep their first four characters
- Masking looks at names and at the shape of a value. A secret in a body is found when it sits in a form field or a JSON member with a sensitive name, or has the shape of a token; a secret with another name and no recognisable shape is shown as it is

## Defined by

- [HAR 1.2 Spec](http://www.softwareishard.com/blog/har-12-spec/)
- [RFC 6265 HTTP State Management Mechanism (Cookie, Set-Cookie)](https://www.rfc-editor.org/rfc/rfc6265)
- [RFC 7235 HTTP/1.1 Authentication (Authorization, Proxy-Authorization)](https://www.rfc-editor.org/rfc/rfc7235)
- [RFC 6750 OAuth 2.0 Bearer Token Usage](https://www.rfc-editor.org/rfc/rfc6750)
- [RFC 7519 JSON Web Token (JWT)](https://www.rfc-editor.org/rfc/rfc7519)
- [RFC 3986 URI Generic Syntax (user information)](https://www.rfc-editor.org/rfc/rfc3986)
- [RFC 8259 The JSON Data Interchange Format](https://www.rfc-editor.org/rfc/rfc8259)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/har-viewer har-viewer
cd har-viewer
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/har-viewer
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { readHar, listRequests, requestDetail } from '@fodt/har-viewer';

const har = readHar(text);
const { rows, total } = listRequests(har, { filter: '', method: '', status: '4xx', sort: 'time', reveal: false, page: 1 });
const detail = requestDetail(har, rows[0].index, { reveal: false, bodies: true });
```

`readHar(text)` parses the recording and keeps it in memory; it throws `HarViewerError` with `path` (an RFC 6901 pointer such as `/log/entries`) for a missing or wrongly typed part, and with `line` and `column` for a JSON syntax error. `listRequests(har, options)` returns `{ rows, total, shown }`: `total` counts the requests that match the filters on every page and `shown` counts the rows on the requested page. `requestDetail(har, index, options)` takes the 1-based `index` of a row. `isSensitive` and `maskValue` are exported from the same package so a page can explain its rules.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every recording in the tests is built from the field list of the HAR 1.2 specification, and the expected sizes, timings and sums are the specification's own definitions and example values. Token-shaped values are assembled at run time from pieces so no test file holds a literal that looks like a real credential. A local server named in the recordings is shown to receive no request.

## Licence

MIT. See [LICENSE](./LICENSE).
