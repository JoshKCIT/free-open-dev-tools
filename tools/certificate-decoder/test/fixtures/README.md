# Fixtures of the certificate decoder tests

Everything here is a second opinion recorded as a literal. The unit tests never run OpenSSL. Every command that made a
literal is in `make-fixtures.sh` (run it from Git Bash with `MSYS2_ARG_CONV_EXCL="*"`, into a scratch folder given as its
first argument, never into the repository), with its two configuration files `ca.cnf` and `leaf.cnf`.

Command line used (from the repository root):

```
MSYS2_ARG_CONV_EXCL="*" sh tools/certificate-decoder/test/fixtures/make-fixtures.sh <scratch folder> > printed.txt
```

Versions that made the literals, recorded on 2026-10-03:

```
OpenSSL 3.5.5 27 Jan 2026 (Library: OpenSSL 3.5.5 27 Jan 2026)     /mingw64/bin/openssl (Git for Windows)
Node v22.14.0                                                       only to turn the printed text into certs.ts
```

## What `certs.ts` holds

Each entry is one certificate (or request) as the Base64 of its DER, with what OpenSSL printed for it, copied without
editing apart from the removal of carriage returns that Windows OpenSSL writes. The PEM armour is put around the Base64 by
the test, so a file of this repository is never a PEM block. No private key is committed: the keys were made in the scratch
folder and deleted.

| Name     | What it is                                                                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `root`   | RSA 3072 self-signed root, SHA-384, serial 1, basicConstraints with a path length, key usage, key identifiers                                                           |
| `int`    | P-384 intermediate signed by `root` with SHA-384: CRL distribution point, authority information access, name constraints, certificate policy                            |
| `leaf`   | RSA 2048 signed by `int` with ECDSA SHA-256, serial `0x0abcdef0123456789`, subject with `O=Müller & Söhne GmbH`, nine kinds of subject alternative name, four key usages  |
| `ec256`  | P-256 self-signed certificate valid for 3,650 days (the page's first example)                                                                                           |
| `ed25519`| Ed25519 self-signed certificate                                                                                                                                         |
| `ec521`  | P-521 self-signed certificate, SHA-512                                                                                                                                  |
| `pss`    | RSA-PSS self-signed certificate (SHA-256, salt length 32)                                                                                                               |
| `weak`   | RSA 1024 signed with SHA-1, valid for 10,000 days (so its end date is a GeneralizedTime), one critical extension OpenSSL does not know whose value is 300 bytes        |
| `canary` | P-256 self-signed `CN=FODT-SECURITY-CANARY` whose CRL, OCSP, CA issuers, policy statement and URI name all use `127.0.0.1:65535`                                        |
| `rsa`, `ec`, `ed` (requests) | three PKCS#10 requests: RSA 2048 with an extension request, P-256 and Ed25519                                                                       |

The values per certificate: the three fingerprints (`openssl x509 -fingerprint -sha256`, `-sha1`, `-md5`), `-serial`,
the subject and issuer with `-nameopt RFC2253,-esc_msb` and with `-nameopt oneline,-esc_msb,-space_eq`, `-dates`, the
SHA-256 of the SubjectPublicKeyInfo (`openssl x509 -pubkey | openssl pkey -pubin -outform DER | openssl dgst -sha256`), and
the whole `-text` output. For the weak certificate the raw dump of the 300 byte extension is replaced by one line saying so,
because OpenSSL prints those bytes as raw control characters. For the requests: `-subject -nameopt RFC2253,-esc_msb`, the
SHA-256 of `openssl req -outform DER`, and `-text`.

Some of the certificates are valid only for a short time (30 days for the self-signed ones, 90 days for `leaf`); the
tests pass a fixed clock reading of 2026-10-03 12:00 UTC to the decoder and never read the clock.

## Not reproduced

Nothing is skipped on purpose. Two differences between the decoder and OpenSSL's text are known and the tests compare
parsed values, never that text: OpenSSL prints an IPv6 address as `2001:DB8:0:0:0:0:0:1` and the decoder writes the RFC 5952
form `2001:db8::1`; OpenSSL prints no size for an Ed25519 key.
