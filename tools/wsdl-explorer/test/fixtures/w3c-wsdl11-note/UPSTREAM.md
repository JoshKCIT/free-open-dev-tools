# Upstream of the WSDL 1.1 examples

`golden.ts` holds seven XML documents copied from the examples of the W3C Note **Web Services Description Language
(WSDL) 1.1** (15 March 2001), each as one exported string.

- **Address:** https://www.w3.org/TR/2001/NOTE-wsdl-20010315 (this version; `https://www.w3.org/TR/wsdl` now serves
  WSDL 2.0).
- **Fetched:** 2026-10-02, with `curl -fsSL`, into a scratch directory.
- **How they were made:** a scratch script read the 51 `<pre>` blocks of the page, decoded the HTML entities, kept the
  seven blocks that begin with `<?xml version="1.0"?>`, and wrote each with `JSON.stringify`. Nothing in them was typed
  by hand.

| Export                  | Where in the note                                                              |
| ----------------------- | ------------------------------------------------------------------------------ |
| `EXAMPLE_1_STOCK_QUOTE` | Example 1, section 1.1: StockQuote over SOAP 1.1, document style               |
| `EXAMPLE_2_SCHEMA`      | Example 2, section 2.1.2, document 1 of 3 (`stockquote.xsd`)                   |
| `EXAMPLE_2_DEFINITIONS` | Example 2, document 2 of 3 (`stockquote.wsdl`), which imports document 1       |
| `EXAMPLE_2_SERVICE`     | Example 2, document 3 of 3 (`stockquoteservice.wsdl`), which imports document 2 |
| `EXAMPLE_3_SMTP_HEADER` | Example 3, section 3.1: one-way over SMTP with a SOAP header                   |
| `EXAMPLE_4_RPC_ENCODED` | Example 4, section 3.1: request-response RPC, `use="encoded"`                  |
| `EXAMPLE_5_RPC_ARRAYS`  | Example 5, section 3.1: RPC with an array type                                 |

## Defects of the note that the tests rely on, not corrected

- In Example 1 the port says `binding="tns:StockQuoteBinding"`, while the binding is declared `StockQuoteSoapBinding`.
  The same port reference is in Example 2 (document 3), Example 4 and Example 5.
- In Example 2, document 3 names its port type as `defs:StockQuotePortType`, which is declared in document 2, an import.
- In Example 4 and Example 5 the message parts use `element="xsd:string"`, which names a type of XML Schema where an
  element is expected, and Example 5's binding operation is named GetTradePrices while its port type has
  GetLastTradePrice.
- Example 5 writes `wsdl:arrayType` without declaring the prefix `wsdl`, so the document is not well-formed with
  respect to namespaces and is refused with its line.
- The note's schemas use the namespace `http://www.w3.org/2000/10/XMLSchema`, a draft that predates the 2001
  recommendation; the explorer reads that namespace and the 2001 one.

## Copyright and licence

The note's page carries "Copyright (c) 2001 Ariba, International Business Machines Corporation, Microsoft" and gives
no licence sentence of its own. It is a W3C Note on w3.org, whose documents are covered by the W3C Document License
(https://www.w3.org/copyright/document-license/): "Permission to copy, and distribute the contents of this document ... in
any medium for any purpose and without fee or royalty is hereby granted, provided that you include ... a link or URL to
the original W3C document [and] the pre-existing copyright notice of the original author". This file is that link and
that notice for the seven examples copied here, which are used only as test input.

The SOAP 1.1 Note (https://www.w3.org/TR/2000/NOTE-SOAP-20000508/), SOAP 1.2 Part 1
(https://www.w3.org/TR/soap12-part1/), RFC 3902 and the WSDL 2.0 specification (https://www.w3.org/TR/wsdl20/) are
quoted in the test comments for their namespaces and media types; nothing of them is copied into a file.
