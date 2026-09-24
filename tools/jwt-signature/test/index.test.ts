import { it, expect, vi } from 'vitest';
import { sign, verify, splitCompact, ALGORITHMS, JwtSignatureError, type JwsAlgorithm } from '../src/index';
import { importSigningKey, importVerifyingKey, bytesToPem } from '../src/keys';

// Test vectors in this file are taken from RFC 7515 (JSON Web Signature),
// https://www.rfc-editor.org/rfc/rfc7515, Appendix A, and cross-checked
// against the signature format rules in RFC 7518 (JSON Web Algorithms),
// https://www.rfc-editor.org/rfc/rfc7518, sections 3.2 through 3.4.
//
// Every test in this file is a TOP-LEVEL it(...) call, never nested inside a
// describe(...). Vitest's JSON reporter concatenates the enclosing describe
// name into a test's fullName, and the nine mandated test titles below are
// matched by exact string equality -- nesting them would silently change
// the string the check reads.

// RFC 7515 Appendix A.1 -- the exact octet sequences the RFC gives for the
// JWS Protected Header and JWS Payload, including the CRLF line break and
// single leading space the RFC states are part of the example's bytes.
const A1_HEADER = '{"typ":"JWT",\r\n "alg":"HS256"}';
const A1_PAYLOAD = '{"iss":"joe",\r\n "exp":1300819380,\r\n "http://example.com/is_root":true}';
const A1_KEY_B64URL = 'AyM1SysPpbyDfgZld3umj1qzKObwVMkoqQ-EstJQLr_T-1qS0gZH75aKtMN3Yj0iPS4hcgUuTwjAzZr1Z9CAow';
const A1_COMPACT_TOKEN =
  'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

// RFC 7515 Appendix A.2 -- RSASSA-PKCS1-v1_5 SHA-256, public key only (this is a verify-only vector).
const A2_JWK = {
  kty: 'RSA',
  n: 'ofgWCuLjybRlzo0tZWJjNiuSfb4p4fAkd_wWJcyQoTbji9k0l8W26mPddxHmfHQp-Vaw-4qPCJrcS2mJPMEzP1Pt0Bm4d4QlL-yRT-SFd2lZS-pCgNMsD1W_YpRPEwOWvG6b32690r2jZ47soMZo9wGzjb_7OMg0LOL-bSf63kpaSHSXndS5z5rexMdbBYUsLA9e-KXBdQOS-UTo7WTBEMa2R2CapHg665xsmtdVMTBQY4uDZlxvb3qCo5ZwKh9kG4LT6_I5IhlJH7aGhyxXFvUK-DWNmoudF8NAco9_h9iaGNj8q2ethFkMLs91kzk2PAcDTW9gb54h4FRWyuXpoQ',
  e: 'AQAB',
};
const A2_COMPACT_TOKEN =
  'eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ.cC4hiUPoj9Eetdgtv3hF80EGrhuB__dzERat0XF9g2VtQgr9PJbu3XOiZj5RZmh7AAuHIm4Bh-0Qc_lF5YKt_O8W2Fp5jujGbds9uJdbF9CUAr7t1dnZcAcQjbKBYNX4BAynRFdiuB--f_nZLgrnbyTyWzO75vRK5h6xBArLIARNPvkSjtQBMHlb1L07Qe7K0GarZRmB_eSN9383LcOLn6_dO--xi12jzDwusC-eOkHWEsqtFZESc6BfI7noOPqvhJ1phCnvWh6IeYI2w9QOYEUipUTI8np6LbgGY9Fs98rqVt5AXLIhWkWywlVmtVrBp0igcN_IoypGlUPQGe77Rw';

// RFC 7515 Appendix A.3 -- ECDSA P-256 SHA-256, public key only. The signature
// is not reproduced by signing (ECDSA is not deterministic, per RFC 7518
// section 3.4's own note that many implementations vary the signature every
// time); only verification of the RFC's own signature is asserted.
const A3_JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU',
  y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0',
};
const A3_COMPACT_TOKEN =
  'eyJhbGciOiJFUzI1NiJ9.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ.DtEhU3ljbEg8L38VWAfUAqOyKAM6-Xx-F4GawxaepmXFCgfTjDxw5djxLa8ISlSApmWQxfKTUJqPP3-Kg6NU1Q';

// RFC 7515 Appendix A.4 -- ECDSA P-521 SHA-512, public key only. Note the
// payload here is the plain ASCII string "Payload", not JSON -- this tool's
// sign()/verify() never require the payload to be JSON at all.
const A4_JWK = {
  kty: 'EC',
  crv: 'P-521',
  x: 'AekpBQ8ST8a8VcfVOTNl353vSrDCLLJXmPk06wTjxrrjcBpXp5EOnYG_NjFZ6OvLFV1jSfS9tsz4qUxcWceqwQGk',
  y: 'ADSmRA43Z1DSNx_RvcLI87cdL07l6jQyyBXMoxVg_l2Th-x3S1WDhjDly79ajL4Kkd0AZMaZmh9ubmf63e3kyMj2',
};
const A4_COMPACT_TOKEN =
  'eyJhbGciOiJFUzUxMiJ9.UGF5bG9hZA.AdwMgeerwtHoh-l192l60hp9wAHZFVJbLfD_UxMi70cwnZOYaRI1bKPWROc-mZZqwqT2SI-KGDKB34XO0aw_7XdtAG8GaSwFKdCAPZgoXD2YBJZCPEX3xKpRwcdOO8KpEHwJjyqOgzDO7iKvU8vcnwNrmxYbSW9ERBXukOXolLzeO_Jn';

const ALL_ALGORITHMS: JwsAlgorithm[] = ALGORITHMS.map((a) => a.id);

async function generateKeyPairFor(algorithm: JwsAlgorithm): Promise<CryptoKeyPair> {
  const info = ALGORITHMS.find((a) => a.id === algorithm)!;
  if (info.family === 'ECDSA') {
    return (await globalThis.crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: info.curve! }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
  }
  return (await globalThis.crypto.subtle.generateKey(
    { name: info.family, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: { name: info.hash } },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
}

// --- RFC 7515 Appendix A worked examples -----------------------------------

it('RFC 7515 appendix: signing the published header and payload produces the published signature', async () => {
  const key = await importSigningKey('HS256', { format: 'secret', encoding: 'base64', value: A1_KEY_B64URL });
  const token = await sign(A1_HEADER, A1_PAYLOAD, key, { algorithm: 'HS256' });
  expect(token).toBe(A1_COMPACT_TOKEN);
});

it('verifies the A.1 keyed-hash token against the published key, and rejects it after one payload character changes', async () => {
  const key = await importVerifyingKey('HS256', { format: 'secret', encoding: 'base64', value: A1_KEY_B64URL });
  const good = await verify(A1_COMPACT_TOKEN, key, { algorithm: 'HS256' });
  expect(good.valid).toBe(true);

  const [header, payload, signature] = splitCompact(A1_COMPACT_TOKEN);
  const tamperedPayload = payload.slice(0, -1) + (payload.endsWith('A') ? 'B' : 'A');
  const tampered = `${header}.${tamperedPayload}.${signature}`;
  const bad = await verify(tampered, key, { algorithm: 'HS256' });
  expect(bad.valid).toBe(false);
});

it('verifies the A.2 RSASSA-PKCS1-v1_5 worked example against the published public key', async () => {
  const key = await importVerifyingKey('RS256', { format: 'jwk', json: JSON.stringify(A2_JWK) });
  const report = await verify(A2_COMPACT_TOKEN, key, { algorithm: 'RS256' });
  expect(report.valid).toBe(true);
});

it('verifies the A.3 ECDSA P-256 worked example; not reproduced by signing because ECDSA is not deterministic', async () => {
  const key = await importVerifyingKey('ES256', { format: 'jwk', json: JSON.stringify(A3_JWK) });
  const report = await verify(A3_COMPACT_TOKEN, key, { algorithm: 'ES256' });
  expect(report.valid).toBe(true);
});

it('verifies the A.4 ECDSA P-521 worked example, whose payload is plain text rather than JSON', async () => {
  const key = await importVerifyingKey('ES512', { format: 'jwk', json: JSON.stringify(A4_JWK) });
  const report = await verify(A4_COMPACT_TOKEN, key, { algorithm: 'ES512' });
  expect(report.valid).toBe(true);
});

// --- sign() takes header and payload as strings, used verbatim -------------

it('the signing input is the two original segments verbatim, whitespace differences included', async () => {
  const key = await importSigningKey('HS256', { format: 'secret', encoding: 'utf8', value: 'k' });
  const compact = '{"alg":"HS256","typ":"JWT"}';
  const spaced = '{"alg":"HS256", "typ":"JWT"}';
  const payload = '{"sub":"1234567890"}';
  const t1 = await sign(compact, payload, key, { algorithm: 'HS256' });
  const t2 = await sign(spaced, payload, key, { algorithm: 'HS256' });
  expect(t1).not.toBe(t2);
});

// --- the unsecured "none" algorithm is refused on both paths ---------------

it('verify with algorithm none in the options is refused before any key is imported', async () => {
  const importKeySpy = vi.spyOn(globalThis.crypto.subtle, 'importKey');
  const verifySpy = vi.spyOn(globalThis.crypto.subtle, 'verify');
  await expect(verify(A1_COMPACT_TOKEN, {} as CryptoKey, { algorithm: 'none' as JwsAlgorithm })).rejects.toThrow(
    JwtSignatureError,
  );
  expect(importKeySpy).not.toHaveBeenCalled();
  expect(verifySpy).not.toHaveBeenCalled();
  importKeySpy.mockRestore();
  verifySpy.mockRestore();
});

it('sign with algorithm none in the options is refused', async () => {
  const key = await importSigningKey('HS256', { format: 'secret', encoding: 'utf8', value: 'k' });
  await expect(sign('{"alg":"none"}', '{}', key, { algorithm: 'none' as JwsAlgorithm })).rejects.toThrow(
    JwtSignatureError,
  );
});

it('a token whose header says none is refused even when the options name a real algorithm', async () => {
  const noneToken = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from('{}').toString('base64url')}.`;
  const key = await importVerifyingKey('HS256', { format: 'secret', encoding: 'utf8', value: 'k' });
  const report = await verify(noneToken, key, { algorithm: 'HS256' });
  expect(report.valid).toBe(false);
  expect(report.reason).toBe('unsecured-refused');
});

// --- algorithm confusion is not possible ------------------------------------

it('an HS256 token forged with the RSA public key bytes fails an RS256 verification', async () => {
  const rsaPair = await generateKeyPairFor('RS256');
  const publicSpki = new Uint8Array(await globalThis.crypto.subtle.exportKey('spki', rsaPair.publicKey));
  const publicKeyAsSecret = Buffer.from(publicSpki).toString('base64');

  const forgingKey = await importSigningKey('HS256', {
    format: 'secret',
    encoding: 'base64',
    value: publicKeyAsSecret,
  });
  const forgedToken = await sign('{"alg":"HS256","typ":"JWT"}', '{"sub":"attacker","admin":true}', forgingKey, {
    algorithm: 'HS256',
  });

  const rsaVerifyKey = await importVerifyingKey('RS256', {
    format: 'pem-public',
    pem: bytesToPem(publicSpki, 'PUBLIC KEY'),
  });
  const report = await verify(forgedToken, rsaVerifyKey, { algorithm: 'RS256' });
  expect(report.valid).toBe(false);
});

it('a token whose header algorithm disagrees with the options algorithm is reported as a disagreement and does not verify', async () => {
  const key = await importSigningKey('HS256', { format: 'secret', encoding: 'utf8', value: 'shared' });
  const verifyKey = await importVerifyingKey('HS384', { format: 'secret', encoding: 'utf8', value: 'shared' });
  const token = await sign('{"alg":"HS256"}', '{"a":1}', key, { algorithm: 'HS256' });
  const report = await verify(token, verifyKey, { algorithm: 'HS384' });
  expect(report.valid).toBe(false);
  expect(report.reason).toBe('algorithm-disagreement');
  expect(report.message).not.toMatch(/signature does not match/);
});

it('a cross-algorithm token fails verification with a report saying the algorithms differ rather than that the signature is bad', async () => {
  const key = await importSigningKey('HS256', { format: 'secret', encoding: 'utf8', value: 'shared' });
  const verifyKey = await importVerifyingKey('HS512', { format: 'secret', encoding: 'utf8', value: 'shared' });
  const token = await sign('{"alg":"HS256"}', '{"a":1}', key, { algorithm: 'HS256' });
  const report = await verify(token, verifyKey, { algorithm: 'HS512' });
  expect(report.reason).toBe('algorithm-disagreement');
});

it('verify ignores jku, jwk and kid entirely and never fetches or imports a key from the token', async () => {
  const importKeySpy = vi.spyOn(globalThis.crypto.subtle, 'importKey');
  const secret = await importSigningKey('HS256', { format: 'secret', encoding: 'utf8', value: 'real-secret' });
  const verifyKey = await importVerifyingKey('HS256', { format: 'secret', encoding: 'utf8', value: 'real-secret' });
  importKeySpy.mockClear();

  // jku points at a URL, jwk embeds an attacker's own key, kid names an
  // attacker-chosen key id -- none of the three is ever read for key
  // selection anywhere in verify().
  const poisonedHeader = JSON.stringify({
    alg: 'HS256',
    typ: 'JWT',
    jku: 'https://evil.example/jwks.json',
    jwk: { kty: 'oct', k: 'QVRUQUNLRVI' },
    kid: 'attacker-chosen-key',
  });
  const token = await sign(poisonedHeader, '{"sub":"x"}', secret, { algorithm: 'HS256' });
  const report = await verify(token, verifyKey, { algorithm: 'HS256' });

  expect(report.valid).toBe(true);
  // No key import happened inside verify() itself -- it received an
  // already-imported key from its caller and never touches SubtleCrypto's
  // import function, so an attacker-embedded jwk header can never reach it.
  expect(importKeySpy).not.toHaveBeenCalled();
  importKeySpy.mockRestore();
});

it('verify with no options, or options with no algorithm, throws rather than defaulting', async () => {
  const key = await importVerifyingKey('HS256', { format: 'secret', encoding: 'utf8', value: 'k' });
  // @ts-expect-error -- a JavaScript caller is not bound by the type; this is the runtime guard for it.
  await expect(verify(A1_COMPACT_TOKEN, key, undefined)).rejects.toThrow(JwtSignatureError);
  // @ts-expect-error -- same: options with no algorithm at all.
  await expect(verify(A1_COMPACT_TOKEN, key, {})).rejects.toThrow(JwtSignatureError);
});

it('HMAC verification goes through the platform verifier and not a string comparison of re-signed output', async () => {
  const verifySpy = vi.spyOn(globalThis.crypto.subtle, 'verify');
  const key = await importSigningKey('HS256', { format: 'secret', encoding: 'utf8', value: 'k' });
  const verifyKey = await importVerifyingKey('HS256', { format: 'secret', encoding: 'utf8', value: 'k' });
  const token = await sign('{"alg":"HS256"}', '{"a":1}', key, { algorithm: 'HS256' });
  const report = await verify(token, verifyKey, { algorithm: 'HS256' });
  expect(report.valid).toBe(true);
  expect(verifySpy).toHaveBeenCalled();
  verifySpy.mockRestore();
});

// --- every supported algorithm signs and verifies its own freshly generated key pair ---

for (const algorithm of ALL_ALGORITHMS) {
  it(`${algorithm}: a freshly generated key pair signs and then verifies its own token`, async () => {
    const isHmac = ALGORITHMS.find((a) => a.id === algorithm)!.family === 'HMAC';
    let signingKey: CryptoKey;
    let verifyingKey: CryptoKey;
    if (isHmac) {
      signingKey = await importSigningKey(algorithm, { format: 'secret', encoding: 'utf8', value: 'a-shared-secret' });
      verifyingKey = await importVerifyingKey(algorithm, {
        format: 'secret',
        encoding: 'utf8',
        value: 'a-shared-secret',
      });
    } else {
      const pair = await generateKeyPairFor(algorithm);
      signingKey = pair.privateKey;
      verifyingKey = pair.publicKey;
    }
    const token = await sign(`{"alg":"${algorithm}"}`, '{"sub":"round-trip"}', signingKey, { algorithm });
    const report = await verify(token, verifyingKey, { algorithm });
    expect(report.valid).toBe(true);
  });
}

// --- malformed compact tokens ------------------------------------------------

it('splitting a value with the wrong segment count is rejected, saying how many segments a compact token has', () => {
  expect(() => splitCompact('only.two')).toThrow(/three/);
  expect(() => splitCompact('a.b.c.d')).toThrow(/three/);
});

it('a segment that is not valid Base64url is rejected with its position', async () => {
  const key = await importVerifyingKey('HS256', { format: 'secret', encoding: 'utf8', value: 'k' });
  const report = await verify('not-!-valid.eyJhbGciOiJIUzI1NiJ9.sig', key, { algorithm: 'HS256' });
  expect(report.valid).toBe(false);
  expect(report.reason).toBe('malformed-token');
});

it('distinguishes a signature mismatch, a token that could not be parsed, and a key that could not be imported', async () => {
  const key = await importVerifyingKey('HS256', { format: 'secret', encoding: 'utf8', value: 'k' });

  const wrongKey = await importVerifyingKey('HS256', { format: 'secret', encoding: 'utf8', value: 'different' });
  const good = await sign(
    '{"alg":"HS256"}',
    '{}',
    await importSigningKey('HS256', { format: 'secret', encoding: 'utf8', value: 'k' }),
    { algorithm: 'HS256' },
  );
  const mismatch = await verify(good, wrongKey, { algorithm: 'HS256' });
  expect(mismatch.reason).toBe('signature-mismatch');

  const malformed = await verify('not.a.token.at.all', key, { algorithm: 'HS256' });
  expect(malformed.reason).toBe('malformed-token');

  // Same declared algorithm as the header (HS256), so the disagreement check
  // does not short-circuit this -- but the supplied key is an ECDSA key,
  // which the platform verifier itself rejects as the wrong kind of key for
  // an HMAC operation.
  const ecKey = (await generateKeyPairFor('ES256')).publicKey;
  const keyError = await verify(good, ecKey, { algorithm: 'HS256' });
  expect(keyError.reason).toBe('key-error');
});

// --- ALGORITHMS metadata -----------------------------------------------------

it('ALGORITHMS carries every algorithm this tool supports, with no entry for the unsecured algorithm', () => {
  const ids = ALGORITHMS.map((a) => a.id);
  expect(ids).toContain('HS256');
  expect(ids).toContain('RS256');
  expect(ids).toContain('PS256');
  expect(ids).toContain('ES256');
  expect(ids).not.toContain('none');
});
