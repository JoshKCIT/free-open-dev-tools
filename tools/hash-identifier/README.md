# Hash Type Identifier

Paste a hash or password hash string and see the algorithms it could come from, ranked, with the reason for each.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Reads one hash or password hash string per line and lists the formats each one fits, ranked: first the strings whose own marker and field layout match a published format, then specific shapes with no marker, then raw digests that can only be told apart by their length. Every candidate comes with the reason it was listed (which marker matched and which fields were checked) and the document the rule rests on. The page lists what a string could be and never claims which algorithm made it; it never tests, cracks or looks up a password, and nothing you paste is sent anywhere.

## Supported

- Modular crypt strings that start with a marker, checked field by field against the libxcrypt crypt(5) layouts: bcrypt ($2a$, $2b$, $2x$, $2y$) and MD5 crypt ($1$) in this first slice
- Raw hexadecimal digests recognised by length alone, in a stated order: 32 hexadecimal characters lists MD5, NTLM, MD4, LM, MD2 and RIPEMD-128
- One string per line (line feed or carriage return plus line feed); only spaces and tabs around a line are trimmed; blank lines are skipped and counted

## Limits

- A paste of up to 256 KiB (262,144 characters) and 1,000 lines is read; a longer paste is refused, and a line over 4,096 characters is reported as too long to be a hash.
- The page never claims which algorithm made a string: it lists the formats the string fits, ranked. It never tests, cracks or looks up a password.
- A bare hex or Base64 string carries no label; those candidates come from its length alone, in the order they are most often met, and several are always possible.
- Salted or keyed digests cannot be told from plain ones by the string alone.
- A line that holds any character other than printable ASCII (a space up to a tilde) is reported as not a hash string.
- Only bcrypt and MD5 crypt strings are matched by their marker so far; other formats are listed as not recognised.

## Ambiguous cases, and what this does about them

- Candidates of one kind keep the order of the rule table, which ranks by how often each algorithm is met; the order is an editorial ranking and not a probability
- A 32 character hexadecimal string is equally an MD5, NTLM, MD4, LM, MD2 or RIPEMD-128 digest as far as the string can tell

## Defined by

- [libxcrypt crypt(5): storage format for hashed passphrases and available hashing methods](https://man.archlinux.org/man/crypt.5.en)
- [PHC string format (C2SP)](https://github.com/C2SP/C2SP/blob/main/phc-strings.md)
- [RFC 2307: An Approach for Using LDAP as a Network Information Service](https://www.rfc-editor.org/rfc/rfc2307)
- [RFC 9106: Argon2, the memory-hard function for password hashing and other applications](https://www.rfc-editor.org/rfc/rfc9106)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/hash-identifier hash-identifier
cd hash-identifier
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/hash-identifier
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { identifyText } from '@fodt/hash-identifier';

const result = identifyText('$1$saltsalt$qjXMvbEw8oaL.CzflDtaK/\n5f4dcc3b5aa765d61d8327deb882cf99');
result.lines[0].candidates[0].name;   // 'MD5 crypt ($1$)'
result.lines[1].candidates.map((c) => c.name);   // ['MD5', 'NTLM (NT hash)', 'MD4', ...]
```

`identifyText(text)` splits a paste into lines and returns `{ lines, blank, read, recognised, notRecognised, warnings, notes }`; each line has its number, its length, the first 12 characters, a status (`ok`, `too-long`, `not-ascii` or `not-recognised`), a message and its candidates. `identifyLine(line)` ranks the candidates of one line. A candidate is `{ ruleId, name, tier, reason, source }` with tier 1 for a marker, 2 for a shape and 3 for a length only, sorted by tier and then by the position of its rule in `RULES`. A paste over `MAX_INPUT_CHARS` characters or `MAX_LINES` lines is refused with a `HashIdentifierError`. Every rule is a bounded scan or a limited split, so a line costs time in proportion to its length.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The expected values are the layouts of the libxcrypt crypt(5) manual and strings made by independent generators (OpenSSL passwd, passlib with the pyca bcrypt library) whose versions are recorded next to them.

## Licence

MIT. See [LICENSE](./LICENSE).
