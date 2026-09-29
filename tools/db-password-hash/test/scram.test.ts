import { describe, it, expect } from 'vitest';
import * as nodeCrypto from 'node:crypto';
import { scramSha256, parseScram, scramKeys, SCRAM_ITERATIONS } from '../src/scram';
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
function randomBytes(rng: () => number, n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(rng() * 256);
  return out;
}
function randomAsciiPassword(rng: () => number, len: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(rng() * chars.length)];
  return s;
}

describe('RFC 7677 section 3 example', () => {
  // https://www.rfc-editor.org/rfc/rfc7677#section-3
  // Password "pencil", salt W22ZaJ0SNY7soEsUEjb6gQ==, i=4096.
  const password = 'pencil';
  const saltB64 = 'W22ZaJ0SNY7soEsUEjb6gQ==';
  const iterations = 4096;

  it('the AuthMessage rebuilt from the RFC own protocol messages verifies against this package StoredKey/ServerKey', async () => {
    const salt = Uint8Array.from(Buffer.from(saltB64, 'base64'));
    const { storedKey, serverKey } = await scramKeys(new TextEncoder().encode(password), salt, iterations);

    const clientFirstBare = 'n=user,r=rOprNGfwEbeRWgbNEkqO';
    const serverFirst = `r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=${saltB64},i=${iterations}`;
    const clientFinalWithoutProof = 'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0';
    const authMessage = [clientFirstBare, serverFirst, clientFinalWithoutProof].join(',');
    const authMessageBytes = new TextEncoder().encode(authMessage);

    // v= (the server signature): HMAC(ServerKey, AuthMessage)
    const serverSignature = Uint8Array.from(
      nodeCrypto.createHmac('sha256', Buffer.from(serverKey)).update(Buffer.from(authMessageBytes)).digest(),
    );
    const expectedServerSignature = Buffer.from('6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=', 'base64');
    expect(Buffer.from(serverSignature).toString('hex')).toBe(expectedServerSignature.toString('hex'));

    // p= (the client proof): ClientProof = ClientKey XOR HMAC(StoredKey, AuthMessage)
    // So StoredKey should equal SHA-256(ClientProof XOR HMAC(StoredKey, AuthMessage)).
    const clientProof = Buffer.from('dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=', 'base64');
    const clientSignature = nodeCrypto
      .createHmac('sha256', Buffer.from(storedKey))
      .update(Buffer.from(authMessageBytes))
      .digest();
    const recoveredClientKey = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) recoveredClientKey[i] = clientProof[i]! ^ clientSignature[i]!;
    const recoveredStoredKey = nodeCrypto.createHash('sha256').update(recoveredClientKey).digest();
    expect(recoveredStoredKey.toString('hex')).toBe(Buffer.from(storedKey).toString('hex'));
  });
});

describe('Node crypto differential (pbkdf2Sync, createHmac, createHash)', () => {
  it('StoredKey/ServerKey match Node for random passwords, salts and iteration counts (~20 cases)', async () => {
    const rng = mulberry32(2024);
    for (let i = 0; i < 20; i++) {
      const password = randomAsciiPassword(rng, 1 + Math.floor(rng() * 16));
      const salt = randomBytes(rng, 16);
      const iterations = 1 + Math.floor(rng() * 3000);

      const { storedKey, serverKey } = await scramKeys(new TextEncoder().encode(password), salt, iterations);

      const saltedPassword = nodeCrypto.pbkdf2Sync(password, Buffer.from(salt), iterations, 32, 'sha256');
      const nodeClientKey = nodeCrypto.createHmac('sha256', saltedPassword).update('Client Key').digest();
      const nodeStoredKey = nodeCrypto.createHash('sha256').update(nodeClientKey).digest();
      const nodeServerKey = nodeCrypto.createHmac('sha256', saltedPassword).update('Server Key').digest();

      expect(Buffer.from(storedKey).toString('hex')).toBe(nodeStoredKey.toString('hex'));
      expect(Buffer.from(serverKey).toString('hex')).toBe(nodeServerKey.toString('hex'));
    }
  });

  it("the stored string's four fields decode to exactly those bytes", async () => {
    const password = 'a-random-password-42';
    const salt = new Uint8Array(16).fill(7);
    const result = await scramSha256(password, { salt, iterations: 100 });
    const parsed = parseScram(result.stored);
    const { storedKey, serverKey } = await scramKeys(new TextEncoder().encode(password), salt, 100);
    expect(Buffer.from(parsed.salt).toString('hex')).toBe(Buffer.from(salt).toString('hex'));
    expect(Buffer.from(parsed.storedKey).toString('hex')).toBe(Buffer.from(storedKey).toString('hex'));
    expect(Buffer.from(parsed.serverKey).toString('hex')).toBe(Buffer.from(serverKey).toString('hex'));
    expect(parsed.iterations).toBe(100);
  });
});

describe('bounds and secret contract', () => {
  it('empty password is refused', async () => {
    await expect(scramSha256('')).rejects.toThrow(/Enter a password/);
  });

  it('iterations 0 and 1,000,001 are refused', async () => {
    await expect(scramSha256('pw', { iterations: 0 })).rejects.toThrow(DbHashError);
    await expect(scramSha256('pw', { iterations: 1_000_001 })).rejects.toThrow(DbHashError);
  });

  it('SCRAM_ITERATIONS bounds match 1 to 1,000,000, default 4096', () => {
    expect(SCRAM_ITERATIONS).toEqual({ min: 1, max: 1_000_000, default: 4096 });
  });

  it('JSON.stringify of the result never contains the password', async () => {
    const password = 'super-secret-marker-value';
    const result = await scramSha256(password, { iterations: 10 });
    expect(JSON.stringify(result)).not.toContain(password);
  });
});

describe('malformed stored hashes', () => {
  it('bad Base64 in the salt is refused', () => {
    expect(() => parseScram('SCRAM-SHA-256$4096:not-base64!!$AAAA$BBBB')).toThrow(DbHashError);
  });

  it('missing "$" is refused with a field-count message', () => {
    expect(() => parseScram('SCRAM-SHA-256$4096:c29tZXNhbHQ=')).toThrow(/two "\$"-separated/);
  });

  it('missing ":" in the iterations/salt section is refused', () => {
    expect(() => parseScram('SCRAM-SHA-256$4096c29tZXNhbHQ=$AAAA:BBBB')).toThrow(/iteration count and salt/);
  });

  it('zero iterations is refused', () => {
    expect(() =>
      parseScram(
        'SCRAM-SHA-256$0:c29tZXNhbHQ=$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      ),
    ).toThrow(/iteration count/);
  });

  it('non-numeric iterations is refused', () => {
    expect(() => parseScram('SCRAM-SHA-256$abc:c29tZXNhbHQ=$AAAA:BBBB')).toThrow(/not a whole number/);
  });

  it('StoredKey not 32 bytes is refused', () => {
    const salt = Buffer.from('somesalt').toString('base64');
    const shortKey = Buffer.alloc(10).toString('base64');
    const key32 = Buffer.alloc(32).toString('base64');
    expect(() => parseScram(`SCRAM-SHA-256$4096:${salt}$${shortKey}:${key32}`)).toThrow(
      /StoredKey must decode to 32 bytes/,
    );
  });
});
