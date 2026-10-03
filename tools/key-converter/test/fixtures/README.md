# Fixtures of the key converter tests

Everything here is a second opinion recorded as a literal. The tests never run OpenSSL or ssh-keygen.

| File                    | Made by                                                            | On         |
| ----------------------- | ------------------------------------------------------------------ | ---------- |
| `rsa2048-public.ts`     | `make-fixtures.sh`: OpenSSL 3.5.5 and ssh-keygen from OpenSSH 10.2p1 | 2026-10-03 |
| The RFC 8032 TEST 1 key | the published vector; fingerprints printed by ssh-keygen 10.2p1    | 2026-10-03 |

No private key is committed in this folder. Tests that need a private key make one at test time with Node's Web Crypto,
or hold a published test vector as hex or as the Base64 body of its DER, and put the armour around it in the test.

Outputs recorded from ssh-keygen 10.2p1 for the RFC 8032 TEST 1 public key:

```
256 SHA256:bbXpuKG6zhzdmnxq256TlqzFBzRl2f6OOg722cYNbU8 no comment (ED25519)
256 MD5:cf:07:be:9d:68:ae:65:54:6d:a0:93:c3:6f:bd:0d:82 no comment (ED25519)
```
