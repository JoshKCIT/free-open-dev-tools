# Where each retyped example comes from

Nothing here is copied by a script that runs in CI: the examples were read from the published PDF text once, retyped
into these files, and are used as plain test data. The notice that goes with them is in `NOTICE.md`.

Fetched 2026-10-06.

## Bindings for the OASIS Security Assertion Markup Language (SAML) V2.0, OASIS Standard, 15 March 2005

Address: https://docs.oasis-open.org/security/saml/v2.0/saml-bindings-2.0-os.pdf

| File | Section | Document lines | What it is |
| --- | --- | --- | --- |
| `redirect-logout-request.txt` | 3.4.8 Example SAML Message Exchange Using HTTP Redirect | 723 to 733 | The Location address that carries the signed logout request, joined into one line (the printed line feeds are an artifact of the document, as the text says). |
| `logout-request.xml` | 3.4.8 | 694 to 702 | The LogoutRequest the address carries. The text prints it wrapped inside an attribute (`2004-01-` then `21T19:00:49Z`); the file holds it unwrapped, with line feeds only, and a test compares the decoded message with this file after line endings are normalised. |

The example `SigAlg` value in the address is `http://www.w3.org/200/09/xmldsig#rsa-sha1`, printed with `200` where the
XML Signature namespace has `2000`. The file keeps it as printed. The `Signature` value is the printed placeholder
`NOTAREALSIGNATUREBUTTHEREALONEWOULDGOHERE`; the text says the signature portion is only illustrative.
