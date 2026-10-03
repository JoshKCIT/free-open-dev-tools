# Fixtures for the check digit schemes

The unit tests never run Python and never reach the network. Everything an outside implementation or document said is
committed here as literals, with the command that produced it.

## `stdnum-corpus.ts` (second opinion: python-stdnum)

2,489 numbers made and accepted by python-stdnum: 400 each of ISBN-10, ISBN-13, EAN-13, EAN-8, UPC-A and ISIN, and one
IBAN for each of the 89 countries python-stdnum lists (a random account part of the registered shape), plus the total
IBAN length python-stdnum holds for each country. The numbers are test data, not real identifiers.

| Item                 | Value                                                            |
| -------------------- | ---------------------------------------------------------------- |
| Library              | python-stdnum 2.2 (installed only in a scratch virtual environment) |
| Python               | 3.14.3                                                           |
| Seed                 | 14080                                                            |
| Recorded             | 2026-10-03                                                       |
| Script               | `make-fixtures.py`                                               |

Commands (from the repository root; the virtual environment is outside the repository):

```
python -m venv venv-14
venv-14/Scripts/python -m pip install python-stdnum==2.2
venv-14/Scripts/python tools/luhn/test/fixtures/make-fixtures.py tools/luhn/test/fixtures/stdnum-corpus.ts
pnpm exec prettier --write tools/luhn/test/fixtures/stdnum-corpus.ts
```

A second run gives the same file byte for byte. The script reads every number back through python-stdnum's own `validate`
(an IBAN without the national account checks, which a random account part cannot satisfy, and an ISIN with the country
codes python-stdnum accepts) and also reads the published vectors the tests use (17 of them) and
`to_isbn13('0-306-40615-2')`, which gave `978-0-306-40615-7`. python-stdnum has no VIN module, so the VIN vectors rest on
49 CFR 565.15 alone.

## `registry-release.ts` (the IBAN registry release)

For each of the 89 countries of the IBAN Registry: the country code, the total IBAN length and the electronic format
example the registry prints. These are facts read from the document; no registry text is copied.

| Item        | Value                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------- |
| Document    | IBAN Registry, ISO 13616, published by SWIFT as registration authority                        |
| Release     | 103, September 2026 (printed on the first page of the PDF, created 2026-09-15)               |
| Fetched     | 2026-10-03                                                                                    |
| Page        | https://www.swift.com/standards/data-standards/iban-international-bank-account-number         |
| Text file   | https://www.swift.com/swift-resource/11971/download (`iban-registry_2.txt`, 34,846 bytes)      |
| PDF         | https://www.swift.com/swift-resource/9606/download (`iban-registry_4.pdf`, 97 pages)           |
| Script      | `extract-registry.mjs`                                                                        |

How it was obtained: scripted requests (`curl` with a browser user agent) and a headless Chromium were answered with HTTP
403 ("SWIFT site off-line"). A headless Firefox driven by a Playwright script opened the page and downloaded both
documents. The PDF text was read with pypdf and gave the same length for every one of the 89 countries as the text file.

```
node tools/luhn/test/fixtures/extract-registry.mjs <downloaded iban-registry_2.txt> > tools/luhn/test/fixtures/registry-release.ts
pnpm exec prettier --write tools/luhn/test/fixtures/registry-release.ts
```

The script stops if an example does not have its stated length, does not begin with its country code or does not leave 1 when
divided by 97. All 89 do.

Compared with the table of the research for this phase (python-stdnum 2.2 and schwifty 2026.7.3), the registry release
differs for no country: the same 89 countries and the same 89 lengths. The registry names territories that use another
country's code in their IBANs (FI also covers AX; FR also covers GF, GP, MQ, RE, PF, TF, YT, NC, BL, MF, PM and WF; GB also
covers IM, JE and GG). Their IBANs begin with the parent's code, so they are not entries of the table.
