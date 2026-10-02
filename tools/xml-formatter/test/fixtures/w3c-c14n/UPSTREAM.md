# W3C Canonical XML 1.0 examples and the Exclusive XML Canonicalization example

- **Sources:**
  - Canonical XML Version 1.0, W3C Recommendation 15 March 2001, <https://www.w3.org/TR/2001/REC-xml-c14n-20010315>,
    section 3 "Examples of XML Canonicalization": 3.1 to 3.6 (3.7 is about document subsets and is not used).
  - Exclusive XML Canonicalization Version 1.0, W3C Recommendation 18 July 2002,
    <https://www.w3.org/TR/2002/REC-xml-exc-c14n-20020718/>, the example in section 2.2 "General Problems with
    re-Enveloping" (see "Where the research and the recommendation differ" below).
- **Fetched:** 2026-10-02 with `curl -fsSL` of both addresses. `golden.ts` is produced by a scratch script from the saved pages,
  not typed by hand: in Canonical XML 1.0 every example is printed twice, as display HTML and as an HTML comment that
  carries the exact characters (the characters that would end a comment are written `<!==` and `==>`), and the script reads
  the comment; in the Exclusive recommendation the script reads the three `<pre>` blocks (markup removed, character
  references decoded).
- **Licence:** both recommendations carry "Copyright (c) W3C (MIT, ERCIM, Keio), All Rights Reserved" and say that the W3C
  liability, trademark, document use and software licensing rules apply; the text of the recommendations is offered under
  the W3C Document License, <https://www.w3.org/copyright/document-license/> (the "document use" link of both pages,
  <https://www.w3.org/Consortium/Legal/copyright-documents-19990405>, leads to its earlier wording). Only the worked
  examples are quoted, with their source named.
- **Files quoted:** `golden.ts` holds, for Canonical XML 1.0, the input and printed canonical form of examples 3.1 (without
  and with comments), 3.2, 3.3, 3.4, 3.5 and 3.6, and for Exclusive XML Canonicalization the input document and the two
  printed results for the element `n1:elem2`.
- **What the tests use:** examples 3.1, 3.2 and 3.4, and the Exclusive example, are canonicalized and compared as
  strings; 3.6 is compared as bytes (the recommendation writes the two bytes of the copyright sign as the text
  `#xC2#xA9`, and its note says the content is the octets C2 and A9, not that text).
- **Left out by name:** 3.5 (entity references), because its external entity `ent2` is never loaded: the page refuses every
  DOCTYPE, and the function the tests call parses with no external entity loading, so the printed `Hello, world!` cannot be
  produced (only `Hello, !`). 3.3 (start and end tags) depends on a default attribute declared in a DOCTYPE, which this tool
  never reads; it is quoted in `golden.ts` and not asserted.
- **Where the research and the recommendation differ:** the phase research calls the Exclusive example "section 2.1".
  In the recommendation as fetched, 2.1 is a different, simpler example whose printed output is wrapped and enveloped by an
  XPath expression; the document and the two results the tests use are in 2.2. The test keeps the title the plan names and
  the files and comments name 2.2.
- **How the Exclusive text is read:** the recommendation prints each document in a block that indents its lines by three
  spaces and says its canonical results are "except for line wrapping to fit in this document". The script removes the
  three-space margin from the input document, and in each result removes the margin from the first line and joins the
  wrapped start tag back into one line with single spaces; the content lines keep their printed spacing, which is the
  spacing the input document's content has once its margin is removed.
