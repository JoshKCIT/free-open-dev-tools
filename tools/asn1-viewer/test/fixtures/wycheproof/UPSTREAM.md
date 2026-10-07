# Where the Wycheproof signatures come from

- Repository: https://github.com/C2SP/wycheproof (Project Wycheproof, licence Apache-2.0, the full text is in `LICENSE`)
- Commit: `12fd3aaf33eb5fa1f52e026912ee00c054f9d984`, committed 2026-10-06T18:05:18Z ("ecdsa: add secp256k1 bitcoin vector for r + n >= p wraparound")
- Fetched: 2026-10-07 with `gh api` and `curl` from raw.githubusercontent.com at that commit

| Upstream file | Git blob sha | Bytes | Kept here as |
| ------------- | ------------ | ----- | ------------ |
| `testvectors_v1/ecdsa_secp256r1_sha256_test.json` | `19c951dbd3b6e33ed5e28d9bbbeea30e5f0350d3` | 327,156 | `ecdsa-p256-sha256.json`, reduced (see `NOTICE`) |
| `LICENSE` | `7a4a3ea2424c09fbe48d455aed1eaa94d9124835` | 11,357 | `LICENSE`, byte for byte |

The upstream file holds 484 tests in 113 groups. The reduced file holds the same 484 tests, in the order of their
`tcId`, each as `tcId`, `comment`, `flags` and `sig` (the signature as hex). The `ecdsa-p256-sha256.json` file is not
byte identical to anything upstream, so it has no blob sha; the test counts the tests and the flags instead.

The flags the test uses, with their counts in this file: `ValidSignature` 10, `BerEncodedSignature` 7 and
`InvalidEncoding` 92.
