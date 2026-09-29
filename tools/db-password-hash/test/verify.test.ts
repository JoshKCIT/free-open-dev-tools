import { describe, it, expect } from 'vitest';
import { detectKind, verifyStoredHash, constantTimeEqual, MATCH_MESSAGE, NO_MATCH_MESSAGE } from '../src/verify';
import { scramSha256 } from '../src/scram';
import { postgresMd5, mysqlNativePassword } from '../src/legacy';
import { DbHashError } from '../src/errors';

describe('detectKind', () => {
  it('detects SCRAM-SHA-256', () => {
    expect(detectKind('SCRAM-SHA-256$4096:c2FsdA==$c3RvcmVk:c2VydmVy')).toBe('scram-sha-256');
  });

  it('detects a PostgreSQL md5 hash (lowercase and uppercase hex)', () => {
    expect(detectKind('md5' + 'a'.repeat(32))).toBe('postgres-md5');
    expect(detectKind('md5' + 'A'.repeat(32))).toBe('postgres-md5');
  });

  it('detects a MySQL native hash (lowercase and uppercase hex)', () => {
    expect(detectKind('*' + 'a'.repeat(40))).toBe('mysql-native');
    expect(detectKind('*' + 'A'.repeat(40))).toBe('mysql-native');
  });

  it('an unrelated string gives the unrecognised message', () => {
    expect(() => detectKind('not-a-hash-at-all')).toThrow(/not a stored hash this tool recognises/);
  });
});

describe('constantTimeEqual', () => {
  it('equal arrays are true', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
  });
  it('differ in the first byte is false', () => {
    expect(constantTimeEqual(new Uint8Array([9, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(false);
  });
  it('differ in the last byte is false', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 9]), new Uint8Array([1, 2, 3]))).toBe(false);
  });
  it('different lengths are false', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });
});

describe('verify round trips', () => {
  it('SCRAM-SHA-256: matches its own password, does not match a different one', async () => {
    const { stored } = await scramSha256('correct-password-1', { iterations: 50 });
    expect((await verifyStoredHash(stored, 'correct-password-1')).match).toBe(true);
    expect((await verifyStoredHash(stored, 'wrong-password-1')).match).toBe(false);
  });

  it('postgres-md5: matches its own password AND role, not a different password or a different role', async () => {
    const hash = postgresMd5('correct-password-2', 'app_user');
    expect((await verifyStoredHash(hash, 'correct-password-2', { role: 'app_user' })).match).toBe(true);
    expect((await verifyStoredHash(hash, 'wrong-password-2', { role: 'app_user' })).match).toBe(false);
    expect((await verifyStoredHash(hash, 'correct-password-2', { role: 'other_user' })).match).toBe(false);
  });

  it('mysql-native: matches its own password, not a different one; hex case does not matter', async () => {
    const hash = mysqlNativePassword('correct-password-3');
    expect((await verifyStoredHash(hash, 'correct-password-3')).match).toBe(true);
    expect((await verifyStoredHash(hash.toLowerCase(), 'correct-password-3')).match).toBe(true);
    expect((await verifyStoredHash(hash, 'wrong-password-3')).match).toBe(false);
  });

  it('leading/trailing whitespace around the stored hash is ignored', async () => {
    const hash = mysqlNativePassword('correct-password-4');
    expect((await verifyStoredHash(`  ${hash}  \n`, 'correct-password-4')).match).toBe(true);
  });
});

describe('malformed input', () => {
  it('postgres-md5 without a role name throws asking for one', async () => {
    const hash = postgresMd5('pw', 'role');
    await expect(verifyStoredHash(hash, 'pw')).rejects.toThrow(/salted with the role name/);
  });

  it('empty password is refused', async () => {
    await expect(verifyStoredHash('md5' + 'a'.repeat(32), '', { role: 'x' })).rejects.toThrow(/Enter a password/);
  });

  it('an unrecognised stored hash is refused', async () => {
    await expect(verifyStoredHash('garbage', 'pw')).rejects.toThrow(DbHashError);
  });
});

describe('fixed messages', () => {
  it('MATCH_MESSAGE and NO_MATCH_MESSAGE are the exact documented strings', () => {
    expect(MATCH_MESSAGE).toBe('Match: this password produces the stored hash.');
    expect(NO_MATCH_MESSAGE).toBe('No match: this password does not produce the stored hash.');
  });
});

describe('secret contract', () => {
  it('JSON.stringify of a verify result never contains the password', async () => {
    const password = 'a-unique-marker-password-99';
    const hash = mysqlNativePassword(password);
    const result = await verifyStoredHash(hash, password);
    expect(JSON.stringify(result)).not.toContain(password);
  });
});
