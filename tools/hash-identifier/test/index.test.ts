import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { identifyLine, identifyText } from '../src/index';

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
