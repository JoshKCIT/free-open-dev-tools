# W3C XML Schema Primer: the purchase order

- **Source:** XML Schema Part 0: Primer Second Edition, W3C Recommendation 28 October 2004,
  <https://www.w3.org/TR/xmlschema-0/>, section 2 "Basic Concepts: The Purchase Order": the examples "The Purchase Order,
  po.xml" and "The Purchase Order Schema, po.xsd".
- **Fetched:** 2026-10-02 with `curl -fsSL https://www.w3.org/TR/xmlschema-0/`; the two examples were taken from the page's
  `<pre>` blocks (markup removed, character references decoded) by a scratch script.
- **Licence:** the primer carries "Copyright (c) 2004 W3C (MIT, ERCIM, Keio), All Rights Reserved" and offers its text under
  the W3C Document License, <https://www.w3.org/copyright/document-license/> (the page's "document use" link,
  <https://www.w3.org/Consortium/Legal/copyright-documents>, redirects there). The examples inside the document carry
  "Copyright 2000 Example.com. All rights reserved." in their own annotation, as printed.
- **Files quoted:** `golden.ts` holds `PO_XSD` (po.xsd, unchanged) and `PO_XML_AS_PRINTED` (po.xml, unchanged).
  `PO_XML` is po.xml with one correction, and `PO_MISSING_PARTNUM`, `PO_QUANTITY_100` and `PO_UNEXPECTED_ELEMENT` are
  edited copies of it; every edit is a visible string replacement listed in the header of `golden.ts`.
- **A typo in the primer:** po.xml as printed ends the first comment with `<!/comment>` instead of `</comment>`, which is
  not well formed XML. The tests keep that text (it must be refused with its line and column) and validate the corrected
  `PO_XML`.
- **Second opinion:** the five documents were run through Python lxml 6.1.1 (libxml2 2.11.9), `etree.XMLSchema(po.xsd)`
  and its `error_log`; its messages and lines are quoted as literals in `test/index.test.ts`.
