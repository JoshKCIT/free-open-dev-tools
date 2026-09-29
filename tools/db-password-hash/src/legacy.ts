/**
 * PostgreSQL's legacy `md5` password format, MySQL/MariaDB's
 * `mysql_native_password` format, and the SQL statement builders for all
 * three formats this package produces (S6/PD-09: the generated SQL carries
 * the role/user name and the hash, never the password, and every name is
 * quoted so it cannot break out of its quotes).
 */
import { md5, sha1 } from '@noble/hashes/legacy.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { DbHashError } from './errors';

/** `'md5' + lower-hex(MD5(password || role))` -- PostgreSQL's `CREATE ROLE ... PASSWORD` legacy format. */
export function postgresMd5(password: string, role: string): string {
  if (password === '') throw new DbHashError('Enter a password.');
  if (role === '') {
    throw new DbHashError(
      'A PostgreSQL md5 hash is salted with the role name: enter the role name it was created for.',
    );
  }
  const bytes = new TextEncoder().encode(password + role);
  return 'md5' + bytesToHex(md5(bytes));
}

/** `'*' + UPPER-hex(SHA1(SHA1(password)))` -- MySQL's `PASSWORD()` / `mysql_native_password` format. */
export function mysqlNativePassword(password: string): string {
  if (password === '') throw new DbHashError('Enter a password.');
  const bytes = new TextEncoder().encode(password);
  const once = sha1(bytes);
  const twice = sha1(once);
  return '*' + bytesToHex(twice).toUpperCase();
}

const MAX_PG_IDENTIFIER_BYTES = 63;

/** Warns when a name is long enough that PostgreSQL would silently truncate it, changing the md5 salt (PD-09). */
export function identifierLengthWarning(name: string): string | undefined {
  const byteLength = new TextEncoder().encode(name).length;
  if (byteLength > MAX_PG_IDENTIFIER_BYTES) {
    return `This name is ${byteLength} UTF-8 bytes; PostgreSQL truncates identifiers at ${MAX_PG_IDENTIFIER_BYTES} bytes, which would change the md5 salt actually used.`;
  }
  return undefined;
}

/** PostgreSQL identifier quoting: wrap in double quotes, doubling any `"` inside. A NUL byte is refused. */
export function quotePgIdentifier(name: string): string {
  if (name.includes('\u0000')) throw new DbHashError('A role name cannot contain a NUL character.');
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * MySQL/MariaDB string-literal quoting (default `sql_mode`, without
 * `NO_BACKSLASH_ESCAPES`): `'` and `\` are each doubled. Under
 * `NO_BACKSLASH_ESCAPES` a doubled backslash must instead be a single one
 * -- disclosed in this package's `meta.json` `ambiguities`.
 */
export function quoteMysqlString(text: string): string {
  if (text.includes('\u0000')) throw new DbHashError('This name cannot contain a NUL character.');
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

export function alterRolePostgres(role: string, hash: string): string {
  return `ALTER ROLE ${quotePgIdentifier(role)} PASSWORD '${hash}';`;
}

export function alterUserMysql(user: string, host: string, hash: string): string {
  return `ALTER USER ${quoteMysqlString(user)}@${quoteMysqlString(host)} IDENTIFIED WITH mysql_native_password AS '${hash}';`;
}

export function alterUserMariadb(user: string, host: string, hash: string): string {
  return `ALTER USER ${quoteMysqlString(user)}@${quoteMysqlString(host)} IDENTIFIED BY PASSWORD '${hash}';`;
}
