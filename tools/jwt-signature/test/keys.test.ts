import { describe, it, expect } from 'vitest';
import {
  pemToBytes,
  bytesToPem,
  importSigningKey,
  importVerifyingKey,
  JwtKeyError,
  ALGORITHM_PARAMS,
  signVerifyAlgorithmParams,
  type JwsAlgorithm,
} from '../src/keys';
import { splitCompact, verify } from '../src/index';

const ASYMMETRIC_ALGORITHMS: JwsAlgorithm[] = [
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
];

/** Generates a real key pair at test time, never checked into the repository. */
async function generateKeyPairFor(algorithm: JwsAlgorithm): Promise<CryptoKeyPair> {
  const params = ALGORITHM_PARAMS[algorithm];
  if (params.family === 'ecdsa') {
    return (await globalThis.crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: params.curve! }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
  }
  const name = params.family === 'rsassa-pkcs1' ? 'RSASSA-PKCS1-v1_5' : 'RSA-PSS';
  return (await globalThis.crypto.subtle.generateKey(
    { name, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: { name: params.hash } },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
}

async function roundTripSignVerify(
  algorithm: JwsAlgorithm,
  signingKey: CryptoKey,
  verifyingKey: CryptoKey,
): Promise<boolean> {
  const message = new TextEncoder().encode(`signing-input-for-${algorithm}`);
  const sig = await globalThis.crypto.subtle.sign(signVerifyAlgorithmParams(algorithm), signingKey, message);
  return globalThis.crypto.subtle.verify(signVerifyAlgorithmParams(algorithm), verifyingKey, sig, message);
}

describe('PEM handling', () => {
  it('converts a PEM block to bytes and back, preserving the label and the line wrapping', async () => {
    const pair = await generateKeyPairFor('RS256');
    const der = new Uint8Array(await globalThis.crypto.subtle.exportKey('pkcs8', pair.privateKey));
    const pem = bytesToPem(der, 'PRIVATE KEY');
    const block = pemToBytes(pem);
    expect(block.label).toBe('PRIVATE KEY');
    expect(block.bytes).toEqual(der);
    expect(bytesToPem(block.bytes, block.label)).toBe(pem);
  });

  it('rejects a PEM whose header and footer labels disagree, naming both', () => {
    const bad = '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PUBLIC KEY-----';
    expect(() => pemToBytes(bad)).toThrow(JwtKeyError);
    try {
      pemToBytes(bad);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(JwtKeyError);
      expect((err as Error).message).toContain('PRIVATE KEY');
      expect((err as Error).message).toContain('PUBLIC KEY');
    }
  });

  it('rejects a PEM with no header, saying what a PEM block starts with', () => {
    expect(() => pemToBytes('not a pem at all')).toThrow(/starts with/);
  });

  it('rejects a PEM whose body is not valid Base64, with the position of the offending character', () => {
    const bad = '-----BEGIN PRIVATE KEY-----\nAA!!\n-----END PRIVATE KEY-----';
    try {
      pemToBytes(bad);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(JwtKeyError);
      expect((err as JwtKeyError).position).toBe(2);
    }
  });
});

describe('private and public key PEM import, for every supported asymmetric algorithm', () => {
  for (const algorithm of ASYMMETRIC_ALGORITHMS) {
    it(`${algorithm}: a PKCS8 private key PEM imports for signing and an SPKI public key PEM imports for verification`, async () => {
      const pair = await generateKeyPairFor(algorithm);
      const privateDer = new Uint8Array(await globalThis.crypto.subtle.exportKey('pkcs8', pair.privateKey));
      const publicDer = new Uint8Array(await globalThis.crypto.subtle.exportKey('spki', pair.publicKey));
      const privatePem = bytesToPem(privateDer, 'PRIVATE KEY');
      const publicPem = bytesToPem(publicDer, 'PUBLIC KEY');

      const signingKey = await importSigningKey(algorithm, { format: 'pem-private', pem: privatePem });
      const verifyingKey = await importVerifyingKey(algorithm, { format: 'pem-public', pem: publicPem });

      expect(await roundTripSignVerify(algorithm, signingKey, verifyingKey)).toBe(true);
    });
  }
});

describe('JSON Web Key import', () => {
  it('imports for signing when the JWK carries a private component, and for verification when it does not', async () => {
    const pair = await generateKeyPairFor('ES256');
    const privateJwk = JSON.stringify(await globalThis.crypto.subtle.exportKey('jwk', pair.privateKey));
    const publicJwk = JSON.stringify(await globalThis.crypto.subtle.exportKey('jwk', pair.publicKey));

    const signingKey = await importSigningKey('ES256', { format: 'jwk', json: privateJwk });
    const verifyingKey = await importVerifyingKey('ES256', { format: 'jwk', json: publicJwk });
    expect(await roundTripSignVerify('ES256', signingKey, verifyingKey)).toBe(true);

    await expect(importSigningKey('ES256', { format: 'jwk', json: publicJwk })).rejects.toThrow(/no private component/);
  });

  it('rejects a JSON Web Key whose key type does not match the chosen algorithm, naming both', async () => {
    const ecPair = await generateKeyPairFor('ES256');
    const ecPrivateJwk = JSON.stringify(await globalThis.crypto.subtle.exportKey('jwk', ecPair.privateKey));
    try {
      await importSigningKey('RS256', { format: 'jwk', json: ecPrivateJwk });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(JwtKeyError);
      expect((err as Error).message).toContain('EC');
      expect((err as Error).message).toContain('RSA');
    }
  });

  it('rejects a key whose curve does not match the chosen algorithm, naming the algorithm and the curve it requires', async () => {
    const p256Pair = await generateKeyPairFor('ES256');
    const p256PublicJwk = JSON.stringify(await globalThis.crypto.subtle.exportKey('jwk', p256Pair.publicKey));
    try {
      await importVerifyingKey('ES384', { format: 'jwk', json: p256PublicJwk });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(JwtKeyError);
      expect((err as Error).message).toContain('ES384');
      expect((err as Error).message).toContain('P-384');
    }
  });

  it('every elliptic-curve algorithm signs and verifies with its own curve, taken from the algorithm table', async () => {
    for (const algorithm of ['ES256', 'ES384', 'ES512'] as JwsAlgorithm[]) {
      const pair = await generateKeyPairFor(algorithm);
      expect(ALGORITHM_PARAMS[algorithm].curve).toBeDefined();
      expect((pair.publicKey.algorithm as EcKeyAlgorithm).namedCurve).toBe(ALGORITHM_PARAMS[algorithm].curve);
      expect(await roundTripSignVerify(algorithm, pair.privateKey, pair.publicKey)).toBe(true);
    }
  });
});

describe('shared secret import', () => {
  it('imports from text, from hexadecimal and from Base64, all producing a working HMAC key', async () => {
    const utf8Key = await importSigningKey('HS256', { format: 'secret', encoding: 'utf8', value: 'sw0rdf1sh' });
    const hexKey = await importSigningKey('HS256', {
      format: 'secret',
      encoding: 'hex',
      value: '73773072646631736800',
    }); // hex won't match utf8's bytes exactly; imported independently below
    const base64Key = await importSigningKey('HS256', {
      format: 'secret',
      encoding: 'base64',
      value: Buffer.from('sw0rdf1sh', 'utf8').toString('base64'),
    });
    const utf8Verify = await importVerifyingKey('HS256', { format: 'secret', encoding: 'utf8', value: 'sw0rdf1sh' });
    const base64Verify = await importVerifyingKey('HS256', {
      format: 'secret',
      encoding: 'base64',
      value: Buffer.from('sw0rdf1sh', 'utf8').toString('base64'),
    });

    expect(await roundTripSignVerify('HS256', utf8Key, utf8Verify)).toBe(true);
    // Base64 of the same bytes as the UTF-8 secret must produce a key that verifies the UTF-8-signed message.
    expect(await roundTripSignVerify('HS256', utf8Key, base64Verify)).toBe(true);
    expect(await roundTripSignVerify('HS256', base64Key, utf8Verify)).toBe(true);
    // hexKey is a different secret value; just prove it imports and works on its own.
    const hexVerify = await importVerifyingKey('HS256', {
      format: 'secret',
      encoding: 'hex',
      value: '73773072646631736800',
    });
    expect(await roundTripSignVerify('HS256', hexKey, hexVerify)).toBe(true);
  });

  it('rejects an empty secret', async () => {
    await expect(importSigningKey('HS256', { format: 'secret', encoding: 'utf8', value: '' })).rejects.toThrow(/empty/);
  });

  it('rejects a shared secret for an algorithm that needs a public or private key, and vice versa', async () => {
    await expect(importSigningKey('RS256', { format: 'secret', encoding: 'utf8', value: 'x' })).rejects.toThrow(
      JwtKeyError,
    );
    const pair = await generateKeyPairFor('RS256');
    const pem = bytesToPem(
      new Uint8Array(await globalThis.crypto.subtle.exportKey('pkcs8', pair.privateKey)),
      'PRIVATE KEY',
    );
    await expect(importSigningKey('HS256', { format: 'pem-private', pem })).rejects.toThrow(JwtKeyError);
  });
});

describe('message hygiene: no rejection message anywhere in this tool ever contains key material', () => {
  const MARKER = 'zZ9kEY-mArKeR-f3e21';

  it('the marker never appears in any message across key import, JWK parsing, PEM parsing, header parsing, segment counting or Base64url decoding', async () => {
    const messages: string[] = [];

    const collect = async (fn: () => unknown | Promise<unknown>) => {
      try {
        const result = await fn();
        if (result && typeof (result as { message?: unknown }).message === 'string') {
          messages.push((result as { message: string }).message);
        }
      } catch (err) {
        messages.push(err instanceof Error ? err.message : String(err));
      }
    };

    // Malformed JWK JSON containing the marker.
    await collect(() => importSigningKey('RS256', { format: 'jwk', json: `{not json ${MARKER}` }));
    // Malformed PEM body containing the marker.
    await collect(() =>
      importSigningKey('RS256', {
        format: 'pem-private',
        pem: `-----BEGIN PRIVATE KEY-----\n${MARKER}!!!\n-----END PRIVATE KEY-----`,
      }),
    );
    // PEM labelled with the marker, rejected for the wrong label.
    await collect(() =>
      importSigningKey('RS256', {
        format: 'pem-private',
        pem: `-----BEGIN ${MARKER}-----\nAA==\n-----END ${MARKER}-----`,
      }),
    );
    // A secret whose hex encoding is invalid, with the marker as the value.
    await collect(() => importSigningKey('HS256', { format: 'secret', encoding: 'hex', value: MARKER }));

    // Token parser entry points (index.ts), still covered by this same assertion.
    await collect(() => splitCompact(`${MARKER}.only-one-dot`));
    await collect(() => splitCompact(`a.b.c.${MARKER}`));

    const okKey = await importVerifyingKey('HS256', { format: 'secret', encoding: 'utf8', value: 'k' });
    const okPayload = Buffer.from('{}').toString('base64url');

    const badHeaderJson = Buffer.from(`{not-json ${MARKER}`).toString('base64url');
    await collect(() => verify(`${badHeaderJson}.${okPayload}.sig`, okKey, { algorithm: 'HS256' }));

    const invalidBase64urlHeader = `${MARKER}!!!not-base64url`;
    await collect(() => verify(`${invalidBase64urlHeader}.${okPayload}.sig`, okKey, { algorithm: 'HS256' }));

    const okHeader = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
    const markerPayload = Buffer.from(`payload with ${MARKER} inside, not valid JSON either`).toString('base64url');
    await collect(() => verify(`${okHeader}.${markerPayload}.not-base64url-!!!`, okKey, { algorithm: 'HS256' }));

    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      expect(message).not.toContain(MARKER);
    }
  });
});
