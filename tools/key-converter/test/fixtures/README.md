# Fixtures of the key converter tests

Everything here is a second opinion recorded as a literal. The tests never run OpenSSL or ssh-keygen. Every command that
made a literal is in `make-fixtures.sh` (run it from Git Bash with `MSYS2_ARG_CONV_EXCL="*"`, into a scratch folder given
as its first argument, never into the repository).

Versions that made the literals, recorded on 2026-10-03:

```
OpenSSL 3.5.5 27 Jan 2026 (Library: OpenSSL 3.5.5 27 Jan 2026)     /mingw64/bin/openssl (Git for Windows 2.53.0.windows.1)
OpenSSH_10.2p1, OpenSSL 3.5.5 27 Jan 2026                          /usr/bin/ssh-keygen
Node v22.14.0                                                       only to print files as Base64 or hex (no key is made by it)
```

| File                     | Made by                                                                                                                 | On         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------- |
| `rsa2048-public.ts`      | `make-fixtures.sh public`: OpenSSL 3.5.5 and ssh-keygen from OpenSSH 10.2p1                                             | 2026-10-03 |
| `ec-ed25519-public.ts`   | `make-fixtures.sh public`: OpenSSL 3.5.5 (ECDSA keys) and ssh-keygen 10.2p1 (the Ed25519 key and every line and print) | 2026-10-03 |
| `keys.ts`                | `make-fixtures.sh private`: six keys, their conversions and the refused samples, as Base64 bodies without armour        | 2026-10-03 |
| The RFC 8032 TEST 1 key  | the published vector; fingerprints printed by ssh-keygen 10.2p1                                                         | 2026-10-03 |

## What `keys.ts` holds

Private keys are committed as Base64 bodies and the PEM armour is put round them inside the test from pieces, so no
scanner reads a file of this repository as a live key. Every key was made in a scratch folder for this purpose and thrown
away; none is used anywhere.

- Six keys: RSA 2048 and 3072, ECDSA P-256, P-384 and P-521, and Ed25519. For each: the PKCS#8 (`openssl pkcs8 -topk8
  -nocrypt -outform DER`), the SubjectPublicKeyInfo (`openssl pkey -pubout -outform DER`), the OpenSSH private file body as
  ssh-keygen wrote it, its check value (read by an independent reader inside the script), the public line (`ssh-keygen -y`),
  the RFC 4716 file (`ssh-keygen -e`, without the Comment header, which names the machine), and the SHA256 and MD5 prints
  (`ssh-keygen -l -E sha256` and `-E md5`).
- RSA also holds the PKCS#1 private key (`openssl rsa -traditional -outform DER`) and the PKCS#1 public key (`openssl rsa
  -RSAPublicKey_out -outform DER`). ECDSA also holds the SEC1 key (`openssl ec -outform DER`), the SEC1 key without its
  public part (`openssl ec -no_public`) and the PKCS#8 of that (`openssl pkcs8 -topk8 -nocrypt`, which keeps no public part).
- The RSA and ECDSA keys were made by `ssh-keygen -t`. A copy was turned into a PKCS#1 or SEC1 PEM file by
  `ssh-keygen -p -m PEM`, and every OpenSSL command reads that copy. ssh-keygen cannot write an Ed25519 key as PKCS#8, so
  the Ed25519 key was made by `openssl genpkey`, then a copy was turned into an OpenSSH file by `ssh-keygen -p` and given its
  comment with `ssh-keygen -c -C fixture`. Every key carries the comment `fixture`.
- Protected samples, refused by the page: an encrypted PKCS#8 (`openssl pkcs8 -topk8 -v2 aes-256-cbc`), a legacy encrypted
  RSA PEM (`openssl rsa -aes256 -traditional`, with its two header lines) and an OpenSSH key made with a phrase. The phrase
  (`throwaway-phrase`) protects these three samples and nothing else.
- Unsupported samples, refused by the page: an RSA-PSS key restricted to SHA-256 (`openssl genpkey -algorithm RSA-PSS
  -pkeyopt rsa_pss_keygen_md:sha256`) with its public key, and a secp256k1 key with its public key.
- The two blocks `openssl ecparam -name prime256v1 -genkey` writes (EC PARAMETERS, then EC PRIVATE KEY).

## Published cases

| Case                                                                    | Quoted from                                  | Used for                                                       |
| ----------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------- |
| Ed25519 private and public JWK of appendix A.1 and A.2                  | RFC 8037                                     | `d` and `x` equal the RFC 8032 TEST 1 seed and public key       |
| JWK thumbprint of the Ed25519 key `kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k` | RFC 8037 appendix A.3                | the thumbprint of an OKP key                                    |
| RSA example JWK and its thumbprint `NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs` | RFC 7638 section 3.1                 | the thumbprint of an RSA key                                    |
| RSA JWK with `n e d p q dp dq qi`                                       | RFC 7515 appendix A.2                        | every number of a published RSA private key                     |

Outputs recorded from ssh-keygen 10.2p1 for the RFC 8032 TEST 1 public key:

```
256 SHA256:bbXpuKG6zhzdmnxq256TlqzFBzRl2f6OOg722cYNbU8 no comment (ED25519)
256 MD5:cf:07:be:9d:68:ae:65:54:6d:a0:93:c3:6f:bd:0d:82 no comment (ED25519)
```
