import { describe, it, expect } from 'vitest';
import * as nodeCrypto from 'node:crypto';
import {
  postgresMd5,
  mysqlNativePassword,
  quotePgIdentifier,
  quoteMysqlString,
  alterRolePostgres,
  alterUserMysql,
  alterUserMariadb,
  identifierLengthWarning,
} from '../src/legacy';
import { DbHashError } from '../src/errors';

function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomPassword(rng: () => number, len: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 !@#$';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(rng() * chars.length)];
  return s;
}

describe('MySQL 5.7 Reference Manual, PASSWORD() worked example', () => {
  it('mysqlNativePassword("mypass") === "*6C8989366EAF75BB670AD8EA7A7FC1176A95CEF4"', () => {
    expect(mysqlNativePassword('mypass')).toBe('*6C8989366EAF75BB670AD8EA7A7FC1176A95CEF4');
  });
});

describe('postgresMd5 differential against Node crypto', () => {
  it("equals 'md5' + createHash('md5').update(password + role).digest('hex') over random passwords and role names, including non-ASCII", () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 25; i++) {
      const password = randomPassword(rng, 1 + Math.floor(rng() * 20));
      const role = i % 5 === 0 ? 'usuário_' + randomPassword(rng, 5) : randomPassword(rng, 1 + Math.floor(rng() * 10));
      const expected =
        'md5' +
        nodeCrypto
          .createHash('md5')
          .update(password + role, 'utf8')
          .digest('hex');
      expect(postgresMd5(password, role)).toBe(expected);
    }
  });
});

describe('mysqlNativePassword differential against Node crypto', () => {
  it('equals the double SHA-1 upper hex over random passwords, including non-ASCII', () => {
    const rng = mulberry32(1337);
    for (let i = 0; i < 25; i++) {
      const password =
        i % 5 === 0 ? 'pässwörd_' + randomPassword(rng, 5) : randomPassword(rng, 1 + Math.floor(rng() * 20));
      const once = nodeCrypto.createHash('sha1').update(password, 'utf8').digest();
      const twice = nodeCrypto.createHash('sha1').update(once).digest('hex').toUpperCase();
      expect(mysqlNativePassword(password)).toBe('*' + twice);
    }
  });
});

describe('empty password refused', () => {
  it('postgresMd5', () => {
    expect(() => postgresMd5('', 'role')).toThrow(/Enter a password/);
  });
  it('mysqlNativePassword', () => {
    expect(() => mysqlNativePassword('')).toThrow(/Enter a password/);
  });
  it('postgresMd5 without a role name', () => {
    expect(() => postgresMd5('pw', '')).toThrow(/salted with the role name/);
  });
});

describe('SQL quoting and injection-shaped names', () => {
  it('quotePgIdentifier doubles ", producing a safe ALTER ROLE for an injection-shaped role name', () => {
    const role = 'a"b; DROP ROLE x; --';
    expect(quotePgIdentifier(role)).toBe('"a""b; DROP ROLE x; --"');
    expect(alterRolePostgres(role, 'SCRAM-SHA-256$...')).toBe(
      'ALTER ROLE "a""b; DROP ROLE x; --" PASSWORD \'SCRAM-SHA-256$...\';',
    );
  });

  it('quotePgIdentifier refuses a NUL character', () => {
    expect(() => quotePgIdentifier('a\u0000b')).toThrow(DbHashError);
  });

  it("quoteMysqlString doubles ' and backslash", () => {
    expect(quoteMysqlString(`o'brien\\`)).toBe("'o''brien\\\\'");
  });

  it('alterUserMysql and alterUserMariadb quote user and host as string literals', () => {
    expect(alterUserMysql('app_user', '%', '*ABC')).toBe(
      "ALTER USER 'app_user'@'%' IDENTIFIED WITH mysql_native_password AS '*ABC';",
    );
    expect(alterUserMariadb('app_user', '%', '*ABC')).toBe("ALTER USER 'app_user'@'%' IDENTIFIED BY PASSWORD '*ABC';");
  });

  it('a role longer than 63 UTF-8 bytes produces the truncation warning', () => {
    const longRole = 'x'.repeat(64);
    expect(identifierLengthWarning(longRole)).toMatch(/truncates identifiers/);
  });

  it('a role of exactly 63 UTF-8 bytes produces no warning', () => {
    const role63 = 'x'.repeat(63);
    expect(identifierLengthWarning(role63)).toBeUndefined();
  });
});
