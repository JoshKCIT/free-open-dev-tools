import { it, expect } from 'vitest';
import { compare as bcryptCompare } from 'bcrypt-ts';
import { htpasswdLine, HTPASSWD_COST, HtaccessError } from '../src/htpasswd';

it('an htpasswd line uses the 2y bcrypt tag that Apache htpasswd writes and differs from the bcrypt-ts 2b hash only in that tag', async () => {
  // programs/htpasswd.html, fetched 2026-09-25: "-B Use bcrypt hashing for
  // passwords." and "-C ... default: 5, valid: 4 to 17" -- D-97 relabels
  // the bcrypt-ts library's own "$2b$" output to "$2y$", the tag Apache's
  // own htpasswd -B writes, changing nothing else.
  const result = await htpasswdLine('alice', 'correct horse battery staple', 5);
  expect(result.line.startsWith('alice:$2y$05$')).toBe(true);
  expect(result.cost).toBe(5);

  const [user, hash2y] = result.line.split(/:(.*)/s);
  expect(user).toBe('alice');
  const hash2b = `$2b$${hash2y!.slice(4)}`;
  // Byte comparison: the only difference between the two strings is the tag.
  expect(hash2y!.slice(4)).toBe(hash2b.slice(4));
  expect(hash2y).not.toBe(hash2b);
  // A real bcrypt-ts compare() call against the un-relabelled hash proves
  // the relabel is cosmetic, not a different digest.
  await expect(bcryptCompare('correct horse battery staple', hash2b)).resolves.toBe(true);
});

it('the htpasswd line verifies against the original password and never contains it', async () => {
  const password = 'correct horse battery staple';
  const result = await htpasswdLine('alice', password, HTPASSWD_COST.default);
  const hash2y = result.line.split(':')[1]!;
  const hash2b = `$2b$${hash2y.slice(4)}`;
  await expect(bcryptCompare(password, hash2b)).resolves.toBe(true);
  await expect(bcryptCompare('wrong password', hash2b)).resolves.toBe(false);

  expect(result.line).not.toContain(password);
  expect(result.warnings.join(' ')).not.toContain(password);
  try {
    await htpasswdLine('al:ice', password, 5);
  } catch (err) {
    expect((err as Error).message).not.toContain(password);
  }
});

it('a password longer than 72 bytes is reported because bcrypt reads only the first 72', async () => {
  const password73 = 'a'.repeat(73);
  const result = await htpasswdLine('alice', password73, 4);
  expect(result.warnings.length).toBe(1);
  expect(result.warnings[0]).toMatch(/72/);

  const password72 = 'a'.repeat(72);
  const notTruncated = await htpasswdLine('alice', password72, 4);
  expect(notTruncated.warnings).toEqual([]);

  const unicode73 = 'a'.repeat(70) + 'éé'; // 70 ASCII bytes + 2 chars x 2 UTF-8 bytes = 74 bytes
  const unicodeResult = await htpasswdLine('alice', unicode73, 4);
  expect(unicodeResult.warnings.length).toBe(1);
});

it('a username with a colon or an out-of-range cost is refused', async () => {
  await expect(htpasswdLine('al:ice', 'password', 5)).rejects.toThrow(HtaccessError);
  await expect(htpasswdLine('', 'password', 5)).rejects.toThrow(HtaccessError);
  await expect(htpasswdLine('alice', '', 5)).rejects.toThrow(HtaccessError);
  await expect(htpasswdLine('alice', 'password', 3)).rejects.toThrow(HtaccessError);
  await expect(htpasswdLine('alice', 'password', 16)).rejects.toThrow(HtaccessError);
  await expect(htpasswdLine('alice', 'password', 4.5)).rejects.toThrow(HtaccessError);
  await expect(htpasswdLine('a'.repeat(256), 'password', 5)).rejects.toThrow(HtaccessError);
});
