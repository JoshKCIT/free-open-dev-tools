import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MAX_LINE_CHARS, RULES, identifyLine, identifyText } from '../src/index';
import { CORPUS, DJANGO_CORPUS } from './fixtures/corpus';

/**
 * The corpus is recorded output of independent generators (OpenSSL 3.5.5, passlib 1.7.4 with bcrypt 4.0.1, argon2-cffi,
 * Werkzeug, Django, Python hashlib and zlib: see fixtures/README.md). The expected rule of each string is the format its
 * generator documents, written by hand into the recording script. Nothing here is computed by the code under test.
 *
 * SAMPLES are strings built by hand from the published layouts for the rules no generator on the recording machine could
 * make (yescrypt and its two variants, scrypt and SM3 in the crypt format, the NT hash in crypt format, the PostgreSQL SCRAM
 * verifier, the Spring Security identifiers, SQL Server and a PHC string of an identifier nobody here knows). Each is
 * assembled from the field widths the document gives, so the document and not the code is the oracle.
 */

const spies = {
  log: vi.spyOn(console, 'log'),
  warn: vi.spyOn(console, 'warn'),
  error: vi.spyOn(console, 'error'),
};
beforeEach(() => {
  for (const spy of Object.values(spies)) spy.mockImplementation(() => undefined);
});
afterEach(() => {
  for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  for (const spy of Object.values(spies)) spy.mockReset();
});

/** Passlib and Cisco formats the rule table deliberately does not cover (named in the limits). */
const NOT_COVERED_IN_TABLE = ['cisco_type7', 'cisco_pix', 'cisco_asa', 'fshp', 'grub_pbkdf2_sha512', 'msdcc', 'msdcc2'];

const rep = (s: string, n: number): string => s.repeat(n);
// crypt(5): yescrypt "$y$" + settings + "$" + salt (up to 86) + "$" + a 43-character hash, all from ./A-Za-z0-9.
const yescrypt = (marker: string): string => `$${marker}$j9T$${rep('Ab.', 7)}A$${rep('x7', 21)}Q`;
const B64_16 = Buffer.alloc(16, 7).toString('base64');
const B64_32 = Buffer.alloc(32, 9).toString('base64');

const SAMPLES: Record<string, string> = {
  yescrypt: yescrypt('y'),
  'gost-yescrypt': yescrypt('gy'),
  'sm3-yescrypt': yescrypt('sm3y'),
  // crypt(5): "$7$" + 11 to 97 characters + "$" + 43 characters
  'scrypt-crypt': `$7$${rep('C/', 11)}$${rep('x7', 21)}Q`,
  // crypt(5): "$sm3$" + (rounds=N$) + salt of 1 to 16 + "$" + 86 characters
  sm3crypt: `$sm3$rounds=5000$saltsalt$${rep('Ab.', 28)}Zz`,
  // crypt(5): "$3$$" + 32 lowercase hexadecimal characters
  'nt-crypt': `$3$$${rep('0f', 16)}`,
  // PostgreSQL pg_authid: SCRAM-SHA-256$<iteration count>:<salt>$<StoredKey>:<ServerKey>
  'pg-scram': `SCRAM-SHA-256$4096:${B64_16}$${B64_32}:${B64_32}`,
  // Spring Security reference, "Password Storage": the identifiers in front of a stored value
  'spring-bcrypt': '{bcrypt}$2a$10$dXJ3SW6G7P50lGmMkkmwe.20cQQubK3.HZWzG3YB1tlRy.fqvM/BG',
  'spring-scrypt': `{scrypt}$e0801$${rep('Ab+/', 20)}==$${rep('Cd+/', 10)}=`,
  'spring-argon2': '{argon2}$argon2id$v=19$m=16384,t=2,p=1$c29tZXNhbHQ$ZGlnZXN0',
  'spring-pbkdf2': `{pbkdf2}${rep('5d', 40)}`,
  'spring-sha256': `{sha256}${rep('97', 40)}`,
  'spring-noop': '{noop}secret text',
  // Microsoft Learn, sys.sql_logins: version byte then the salted hash; salt 8 and digest 40 or 128 hexadecimal characters
  mssql2005: `0x0100${rep('1a', 4)}${rep('b2', 20)}`,
  mssql2012: `0x0200${rep('1a', 4)}${rep('b2', 64)}`,
  // PHC string format: $<id>$<param>=<value>$<salt>$<hash> with an identifier this package does not know
  'phc-unknown': '$mykdf$v=1$n=12$c29tZXNhbHQ$ZGlnZXN0',
};

const ALL_CORPUS = [...CORPUS, ...DJANGO_CORPUS];

it('every recorded corpus string gets its generator format among its candidates', () => {
  expect(CORPUS).toHaveLength(91);
  expect(DJANGO_CORPUS).toHaveLength(6);
  const ruleIds = new Set(RULES.map((r) => r.id));
  const missing: string[] = [];
  const uncovered: string[] = [];
  for (const entry of ALL_CORPUS) {
    const found = identifyLine(entry.string);
    if (entry.rule === null) {
      uncovered.push(entry.generator);
      // A format the table does not cover is never claimed by a marker.
      expect(found.filter((c) => c.tier === 1).map((c) => c.ruleId)).toEqual([]);
      continue;
    }
    expect(ruleIds.has(entry.rule), `${entry.rule} is a rule id`).toBe(true);
    if (!found.some((c) => c.ruleId === entry.rule)) {
      missing.push(
        `${entry.generator}: wanted ${entry.rule}, got ${found.map((c) => c.ruleId).join(',') || 'nothing'}`,
      );
    }
  }
  expect(missing).toEqual([]);
  // The seven formats left out are exactly the ones named in NOT_COVERED_IN_TABLE (matched on the end of the generator name).
  expect(uncovered).toHaveLength(NOT_COVERED_IN_TABLE.length);
  for (const name of NOT_COVERED_IN_TABLE) expect(uncovered.some((g) => g.endsWith(` ${name}`))).toBe(true);
});

it('every rule has a name, a tier, a reason and a source', () => {
  const fired = new Map<string, string>();
  const strings = [...ALL_CORPUS.map((e) => e.string), ...Object.values(SAMPLES)];
  // {CRYPT} wrapped copies of every modular sample, so each wrapper rule has a string too.
  for (const s of strings.slice()) strings.push(`{CRYPT}${s}`);
  for (const s of strings) {
    for (const c of identifyLine(s)) {
      expect(c.name.length).toBeGreaterThan(0);
      expect([1, 2, 3]).toContain(c.tier);
      expect(c.reason.length).toBeGreaterThan(20);
      expect(c.source.length).toBeGreaterThan(3);
      if (!fired.has(c.ruleId)) fired.set(c.ruleId, c.reason);
    }
  }
  const ids = RULES.map((r) => r.id);
  expect(new Set(ids).size).toBe(ids.length); // every rule id is unique
  for (const r of RULES) {
    expect(r.name.length, `${r.id} has a name`).toBeGreaterThan(0);
    expect([1, 2, 3], `${r.id} has a tier`).toContain(r.tier);
    expect(r.source.length, `${r.id} has a source`).toBeGreaterThan(3);
    expect(fired.has(r.id), `${r.id} is fired by a corpus string or a sample`).toBe(true);
  }
  // At least the research table (about 45 formats); the table lists each algorithm and each wrapped crypt format as its own rule.
  expect(RULES.length).toBeGreaterThanOrEqual(45);
  for (const tier of [1, 2, 3]) expect(RULES.some((r) => r.tier === tier)).toBe(true);
});

it('every marker sample is accepted by its rule and refused one character short and one character long', () => {
  // Fixed-width fields: a marker string with one character fewer or more is never listed by its own marker rule.
  const fixed = [
    'bcrypt',
    'md5crypt',
    'apr1',
    'sha256crypt',
    'sha512crypt',
    'sm3crypt',
    'sunmd5',
    'phpass',
    'nt-crypt',
    'bsdicrypt',
    'yescrypt',
    'gost-yescrypt',
    'sm3-yescrypt',
    'scrypt-crypt',
    'mysql41',
    'pg-md5',
    'oracle11',
    'mssql2005',
    'mssql2012',
    'pbkdf2-sha1',
    'pbkdf2-sha256',
    'pbkdf2-sha512',
    'bcrypt-sha256',
    'ldap-pkcs5s2',
    'ldap-sha',
    'ldap-md5',
    'django-pbkdf2-sha256',
    'django-pbkdf2-sha1',
    'django-bcrypt',
    'django-bcrypt-sha256',
    'django-md5',
    'django-sha1',
  ];
  const sampleOf = new Map<string, string>();
  for (const e of ALL_CORPUS) if (e.rule !== null && !sampleOf.has(e.rule)) sampleOf.set(e.rule, e.string);
  for (const [id, s] of Object.entries(SAMPLES)) if (!sampleOf.has(id)) sampleOf.set(id, s);
  for (const id of fixed) {
    const sample = sampleOf.get(id);
    expect(sample, `${id} has a sample`).toBeDefined();
    const text = sample ?? '';
    expect(
      identifyLine(text).some((c) => c.ruleId === id),
      `${id} accepts its sample`,
    ).toBe(true);
    // Last character removed, and one character appended: the field width is wrong either way.
    expect(
      identifyLine(text.slice(0, -1)).some((c) => c.ruleId === id),
      `${id} accepts one character short`,
    ).toBe(false);
    expect(
      identifyLine(`${text}a`).some((c) => c.ruleId === id),
      `${id} accepts one character long`,
    ).toBe(false);
  }
});

it('a run of one repeated character is never listed by a marker rule', () => {
  // A string of one repeated character is not a hash of any marker format: only length rules may list it.
  for (const ch of ['a', 'A', '0', '$', '=', '.', '/']) {
    for (const n of [1, 2, 13, 22, 32, 43, 60, 86, 128, 4096]) {
      const found = identifyLine(ch.repeat(n));
      for (const c of found) expect(c.tier === 1, `${ch} x ${n} is not listed by ${c.ruleId}`).toBe(false);
    }
  }
  const noLines = identifyText(rep('$\n', 10));
  expect(noLines.recognised).toBe(0);
  expect(MAX_LINE_CHARS).toBe(4096);
});
