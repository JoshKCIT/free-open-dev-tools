import { describe, it, expect } from 'vitest';
import { decodeJwt, segments } from '../src/index';

// The example token from RFC 7519 section 3.1, with its documented claims.
const RFC7519_EXAMPLE =
  'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9.' +
  'eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ.' +
  'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

const NOW = Date.UTC(2026, 0, 1);

function makeToken(header: object, payload: object, signature = 'sig'): string {
  const enc = (o: object) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');
  return `${enc(header)}.${enc(payload)}.${signature}`;
}

describe('RFC 7519 example token', () => {
  const decoded = decodeJwt(RFC7519_EXAMPLE, { now: NOW });

  it('reads the header', () => {
    expect(decoded.shape).toBe('jws');
    expect(decoded.header).toEqual({ typ: 'JWT', alg: 'HS256' });
    expect(decoded.algorithm).toBe('HS256');
  });

  it('reads the payload, including the URI-named custom claim', () => {
    expect(decoded.payload).toEqual({
      iss: 'joe',
      exp: 1300819380,
      'http://example.com/is_root': true,
    });
  });

  it('exposes the exact bytes a verifier would sign', () => {
    expect(decoded.signingInput).toBe(RFC7519_EXAMPLE.split('.').slice(0, 2).join('.'));
  });

  it('reports the signature length in bytes', () => {
    // HS256 produces a 32 byte MAC.
    expect(decoded.signatureBytes).toBe(32);
  });

  it('notices this token expired in 2011', () => {
    expect(decoded.warnings.some((w) => w.severity === 'error' && /expired/.test(w.message))).toBe(true);
  });
});

describe('the decoding is not verification message', () => {
  it('is present on every successfully decoded token', () => {
    const decoded = decodeJwt(makeToken({ alg: 'HS256' }, { sub: 'x', exp: 4102444800 }), { now: NOW });
    expect(decoded.warnings.some((w) => /not verification/i.test(w.message))).toBe(true);
  });
});

describe('alg: none', () => {
  it('is reported as an error, not a curiosity', () => {
    const token = makeToken({ alg: 'none', typ: 'JWT' }, { sub: 'admin' }, '');
    const decoded = decodeJwt(token, { now: NOW });
    const err = decoded.warnings.find((w) => w.severity === 'error' && /unsigned/.test(w.message));
    expect(err).toBeDefined();
    expect(err!.message).toMatch(/anyone can forge/);
  });

  it('catches the capitalised variant used to slip past naive checks', () => {
    const decoded = decodeJwt(makeToken({ alg: 'NONE' }, { sub: 'x' }, ''), { now: NOW });
    expect(decoded.warnings.some((w) => w.severity === 'error' && /unsigned/.test(w.message))).toBe(true);
  });
});

describe('claim validation', () => {
  it('flags an expired token', () => {
    const decoded = decodeJwt(makeToken({ alg: 'HS256' }, { exp: NOW / 1000 - 3600 }), { now: NOW });
    expect(decoded.warnings.some((w) => w.severity === 'error' && /expired/.test(w.message))).toBe(true);
  });

  it('accepts a token that has not expired', () => {
    const decoded = decodeJwt(makeToken({ alg: 'HS256' }, { exp: NOW / 1000 + 3600 }), { now: NOW });
    expect(decoded.warnings.some((w) => /expired/.test(w.message))).toBe(false);
  });

  it('warns when there is no expiry at all', () => {
    const decoded = decodeJwt(makeToken({ alg: 'HS256' }, { sub: 'x' }), { now: NOW });
    expect(decoded.warnings.some((w) => /never expires/.test(w.message))).toBe(true);
  });

  it('flags a not-before time in the future', () => {
    const decoded = decodeJwt(makeToken({ alg: 'HS256' }, { exp: NOW / 1000 + 7200, nbf: NOW / 1000 + 3600 }), {
      now: NOW,
    });
    expect(decoded.warnings.some((w) => /not valid yet/.test(w.message))).toBe(true);
  });

  it('catches the classic milliseconds mistake', () => {
    // JWT timestamps are seconds. Passing Date.now() directly is a common bug.
    const decoded = decodeJwt(makeToken({ alg: 'HS256' }, { exp: NOW }), { now: NOW });
    expect(decoded.warnings.some((w) => w.severity === 'error' && /milliseconds/.test(w.message))).toBe(true);
  });

  it('rejects a non-numeric exp', () => {
    const decoded = decodeJwt(makeToken({ alg: 'HS256' }, { exp: '2026-01-01' }), { now: NOW });
    expect(decoded.warnings.some((w) => /must be a number of seconds/.test(w.message))).toBe(true);
  });

  it('flags an issued-at time in the future', () => {
    const decoded = decodeJwt(makeToken({ alg: 'HS256' }, { exp: NOW / 1000 + 9999, iat: NOW / 1000 + 600 }), {
      now: NOW,
    });
    expect(decoded.warnings.some((w) => /"iat" claim is in the future/.test(w.message))).toBe(true);
  });
});

describe('claim presentation', () => {
  const decoded = decodeJwt(
    makeToken(
      { alg: 'RS256', typ: 'JWT', kid: 'key-1' },
      { zzz: 1, iss: 'https://issuer', sub: 'user-1', aud: ['a', 'b'], exp: NOW / 1000 + 60, custom: { a: 1 } },
    ),
    { now: NOW },
  );

  it('puts the registered claims first, in specification order', () => {
    expect(decoded.claims.slice(0, 4).map((c) => c.name)).toEqual(['iss', 'sub', 'aud', 'exp']);
  });

  it('describes registered claims and marks the rest as custom', () => {
    expect(decoded.claims.find((c) => c.name === 'iss')!.description).toMatch(/Issuer/);
    expect(decoded.claims.find((c) => c.name === 'custom')!.description).toMatch(/Custom claim/);
  });

  it('renders a time claim as an ISO date with a relative offset', () => {
    const exp = decoded.claims.find((c) => c.name === 'exp')!;
    expect(exp.display).toMatch(/^2026-01-01T00:01:00\.000Z \(in 1 minute\)$/);
  });

  it('renders an array audience as a comma-separated list', () => {
    expect(decoded.claims.find((c) => c.name === 'aud')!.display).toBe('a, b');
  });

  it('reads the key id from the header', () => {
    expect(decoded.keyId).toBe('key-1');
  });
});

describe('malformed input', () => {
  it('says how many segments it found when the count is wrong', () => {
    const decoded = decodeJwt('abc.def', { now: NOW });
    expect(decoded.errors[0]).toMatch(/This has 2/);
  });

  it('recognises a five segment JWE and explains why the payload is unreadable', () => {
    const decoded = decodeJwt(makeToken({ alg: 'RSA-OAEP', enc: 'A256GCM' }, {}) + '.iv.tag', { now: NOW });
    expect(decoded.shape).toBe('jwe');
    expect(decoded.errors[0]).toMatch(/encrypted token/);
    expect(decoded.header?.alg).toBe('RSA-OAEP');
  });

  it('reports a segment that is not valid Base64url', () => {
    const decoded = decodeJwt('!!!.eyJhIjoxfQ.sig', { now: NOW });
    expect(decoded.errors.some((e) => /Header/.test(e))).toBe(true);
  });

  it('reports a segment that decodes to something other than JSON', () => {
    const notJson = Buffer.from('hello there', 'utf8').toString('base64url');
    const decoded = decodeJwt(`${notJson}.${notJson}.sig`, { now: NOW });
    expect(decoded.errors.some((e) => /not valid JSON/.test(e))).toBe(true);
  });

  it('handles an empty input without throwing', () => {
    expect(decodeJwt('', { now: NOW }).errors[0]).toMatch(/No token/);
  });

  it('strips a Bearer prefix, which is how tokens are usually copied', () => {
    const decoded = decodeJwt(`Bearer ${RFC7519_EXAMPLE}`, { now: NOW });
    expect(decoded.header).toEqual({ typ: 'JWT', alg: 'HS256' });
  });

  it('tolerates surrounding whitespace and line breaks', () => {
    const decoded = decodeJwt(`  \n${RFC7519_EXAMPLE}\n  `, { now: NOW });
    expect(decoded.shape).toBe('jws');
  });

  it('never throws, whatever it is given', () => {
    const inputs = ['.', '..', '...', 'a.b.c', '\u0000.\u0000.\u0000', 'ey.ey.ey', '.'.repeat(100), '👋.👋.👋'];
    for (const input of inputs) {
      expect(() => decodeJwt(input, { now: NOW })).not.toThrow();
    }
  });

  it('handles a header that decodes to an array rather than an object', () => {
    const arr = Buffer.from('[1,2,3]', 'utf8').toString('base64url');
    const decoded = decodeJwt(`${arr}.${arr}.sig`, { now: NOW });
    expect(decoded.header).toBeUndefined();
    expect(decoded.algorithm).toBeUndefined();
  });
});

describe('Unicode in claims', () => {
  it('decodes non-ASCII claim values correctly', () => {
    const decoded = decodeJwt(makeToken({ alg: 'HS256' }, { name: 'Ana Sánchez 👋', exp: NOW / 1000 + 60 }), {
      now: NOW,
    });
    expect((decoded.payload as Record<string, string>).name).toBe('Ana Sánchez 👋');
  });
});

describe('segments helper', () => {
  it('splits without decoding so a broken token still shows its shape', () => {
    expect(segments('a.b.c')).toEqual(['a', 'b', 'c']);
    expect(segments('Bearer a.b.c')).toEqual(['a', 'b', 'c']);
  });
});
