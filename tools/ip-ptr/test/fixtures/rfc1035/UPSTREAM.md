# RFC 1035 (vendored)

- **Source:** https://www.rfc-editor.org/rfc/rfc1035.txt
- **Fetched:** 2026-09-25
- **File:** `rfc1035.txt`, fetched verbatim, 3077 lines

## Upstream's own copyright notice

> Distribution of this memo is unlimited.

RFC 1035 predates the RFC Editor's modern "Full Copyright Statement" boilerplate; the sentence above, from its own "STATUS OF THIS MEMO" section, is the only distribution notice the document itself carries.

## What this is used for

Section 3.5 (the IN-ADDR.ARPA domain) is asserted against directly in `tools/ip-ptr/test/index.test.ts`: the worked example `52.0.2.10.IN-ADDR.ARPA.` for address `10.2.0.52` is checked as a whitespace-free substring of this vendored text, so a transcription error in the test fails instead of silently passing.
