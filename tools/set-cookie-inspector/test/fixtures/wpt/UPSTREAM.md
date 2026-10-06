# Where `rows.json` comes from

`rows.json` holds cookie cases from the web-platform-tests folder `cookies`, re-expressed as data.

- Repository: https://github.com/web-platform-tests/wpt
- Commit: `a419ab2055dd4a747dfae5c407ae9a6d10aa08ca`
- Read on: 2026-10-06
- Licence: 3-Clause BSD, "Copyright (c) web-platform-tests contributors". The licence text is in `LICENSE.md` beside this
  file, copied from the repository's `LICENSE.md` at that commit.
- Specification the expected values are checked against: draft-ietf-httpbis-rfc6265bis-22 (1 December 2025),
  https://www.ietf.org/archive/id/draft-ietf-httpbis-rfc6265bis-22.txt, read on 2026-10-06.

## What was taken and how

No JavaScript of web-platform-tests is copied. Each case was re-written as one JSON row: the Set-Cookie text the server
sends, the address it came from (the test host is written as `web-platform.test`), whether the request was same-site or
cross-site, and what the test asserts (the cookie ends up in the jar or it does not) mapped to the outcome the draft gives
it (`stored`, `not-stored`, `ignored` or `stored-then-deleted`). `source` is the file and the line of the case in the file at
the commit.

- A case that sends several Set-Cookie headers is written as one row per header, because the page judges each line on
  its own. What the jar holds after several headers needs the cookie store, which the page does not model.
- A cookie built by the file from a name and value length (`cookieStringWithNameAndValueLengths`, "t" repeated for the
  name and "1" repeated for the value) is written as `{ nameLength, valueLength }` so the file stays small.
- Wall-clock dates are replaced by one fixed time (`nowMs`, Tuesday 6 October 2026 12:00:00 UTC). The 2038 dates mean "far
  in the future" and are kept: they are beyond the 400-day limit of the draft, so the rows also test the limit. The one date
  in 2027 (`expires.html` line 34) meant "in the future when the file was written"; it is replaced by a date 30 days after
  the fixed time.
- The Set-Cookie text of the prefix files is the one `cookie-helper.sub.js` builds: the prefix, `prefixtestcookie=bar1;`
  and the parameters. The cross-site host of the test server comes from a template, so a fixed host name stands in for it;
  only that the Domain equals the request host matters.
- Every expected value was worked out from the assertion of the test and the text of the draft. None was produced by
  running the package; a row is never edited to match it. The rows were written with a small script of case tables that is
  not kept in this repository.

## Rows by file

| File | Rows | Lines of the file used |
| --- | --- | --- |
| `cookies/size/name-and-value.html` | 11 | 21 to 71 (every case of `nameAndValueSizeTests`) |
| `cookies/attributes/max-age.html` | 13 | 22 to 67 (every case of `maxAgeTests`) |
| `cookies/attributes/expires.html` | 13 | 19 to 103 (every case of `expiresTests`, and the non-ASCII time zone case at 103) |
| `cookies/attributes/invalid.html` | 29 | 23 to 160 (every case of `invalidAttributeTests`; an empty header is written as `Set-Cookie:` with nothing after it) |
| `cookies/prefix/__host.header.https.html` | 20 | 14 to 80 (the three `extraParams` make three rows from each of lines 14, 23, 33, 42, 52 and 61) |
| `cookies/prefix/__host.header.html` | 20 | 14 to 80 (same, from a non-secure address) |
| `cookies/prefix/__secure.header.https.html` | 16 | 13 to 77 (lines 13 to 38 with the three `extraParams`, lines 49 to 77 cross-site) |
| `cookies/prefix/__secure.header.html` | 12 | 13 to 38 (from a non-secure address) |
| `cookies/prefix/__host.explicit-path.https.window.js` | 4 | 90, 99, 106 and 113 (two reproduce and are in `windowJsRows`, two do not and are in `notReproduced`) |
| `cookies/prefix/__Http.https.html` | 2 | 35 and 43 (in `notReproduced`) |
| `cookies/prefix/__Host-Http.https.html` | 2 | 28 and 52 (in `notReproduced`) |

Files read and not turned into rows: `cookies/resources/cookie-test.js`, `cookies/resources/cookie-helper.sub.js` and
`cookies/resources/cookie.py` (to see how each test builds the cookie it sends), and the cases of the prefix files that set a
cookie through the document cookie API (the page only judges Set-Cookie lines).

## Cases the page does not reproduce

`rows.json` lists six cases in `notReproduced`, each with the outcome the file expects, the outcome the draft gives, and
the reason. They are the two explicit-path cases (an empty or valueless `Path` attribute on a `__Host-` cookie, which
section 5.6.4 turns into the default path), the two `__Http-` cases and one `__Host-Http-` case (prefixes that are not in the
draft), and one `__Host-Http-` case where the outcome is the same but the rule is not. The page follows the draft.
