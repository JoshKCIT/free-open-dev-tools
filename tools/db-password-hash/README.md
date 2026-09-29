# Database Password Hash

Generate and check PostgreSQL SCRAM-SHA-256 and md5 password hashes and MySQL/MariaDB native password hashes.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Generates and checks the password hash formats PostgreSQL and MySQL/MariaDB actually store: PostgreSQL's default SCRAM-SHA-256, PostgreSQL's older md5 format, and MySQL/MariaDB's mysql_native_password. A pre-hashed value in ALTER ROLE or ALTER USER lets you set a password on a server without the server ever seeing the plain text over the wire.

## Supported

- PostgreSQL SCRAM-SHA-256 stored secrets, the default format since PostgreSQL 14, in the exact SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey> form
- SCRAM iteration counts from 1 to 1,000,000, default 4096 (PostgreSQL's own scram_iterations default), with a random 16-byte salt or a salt you supply as Base64
- SASLprep password preparation (RFC 4013 mapping tables plus Unicode NFKC), matching PostgreSQL's own password preparation for printable-ASCII passwords
- PostgreSQL's legacy md5 password format, salted with the role name
- MySQL and MariaDB's mysql_native_password format
- Ready ALTER ROLE / ALTER USER SQL statements with safe quoting of the role or user name (PostgreSQL stores a value already in SCRAM or md5 format as-is, so these statements work as written)
- Verifying a password against a stored hash of any of the three kinds, detected automatically from the hash's own prefix, using a constant-time comparison

## Limits

- MySQL 8's caching_sha2_password is not offered. Its stored format is a MySQL-specific variant of SHA-256 crypt with a 20-byte salt and no published test vectors to check an implementation against, and a wrong hash here would lock an account out rather than merely give a wrong answer on screen.
- SASLprep's prohibited-output, bidirectional and unassigned-code-point checks (RFC 4013 sections 2.3 to 2.5) are not performed. Every password containing a non-ASCII character carries a warning to test a real login before relying on the generated hash.
- PostgreSQL's md5 format is deprecated since PostgreSQL 14 and only works where pg_hba.conf still allows md5 authentication.
- mysql_native_password is deprecated in MySQL 8.0, disabled by default from MySQL 8.4, and removed in MySQL 9.0. It remains the default authentication plugin on MariaDB.
- Iteration counts above 1,000,000 are refused, both when generating and when verifying against a pasted stored hash.
- An empty password is refused everywhere in this tool.
- A stored hash is not the password, but it is still sensitive: a weak password can be cracked from it offline, especially a PostgreSQL md5 or MySQL native hash, which have no configurable work factor at all.

## Ambiguous cases, and what this does about them

- U+200B (zero width space) appears in both RFC 3454 mapping tables this tool implements: table C.1.2 (non-ASCII space, mapped to U+0020) and table B.1 (commonly mapped to nothing). Because C.1.2 is applied first, U+200B becomes a literal space rather than being removed.
- A role or user name longer than 63 UTF-8 bytes triggers a warning: PostgreSQL truncates identifiers at that length, which changes what the md5 hash was actually salted with on the server. MySQL/MariaDB user and host values are quoted as string literals with ' and \ each doubled (the default sql_mode); under NO_BACKSLASH_ESCAPES a doubled backslash must instead be a single one, which this tool does not detect.
- Password bytes are UTF-8 throughout. MySQL actually hashes the bytes in the connection's own character set, and PostgreSQL md5 hashes the bytes in the server's encoding -- UTF-8 in the common case, but not guaranteed.
- This tool's Unicode NFKC normalisation comes from the browser's own Unicode version, which can differ from the Unicode tables compiled into a given PostgreSQL release for a very recently assigned code point.

## Defined by

- [RFC 5802 — Salted Challenge Response Authentication Mechanism (SCRAM)](https://www.rfc-editor.org/rfc/rfc5802)
- [RFC 7677 — SCRAM-SHA-256 and SCRAM-SHA-256-PLUS](https://www.rfc-editor.org/rfc/rfc7677)
- [RFC 4013 — SASLprep](https://www.rfc-editor.org/rfc/rfc4013)
- [RFC 3454 — Preparation of Internationalized Strings (stringprep)](https://www.rfc-editor.org/rfc/rfc3454)
- [RFC 8018 — PKCS #5: Password-Based Cryptography Specification v2.1](https://www.rfc-editor.org/rfc/rfc8018)
- [PostgreSQL — Password Authentication](https://www.postgresql.org/docs/current/auth-password.html)
- [MySQL — Native Pluggable Authentication](https://dev.mysql.com/doc/refman/8.4/en/native-pluggable-authentication.html)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/db-password-hash db-password-hash
cd db-password-hash
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/db-password-hash
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { scramSha256, verifyStoredHash, alterRolePostgres } from '@fodt/db-password-hash';

const { stored, iterations } = await scramSha256('a-placeholder-password', { iterations: 4096 });
const statement = alterRolePostgres('app_user', stored);
// ALTER ROLE "app_user" PASSWORD '...';

const { match } = await verifyStoredHash(stored, 'a-placeholder-password');
// true
```

scramSha256 and verifyStoredHash are asynchronous because they use pbkdf2Async, which yields so a browser tab stays responsive at a high iteration count; postgresMd5, mysqlNativePassword and the SQL builders are synchronous. Every error thrown by this package is a DbHashError with a fixed message that never contains a password.

## Dependencies

- `@noble/hashes` ^2.4.0

## Tests

```sh
npm test
```

MySQL 5.7 Reference Manual's own PASSWORD() worked example; RFC 7677 section 3's example (password "pencil", a published salt and iteration count), checked by rebuilding the SCRAM AuthMessage from the RFC's own protocol messages and verifying the client and server proofs it publishes against this package's StoredKey and ServerKey; RFC 4013 section 3's SASLprep examples; a Node crypto differential (pbkdf2Sync, createHmac, createHash) over randomised passwords, salts and iteration counts; verification round trips for all three kinds; malformed-stored-hash refusals; SQL-injection-shaped role and user names; and the secret contract (no password in a result, an error message, or generated SQL).

## Licence

MIT. See [LICENSE](./LICENSE).
