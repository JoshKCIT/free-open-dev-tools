import { rule, SRC, type HashRule } from './rule';
import { argon2Fields, argon2Reason, bcryptAt, bcryptReason, MODULAR_RULES } from './rules-modular';
import { BASE64, DIGITS, HEX, HEX_LOWER, ITOA, classTable, countTrailing, only, upperNote } from './scan';

/**
 * Rules for the formats of frameworks, directory servers and databases: Django, Werkzeug, LDAP password schemes and other
 * brace tags, PostgreSQL, MySQL, Oracle and SQL Server. Brace tags are compared as upper-case text one rule at a time and
 * identifiers are never looked up in a plain object, so a line such as "constructor" or "__proto__" is only text.
 */

const PASSLIB = 'Passlib documentation';
const ALNUM = classTable('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');
/** The digest names Python's hashlib offers for PBKDF2 (the hash_method of Werkzeug's pbkdf2:method:iterations). */
const HASHLIB_NAMES: ReadonlySet<string> = new Set([
  'md5',
  'sha1',
  'sha224',
  'sha256',
  'sha384',
  'sha512',
  'sha3_224',
  'sha3_256',
  'sha3_384',
  'sha3_512',
  'blake2b',
  'blake2s',
]);

function at(fields: readonly string[], i: number): string {
  return fields[i] ?? '';
}

function isDecimal(s: string): boolean {
  return s.length > 0 && s.length <= 12 && only(s, DIGITS) && (s.length === 1 || s.charCodeAt(0) !== 48);
}

/** The bytes in padded standard Base64 text from index `from` to the end of the line, or -1 when it is not padded Base64. */
function base64Bytes(s: string, from: number): number {
  const length = s.length - from;
  if (length <= 0 || length % 4 !== 0) return -1;
  const pads = countTrailing(s, '=');
  if (pads > 2 || !only(s, BASE64, from, s.length - pads)) return -1;
  return (length / 4) * 3 - pads;
}

// --- Django: algorithm$iterations$salt$hash --------------------------------------------------------------------------------

const DJANGO = `${SRC.django}; ${PASSLIB}, django_digest`;

function djangoPbkdf2(id: string, digest: string, hashLength: number): HashRule {
  return rule(`django-${id.replace('_', '-')}`, `Django password hash (PBKDF2-HMAC-${digest})`, 1, DJANGO, (line) => {
    if (!line.startsWith(`${id}$`)) return null;
    const f = line.split('$', 5); // [id, iterations, salt, hash]
    if (f.length !== 4) return null;
    const hash = at(f, 3);
    if (!isDecimal(at(f, 1)) || !only(at(f, 2), ALNUM) || hash.length !== hashLength || base64Bytes(hash, 0) < 0)
      return null;
    return `Starts with ${id}$ in Django's algorithm$iterations$salt$hash layout: ${at(f, 1)} iterations, a ${at(f, 2).length}-character salt and a ${hashLength}-character Base64 hash.`;
  });
}

const djangoArgon2 = rule('django-argon2', 'Django password hash (Argon2)', 1, `${DJANGO}; ${SRC.phc}`, (line) => {
  if (!line.startsWith('argon2$argon2')) return null;
  const found = argon2Fields(line.split('$', 9)); // ['argon2', 'argon2id', 'v=19', 'm=..,t=..,p=..', salt, hash]
  return found === null ? null : argon2Reason(found, 'Starts with argon2$ and, as Django writes it, then ');
});

const djangoBcryptSha256 = rule(
  'django-bcrypt-sha256',
  'Django password hash (bcrypt over SHA-256)',
  1,
  DJANGO,
  (line) => {
    if (!line.startsWith('bcrypt_sha256$$2')) return null;
    const found = bcryptAt(line, 14);
    return found === null ? null : bcryptReason(found, 'Starts with bcrypt_sha256 and a dollar sign, then ');
  },
);

const djangoBcrypt = rule('django-bcrypt', 'Django password hash (bcrypt)', 1, DJANGO, (line) => {
  if (!line.startsWith('bcrypt$$2')) return null;
  const found = bcryptAt(line, 7);
  return found === null ? null : bcryptReason(found, 'Starts with bcrypt and a dollar sign, then ');
});

const djangoScrypt = rule(
  'django-scrypt',
  'Django password hash (scrypt)',
  1,
  `${SRC.django} (the scrypt hasher: work factor, block size, parallelism); layout confirmed by Django 6.1.1 output`,
  (line) => {
    if (!line.startsWith('scrypt$')) return null;
    const f = line.split('$', 7); // ['scrypt', work factor, salt, block size, parallelism, hash]
    if (f.length !== 6) return null;
    if (!isDecimal(at(f, 1)) || !only(at(f, 2), ALNUM) || !isDecimal(at(f, 3)) || !isDecimal(at(f, 4))) return null;
    if (base64Bytes(at(f, 5), 0) < 0) return null;
    return `Starts with scrypt$ in the layout Django's scrypt hasher writes: work factor ${at(f, 1)}, a ${at(f, 2).length}-character salt, block size ${at(f, 3)}, parallelism ${at(f, 4)} and a Base64 hash.`;
  },
);

function djangoSalted(id: string, name: string, hashLength: number, hashClass: Uint8Array): HashRule {
  return rule(
    `django-${id}`,
    `Django password hash (${name})`,
    1,
    `${PASSLIB}, django_digest ("id$salt$checksum", Django up to 1.10)`,
    (line) => {
      if (!line.startsWith(`${id}$`)) return null;
      const f = line.split('$', 4); // [id, salt, hash]
      if (f.length !== 3) return null;
      const salt = at(f, 1);
      const hash = at(f, 2);
      if (hash.length !== hashLength || !only(hash, hashClass)) return null;
      if (id === 'crypt' ? salt.length !== 2 || !only(salt, ITOA) : !only(salt, ALNUM)) return null;
      return `Starts with ${id}$ in the older id$salt$hash layout of Django: a ${salt.length}-character salt and a ${hashLength}-character hash (three fields, not the four of the newer layout).`;
    },
  );
}

// --- Werkzeug: method:parameters$salt$hash ---------------------------------------------------------------------------------

const WERKZEUG =
  'Werkzeug documentation, werkzeug.security.generate_password_hash ("scrypt:32768:8:1", "pbkdf2:sha256:600000")';

function isLowerHexText(s: string): boolean {
  return s.length >= 2 && s.length % 2 === 0 && only(s, HEX_LOWER);
}

const werkzeugScrypt = rule('werkzeug-scrypt', 'Werkzeug / Flask scrypt hash', 1, WERKZEUG, (line) => {
  if (!line.startsWith('scrypt:')) return null;
  const f = line.split('$', 4); // ['scrypt:n:r:p', salt, hash]
  if (f.length !== 3) return null;
  const p = at(f, 0).split(':', 5);
  if (p.length !== 4 || !isDecimal(at(p, 1)) || !isDecimal(at(p, 2)) || !isDecimal(at(p, 3))) return null;
  if (!only(at(f, 1), ALNUM) || !isLowerHexText(at(f, 2))) return null;
  return `Starts with scrypt:N:r:p (N=${at(p, 1)}, r=${at(p, 2)}, p=${at(p, 3)}), then $, a ${at(f, 1).length}-character salt, $ and a hexadecimal hash.`;
});

const werkzeugPbkdf2 = rule('werkzeug-pbkdf2', 'Werkzeug / Flask PBKDF2 hash', 1, WERKZEUG, (line) => {
  if (!line.startsWith('pbkdf2:')) return null;
  const f = line.split('$', 4); // ['pbkdf2:digest:iterations', salt, hash]
  if (f.length !== 3) return null;
  const p = at(f, 0).split(':', 4);
  if (p.length !== 3) return null;
  const digest = at(p, 1);
  if (!HASHLIB_NAMES.has(digest) || !isDecimal(at(p, 2))) return null;
  if (!only(at(f, 1), ALNUM) || !isLowerHexText(at(f, 2))) return null;
  return `Starts with pbkdf2:${digest}:${at(p, 2)} (PBKDF2 with ${digest} and ${at(p, 2)} iterations), then $, a ${at(f, 1).length}-character salt, $ and a hexadecimal hash.`;
});

// --- LDAP password schemes: {SCHEME}body -----------------------------------------------------------------------------------

/** The upper-cased scheme between braces at the start of the line, and where its body begins. */
function tagOf(line: string): { tag: string; body: number } | null {
  if (line.charCodeAt(0) !== 123) return null;
  const limit = Math.min(line.length, 32);
  for (let i = 1; i < limit; i++) {
    if (line.charCodeAt(i) === 125) return i < 2 ? null : { tag: line.slice(1, i).toUpperCase(), body: i + 1 };
  }
  return null;
}

function ldapDigest(
  id: string,
  name: string,
  tag: string,
  digestBytes: number,
  salted: boolean,
  fact: string,
  source: string,
): HashRule {
  return rule(id, name, 1, source, (line) => {
    const t = tagOf(line);
    if (t === null || t.tag !== tag) return null;
    const bytes = base64Bytes(line, t.body);
    if (bytes < 0) return null;
    if (salted ? bytes <= digestBytes : bytes !== digestBytes) return null;
    const detail = salted
      ? `Base64 of ${bytes} bytes: a ${digestBytes}-byte ${fact} digest followed by ${bytes - digestBytes} bytes of salt.`
      : `Base64 of ${bytes} bytes: the ${digestBytes}-byte ${fact} digest.`;
    return `Starts with {${tag}} (case does not matter), then ${detail}`;
  });
}

const RFC2307_AND_PASSLIB = `${SRC.rfc2307}; ${SRC.slappasswd}; ${PASSLIB}, ldap_digests`;

const ldapSha = ldapDigest(
  'ldap-sha',
  'LDAP {SHA} (unsalted SHA-1)',
  'SHA',
  20,
  false,
  'SHA-1',
  `${SRC.rfc2307}; ${SRC.apache} ("{SHA}" followed by the Base64 SHA-1 digest)`,
);
const ldapSsha = ldapDigest('ldap-ssha', 'LDAP {SSHA} (salted SHA-1)', 'SSHA', 20, true, 'SHA-1', RFC2307_AND_PASSLIB);
const ldapMd5 = ldapDigest(
  'ldap-md5',
  'LDAP {MD5} (unsalted MD5)',
  'MD5',
  16,
  false,
  'MD5',
  `${SRC.rfc2307}; ${SRC.slappasswd}`,
);
const ldapSmd5 = ldapDigest('ldap-smd5', 'LDAP {SMD5} (salted MD5)', 'SMD5', 16, true, 'MD5', RFC2307_AND_PASSLIB);

const ldapCrypt = rule(
  'ldap-crypt',
  'LDAP {CRYPT} wrapper',
  1,
  `${SRC.rfc2307} ({crypt}); ${SRC.slappasswd}`,
  (line) => {
    const t = tagOf(line);
    if (t === null || t.tag !== 'CRYPT' || t.body >= line.length) return null;
    // RFC 2307 says the body is a crypt(3) string, but anything can follow the tag. The marker only counts as tier 1 when a
    // crypt format that has a marker of its own (tier 1) checks the body; otherwise the body is not checked.
    const body = line.slice(t.body);
    const checked = MODULAR_RULES.some(
      (inner) => inner.id !== 'phc-unknown' && inner.tier === 1 && inner.test(body) !== null,
    );
    if (checked) {
      return {
        tier: 1,
        reason:
          'Starts with {CRYPT} (case does not matter) followed by a crypt(3) string whose own marker and fields were checked; the formats that string fits are listed as well.',
      };
    }
    return {
      tier: 2,
      reason:
        'Starts with {CRYPT} (case does not matter), but the body is not checked: no crypt format with a marker fits it, so this is the scheme label only. Any text can follow it; the formats the body fits by length alone are listed as well.',
    };
  },
);

/** One rule per modular rule: the same layout inside a {CRYPT} tag, because RFC 2307 says the body is a crypt(3) string. */
const cryptWrapped: HashRule[] = MODULAR_RULES.filter((inner) => inner.id !== 'phc-unknown').map((inner) =>
  rule(
    `ldap-crypt/${inner.id}`,
    `LDAP {CRYPT} + ${inner.name}`,
    inner.tier,
    `${SRC.rfc2307}; ${inner.source}`,
    (line) => {
      const t = tagOf(line);
      if (t === null || t.tag !== 'CRYPT') return null;
      const match = inner.test(line.slice(t.body));
      return match === null ? null : `Inside {CRYPT}: ${match.reason}`;
    },
  ),
);

const ldapPkcs5s2 = rule(
  'ldap-pkcs5s2',
  'Atlassian {PKCS5S2} (PBKDF2-HMAC-SHA1)',
  1,
  `${PASSLIB}, atlassian_pbkdf2_sha1`,
  (line) => {
    const t = tagOf(line);
    if (t === null || t.tag !== 'PKCS5S2' || line.length - t.body !== 64 || !only(line, BASE64, t.body, line.length))
      return null;
    return 'Starts with {PKCS5S2} followed by 64 Base64 characters: a 16-byte salt and a 32-byte checksum (PBKDF2-HMAC-SHA1, 10,000 rounds, used by Atlassian products).';
  },
);

function ldapPbkdf2(id: string, tag: string, digest: string, checksumLength: number): HashRule {
  return rule(
    id,
    `LDAP {${tag}} (PBKDF2-HMAC-${digest})`,
    1,
    `${PASSLIB}, ldap_pbkdf2_digest ("{PBKDF2-SHA256}rounds$salt$checksum")`,
    (line) => {
      const t = tagOf(line);
      if (t === null || t.tag !== tag) return null;
      const f = line.split('$', 4); // ['{TAG}rounds', salt, checksum]
      if (f.length !== 3) return null;
      const rounds = at(f, 0).slice(t.body);
      const checksum = at(f, 2);
      if (!isDecimal(rounds) || !only(at(f, 1), ITOA) || checksum.length !== checksumLength || !only(checksum, ITOA))
        return null;
      return `Starts with {${tag}} (case does not matter), ${rounds} rounds, a salt and a ${checksumLength}-character checksum in Passlib's adapted Base64 (PBKDF2 with HMAC-${digest}).`;
    },
  );
}

// --- Spring Security identifiers: tier 2, the body is not checked ---------------------------------------------------------

const SPRING = 'Spring Security reference, "Password Storage" (DelegatingPasswordEncoder identifiers)';

function springTag(
  id: string,
  name: string,
  tag: string,
  meaning: string,
  versioned: boolean,
  bodyIsHex = false,
): HashRule {
  return rule(id, name, 2, SPRING, (line) => {
    const t = tagOf(line);
    if (t === null || t.body >= line.length) return null;
    const matches = t.tag === tag || (versioned && t.tag === `${tag}@SPRINGSECURITY_V5_8`);
    if (!matches) return null;
    if (bodyIsHex && !only(line, HEX, t.body, line.length)) return null;
    return `Begins {${line.slice(1, t.body - 1)}}, the identifier Spring Security puts in front of ${meaning}. ${bodyIsHex ? 'The rest is hexadecimal.' : 'The rest is not checked further.'}`;
  });
}

// --- PostgreSQL, MySQL, Oracle, SQL Server ---------------------------------------------------------------------------------

const POSTGRES = 'PostgreSQL documentation, pg_authid ("md5" followed by a 32-character hexadecimal MD5 hash)';

const pgMd5 = rule('pg-md5', 'PostgreSQL md5 password', 1, `${POSTGRES}; ${PASSLIB}, postgres_md5`, (line) => {
  if (line.length !== 35 || !line.startsWith('md5') || !only(line, HEX, 3, 35)) return null;
  return 'The word md5 followed by 32 hexadecimal characters: the MD5 of the password followed by the user name.';
});

const pgScram = rule(
  'pg-scram',
  'PostgreSQL SCRAM-SHA-256 verifier',
  1,
  'PostgreSQL documentation, pg_authid ("SCRAM-SHA-256$<iteration count>:<salt>$<StoredKey>:<ServerKey>"); RFC 5802; RFC 7677',
  (line) => {
    if (!line.startsWith('SCRAM-SHA-256$')) return null;
    const f = line.split('$', 4); // ['SCRAM-SHA-256', 'iterations:salt', 'StoredKey:ServerKey']
    if (f.length !== 3) return null;
    const first = at(f, 1).split(':', 3);
    const keys = at(f, 2).split(':', 3);
    if (first.length !== 2 || keys.length !== 2) return null;
    const salt = at(first, 1);
    const stored = at(keys, 0);
    const server = at(keys, 1);
    if (
      !isDecimal(at(first, 0)) ||
      base64Bytes(salt, 0) < 0 ||
      base64Bytes(stored, 0) < 0 ||
      base64Bytes(server, 0) < 0
    )
      return null;
    return `Starts with SCRAM-SHA-256$ followed by ${at(first, 0)} iterations, a Base64 salt, a StoredKey and a ServerKey (RFC 5802 and RFC 7677).`;
  },
);

const mysql41 = rule(
  'mysql41',
  'MySQL 4.1 and later (mysql_native_password)',
  1,
  `${PASSLIB}, mysql41 ("an asterisk followed by 40 hexadecimal digits"); confirmed by passlib 1.7.4 output`,
  (line) => {
    if (line.length !== 41 || line.charCodeAt(0) !== 42 || !only(line, HEX, 1, 41)) return null;
    return 'An asterisk followed by 40 hexadecimal characters: the SHA-1 of the SHA-1 of the password (MySQL writes the digits in upper case).';
  },
);

const oracle11 = rule(
  'oracle11',
  'Oracle 11g password hash',
  1,
  `${PASSLIB}, oracle11 ("S:" then a 40-digit checksum and a 20-digit salt); confirmed by passlib 1.7.4 output`,
  (line) => {
    if (line.length !== 62 || !line.startsWith('S:') || !only(line, HEX, 2, 62)) return null;
    return 'S: followed by 60 hexadecimal characters: a 40-character SHA-1 checksum and a 20-character salt.';
  },
);

const MSSQL =
  'Microsoft Learn, sys.sql_logins ("the first byte of the hash indicates the version: 0x02 ... SHA-512 of the salted password")';

const mssql2005 = rule(
  'mssql2005',
  'Microsoft SQL Server 2005 password hash',
  2,
  `${MSSQL}; the 2005 layout is not published there`,
  (line) => {
    if (line.length !== 54 || !line.startsWith('0x0100') || !only(line, HEX, 2, 54)) return null;
    return 'Starts with 0x0100 followed by an 8-character salt and a 40-character SHA-1 digest. This is a check of the shape alone: Microsoft does not publish this layout.';
  },
);

const mssql2012 = rule('mssql2012', 'Microsoft SQL Server 2012 to 2022 password hash', 2, MSSQL, (line) => {
  if (line.length !== 142 || !line.startsWith('0x0200') || !only(line, HEX, 2, 142)) return null;
  return 'Starts with 0x0200 (version 2) followed by an 8-character salt and a 128-character SHA-512 digest. Microsoft documents the version byte and the salted SHA-512; the salt position is the shape seen in real values.';
});

// 16 hexadecimal characters: a length only (tier 3), so these two sit in the digest section of the order.
const mysql323 = rule(
  'mysql323',
  'MySQL before 4.1 (OLD_PASSWORD)',
  3,
  `${PASSLIB}, mysql323 ("16 hexadecimal digits"); confirmed by passlib 1.7.4 output`,
  (line) => {
    if (line.length !== 16 || !only(line, HEX)) return null;
    return `The pre-4.1 MySQL password hash is a 64-bit checksum written as 16 hexadecimal characters. Length only: nothing in the string says which algorithm made it.${upperNote(line)}`;
  },
);

const oracle10 = rule(
  'oracle10',
  'Oracle 10g password hash',
  3,
  `${PASSLIB}, oracle10 ("16 hexadecimal digits"); confirmed by passlib 1.7.4 output`,
  (line) => {
    if (line.length !== 16 || !only(line, HEX)) return null;
    return `The Oracle 10g password hash is a DES-based 64-bit checksum written as 16 hexadecimal characters. Length only: nothing in the string says which algorithm made it.${upperNote(line)}`;
  },
);

/** The framework, directory and database rules, in the order of the rule table. */
export const FRAMEWORK_RULES: readonly HashRule[] = [
  djangoPbkdf2('pbkdf2_sha256', 'SHA-256', 44),
  djangoPbkdf2('pbkdf2_sha1', 'SHA-1', 28),
  djangoArgon2,
  djangoBcryptSha256,
  djangoBcrypt,
  djangoScrypt,
  djangoSalted('md5', 'salted MD5', 32, HEX_LOWER),
  djangoSalted('sha1', 'salted SHA-1', 40, HEX_LOWER),
  djangoSalted('crypt', 'DES crypt', 13, ITOA),
  werkzeugScrypt,
  werkzeugPbkdf2,
  ldapSha,
  ldapSsha,
  ldapMd5,
  ldapSmd5,
  ldapCrypt,
  ...cryptWrapped,
  ldapPkcs5s2,
  ldapPbkdf2('ldap-pbkdf2-sha1', 'PBKDF2', 'SHA-1', 27),
  ldapPbkdf2('ldap-pbkdf2-sha256', 'PBKDF2-SHA256', 'SHA-256', 43),
  ldapPbkdf2('ldap-pbkdf2-sha512', 'PBKDF2-SHA512', 'SHA-512', 86),
  pgMd5,
  pgScram,
  mysql41,
  oracle11,
  springTag('spring-bcrypt', 'Spring Security {bcrypt}', 'BCRYPT', 'a bcrypt string', false),
  springTag('spring-scrypt', 'Spring Security {scrypt}', 'SCRYPT', 'an scrypt string', true),
  springTag('spring-argon2', 'Spring Security {argon2}', 'ARGON2', 'an Argon2 string', true),
  springTag('spring-pbkdf2', 'Spring Security {pbkdf2}', 'PBKDF2', 'a PBKDF2 value', true, true),
  springTag('spring-sha256', 'Spring Security {sha256}', 'SHA256', 'a salted SHA-256 value', false, true),
  springTag(
    'spring-noop',
    'Spring Security {noop} (plain text)',
    'NOOP',
    'a password stored as plain text, which is not a hash',
    false,
  ),
  mssql2005,
  mssql2012,
  mysql323,
  oracle10,
];
