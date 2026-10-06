# CORS Checker

Describe a cross-origin request and paste the response headers to see whether a browser would send a preflight and let the page read the answer.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Describe a cross-origin request (the page's origin, the address, the method, the mode, the credentials mode and the request headers) and paste the headers the server answers with. The page applies the CORS rules of the WHATWG Fetch Standard in order and shows whether a browser would send a preflight and its exact text, which rule blocks the request first, which response headers script could read and what the browser does with each request header. It never contacts the server: nothing you describe or paste leaves your browser.

## Supported

- A request described by the page origin (an http or https origin, or null for a sandboxed page), the address (http or https, without a user name or password), the method, the mode (cors or no-cors), the credentials mode (same-origin, omit or include) and the request headers, one Name: value per line
- Method names as the Fetch Standard normalises them: DELETE, GET, HEAD, OPTIONS, POST and PUT are written in capitals whatever letters were typed, every other name (patch, for example) is kept as written, and the comparison with Access-Control-Allow-Methods is byte for byte
- Whether the browser sends a preflight (a method other than GET, HEAD or POST, or at least one CORS-unsafe request header) and the text it would send, with Access-Control-Request-Headers written as the standard writes it: lower-case names, each once, sorted by byte, joined by a comma and no space
- The CORS-safelisted request-header rules: 128 bytes at most per value, the unsafe byte set, the byte set of accept-language and content-language, a content-type whose parsed essence is application/x-www-form-urlencoded, multipart/form-data or text/plain, a single range with a start, and the 1,024-byte total above which every safelisted header counts as unsafe
- The CORS-preflight fetch checks in the order of the standard: the CORS check on the preflight answer, an ok status (200 to 299), the lists in Access-Control-Allow-Methods and Access-Control-Allow-Headers (a list that is not a list of tokens fails the whole preflight), the method, Authorization named explicitly (a wildcard never covers it), every other unsafe header name, and the Max-Age the browser may keep (5 seconds when absent or invalid)
- The CORS check on the real response: Access-Control-Allow-Origin must be * (never when credentials are included) or exactly the request origin, and Access-Control-Allow-Credentials must be exactly true when credentials are included; two lines or a comma list are one combined value and fail
- The response headers script can read: the seven safelisted names plus those in Access-Control-Expose-Headers, where * means every name except Set-Cookie and Set-Cookie2 when credentials are not included and only a header literally named * when they are
- What the browser does with each request header: sent, dropped without a message (forbidden request headers, and headers that are not allowed in no-cors mode) or the cause of the preflight, and the requests the browser refuses with a TypeError (the methods CONNECT, TRACE and TRACK, and a no-cors request with a method other than GET, HEAD or POST)
- Pasted header blocks with an optional status line, obsolete line folding and repeated names, kept in order and combined with a comma and a space as the standard combines them

## Limits

- This page reads only the request you describe and the headers you paste. It never contacts the server, so it cannot know what the server would really send, and a pass means only that a browser following the WHATWG Fetch Standard would let the page read the response. It does not mean the endpoint is safe to expose.
- It follows the WHATWG Fetch Standard at commit e9460d1 (read on 6 October 2026). Browsers add limits of their own: Firefox remembers a preflight for at most 86,400 seconds and Chromium 76 and later for at most 7,200 (MDN); other engines are not covered.
- Not modelled: redirects of the real request, service workers, browser extensions that change headers, upload event listeners and streaming bodies (these can force a preflight that cannot be seen from your description), the preflight cache itself, and other protections such as CORB, ORB, COEP, CORP and Private Network Access.
- A header list that is not a comma separated list of valid names fails the whole preflight, as the standard says; the page names the line, never the text.
- Pasted header text is limited to 65,536 characters and 500 lines, an address or origin to 8,192 characters and a method to 64 characters; a larger paste is refused before any work. Header values are counted one byte for each character, as the fetch API counts them; a request header value with a character above U+00FF is shown as a request the browser refuses.
- The preflight text shows the headers the standard lists. Browsers also add headers of their own (User-Agent, Referer, Accept-Language, cookies on the real request) that depend on the browser and are not shown.
- Where real browsers differ from the standard, the checker follows the standard. Tried with Chromium 153, Chrome 154, Edge 154, Firefox 155 and WebKit 26.6: every one of them lets the page read the response when Access-Control-Allow-Headers is * and the request has an Authorization header and does not include credentials, although the standard says Authorization must be named, so a page can work today and stop working when browsers enforce the standard.
- Chromium and WebKit join repeated lines of one request header with a comma and a space before they apply the 128-byte rule, so eight Accept lines of 128 bytes make a preflight there, while the standard counts each line and finds a total of 1,024 bytes that needs none. Firefox applies the 128-byte rule to each line and does not apply the 1,024-byte total at all.

## Ambiguous cases, and what this does about them

- For a cross-origin request the credentials modes same-origin and omit behave the same: no cookies or authorisation data are sent and a wildcard origin is accepted.
- A request to the page's own origin needs none of these checks, whatever the mode, so the page lists no preflight and no CORS check for it.
- Access-Control-Allow-Methods compares the method byte for byte: PATCH and patch are different methods, while delete, put and the other normalised names are written in capitals in the request before the comparison.
- Access-Control-Allow-Origin may appear once: two lines, or one line holding a comma list, are read as one combined value that never equals an origin.

## Defined by

- [WHATWG Fetch Standard (CORS protocol, CORS-preflight fetch, CORS check)](https://fetch.spec.whatwg.org/)
- [Fetch Standard source at commit e9460d1](https://github.com/whatwg/fetch/blob/e9460d1b22ead1c6a72eeac37fb2ec0dc01aeb1d/fetch.bs)
- [web-platform-tests fetch/api/cors at commit a419ab2](https://github.com/web-platform-tests/wpt/tree/a419ab2055dd4a747dfae5c407ae9a6d10aa08ca/fetch/api/cors)
- [MDN: Access-Control-Max-Age (the limits browsers set)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Access-Control-Max-Age)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/cors-checker cors-checker
cd cors-checker
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/cors-checker
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { checkCors, CorsCheckerError } from '@fodt/cors-checker';

const report = checkCors({
  pageOrigin: 'https://app.example',
  url: 'https://api.example/items',
  method: 'POST',
  mode: 'cors',
  credentials: 'same-origin',
  requestHeaders: 'Authorization: 123',
  preflightStatus: 204,
  preflightHeaders: 'Access-Control-Allow-Origin: *\nAccess-Control-Allow-Methods: *\nAccess-Control-Allow-Headers: *',
  responseStatus: 200,
  responseHeaders: 'Access-Control-Allow-Origin: *',
});

report.plan.preflight.accessControlRequestHeaders; // 'authorization'
report.verdict; // 'blocked-preflight'
report.firstFailure?.id; // 'preflight-authorization'
```

`checkCors(input)` checks the size of every part first (`checkInput`), reads the pasted header blocks it needs, describes the request (`describeRequest`: the method as the browser sends it, what happens to each header (sent, dropped without a message because it is forbidden or not allowed in no-cors mode), the CORS-unsafe names, whether a preflight is sent and why, and `refused` when the browser itself would refuse to build the request) and then runs the checks of the Fetch Standard in order. The report holds every step (`pass`, `fail`, `skipped` or `info`) with its part of the standard, the first failing step, the verdict, the text of the preflight, the response headers script can read and why, neutral advice and the Max-Age. Nothing is looked up: the function is pure, holds no state and gives a deep-equal report for the same input. A refusal is a `CorsCheckerError` with `part` and `line` and never holds pasted text; `visible(text, max)` writes hidden and direction-changing characters as \u{XX} and cuts at `max` characters for the few places that show pasted text. The safelist rules (`isCorsSafelistedRequestHeader`, `corsUnsafeRequestHeaderNames`, `isForbiddenRequestHeader`, `normalizeMethod`) and the list reader (`extractHeaderListValues`) are exported too.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Expected values come from the Fetch Standard at commit e9460d1 and from the web-platform-tests folder fetch/api/cors at commit a419ab2, re-expressed as 207 JSON rows that cite their file and line (test/fixtures/wpt: 170 rows from eleven web-platform-tests files and 37 from the text of fetch.bs). Every row is checked for the preflight decision, the exact Access-Control-Request-Headers line, whether the response is readable and the first rule that fails; the byte limits and every byte of the safelist rules, the 1,024-byte total, token lists, Max-Age, readable headers, the silent drops, forbidden methods, names such as __proto__ and the repeat of a check are checked against the wording of the standard, and every parser is timed on sixteen hostile strings at two sizes. Real browsers are the second opinion: a Playwright spec runs the 207 rows against two local servers in Chromium, Firefox, WebKit and mobile Chrome and compares what the page can read and what preflight the server sees. They agree on every row except those listed in the limits (Authorization under a wildcard in all four, repeated Accept lines in Chromium and WebKit, the 1,024-byte total in Firefox).

## Licence

MIT. See [LICENSE](./LICENSE).
