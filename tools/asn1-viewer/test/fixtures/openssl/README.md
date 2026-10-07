# OpenSSL recordings

These files are what OpenSSL 3.5.5 (27 Jan 2026, the build in Git for Windows) said about structures it was given, kept as
a second opinion on the reader. Nothing in the tests runs OpenSSL.

| File | What it holds |
| ---- | ------------- |
| `structures.ts` | 31 structures, each as the Base64 of one DER file: keys (PKCS #8 for EC P-256, Ed25519 and RSA, one encrypted with PBES2), public keys, three certificates, a certification request, CMS signed data with definite lengths and with indefinite lengths, an S/MIME signature, an OCSP request, a time-stamp request, a PKCS #12 file, and 15 worked examples of ITU-T X.690 (02/2021) clause 8 and annex A.3 written as files |
| `asn1parse.json` | the lines of `openssl asn1parse -inform DER -i` for each structure: offset, depth, header length, length (`inf` for an indefinite length), constructed or primitive, and the tag text OpenSSL prints. 636 lines in all |
| `oid-names.json` | for each name in `src/oids-extra.ts`, the digits `openssl asn1parse -genstr 'OID:<name>'` gives for it |
| `make-fixtures.sh` | the script that made all three |

`openssl.test.ts` finds each recorded line in the reader's output by offset and compares depth, header length, length,
form and tag. `values.test.ts` compares `oid-names.json` with the names in the package.

## Recording again

```
bash make-fixtures.sh <work-folder>
```

Needs OpenSSL 3.5.x, `xxd` and Node. The keys and certificates are generated each time, so a new recording changes every
byte of `structures.ts` (the shapes, offsets and lengths stay the same). The keys inside are throwaway: they were made for the
recording and thrown away, and the five lines that hold a private key (the three PKCS #8 files, the encrypted one and the
PKCS #12 file) carry `// gitleaks:allow`. Only Base64 of DER is kept, never PEM text of a private key.

OpenSSL stops its listing at a structure it cannot read, so a line that is missing from `asn1parse.json` is not compared.
The relative object identifier example is listed by OpenSSL as `<ASN1 13>`, a tag it does not name.

Recorded 2026-10-07 on Windows 11 with `MSYS_NO_PATHCONV=1` set by the script.
