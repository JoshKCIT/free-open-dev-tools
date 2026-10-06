# Where `rows.json` comes from

`rows.json` holds cases from the web-platform-tests folder `fetch/api/cors`, re-expressed as data, and a few boundary
cases worked out from the text of the Fetch Standard.

- Repository: https://github.com/web-platform-tests/wpt
- Commit: `a419ab2055dd4a747dfae5c407ae9a6d10aa08ca`
- Read on: 2026-10-06
- Licence: 3-Clause BSD, "Copyright (c) web-platform-tests contributors". The licence text is in `LICENSE.md` beside this
  file, copied from the repository's `LICENSE.md` at that commit.
- Fetch Standard: https://github.com/whatwg/fetch, commit `e9460d1b22ead1c6a72eeac37fb2ec0dc01aeb1d`, file `fetch.bs`,
  read on 2026-10-06. The boundary rows cite its line numbers at that commit.

## What was taken and how

No JavaScript of web-platform-tests is copied. Each test case was re-written as one JSON row: the method, the request
headers, the credentials mode and the mode of the request, the headers and status the server answers the preflight and the
real request with, and what the test asserts (the response can be read, or the call is rejected with a TypeError). The
answers are those the resource files `fetch/api/resources/preflight.py` and `top.txt` give for the query the test builds;
those two files were only read, to see which headers each test makes the server send.

The hosts of `get_host_info()` are written as `page.example` and `remote.example` with the ports and schemes kept, so a
row about "same domain, different port" is still about a different port.

Every expected value in a row (is a preflight sent, the `Access-Control-Request-Headers` line, whether the response is
readable, the first rule that fails, the readable header names) was written out case by case from the assertion of the test
it comes from and from the Fetch Standard. None was produced by running the package; a row is never edited to match it.
The rows were written with a small script of case tables that is not kept in this repository.

## Rows by file

| File | Rows | Lines of the file used |
| --- | --- | --- |
| `cors-preflight-star.any.js` | 34 | 36 to 86 (every `preflightTest` call: 22 distinct lines, because the loops make several rows from one line) |
| `cors-origin.any.js` | 17 | 35 to 51 |
| `cors-multiple-origins.sub.any.js` | 6 | 15 to 20 |
| `cors-preflight-status.any.js` | 27 | 37 (one call, 27 statuses) |
| `cors-expose-star.sub.any.js` | 3 | 15, 28 and 39 (the three tests) |
| `cors-preflight-response-validation.any.js` | 2 | 32 and 33 |
| `resources/not-cors-safelisted.json` | 11 | 2 to 12 (every entry) |
| `cors-preflight.any.js` | 21 | 8 to 62 |
| `cors-no-preflight.any.js` | 15 | 27 to 41 |
| `cors-basic.any.js` | 15 | 25, 29 and 36 (five origins, three tests each) |
| `cors-filtering.sub.any.js` | 19 | 44 to 65 |

The remaining rows cite `fetch.bs` at the commit above: the CORS-safelisted request-header rules, the 1,024-byte total of
the CORS-unsafe request-header names, the single range value, method normalisation, the forbidden methods and the CORS
check.

## Not re-expressed

- `cors-preflight.any.js` line 11 (`CORS [PUT], server allows, check preflight has user agent`): it checks the
  `User-Agent` header the browser sends in the preflight, which this tool does not model.

## Notes

- `cors-origin.any.js` line 51 passes an empty string as the allowed origin, but the helper replaces a false value with
  the address's own origin (its line 7), so the server really answers with that origin. The row says so.
- `cors-expose-star.sub.any.js` writes `Access-Control-Expose-Headers` twice in its third test; the second `header(...)`
  of the server's pipe replaces the first, so the row holds the single line `set-cookie,*`.
