# RFC 3596 (vendored)

- **Source:** https://www.rfc-editor.org/rfc/rfc3596.txt
- **Fetched:** 2026-09-25
- **File:** `rfc3596.txt`, fetched verbatim, 451 lines

## Upstream's own copyright notice

> Copyright (C) The Internet Society (2003). All Rights Reserved.

(from the document's own "Copyright Notice" and "Full Copyright Statement" sections)

## What this is used for

Section 2.5 (the IP6.ARPA domain) is asserted against directly in `tools/ip-ptr/test/index.test.ts`: the worked example for address `4321:0:1:2:3:4:567:89ab`, which the RFC gives as `b.a.9.8.7.6.5.0.4.0.0.0.3.0.0.0.2.0.0.0.1.0.0.0.0.0.0.0.1.2.3.4.IP6.ARPA.` (wrapped across two lines in the RFC's own text), is checked as a whitespace-free substring of this vendored text, so a transcription error in the test fails instead of silently passing.
