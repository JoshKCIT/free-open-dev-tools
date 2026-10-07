# Where each retyped example comes from

Nothing here is copied by a script that runs in CI: the examples were read from the published PDF text once, retyped
into these files, and are used as plain test data. The notice that goes with them is in `NOTICE.md`.

Fetched 2026-10-06.

## Bindings for the OASIS Security Assertion Markup Language (SAML) V2.0, OASIS Standard, 15 March 2005

Address: https://docs.oasis-open.org/security/saml/v2.0/saml-bindings-2.0-os.pdf

| File | Section | Document lines | What it is |
| --- | --- | --- | --- |
| `redirect-logout-request.txt` | 3.4.8 Example SAML Message Exchange Using HTTP Redirect | 723 to 733 | The Location address that carries the signed logout request, joined into one line (the printed line feeds are an artifact of the document, as the text says). |
| `redirect-logout-response.txt` | 3.4.8 | 742 to 751 | The Location address that carries the signed logout response, joined the same way. |
| `logout-request.xml` | 3.4.8 | 694 to 702 | The LogoutRequest the first address carries. The text prints it wrapped inside an attribute (`2004-01-` then `21T19:00:49Z`); the file holds it unwrapped, with line feeds only, and a test compares the decoded message with this file after line endings are normalised. |
| `logout-response.xml` | 3.4.8 | 703 to 713 | The LogoutResponse the second address and the POST form both carry. |
| `post-logout-response.html` | 3.5.8 Example SAML Message Exchange Using HTTP POST | 956 to 971 | The hidden form control that carries the same LogoutResponse as Base64, wrapped at 64 columns as printed. |

The example `SigAlg` value in both addresses is `http://www.w3.org/200/09/xmldsig#rsa-sha1`, printed with `200` where the
XML Signature namespace has `2000`. The files keep it as printed. The `Signature` value is the printed placeholder
`NOTAREALSIGNATUREBUTTHEREALONEWOULDGOHERE`; the text says the signature portion is only illustrative.

## SAML V2.0 Technical Overview, Committee Draft 02, 25 March 2008 (a Committee Draft, not a standard)

Address: https://www.oasis-open.org/committees/download.php/27819/sstc-saml-tech-overview-2.0-cd-02.pdf

| File | Section | Document lines | What it is |
| --- | --- | --- | --- |
| `overview-authnrequest.xml` | 5.1.2 SP-Initiated SSO: Redirect/POST Bindings, step 2 | 837 to 848 | The AuthnRequest with `AssertionConsumerServiceIndex="1"`. |
| `overview-response.xml` | 5.1.2, step 5 | 875 to 927 | The Response with a signed Assertion, a transient NameID, a bearer SubjectConfirmation, Conditions with an audience and an AuthnStatement. |

`overview-response.xml` keeps the document's own placeholder `...` inside `ds:Signature`, so the page has a signature
element to list but no real signature or certificate. The line numbers are the document's own printed line numbers.
