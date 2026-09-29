# AES Encrypt & Decrypt

Encrypt and decrypt with AES-GCM, AES-CBC or AES-CTR, with a raw key or an OpenSSL-compatible passphrase.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Encrypts and decrypts with AES over the browser's own Web Crypto interface. Passphrase mode reproduces the framing `openssl enc` uses, so a file this tool encrypts decrypts with the real `openssl` command line and vice versa. Raw-key mode is for an application key you already have: AES-GCM, AES-CBC or AES-CTR, with the key and IV shown and taken as hex or Base64.

## Supported

- Passphrase mode: AES-256-CBC (default), AES-128-CBC, AES-256-CTR and AES-128-CTR
- Key derivation: PBKDF2-HMAC-SHA256 as `openssl enc -pbkdf2` uses it (default 10000 iterations, adjustable from 1 to 10,000,000), or legacy EVP_BytesToKey with SHA-256 (OpenSSL 1.1.0 and later without -pbkdf2) or MD5 (OpenSSL before 1.1.0, and several JavaScript libraries' default passphrase mode)
- Base64 output with the `Salted__` header, matching `openssl enc -a -A`; whitespace-wrapped Base64 (as plain `-a` without `-A` produces) is also accepted on decrypt
- The exact `openssl enc -d ...` command to decrypt what this tool just encrypted, using `-pass env:PASS` so the passphrase is never written into a command line
- Raw-key mode: AES-GCM (default, 128-bit tag, optional additional authenticated data), AES-CBC with PKCS#7 padding, AES-CTR with a full 128-bit big-endian counter
- Raw keys as hex or Base64, 16 bytes (AES-128) or 32 bytes (AES-256); a button to generate a random key
- Raw-mode IV shown separately and as part of a combined IV-then-ciphertext-then-tag value; decrypt accepts the tag appended to the ciphertext or given separately
- Plaintext and decrypted output as UTF-8 text or hex

## Limits

- AES-192 is not offered: Chromium's Web Crypto implementation refuses to import a 192-bit AES key, so there is no way to offer it consistently across browsers.
- ECB, CFB, OFB, DES, 3DES and RC4 are not offered. They are not in Web Crypto; ECB also leaks repeated-block patterns even when encrypted correctly, and the others are broken or obsolete.
- AES-CBC and AES-CTR carry no integrity check. A wrong key or passphrase in CTR mode, and roughly 1 in 256 wrong keys in CBC mode, produce wrong plaintext bytes rather than an error. AES-GCM is the raw-mode default for this reason.
- Legacy EVP_BytesToKey key derivation is a single fast hash with no iteration count, and is easy to brute-force offline. It exists only for reading data made by older tools.
- Only the default 8-byte OpenSSL salt and the `Salted__` header are read or written. Data made with `-nosalt`, or with an explicit `-S` salt in OpenSSL 3 (which OpenSSL itself confirms omits the `Salted__` header), cannot be decrypted here.
- Only 128-bit GCM tags are produced or accepted.
- The derived key and IV in passphrase mode are never displayed; there is no equivalent of `openssl enc -P` here.
- The page reads additional authenticated data (AAD) for GCM as UTF-8 text, not arbitrary bytes.
- A key or passphrase typed here is used only on this page and never sent anywhere, but this tool cannot see what a browser extension or clipboard manager does with it before it arrives.

## Ambiguous cases, and what this does about them

- Passphrase bytes are UTF-8. A terminal using a different encoding to set the PASS environment variable would derive a different key from the same-looking text.
- PBKDF2 derives the key and the IV together from one `deriveBits` call, split key-then-IV, matching what `openssl enc -pbkdf2` itself does.
- A raw-mode GCM IV that is not 12 bytes is accepted on encrypt and decrypt, with a warning: GCM's own definition allows any length from 1 to 2^61-1 bits, but 12 bytes is the near-universal choice and the only length "IV is prepended" assumes.

## Defined by

- [FIPS 197 — Advanced Encryption Standard (AES)](https://csrc.nist.gov/pubs/fips/197/final)
- [NIST SP 800-38A — Block Cipher Modes of Operation](https://csrc.nist.gov/pubs/sp/800/38/a/final)
- [NIST SP 800-38D — Galois/Counter Mode (GCM)](https://csrc.nist.gov/pubs/sp/800/38/d/final)
- [RFC 8018 — PKCS #5: Password-Based Cryptography Specification v2.1](https://www.rfc-editor.org/rfc/rfc8018)
- [RFC 5652 section 6.3 — Content Encryption Key Wrapping (PKCS#7 padding)](https://www.rfc-editor.org/rfc/rfc5652#section-6.3)
- [W3C Web Cryptography API](https://www.w3.org/TR/WebCryptoAPI/)
- [OpenSSL enc(1) manual (3.5)](https://docs.openssl.org/3.5/man1/openssl-enc/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/aes-encryption aes-encryption
cd aes-encryption
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/aes-encryption
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { encryptWithPassphrase, decryptWithPassphrase, opensslDecryptCommand } from '@fodt/aes-encryption';

const { base64, command } = await encryptWithPassphrase(
  new TextEncoder().encode('Attack at dawn'),
  'a-placeholder-passphrase',
  { cipher: 'aes-256-cbc', kdf: 'pbkdf2', iterations: 10000 },
);
// base64 decrypts with: `openssl enc -d -aes-256-cbc -pbkdf2 -iter 10000 -md sha256 -a -A -in encrypted.txt -pass env:PASS`

import { encryptRaw, generateKey } from '@fodt/aes-encryption';
const key = generateKey(256);
const { combined } = await encryptRaw(new TextEncoder().encode('hello'), key, { mode: 'gcm' });
```

Every function that touches `crypto.subtle` is asynchronous, because Web Crypto's own key-import, derive, encrypt and decrypt calls are. `generateKey` is synchronous: it only calls `crypto.getRandomValues`. Passphrase encryption results are plain strings (Base64, hex, a shell command); raw-mode results carry `Uint8Array`s for the IV, ciphertext and tag. Every error thrown by this package is an `AesError`, with a `kind` of `'input'`, `'decrypt'` or `'unavailable'` and a fixed message that never contains a passphrase, key or password.

## Dependencies

- `@noble/hashes` ^2.4.0

## Tests

```sh
npm test
```

NIST SP 800-38A Appendix F.2 (CBC-AES128 and CBC-AES256) and F.5 (CTR-AES128 and CTR-AES256) vectors; the McGrew–Viega GCM specification's test cases 2-4 (AES-128) and 13-16 (AES-256), asserted as the published literal values; a CTR counter-wrap case against Node's own `createCipheriv`; a Node `crypto` differential over randomised keys, IVs and plaintext lengths for every mode; six OpenSSL 3.5.5 interoperability fixtures generated once with the local `openssl` CLI (recorded as literals, with the exact commands used to make and confirm them in a comment; tests never shell out) covering PBKDF2 at two iteration counts and both EVP_BytesToKey hashes; and the full secret-handling contract (no passphrase or key ever appears in a result, an error message, or the OpenSSL command line).

## Licence

MIT. See [LICENSE](./LICENSE).
