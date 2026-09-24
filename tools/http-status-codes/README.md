# HTTP Status Code Reference

Search every registered HTTP status code with its defining document.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Searches every code in the IANA HTTP Status Code Registry, generated from the registry's own published CSV rather than typed from memory, plus a small set of widely used unofficial codes each labelled with the server that defines it. Every result cites the document that defines the code, so an answer is checkable, not just asserted.

## Supported

- Every code assigned in the IANA HTTP Status Code Registry, with its reason phrase, class and defining reference
- Searching by a three-digit code, a status class such as 4xx or a bare class digit, an RFC number, or a phrase fragment of the reason phrase
- The 104 Upload Resumption Supported temporary registration, labelled as temporary and citing its Internet-Draft
- 306 and 418, labelled unused per the registry's own entries
- nginx 444 and 499, and Cloudflare 520-526, labelled unofficial with the page or source file that defines them
- Reporting when a code is in an unassigned range, or is not a valid three-digit HTTP status code at all

## Limits

- Unofficial codes are limited to the small, widely recognised set this tool bundles; a server-specific or vendor-specific code outside that set is reported as not found
- The registry snapshot is generated at build time from a fetched copy of the IANA CSV; it does not check the live registry at request time
- A registration whose IANA description carries an experimental or historic annotation beyond the registry's own 'TEMPORARY' and '(Unused)' markers is shown as registered, since the registry does not define a separate status value for it
- This tool never sends or receives an actual HTTP request; it only looks up what a code means

## Ambiguous cases, and what this does about them

- IANA labels 104 with the word TEMPORARY inside its description rather than a separate status field; this tool treats that word as the signal for the temporary registration state and keeps the full registration text as the description
- A three-digit query that happens to also look like a phrase fragment (none exist among current reason phrases) is treated as a code lookup, not a text search, since codes are unambiguous

## Defined by

- [IANA HTTP Status Code Registry](https://www.iana.org/assignments/http-status-codes/http-status-codes.xhtml)
- [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/http-status-codes http-status-codes
cd http-status-codes
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/http-status-codes
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { searchStatusCodes, statusClass } from '@fodt/http-status-codes';

searchStatusCodes('451'); // Unavailable For Legal Reasons, RFC 7725
searchStatusCodes('4xx'); // every 4xx code
statusClass(404); // '4xx'
```

`searchStatusCodes` never throws; an empty or unmatched query returns `{ rows: [] , note }` rather than an error, since a status lookup with no result is a normal outcome, not a bad request. `STATUS_CODES` and `UNOFFICIAL_CODES` are exported separately from the combined search so a caller can tell an IANA-registered code from an unofficial one without re-parsing the label.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Tests assert the registered code count against a number written into the test from the fetched IANA CSV (not counted from STATUS_CODES itself), plus at least six hand-transcribed rows (code, description, reference) copied from the same fetched CSV, and name RFC 9110 by section for every RFC 9110-defined code exercised.

## Licence

MIT. See [LICENSE](./LICENSE).
