import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HashIdentifierError, MAX_ROWS, RULES, identifyLine, identifyText } from '../src/index';
import { CORPUS, DJANGO_CORPUS } from './fixtures/corpus';

/**
 * Expected values come only from published layouts and from strings made by independent generators: the libxcrypt
 * crypt(5) manual gives the bcrypt layout ("$2[abxy]$[0-9]{2}$" then 53 characters: a 22-character salt and a 31-character
 * hash) and the MD5 crypt layout ("$1$", a salt of up to 8 characters, "$", 22 characters); RFC 1321 gives MD5 as 128 bits.
 * The literals below were recorded from the OpenSSL command line and from passlib 1.7.4 over pyca bcrypt 4.0.1 (see
 * test/fixtures/README.md). Nothing here is computed by the code under test.
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

// passlib 1.7.4 bcrypt (pyca bcrypt 4.0.1 backend), cost 12, recorded 2026-10-03.
const BCRYPT_12 = '$2b$12$/vy7ZxGf2E2ffCTmkTnBvuDt80597OVIwFjbo1fXcIr3u/A2b22tC';
// OpenSSL 3.5.5 passwd -1 -salt saltsalt, recorded 2026-10-03.
const MD5_CRYPT = '$1$saltsalt$qjXMvbEw8oaL.CzflDtaK/';
// Python hashlib md5 of a short sample text: 32 hexadecimal characters.
const MD5_HEX = '5f4dcc3b5aa765d61d8327deb882cf99';

it('a bcrypt string is a marker candidate whose reason names the marker, the cost and both fields', () => {
  const found = identifyLine(BCRYPT_12);
  const first = found[0];
  expect(first).toBeDefined();
  expect(first?.ruleId).toBe('bcrypt');
  expect(first?.tier).toBe(1);
  expect(first?.reason).toContain('$2b$');
  expect(first?.reason).toContain('cost of 12');
  expect(first?.reason).toContain('22-character salt');
  expect(first?.reason).toContain('31-character hash');
  expect(first?.source).toContain('crypt(5)');
  // A marker string fits no other format.
  expect(found.map((c) => c.ruleId)).toEqual(['bcrypt']);
});

it('an MD5 crypt string is a marker candidate', () => {
  const found = identifyLine(MD5_CRYPT);
  expect(found[0]?.ruleId).toBe('md5crypt');
  expect(found[0]?.tier).toBe(1);
  expect(found[0]?.reason).toContain('$1$');
  expect(found[0]?.reason).toContain('22-character hash');
  expect(found[0]?.source).toContain('crypt(5)');
});

it('32 hex characters list MD5, NTLM and MD4 in that order with the no-label sentence', () => {
  const found = identifyLine(MD5_HEX);
  expect(found.slice(0, 3).map((c) => c.ruleId)).toEqual(['md5', 'ntlm', 'md4']);
  // Every algorithm of exactly this length, and nothing else, in the stated order.
  expect(found.map((c) => c.ruleId)).toEqual(['md5', 'ntlm', 'md4', 'lm', 'md2', 'ripemd128']);
  for (const c of found) expect(c.tier).toBe(3);
  const result = identifyText(MD5_HEX);
  expect(result.notes).toEqual([
    'A bare hex string carries no label; these are the algorithms that produce exactly this length, in the order they are most often met. Several are always possible.',
  ]);
});

it('a bcrypt string one character short is not a bcrypt candidate', () => {
  // The crypt(5) layout is exactly 53 characters after the cost; a 52 character body is not it.
  const short = BCRYPT_12.slice(0, -1);
  expect(short.length).toBe(59);
  expect(identifyLine(short).map((c) => c.ruleId)).not.toContain('bcrypt');
  expect(identifyLine(short)).toEqual([]);
  // One character too long is not it either.
  expect(identifyLine(BCRYPT_12 + 'a').map((c) => c.ruleId)).not.toContain('bcrypt');
  const result = identifyText(short);
  expect(result.lines[0]?.status).toBe('not-recognised');
  expect(result.lines[0]?.message).toContain('matches no rule');
});

it('an empty paste gives no lines and blank lines are counted', () => {
  expect(identifyText('')).toMatchObject({ lines: [], blank: 0, read: 0, recognised: 0, notRecognised: 0 });
  // Each line break ends a line; the last break does not start another one.
  const blanks = identifyText('\n\n  \n\t\n');
  expect(blanks.lines).toEqual([]);
  expect(blanks.blank).toBe(4);
  const mixed = identifyText(`${MD5_CRYPT}\n\n${BCRYPT_12}\r\n   \n`);
  expect(mixed.blank).toBe(2);
  expect(mixed.read).toBe(2);
  expect(mixed.lines.map((l) => l.number)).toEqual([1, 3]);
  expect(mixed.lines.map((l) => l.candidates[0]?.ruleId)).toEqual(['md5crypt', 'bcrypt']);
});

// ----- Task 2: the full rule table, the limits, encoding and ordering ------------------------------------------------------

const RULE_ORDER = new Map(RULES.map((r, i) => [r.id, i]));

function corpusString(generatorSuffix: string): string {
  const found = CORPUS.find((e) => e.generator.endsWith(` ${generatorSuffix}`));
  expect(found, `${generatorSuffix} is in the corpus`).toBeDefined();
  return found?.string ?? '';
}

const ids = (line: string): string[] => identifyLine(line).map((c) => c.ruleId);

it('the SHA-1 crypt rule accepts the 28 character checksums real generators write', () => {
  // passlib 1.7.4 sha1_crypt (its documentation says "checksum is 28 characters"): 8 character salt, 28 character checksum.
  const real = corpusString('sha1_crypt');
  expect(real.split('$')[4]).toHaveLength(28);
  expect(ids(real)).toContain('sha1crypt');
  const first = identifyLine(real).find((c) => c.ruleId === 'sha1crypt');
  expect(first?.tier).toBe(1);
  expect(first?.reason).toContain('28-character checksum');
  // libxcrypt crypt(5) writes the checksum as 8 to 64 characters followed by 32: 40 to 96 characters in all.
  expect(ids(`$sha1$480000$07Wsc/Bv$${'a'.repeat(40)}`)).toContain('sha1crypt');
  expect(ids(`$sha1$480000$07Wsc/Bv$${'a'.repeat(96)}`)).toContain('sha1crypt');
  // Fewer than 28 or more than 96 characters, a rounds count with a leading zero or a salt over 64 characters is not it.
  expect(ids(`$sha1$480000$07Wsc/Bv$${'a'.repeat(27)}`)).not.toContain('sha1crypt');
  expect(ids(`$sha1$480000$07Wsc/Bv$${'a'.repeat(97)}`)).not.toContain('sha1crypt');
  expect(ids(`$sha1$0480000$07Wsc/Bv$${'a'.repeat(28)}`)).not.toContain('sha1crypt');
  expect(ids(`$sha1$480000$${'s'.repeat(65)}$${'a'.repeat(28)}`)).not.toContain('sha1crypt');
});

it('LDAP tags are identified by tag and decoded length and a CRYPT tag identifies the inner string too', () => {
  const b64 = (bytes: number): string => Buffer.alloc(bytes, 0x5a).toString('base64');
  // RFC 2307 section 5.3 and slappasswd(8): {SHA} and {MD5} wrap the Base64 of a bare digest, {SSHA} and {SMD5} of the
  // digest followed by the salt. The decoded length decides, so one byte too many or too few is not the format.
  expect(ids(`{SHA}${b64(20)}`)).toContain('ldap-sha');
  expect(ids(`{SHA}${b64(21)}`)).not.toContain('ldap-sha');
  expect(ids(`{SHA}${b64(19)}`)).not.toContain('ldap-sha');
  expect(ids(`{MD5}${b64(16)}`)).toContain('ldap-md5');
  expect(ids(`{MD5}${b64(20)}`)).not.toContain('ldap-md5');
  expect(ids(`{SSHA}${b64(24)}`)).toContain('ldap-ssha');
  expect(ids(`{SSHA}${b64(20)}`)).not.toContain('ldap-ssha');
  expect(ids(`{SMD5}${b64(20)}`)).toContain('ldap-smd5');
  expect(ids(`{SMD5}${b64(16)}`)).not.toContain('ldap-smd5');
  const salted = identifyLine(`{SSHA}${b64(24)}`).find((c) => c.ruleId === 'ldap-ssha');
  expect(salted?.reason).toContain('20-byte SHA-1 digest followed by 4 bytes of salt');
  // The scheme name is case-insensitive in RFC 2307 (its example is written {crypt}).
  expect(ids(`{sha}${b64(20)}`)).toContain('ldap-sha');
  expect(ids(`{SHA}${b64(20)}`)).toEqual(['ldap-sha']);
  // A bad Base64 body (a character outside the alphabet, bare padding) is not a digest.
  expect(ids(`{SHA}${b64(20).slice(0, -1)}*`)).not.toContain('ldap-sha');
  expect(ids('{SHA}====')).toEqual([]);
  // {CRYPT}: the wrapper is listed, and so is the crypt format of the string inside it.
  const wrapped = identifyLine(`{CRYPT}${corpusString('passwd -1')}`);
  expect(wrapped.map((c) => c.ruleId)).toEqual(['ldap-crypt', 'ldap-crypt/md5crypt']);
  expect(wrapped[1]?.reason.startsWith('Inside {CRYPT}: ')).toBe(true);
  // RFC 2307's own example value: a traditional DES crypt string inside {crypt}.
  // (13 characters are also the first block of a bigcrypt string, so that wrapper is listed after it.)
  expect(ids('{crypt}X5/DBrWPOQQaI')).toEqual(['ldap-crypt', 'ldap-crypt/descrypt', 'ldap-crypt/bigcrypt']);
  expect(ids('{CRYPT}')).toEqual([]);
});

const HEX_LISTS: [number, string[]][] = [
  [8, ['crc32', 'adler32']],
  [16, ['mysql323', 'oracle10']],
  [32, ['md5', 'ntlm', 'md4', 'lm', 'md2', 'ripemd128']],
  [40, ['sha1', 'ripemd160']],
  [56, ['sha224', 'sha3-224', 'sha512-224']],
  [64, ['sha256', 'sha3-256', 'keccak256', 'blake2s', 'blake3', 'sha512-256']],
  [96, ['sha384', 'sha3-384']],
  [128, ['sha512', 'sha3-512', 'blake2b', 'whirlpool']],
];

// The digest lists only: the two crypt shapes with no marker (descrypt, bigcrypt) are length-only too since review finding
// B-WR-04, and a 57 character string of ./0-9A-Za-z has the length of a bigcrypt string. They are tested in review.test.ts.
const lengthOnly = (line: string): string[] =>
  identifyLine(line)
    .filter((c) => c.tier === 3 && c.ruleId !== 'descrypt' && c.ruleId !== 'bigcrypt')
    .map((c) => c.ruleId);

it('hex lengths at and beside each boundary give disjoint lists in the stated order', () => {
  const seen = new Set<string>();
  for (const [n, expected] of HEX_LISTS) {
    // At the length: every algorithm of that length, in the stated order, and nothing else of tier 3.
    expect(lengthOnly('a'.repeat(n)), `${n} hexadecimal characters`).toEqual(expected);
    expect(lengthOnly('0123456789abcdef'.repeat(8).slice(0, n))).toEqual(expected);
    // Upper case is the same list, and the reason says the case does not change the value.
    expect(lengthOnly('A'.repeat(n))).toEqual(expected);
    expect(identifyLine('A'.repeat(n))[0]?.reason).toContain('upper case');
    // One character beside it, either way: nothing of any digest length.
    expect(lengthOnly('a'.repeat(n - 1)), `${n - 1} hexadecimal characters`).toEqual([]);
    expect(lengthOnly('a'.repeat(n + 1)), `${n + 1} hexadecimal characters`).toEqual([]);
    // A single character that is not hexadecimal breaks it.
    expect(lengthOnly(`${'a'.repeat(n - 1)}g`)).toEqual([]);
    for (const id of expected) {
      expect(seen.has(id), `${id} is listed for one length only`).toBe(false);
      seen.add(id);
    }
  }
  // The three lengths the plan names: 31 and 33 list nothing and 32 lists all six of its algorithms.
  expect(lengthOnly('a'.repeat(31))).toEqual([]);
  expect(lengthOnly('a'.repeat(32))).toHaveLength(6);
  expect(lengthOnly('a'.repeat(33))).toEqual([]);
});

it('Base64 digests are listed by length with or without padding and as Base64 or Base64url', () => {
  const cases: [number, string][] = [
    [16, 'b64-md5'],
    [20, 'b64-sha1'],
    [32, 'b64-sha256'],
    [64, 'b64-sha512'],
  ];
  for (const [bytes, id] of cases) {
    // 0xfb bytes give the characters + and / in the standard alphabet and - and _ in the URL-safe one.
    const standard = Buffer.alloc(bytes, 0xfb).toString('base64');
    const url = Buffer.alloc(bytes, 0xfb).toString('base64url');
    expect(lengthOnly(standard), `${bytes} bytes padded`).toEqual([id]);
    expect(lengthOnly(standard.split('=').join('')), `${bytes} bytes unpadded`).toEqual([id]);
    expect(lengthOnly(url), `${bytes} bytes as Base64url`).toEqual([id]);
    // The wrong amount of padding is not a digest of this size.
    expect(lengthOnly(`${standard}=`)).toEqual([]);
    expect(lengthOnly(`${standard.slice(0, -1)}A`)).toEqual([]);
  }
  // Both alphabets in one string, and an equals sign inside the text, are neither.
  expect(lengthOnly(`+${'a'.repeat(20)}-${'b'.repeat(21)}`)).toEqual([]);
  expect(lengthOnly(`${'a'.repeat(10)}=${'a'.repeat(11)}`)).toEqual([]);
  const notes = identifyText(Buffer.alloc(32, 0xfb).toString('base64')).notes;
  expect(notes).toHaveLength(1);
  expect(notes[0]).toContain('A bare Base64 string carries no label either');
});

it('non-ASCII lines are not hash strings and prototype names are not recognised', () => {
  const E_ACUTE = String.fromCharCode(0xe9);
  const NBSP = String.fromCharCode(0xa0);
  const ZWSP = String.fromCharCode(0x200b);
  const NUL = String.fromCharCode(0);
  const hex = '5f4dcc3b5aa765d61d8327deb882cf99';
  const odd = [
    `caf${E_ACUTE}`,
    `${hex}${E_ACUTE}`,
    `${NBSP}${hex}`, // a no-break space is not trimmed
    `${ZWSP}${hex}`, // a zero-width space is not trimmed
    `\f${hex}`, // a form feed is not trimmed
    `${hex.slice(0, 16)}\t${hex.slice(16)}`, // a tab inside the line
    `${hex.slice(0, 16)}\rabc${hex.slice(16)}`, // a carriage return not followed by a line feed
    NUL,
  ];
  for (const line of odd) {
    const result = identifyText(line);
    expect(result.lines[0]?.status, JSON.stringify(line)).toBe('not-ascii');
    expect(result.lines[0]?.candidates).toEqual([]);
    expect(result.lines[0]?.message).toContain('not printable ASCII');
    expect(result.recognised).toBe(0);
    for (const ch of result.lines[0]?.preview ?? '') {
      expect(ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) <= 0x7e).toBe(true);
    }
    expect(identifyLine(line)).toEqual([]);
  }
  // Only spaces and tabs are trimmed; line feed and carriage return plus line feed end a line; lengths are of the trimmed line.
  const trimmed = identifyText(`  \t${hex} \t\r\n${hex}\n`);
  expect(trimmed.lines.map((l) => [l.number, l.length, l.status])).toEqual([
    [1, 32, 'ok'],
    [2, 32, 'ok'],
  ]);
  // Prototype names and property names are plain text: no candidate, no crash, no lookup in an object.
  const names = [
    '__proto__',
    'constructor',
    'toString',
    'hasOwnProperty',
    'valueOf',
    'prototype',
    '{__proto__}abc',
    '{constructor}abc',
    '{toString}abc',
    'constructor$1$salt$hash',
    '__proto__$1$salt$hash',
    'toString:1:2$salt$abcd',
    'pbkdf2:constructor:1$salt$abcd',
    '$__proto__$a$b',
    '$toString$a$b',
  ];
  for (const name of names) {
    const result = identifyText(name);
    expect(result.lines[0]?.status, name).toBe('not-recognised');
    expect(result.lines[0]?.candidates, name).toEqual([]);
  }
  // A lower-case identifier that merely looks like a property name is just an unknown PHC identifier, with its name in the reason.
  const unknown = identifyLine('$constructor$a$b');
  expect(unknown.map((c) => c.ruleId)).toEqual(['phc-unknown']);
  expect(unknown[0]?.reason).toContain('constructor');
});

it('the same paste gives the same candidates in the same order', () => {
  const lines = [...CORPUS, ...DJANGO_CORPUS].map((e) => e.string);
  const text = lines.join('\n');
  const first = identifyText(text);
  const second = identifyText(text);
  expect(second).toEqual(first);
  // Within a line the candidates are sorted by tier and then by the position of their rule in the table (a stable sort).
  for (const line of first.lines) {
    for (let i = 1; i < line.candidates.length; i++) {
      const before = line.candidates[i - 1];
      const after = line.candidates[i];
      if (before === undefined || after === undefined) continue;
      if (before.tier === after.tier) {
        expect(RULE_ORDER.get(before.ruleId) ?? -1).toBeLessThan(RULE_ORDER.get(after.ruleId) ?? -1);
      } else expect(before.tier).toBeLessThan(after.tier);
    }
  }
  // The order of the lines in the paste does not change what a line gets.
  const reversed = identifyText([...lines].reverse().join('\n'));
  const byLine = new Map(first.lines.map((l, i) => [lines[i], l.candidates]));
  reversed.lines.forEach((l, i) => {
    expect(l.candidates).toEqual(byLine.get(lines[lines.length - 1 - i]));
  });
  // Two length-only shapes of 13 characters keep their table order.
  expect(ids('6qs9wy8aNfoKQ')).toEqual(['descrypt', 'bigcrypt']);
});

/** A line of exactly 4096 characters that starts with `prefix` and is filled with `unit`. */
function fill(prefix: string, unit: string): string {
  return (prefix + unit.repeat(Math.ceil(4096 / unit.length))).slice(0, 4096);
}

const HOSTILE = [
  '$'.repeat(4096),
  `${'='.repeat(4095)}a`,
  'a'.repeat(4096),
  '= '.repeat(2048),
  fill('$2b$12$', 'a'),
  fill('{', 'A'),
  fill('{SSHA}', 'A'),
  // Reaches the padding count of the LDAP rules (the body length is a multiple of 4): a run of equals signs, then one letter.
  `{SHA}${'='.repeat(4087)}a`,
  `{SMD5}${'='.repeat(4086)}a`,
  fill('{CRYPT}', '$'),
  fill('{CRYPT}$6$rounds=', '1'),
  fill('{PBKDF2}1$', 'a$'),
  fill('$6$rounds=', '1'),
  fill('$argon2id$v=19$m=', '1'),
  fill('$scrypt$ln=1,r=1,p=1$', 'a$'),
  fill('$pbkdf2-sha256$1$', 'a'),
  fill('$sha1$1$', 'a'),
  fill('$', 'a$'),
  fill('scrypt:', '1:'),
  fill('pbkdf2:sha256:1$', 'a'),
  fill('SCRAM-SHA-256$1:', 'A:'),
  fill('=', '=A'),
  fill('0x0200', 'f'),
  fill('md5', 'f'),
  fill('_', 'a'),
  fill('$md5,rounds=1$', '$'),
  fill('bcrypt_sha256$$2b$12$', 'a'),
];

/** Lines that make several rules scan the whole line: a long run after a plausible start, and a run of equals signs. */
const HEAVY = [
  fill('$a$', 'a$'),
  fill('$mykdf$', 'A'),
  `{SSHA}${'A'.repeat(4087)}=`,
  `{SMD5}${'A'.repeat(4087)}=`,
  `{SHA}${'='.repeat(4087)}a`,
  `{MD5}${'='.repeat(4088)}`,
];

it('1000 hostile lines of 4096 characters are identified in linear time', () => {
  for (const line of [...HOSTILE, ...HEAVY]) {
    expect(line.length).toBeGreaterThanOrEqual(4093);
    expect(line.length).toBeLessThanOrEqual(4096);
  }
  const lines: string[] = [];
  // Half the lines are the heavy ones, so a rule that scans the line more than once per character shows up at once.
  for (let i = 0; i < 1000; i++) {
    lines.push((i % 2 === 0 ? HEAVY[(i / 2) % HEAVY.length] : HOSTILE[((i - 1) / 2) % HOSTILE.length]) ?? '');
  }
  // The paste limit (262,144 characters) is a sixteenth of 1000 lines of 4096, so the 1000 lines go through identifyLine,
  // which is the whole of the identification; pastes at the limit go through identifyText below. The clock is read around
  // the identification only, and every expectation comes after the second reading.
  const startLines = performance.now();
  let found = 0;
  for (const line of lines) found += identifyLine(line).length;
  const elapsedLines = performance.now() - startLines;

  const paste = [...HEAVY, ...HOSTILE].join('\n');
  const startText = performance.now();
  let pasteLines = 0;
  for (let i = 0; i < 40; i++) pasteLines += identifyText(paste).read;
  const elapsedText = performance.now() - startText;

  expect(found).toBeGreaterThanOrEqual(0);
  expect(elapsedLines).toBeLessThan(2000);
  expect(paste.length).toBeLessThanOrEqual(262144);
  expect(pasteLines).toBe(40 * (HEAVY.length + HOSTILE.length));
  expect(elapsedText).toBeLessThan(2000);
}, 60_000);

it('pastes over the character or line limit are refused and rows stop at 2000 with a note', () => {
  // The character limit is 262,144 characters, counted before any line is split.
  expect(() => identifyText('a'.repeat(262145))).toThrow(HashIdentifierError);
  expect(() => identifyText('a'.repeat(262145))).toThrow(
    'This paste is 262,145 characters. The limit is 262,144 because longer pastes are not lists of hashes.',
  );
  const atLimit = identifyText('a'.repeat(262144));
  expect(atLimit.lines[0]?.status).toBe('too-long');
  expect(atLimit.lines[0]?.message).toContain('4,096');
  // The line limit is 1,000 lines; a final line break does not start another.
  const thousand = Array.from({ length: 1000 }, () => '5f4dcc3b5aa765d61d8327deb882cf99');
  expect(identifyText(thousand.join('\n')).read).toBe(1000);
  expect(identifyText(`${thousand.join('\n')}\n`).read).toBe(1000);
  expect(() => identifyText(`${thousand.join('\n')}\nx`)).toThrow('This paste has 1,001 lines. The limit is 1,000.');
  expect(identifyText('\n'.repeat(1000)).blank).toBe(1000);
  expect(() => identifyText('\n'.repeat(1001))).toThrow('This paste has 1,001 lines. The limit is 1,000.');
  // A line of 4,096 characters is read; one of 4,097 is reported as too long to be a hash.
  expect(identifyText('a'.repeat(4096)).lines[0]?.status).toBe('not-recognised');
  const tooLong = identifyText('a'.repeat(4097));
  expect(tooLong.lines[0]?.status).toBe('too-long');
  expect(tooLong.lines[0]?.candidates).toEqual([]);
  expect(tooLong.lines[0]?.message).toBe(
    'This line is 4,097 characters. A hash string is at most 4,096 characters, so it is not read.',
  );
  expect(tooLong.notRecognised).toBe(1);
  // 1000 lines of 32 hexadecimal characters have six candidates each: the table stops at 2,000 rows with a note and the
  // counts still cover every line.
  const many = identifyText(thousand.join('\n'));
  const rows = many.lines.reduce((sum, l) => sum + Math.max(1, l.candidates.length), 0);
  expect(rows).toBeLessThanOrEqual(MAX_ROWS);
  expect(rows).toBeGreaterThan(MAX_ROWS - 6);
  expect(many.lines).toHaveLength(333);
  expect(many.read).toBe(1000);
  expect(many.recognised).toBe(1000);
  expect(many.warnings).toEqual(['The table stops at 2,000 rows. 667 more lines are read and counted but not listed.']);
  // Under the cap nothing is left out and there is no warning.
  expect(identifyText(thousand.slice(0, 100).join('\n')).warnings).toEqual([]);
});

it('lines split on line feed and on carriage return with line feed and nothing else', () => {
  const md5 = '5f4dcc3b5aa765d61d8327deb882cf99';
  const result = identifyText(`${md5}\r\n${md5}\n\n${md5}\r\n`);
  expect(result.lines.map((l) => l.number)).toEqual([1, 2, 4]);
  expect(result.blank).toBe(1);
  expect(result.lines.map((l) => l.status)).toEqual(['ok', 'ok', 'ok']);
  // The preview is the first 12 characters.
  expect(result.lines[0]?.preview).toBe('5f4dcc3b5aa7');
});

it('marker strings one character short or long are never listed by their own marker rule', () => {
  const real: [string, string][] = [
    ['md5crypt', corpusString('passwd -1')],
    ['sha256crypt', corpusString('passwd -5')],
    ['sha512crypt', corpusString('passwd -6')],
    ['apr1', corpusString('passwd -apr1')],
    ['bcrypt', BCRYPT_12],
    ['phpass', corpusString('phpass')],
    ['sunmd5', corpusString('sun_md5_crypt')],
  ];
  for (const [id, text] of real) {
    expect(ids(text)).toContain(id);
    for (const changed of [text.slice(0, -1), `${text}a`, text.slice(1)]) {
      expect(ids(changed), `${id}: ${changed.length} characters`).not.toContain(id);
    }
  }
});

it('rules with a variable salt or cost accept the whole range crypt(5) gives and refuse beyond it', () => {
  const hash86 = 'a'.repeat(86);
  // $6$: an optional rounds=N (at least two digits, no leading zero) and a salt of 1 to 16 characters.
  expect(ids(`$6$s$${hash86}`)).toContain('sha512crypt');
  expect(ids(`$6$${'s'.repeat(16)}$${hash86}`)).toContain('sha512crypt');
  expect(ids(`$6$${'s'.repeat(17)}$${hash86}`)).not.toContain('sha512crypt');
  expect(ids(`$6$$${hash86}`)).not.toContain('sha512crypt');
  expect(ids(`$6$rounds=10$s$${hash86}`)).toContain('sha512crypt');
  expect(ids(`$6$rounds=5$s$${hash86}`)).not.toContain('sha512crypt');
  expect(ids(`$6$rounds=010$s$${hash86}`)).not.toContain('sha512crypt');
  expect(ids(`$6$a:b$${hash86}`)).not.toContain('sha512crypt');
  // $1$: a salt of 1 to 8 characters.
  expect(ids(`$1$12345678$${'a'.repeat(22)}`)).toContain('md5crypt');
  expect(ids(`$1$123456789$${'a'.repeat(22)}`)).not.toContain('md5crypt');
  // bcrypt: all four variants, and a cost outside 4 to 31 is still the layout but says so.
  for (const v of ['2a', '2b', '2x', '2y']) expect(ids(`$${v}$10$${'a'.repeat(53)}`)).toContain('bcrypt');
  expect(ids(`$2c$10$${'a'.repeat(53)}`)).not.toContain('bcrypt');
  expect(ids(`$2b$1$${'a'.repeat(54)}`)).not.toContain('bcrypt');
  expect(identifyLine(`$2b$03$${'a'.repeat(53)}`)[0]?.reason).toContain('outside the 4 to 31');
  // Argon2: m, t and p in that order, a version only as v=digits.
  const argon = (params: string, version = 'v=19'): string => `$argon2id$${version}$${params}$c29tZXNhbHQ$ZGlnZXN0`;
  expect(ids(argon('m=65536,t=3,p=4'))).toContain('argon2id');
  expect(ids(argon('t=3,m=65536,p=4'))).not.toContain('argon2id');
  expect(ids(argon('m=65536,t=3,p=4', 'v=x'))).not.toContain('argon2id');
  expect(ids('$argon2id$m=65536,t=3,p=4$c29tZXNhbHQ$ZGlnZXN0')).toContain('argon2id');
  expect(ids('$argon2x$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$ZGlnZXN0')).not.toContain('argon2id');
});
