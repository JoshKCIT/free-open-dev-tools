# RFC 9110 (vendored)

- **Source:** https://www.rfc-editor.org/rfc/rfc9110.txt
- **Fetched:** 2026-09-25
- **File:** `rfc9110.txt`, fetched verbatim, 10785 lines

## Upstream's own copyright notice

> Copyright (c) 2022 IETF Trust and the persons identified as the document authors. All rights reserved.

(from the document's own "Copyright Notice" section)

## What this is used for

Section 10.1.5 (the User-Agent field) and section 5.6.2/5.6.5 (tokens and comments) are asserted against directly in `tools/user-agent/test/index.test.ts`: the section 10.1.5 worked example `User-Agent: CERN-LineMode/2.15 libwww/2.17b3` is checked as a whitespace-free substring of this vendored text, so a transcription error in the test fails instead of silently passing.
