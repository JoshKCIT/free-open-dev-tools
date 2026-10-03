import { rule, SRC, type HashRule } from './rule';
import { DIGITS, HEX_LOWER, ITOA, classTable, only } from './scan';

/**
 * Rules for strings that carry their own marker: the modular crypt formats of libxcrypt crypt(5), phpass, the PHC string
 * format and the Passlib formats. Each rule is a fixed-length comparison, a limited split or a bounded character-class
 * scan, so its cost grows in proportion to the length of the line. No rule looks anything up by the text it is given in a
 * plain object: identifiers are compared as strings or looked up in a Set.
 */

const PASSLIB = 'Passlib documentation';
const BCRYPT_TYPES: ReadonlySet<string> = new Set(['2', '2a', '2b', '2x', '2y']);
const PHC_VALUE = classTable('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/+.-');
const PHC_NAME = classTable('abcdefghijklmnopqrstuvwxyz0123456789-');
const PHC_ANY = classTable('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/+.-=,$');
const P5K2_VALUE = classTable('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789./+_=-');

/** The piece at index i of a split, or the empty string when there is none. */
function at(fields: readonly string[], i: number): string {
  return fields[i] ?? '';
}

/** A whole number written with digits only and no leading zero: the decimal encoding of the PHC string format. */
function isDecimal(s: string): boolean {
  return s.length > 0 && s.length <= 12 && only(s, DIGITS) && (s.length === 1 || s.charCodeAt(0) !== 48);
}

/** The crypt(5) salt class `[^$:\n]`, for a field that is already known to hold no dollar sign. */
function isSaltText(s: string): boolean {
  return !s.includes(':') && !s.includes('\n');
}

// --- bcrypt -----------------------------------------------------------------------------------------------------------

/**
 * The bcrypt layout of crypt(5), `\$2[abxy]\$[0-9]{2}\$[./A-Za-z0-9]{53}`, written as a fixed-length comparison starting at
 * index `start` (so a prefix such as Django's `bcrypt$` can be skipped without copying the line).
 */
export function bcryptAt(line: string, start = 0): { variant: string; cost: string } | null {
  if (line.length !== start + 60) return null;
  if (line.charCodeAt(start) !== 36 || line.charCodeAt(start + 1) !== 50) return null; // "$2"
  const variant = line.charAt(start + 2);
  if (variant !== 'a' && variant !== 'b' && variant !== 'x' && variant !== 'y') return null;
  if (line.charCodeAt(start + 3) !== 36 || line.charCodeAt(start + 6) !== 36) return null;
  if (!only(line, DIGITS, start + 4, start + 6)) return null;
  if (!only(line, ITOA, start + 7, start + 60)) return null;
  return { variant: `2${variant}`, cost: line.slice(start + 4, start + 6) };
}

/** The sentence that says which marker, cost and fields a bcrypt string was checked for. */
export function bcryptReason(found: { variant: string; cost: string }, lead: string): string {
  const cost = Number(found.cost);
  const range = cost >= 4 && cost <= 31 ? '' : ', outside the 4 to 31 the format allows';
  const note =
    found.variant === '2y'
      ? ' ($2y$ is the same as $2b$ and exists for historical reasons)'
      : found.variant === '2a' || found.variant === '2x'
        ? ' ($2a$ and $2x$ keep compatibility with an older implementation that mishandled characters with the eighth bit set)'
        : '';
  return `${lead}$${found.variant}$, the bcrypt marker${note}, a cost of ${found.cost} (two digits${range}), then 53 characters from ./A-Za-z0-9: a 22-character salt and a 31-character hash.`;
}

const bcrypt = rule('bcrypt', 'bcrypt', 1, SRC.crypt5, (line) => {
  const found = bcryptAt(line);
  return found === null ? null : bcryptReason(found, 'Starts with ');
});

// --- yescrypt, scrypt, SHA-2 and SM3 crypt, SHA-1 crypt, Sun MD5, MD5 crypt, Apache MD5, NT --------------------------------

const SHAPE_ONLY =
  ' This is a check of the layout alone: no string made by a yescrypt generator was available to confirm it against.';

function yescryptFamily(id: string, name: string, marker: string): HashRule {
  return rule(id, name, 1, SRC.crypt5, (line) => {
    if (!line.startsWith(`$${marker}$`)) return null;
    const f = line.split('$', 6); // ['', marker, settings, salt, hash]
    if (f.length !== 5) return null;
    const settings = at(f, 2);
    const salt = at(f, 3);
    const hash = at(f, 4);
    if (!only(settings, ITOA) || salt.length > 86 || (salt.length > 0 && !only(salt, ITOA))) return null;
    if (hash.length !== 43 || !only(hash, ITOA)) return null;
    return `Starts with $${marker}$ (${name}) and has the three fields crypt(5) gives for it: ${settings.length} characters of settings, a salt of ${salt.length} characters (up to 86 are allowed) and a 43-character hash, all from ./A-Za-z0-9.${SHAPE_ONLY}`;
  });
}

const scryptCrypt = rule('scrypt-crypt', 'scrypt ($7$)', 1, SRC.crypt5, (line) => {
  if (!line.startsWith('$7$')) return null;
  const f = line.split('$', 5); // ['', '7', settings and salt, hash]
  if (f.length !== 4) return null;
  const body = at(f, 2);
  const hash = at(f, 3);
  if (body.length < 11 || body.length > 97 || !only(body, ITOA)) return null;
  if (hash.length !== 43 || !only(hash, ITOA)) return null;
  return `Starts with $7$ (scrypt in the crypt format), then ${body.length} characters of settings and salt (11 to 97 are allowed) and a 43-character hash, all from ./A-Za-z0-9.`;
});

function shaCrypt(id: string, name: string, marker: string, hashLength: number): HashRule {
  return rule(id, name, 1, SRC.crypt5, (line) => {
    if (!line.startsWith(`$${marker}$`)) return null;
    const f = line.split('$', 7); // ['', marker, (rounds=N,) salt, hash]
    if (f.length !== 4 && f.length !== 5) return null;
    let k = 2;
    let rounds = '';
    if (f.length === 5) {
      const setting = at(f, 2);
      // rounds=[1-9][0-9]+ : at least two digits, no leading zero
      if (!setting.startsWith('rounds=') || setting.length < 9 || !isDecimal(setting.slice(7))) return null;
      rounds = setting;
      k = 3;
    }
    const salt = at(f, k);
    const hash = at(f, k + 1);
    if (salt.length < 1 || salt.length > 16 || !isSaltText(salt)) return null;
    if (hash.length !== hashLength || !only(hash, ITOA)) return null;
    return `Starts with $${marker}$ (${name}), ${rounds ? `a ${rounds} setting, ` : ''}a salt of ${salt.length} characters (1 to 16 are allowed) and a ${hashLength}-character hash from ./0-9A-Za-z.`;
  });
}

const sha1Crypt = rule('sha1crypt', 'SHA-1 crypt ($sha1$)', 1, `${SRC.crypt5}; ${PASSLIB}, sha1_crypt`, (line) => {
  if (!line.startsWith('$sha1$')) return null;
  const f = line.split('$', 6); // ['', 'sha1', rounds, salt, checksum]
  if (f.length !== 5) return null;
  const rounds = at(f, 2);
  const salt = at(f, 3);
  const checksum = at(f, 4);
  if (!isDecimal(rounds)) return null;
  if (salt.length > 64 || (salt.length > 0 && !only(salt, ITOA))) return null;
  // crypt(5) writes 8 to 64 characters before a 32-character tail; Passlib's documentation and its real output write 28.
  if (checksum.length < 28 || checksum.length > 96 || !only(checksum, ITOA)) return null;
  return `Starts with $sha1$ (SHA-1 crypt), a rounds count of ${rounds}, a salt of ${salt.length} characters (up to 64) and a ${checksum.length}-character checksum from ./0-9A-Za-z (Passlib writes 28 characters, crypt(5) shows a longer form; 28 to 96 are accepted).`;
});

const sunMd5 = rule('sunmd5', 'Sun MD5 crypt ($md5$)', 1, SRC.crypt5, (line) => {
  if (!line.startsWith('$md5')) return null;
  const f = line.split('$', 6); // ['', 'md5' or 'md5,rounds=N', salt, (empty,) hash]
  if (f.length !== 4 && f.length !== 5) return null;
  const id = at(f, 1);
  let rounds = '';
  if (id !== 'md5') {
    if (!id.startsWith('md5,rounds=') || id.length < 13 || !isDecimal(id.slice(11))) return null;
    rounds = id.slice(4 + 1);
  }
  if (f.length === 5 && at(f, 3) !== '') return null; // the optional second dollar sign
  const salt = at(f, 2);
  const hash = at(f, f.length - 1);
  if (salt.length !== 8 || !only(salt, ITOA) || hash.length !== 22 || !only(hash, ITOA)) return null;
  return `Starts with $md5 (Sun MD5), ${rounds ? `a ${rounds} setting, ` : ''}an 8-character salt, ${f.length === 5 ? 'two dollar signs' : 'a dollar sign'} and a 22-character hash from ./0-9A-Za-z.`;
});

function md5Family(id: string, name: string, marker: string, source: string, intro: string): HashRule {
  const prefix = `$${marker}$`;
  return rule(id, name, 1, source, (line) => {
    if (!line.startsWith(prefix)) return null;
    const end = line.indexOf('$', prefix.length);
    if (end < prefix.length + 1 || end - prefix.length > 8) return null; // a salt of 1 to 8 characters
    if (line.length - (end + 1) !== 22 || !only(line, ITOA, end + 1, line.length)) return null;
    const salt = line.slice(prefix.length, end);
    if (!isSaltText(salt)) return null;
    return `Starts with ${prefix}, ${intro}, then a salt of ${salt.length} characters (1 to 8 are allowed), a $ and a 22-character hash from ./0-9A-Za-z.`;
  });
}

const md5Crypt = md5Family('md5crypt', 'MD5 crypt ($1$)', '1', SRC.crypt5, 'the MD5 crypt marker');
const apr1 = md5Family(
  'apr1',
  'Apache MD5 ($apr1$)',
  'apr1',
  SRC.apache,
  'the Apache-specific MD5 marker used in password files',
);

const ntCrypt = rule('nt-crypt', 'NT hash in crypt format ($3$$)', 1, SRC.crypt5, (line) => {
  if (line.length !== 36 || !line.startsWith('$3$$') || !only(line, HEX_LOWER, 4, 36)) return null;
  return 'Starts with $3$$ (the NT hash in crypt format) followed by 32 lowercase hexadecimal characters.';
});

const bsdiCrypt = rule('bsdicrypt', 'BSDi extended DES crypt', 1, SRC.crypt5, (line) => {
  if (line.length !== 20 || line.charCodeAt(0) !== 95 || !only(line, ITOA, 1, 20)) return null;
  return 'Starts with an underscore (the BSDi extended DES marker) followed by 19 characters from ./0-9A-Za-z.';
});

// --- traditional DES crypt and bigcrypt: shapes without a marker ----------------------------------------------------------

const desCrypt = rule('descrypt', 'Traditional DES crypt', 2, SRC.crypt5, (line) => {
  if (line.length !== 13 || !only(line, ITOA)) return null;
  return 'Exactly 13 characters from ./0-9A-Za-z and no marker: the layout of the oldest crypt hash, a 2-character salt and an 11-character hash.';
});

const bigCrypt = rule(
  'bigcrypt',
  'bigcrypt (DES crypt for long passphrases)',
  2,
  `${SRC.crypt5}; ${PASSLIB}, bigcrypt`,
  (line) => {
    const n = line.length;
    // crypt(5): 13 to 178 characters. Passlib: a 2-character salt then one 11-character checksum per 8 passphrase characters.
    if (n < 13 || n > 178 || (n - 2) % 11 !== 0 || !only(line, ITOA)) return null;
    const blocks = (n - 2) / 11;
    return `${n} characters from ./0-9A-Za-z and no marker: a 2-character salt then ${blocks} checksum block${blocks === 1 ? '' : 's'} of 11 characters, one for each 8 characters of the passphrase (crypt(5) allows 13 to 178). A 13-character string is also exactly a traditional DES crypt string.`;
  },
);

// --- phpass ---------------------------------------------------------------------------------------------------------------

const phpass = rule(
  'phpass',
  'phpass portable hash ($P$ or $H$)',
  1,
  'phpass (Openwall, openwall.com/phpass); Passlib documentation, phpass',
  (line) => {
    if (line.length !== 34 || line.charCodeAt(0) !== 36 || line.charCodeAt(2) !== 36) return null;
    const marker = line.charAt(1);
    if (marker !== 'P' && marker !== 'H') return null;
    if (!only(line, ITOA, 3, 34)) return null;
    return `Starts with $${marker}$ and is exactly 34 characters: one character for the iteration count, an 8-character salt and a 22-character hash, all from ./0-9A-Za-z (used by WordPress and phpBB).`;
  },
);

// --- Argon2 and scrypt in PHC strings -----------------------------------------------------------------------------------

export interface Argon2Fields {
  variant: string;
  version: string | null;
  memory: string;
  time: string;
  parallelism: string;
}

/**
 * The fields of an Argon2 string in the PHC layout, `argon2id$v=19$m=65536,t=3,p=4$salt$hash`, from a split on dollar signs
 * in which the variant is at index 1 (a PHC string has an empty first piece; a Django string has `argon2` there).
 */
export function argon2Fields(f: readonly string[]): Argon2Fields | null {
  const id = at(f, 1);
  if (id !== 'argon2i' && id !== 'argon2d' && id !== 'argon2id') return null;
  let i = 2;
  let version: string | null = null;
  const v = at(f, i);
  if (v.startsWith('v=')) {
    version = v.slice(2);
    if (!isDecimal(version)) return null;
    i++;
  }
  if (f.length !== i + 3) return null;
  const params = at(f, i).split(',', 4);
  if (params.length !== 3) return null;
  const m = at(params, 0);
  const t = at(params, 1);
  const p = at(params, 2);
  if (!m.startsWith('m=') || !t.startsWith('t=') || !p.startsWith('p=')) return null;
  const memory = m.slice(2);
  const time = t.slice(2);
  const parallelism = p.slice(2);
  if (!isDecimal(memory) || !isDecimal(time) || !isDecimal(parallelism)) return null;
  if (!only(at(f, i + 1), PHC_VALUE) || !only(at(f, i + 2), PHC_VALUE)) return null;
  return { variant: id, version, memory, time, parallelism };
}

export function argon2Reason(found: Argon2Fields, lead: string): string {
  const name = found.variant.slice(0, 1).toUpperCase() + found.variant.slice(1);
  return `${lead}$${found.variant}$ (${name}), ${found.version === null ? 'no version field' : `version ${found.version}`}, the m=${found.memory}, t=${found.time}, p=${found.parallelism} cost parameters, then a salt and a hash written in the PHC string layout.`;
}

function argon2Rule(variant: 'i' | 'd' | 'id'): HashRule {
  const id = `argon2${variant}`;
  return rule(id, `Argon2${variant} (PHC string)`, 1, `${SRC.phc}; ${SRC.rfc9106}`, (line) => {
    if (!line.startsWith(`$${id}$`)) return null;
    const found = argon2Fields(line.split('$', 8));
    return found === null ? null : argon2Reason(found, 'Starts with ');
  });
}

const scryptPhc = rule('scrypt-phc', 'scrypt (PHC string)', 1, `${SRC.phc}; ${PASSLIB}, scrypt`, (line) => {
  if (!line.startsWith('$scrypt$')) return null;
  const f = line.split('$', 6); // ['', 'scrypt', 'ln=..,r=..,p=..', salt, hash]
  if (f.length !== 5) return null;
  const params = at(f, 2).split(',', 4);
  if (params.length !== 3) return null;
  const ln = at(params, 0);
  const r = at(params, 1);
  const p = at(params, 2);
  if (!ln.startsWith('ln=') || !r.startsWith('r=') || !p.startsWith('p=')) return null;
  if (!isDecimal(ln.slice(3)) || !isDecimal(r.slice(2)) || !isDecimal(p.slice(2))) return null;
  if (!only(at(f, 3), PHC_VALUE) || !only(at(f, 4), PHC_VALUE)) return null;
  return `Starts with $scrypt$ and carries the ln=${ln.slice(3)}, r=${r.slice(2)}, p=${p.slice(2)} cost parameters, then a salt and a hash written in the PHC string layout.`;
});

// --- Passlib's own modular formats ---------------------------------------------------------------------------------------

function pbkdf2Rule(id: string, marker: string, digest: string, checksumLength: number): HashRule {
  return rule(
    id,
    `PBKDF2-HMAC-${digest} ($${marker}$)`,
    1,
    `${PASSLIB}, pbkdf2_digest ("$pbkdf2-digest$rounds$salt$checksum")`,
    (line) => {
      if (!line.startsWith(`$${marker}$`)) return null;
      const f = line.split('$', 6); // ['', marker, rounds, salt, checksum]
      if (f.length !== 5) return null;
      const rounds = at(f, 2);
      if (!isDecimal(rounds) || !only(at(f, 3), ITOA)) return null;
      const checksum = at(f, 4);
      if (checksum.length !== checksumLength || !only(checksum, ITOA)) return null;
      return `Starts with $${marker}$ (PBKDF2 with HMAC-${digest}), ${rounds} rounds, a salt and a ${checksumLength}-character checksum in Passlib's adapted Base64 (./0-9A-Za-z, no padding).`;
    },
  );
}

const bcryptSha256 = rule(
  'bcrypt-sha256',
  'bcrypt-sha256 (Passlib)',
  1,
  `${PASSLIB}, bcrypt_sha256 ("$bcrypt-sha256$v=2,t=2b,r=12$salt$digest")`,
  (line) => {
    if (!line.startsWith('$bcrypt-sha256$')) return null;
    const f = line.split('$', 6); // ['', 'bcrypt-sha256', settings, salt, digest]
    if (f.length !== 5) return null;
    const settings = at(f, 2).split(',', 4);
    let type: string;
    let rounds: string;
    let version: string;
    if (
      settings.length === 3 &&
      at(settings, 0).startsWith('v=') &&
      at(settings, 1).startsWith('t=') &&
      at(settings, 2).startsWith('r=')
    ) {
      version = at(settings, 0).slice(2);
      type = at(settings, 1).slice(2);
      rounds = at(settings, 2).slice(2);
    } else if (settings.length === 2) {
      version = '1';
      type = at(settings, 0);
      rounds = at(settings, 1);
    } else return null;
    if (!isDecimal(version) || !isDecimal(rounds) || !BCRYPT_TYPES.has(type)) return null;
    if (at(f, 3).length !== 22 || !only(at(f, 3), ITOA) || at(f, 4).length !== 31 || !only(at(f, 4), ITOA)) return null;
    return `Starts with $bcrypt-sha256$ (bcrypt over a SHA-256 pre-hash), format version ${version}, bcrypt type ${type}, ${rounds} rounds, a 22-character salt and a 31-character digest.`;
  },
);

const scram = rule(
  'scram',
  'SCRAM hash (Passlib)',
  1,
  `${PASSLIB}, scram ("$scram$rounds$salt$alg1=digest1,alg2=digest2")`,
  (line) => {
    if (!line.startsWith('$scram$')) return null;
    const f = line.split('$', 6); // ['', 'scram', rounds, salt, pairs]
    if (f.length !== 5) return null;
    if (!isDecimal(at(f, 2)) || !only(at(f, 3), ITOA)) return null;
    const pairs = at(f, 4).split(',', 17);
    if (pairs.length > 16) return null;
    const names: string[] = [];
    for (const pair of pairs) {
      const eq = pair.indexOf('=');
      if (eq < 1 || !only(pair, PHC_NAME, 0, eq) || !only(pair, ITOA, eq + 1, pair.length)) return null;
      names.push(pair.slice(0, eq));
    }
    return `Starts with $scram$, a rounds count of ${at(f, 2)}, a salt and ${names.length} algorithm=digest pair${names.length === 1 ? '' : 's'} (${names.join(', ')}).`;
  },
);

const p5k2 = rule(
  'p5k2',
  'PBKDF2-HMAC-SHA1 ($p5k2$)',
  1,
  `${PASSLIB}, cta_pbkdf2_sha1 and dlitz_pbkdf2_sha1 ("$p5k2$rounds$salt$checksum")`,
  (line) => {
    if (!line.startsWith('$p5k2$')) return null;
    const f = line.split('$', 6); // ['', 'p5k2', rounds in hexadecimal, salt, checksum]
    if (f.length !== 5) return null;
    const rounds = at(f, 2);
    if (rounds.length < 1 || rounds.length > 8 || !only(rounds, HEX_LOWER)) return null;
    if (!only(at(f, 3), P5K2_VALUE) || !only(at(f, 4), P5K2_VALUE)) return null;
    return `Starts with $p5k2$ (an older PBKDF2-HMAC-SHA1 format), a rounds count of ${rounds} written in hexadecimal, a salt and a ${at(f, 4).length}-character checksum.`;
  },
);

// --- a PHC or modular string whose identifier this page does not know -----------------------------------------------------

/** Every identifier the rules above recognise, so that a string with one of them and a wrong layout is never "unknown". */
const KNOWN_IDS: ReadonlySet<string> = new Set([
  'y',
  'gy',
  'sm3y',
  '7',
  '2a',
  '2b',
  '2x',
  '2y',
  '6',
  '5',
  'sm3',
  'sha1',
  'md5',
  '1',
  'apr1',
  '3',
  'argon2i',
  'argon2d',
  'argon2id',
  'scrypt',
  'pbkdf2',
  'pbkdf2-sha256',
  'pbkdf2-sha512',
  'bcrypt-sha256',
  'scram',
  'p5k2',
]);

const phcUnknown = rule('phc-unknown', 'A $id$ string in the PHC or crypt layout', 2, SRC.phc, (line) => {
  if (line.charCodeAt(0) !== 36) return null;
  const end = line.indexOf('$', 1);
  if (end < 2 || end - 1 > 32) return null;
  const id = line.slice(1, end);
  if (!only(id, PHC_NAME) || KNOWN_IDS.has(id)) return null;
  if (end + 1 >= line.length || !only(line, PHC_ANY, end + 1, line.length)) return null;
  return `Begins $${id}$ and the rest uses only the characters a PHC string allows (letters, digits and / + . - = , $), the layout of a PHC or modular crypt string, but ${id} is not an identifier this page knows.`;
});

/** The modular and PHC rules, in the order of the rule table. */
export const MODULAR_RULES: readonly HashRule[] = [
  yescryptFamily('yescrypt', 'yescrypt ($y$)', 'y'),
  yescryptFamily('gost-yescrypt', 'gost-yescrypt ($gy$)', 'gy'),
  yescryptFamily('sm3-yescrypt', 'sm3-yescrypt ($sm3y$)', 'sm3y'),
  scryptCrypt,
  bcrypt,
  shaCrypt('sha512crypt', 'SHA-512 crypt ($6$)', '6', 86),
  shaCrypt('sha256crypt', 'SHA-256 crypt ($5$)', '5', 43),
  shaCrypt('sm3crypt', 'SM3 crypt ($sm3$)', 'sm3', 86),
  sha1Crypt,
  sunMd5,
  md5Crypt,
  apr1,
  ntCrypt,
  bsdiCrypt,
  phpass,
  argon2Rule('i'),
  argon2Rule('d'),
  argon2Rule('id'),
  scryptPhc,
  pbkdf2Rule('pbkdf2-sha1', 'pbkdf2', 'SHA-1', 27),
  pbkdf2Rule('pbkdf2-sha256', 'pbkdf2-sha256', 'SHA-256', 43),
  pbkdf2Rule('pbkdf2-sha512', 'pbkdf2-sha512', 'SHA-512', 86),
  bcryptSha256,
  scram,
  p5k2,
  phcUnknown,
  desCrypt,
  bigCrypt,
];
