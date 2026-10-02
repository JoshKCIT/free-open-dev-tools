# Upstream of golden.ts

`golden.ts` holds the 81 rows of Table 6, "Examples of Encoded CBOR Data Items", in Appendix A of RFC 8949.

- **Document:** RFC 8949, Concise Binary Object Representation (CBOR), C. Bormann and P. Hoffman, December 2020 (STD 94,
  obsoletes RFC 7049).
- **Address:** https://www.rfc-editor.org/rfc/rfc8949 (the text fetched from https://www.rfc-editor.org/rfc/rfc8949.txt,
  Appendix A, from the heading "Appendix A.  Examples of Encoded CBOR Data Items" to the caption of Table 6).
- **Fetched:** 2026-10-02.
- **Copyright and licence:** Copyright (c) 2020 IETF Trust and the persons identified as the document authors. All rights
  reserved. The rows are reproduced unmodified (only the table's own line wraps are joined) and attributed to IETF and to
  RFC 8949 under section 3.c.iii of the IETF Trust's Legal Provisions Relating to IETF Documents
  (https://trustee.ietf.org/license-info, the provisions the RFC's own copyright notice names; this is under one fifth of
  the RFC's text). The rows are data, not Code Components, so the Revised BSD licence of section 4 does not apply to them.
- **How it was made:** a script (kept in the session scratch directory, not in this repository) reads the table out of the
  RFC text row by row and writes the file. Nothing in it was typed by hand, and nothing in it was produced by this
  package: the diagnostic notation is the RFC's own text, and the hex is the RFC's own encoding.
- **Rows:** 81. The first is `0` as `00` and the last is `{_ "Fun": true, "Amt": -2}` as `bf6346756ef563416d7421ff`.
