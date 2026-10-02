# Upstream of the HAR Viewer's test values

No file is copied into this folder. The tests build every recording in code, from the field list of the specification
and from the values below, which are quoted as literals in `../index.test.ts` with their source named beside them.

| Source                                    | Address                                         | Fetched    | Rights                                                                                             |
| ----------------------------------------- | ----------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| HAR 1.2 Spec                              | http://www.softwareishard.com/blog/har-12-spec/ | 2026-10-02 | The page says "Copyright (c) 2007 Software is hard. All rights reserved." It gives no licence.     |
| RFC 6265, 7235, 6750, 7519, 3986 and 8259 | https://www.rfc-editor.org/rfc/rfcNNNN (txt)    | 2026-10-02 | IETF documents; short extracts and the examples in them are used with the number of the RFC named. |

## What is taken from the HAR 1.2 specification

Because the page is "all rights reserved", only facts and tiny samples are used, and the specification's prose is not
copied:

- The names of the objects and fields (`log`, `entries`, `request`, `response`, `content`, `timings`, `cookies`,
  `headers`, `queryString`, `postData`, and their members) and their meanings: the time of a request is the sum of the
  timings that are not -1, `ssl` is included in `connect`, a size or timing of -1 means the information is not
  available, an empty `version` means 1.1, `encoding: "base64"` means the text is Base64, and custom fields start with
  an underscore. The test comments paraphrase these rules and quote a few sentences of them, each marked with the
  specification's name, as a reference for the reader of the test.
- The example timings `blocked 0, dns -1, connect 15, send 20, wait 38, receive 12, ssl -1`, the example start time
  `2009-04-16T12:07:23.596Z`, the example address `http://www.example.com/path/?param=value`, the example content
  size 33 and body size 850, and the example Base64 text `PGh0bWw+PGhlYWQ+PC9oZWFkPjxib2R5Lz48L2h0bWw+XG4=` of the
  content example (which Python 3.14.3 `base64.b64decode` reads as `<html><head></head><body/></html>`, a backslash and
  the letter n).
- The version rule for a reader that supports HAR since 1.1: a major version other than 1, or a minor version below 1,
  is refused.

## What is taken from the RFCs

- RFC 6750 section 2.1: `Authorization: Bearer mF_9.B5f-4.1JqM` and the `b64token` syntax; sections 2.2 and 2.3: the
  `access_token` form field and query parameter.
- RFC 7519 section 3.1: the example JWT, assembled in the test from pieces so the file holds no literal that looks
  like a credential.
- RFC 3986 section 3.2.1: "Applications should not render as clear text any data after the first colon (":")
  character found within a userinfo subcomponent".
- RFC 6265 section 4.1 and 4.2 (the Set-Cookie and Cookie headers) and RFC 7235 section 4.2 and 4.4 (Authorization and
  Proxy-Authorization) for the header names.
