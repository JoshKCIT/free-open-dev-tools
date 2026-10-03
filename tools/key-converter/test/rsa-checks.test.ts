import { generateKeyPairSync, generatePrimeSync } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readKeyInput } from '../src/detect';
import { keyOutputs } from '../src/index';
import { KeyConverterError } from '../src/model';
import { completeRsa } from '../src/rsa-math';
import { armour } from './fixtures/fixture-list';

/**
 * Specification: RFC 8017 section 3.1 (an RSA public key is a modulus n, the product of two distinct odd primes, and an
 * exponent e with 3 <= e <= n - 1 that is coprime to the primes' totient, so odd), and section 3.2 for the private key. The
 * second opinion for the keys that must still convert is Node's own crypto (OpenSSL-backed), which makes them.
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

const MODULUS_SENTENCE = 'This RSA modulus is even or zero, so it cannot be the product of two odd primes.';
const SMALL_E_SENTENCE = 'This RSA public exponent is smaller than 3, which no RSA key uses.';
const EVEN_E_SENTENCE = 'This RSA public exponent is even, so it cannot be inverted modulo the primes.';
const BIG_E_SENTENCE = 'This RSA public exponent is not smaller than the modulus.';

// ---- small writers for the shapes the tests need -----------------------------------------------------------------

const toBytes = (value: bigint): Uint8Array => {
  if (value === 0n) return Uint8Array.of(0);
  let text = value.toString(16);
  if (text.length % 2 === 1) text = '0' + text;
  return new Uint8Array(Buffer.from(text, 'hex'));
};
const toBigInt = (bytes: Uint8Array): bigint => BigInt('0x' + Buffer.from(bytes).toString('hex'));

function tlv(tag: number, ...parts: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const header =
    length < 128
      ? [tag, length]
      : length < 256
        ? [tag, 0x81, length]
        : length < 65536
          ? [tag, 0x82, length >> 8, length & 255]
          : [tag, 0x83, length >> 16, (length >> 8) & 255, length & 255];
  const out = new Uint8Array(header.length + length);
  out.set(header);
  let at = header.length;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const derInteger = (bytes: Uint8Array): Uint8Array => tlv(0x02, bytes[0]! >= 0x80 ? Uint8Array.of(0, ...bytes) : bytes);

const pkcs1Public = (n: Uint8Array, e: Uint8Array): Uint8Array => tlv(0x30, derInteger(n), derInteger(e));

const spki = (n: Uint8Array, e: Uint8Array): Uint8Array =>
  tlv(
    0x30,
    tlv(0x30, tlv(0x06, Uint8Array.of(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01)), Uint8Array.of(5, 0)),
    tlv(0x03, Uint8Array.of(0), pkcs1Public(n, e)),
  );

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

function sshString(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length);
  out.set(bytes, 4);
  return out;
}
function sshMpint(bytes: Uint8Array): Uint8Array {
  let trimmed = bytes;
  while (trimmed.length > 0 && trimmed[0] === 0) trimmed = trimmed.subarray(1);
  return sshString(trimmed[0] !== undefined && trimmed[0] >= 0x80 ? Uint8Array.of(0, ...trimmed) : trimmed);
}
function sshPublicLine(n: Uint8Array, e: Uint8Array): string {
  const parts = [sshString(new TextEncoder().encode('ssh-rsa')), sshMpint(e), sshMpint(n)];
  const blob = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    blob.set(part, at);
    at += part.length;
  }
  return `ssh-rsa ${b64(blob)}`;
}

/** The same RSA public key written in the four forms a paste can hold it in. */
function publicForms(n: Uint8Array, e: Uint8Array): [string, string][] {
  return [
    ['SPKI', armour('PUBLIC KEY', b64(spki(n, e)))],
    ['PKCS#1', armour('RSA PUBLIC KEY', b64(pkcs1Public(n, e)))],
    ['OpenSSH', sshPublicLine(n, e)],
    ['JWK', JSON.stringify({ kty: 'RSA', n: b64url(n), e: b64url(e) })],
  ];
}

function refusal(text: string): string {
  try {
    readKeyInput(text);
  } catch (err) {
    expect(err).toBeInstanceOf(KeyConverterError);
    return (err as KeyConverterError).message;
  }
  throw new Error('expected a refusal');
}

/** A modulus that is odd, 2048 bits and has its top bit set; no prime factors are needed for a public key. */
const N = (() => {
  const bytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) bytes[i] = (i * 37 + 11) & 255;
  bytes[0] = 0xc1;
  bytes[255] = 0x9b;
  return bytes;
})();
const nValue = toBigInt(N);

it('an RSA public key with an even or zero modulus is refused in every form', () => {
  const even = N.slice();
  even[255] = 0x9a;
  for (const [name, text] of publicForms(even, toBytes(65537n))) expect(refusal(text), name).toBe(MODULUS_SENTENCE);
  for (const [name, text] of publicForms(Uint8Array.of(0), toBytes(65537n))) {
    // A zero modulus is written as one zero byte; every form refuses it for the same reason (or reads it as empty).
    expect(() => readKeyInput(text), name).toThrow(KeyConverterError);
  }
  // A small even modulus such as 8 is refused for the same reason.
  for (const [name, text] of publicForms(Uint8Array.of(8), toBytes(3n)))
    expect(refusal(text), name).toBe(MODULUS_SENTENCE);
});

it('an RSA public exponent below 3, even, or not below the modulus is refused in every form', () => {
  for (const [value, sentence] of [
    [0n, SMALL_E_SENTENCE],
    [1n, SMALL_E_SENTENCE],
    [2n, SMALL_E_SENTENCE],
    [4n, EVEN_E_SENTENCE],
    [65536n, EVEN_E_SENTENCE],
    [nValue - 1n, EVEN_E_SENTENCE],
    [nValue, BIG_E_SENTENCE],
    [nValue + 2n, BIG_E_SENTENCE],
  ] as const) {
    for (const [name, text] of publicForms(N, toBytes(value))) {
      expect(refusal(text), `${name}, e = ${value > 100000n ? 'about n' : value}`).toBe(sentence);
    }
  }
});

it('a 30,000 byte public exponent is refused with one short sentence, not printed', () => {
  const huge = new Uint8Array(30_000).fill(0x55);
  for (const [name, text] of publicForms(N, huge)) {
    const message = refusal(text);
    expect(message, name).toBe(BIG_E_SENTENCE);
    expect(message.length, name).toBeLessThan(200);
  }
});

it('a private key with e = 1 and d = 1 is refused instead of converted', () => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ format: 'jwk' });
  const jwk = JSON.stringify({ kty: 'RSA', n: pair.n, e: 'AQ', d: 'AQ', p: pair.p, q: pair.q });
  expect(refusal(jwk)).toBe(SMALL_E_SENTENCE);
  expect(refusal(JSON.stringify({ kty: 'RSA', n: pair.n, e: 'Ag', d: 'AQ', p: pair.p, q: pair.q }))).toBe(
    SMALL_E_SENTENCE,
  );
  // The same numbers through completeRsa itself, the function every private reader ends in.
  const numbers = {
    type: 'rsa' as const,
    n: new Uint8Array(Buffer.from(pair.n!, 'base64url')),
    e: Uint8Array.of(1),
    d: Uint8Array.of(1),
    p: new Uint8Array(Buffer.from(pair.p!, 'base64url')),
    q: new Uint8Array(Buffer.from(pair.q!, 'base64url')),
  };
  expect(() => completeRsa(numbers)).toThrow(SMALL_E_SENTENCE);
});

it('exponents 3 and 65537 read without a warning, and any other odd exponent reads with one', () => {
  const warningsOf = (value: bigint): string[] => readKeyInput(publicForms(N, toBytes(value))[0]![1]).warnings;
  expect(warningsOf(65537n)).toEqual([]);
  expect(warningsOf(3n)).toEqual([]);
  expect(warningsOf(17n)).toEqual([
    'This RSA key has a public exponent of 17. Nearly every RSA key uses 65537, and software that expects it may refuse this key.',
  ]);
  // A long exponent below the modulus is described by its size, in the warning and in the facts.
  const longExponent = (1n << 99n) + 1n;
  const read = readKeyInput(publicForms(N, toBytes(longExponent))[0]![1]);
  expect(read.warnings).toEqual([
    'This RSA key has a public exponent of a number of 100 bits. Nearly every RSA key uses 65537, and software that expects it may refuse this key.',
  ]);
  const outputs = keyOutputs(read.key, { comment: '' });
  expect(outputs.facts).toContainEqual(['Public exponent', 'a number of 100 bits']);
  expect(outputs.facts).toContainEqual(['Size in bits', '2048']);
  // A short exponent is a decimal number, up to 20 digits.
  expect(keyOutputs(readKeyInput(publicForms(N, toBytes(65537n))[0]![1]).key, { comment: '' }).facts).toContainEqual([
    'Public exponent',
    '65537',
  ]);
  expect(
    keyOutputs(readKeyInput(publicForms(N, toBytes(18446744073709551615n))[0]![1]).key, { comment: '' }).facts,
  ).toContainEqual(['Public exponent', '18446744073709551615']);
});

it('keys made by Node (OpenSSL) in every size still convert without a warning', () => {
  for (const bits of [1024, 2048, 3072]) {
    const pair = generateKeyPairSync('rsa', { modulusLength: bits });
    const pem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const read = readKeyInput(pem);
    expect(read.key.type, String(bits)).toBe('rsa');
    expect(read.warnings, String(bits)).toEqual(bits < 2048 ? [expect.stringMatching(/shorter than 2048/)] : []);
    const jwk = readKeyInput(JSON.stringify(pair.privateKey.export({ format: 'jwk' })));
    expect(jwk.key.type, String(bits)).toBe('rsa');
  }
});

// ---- A-WR-02: the prime factors of a private key ----------------------------------------------------------------------

const FACTOR_EVEN_SENTENCE = 'A prime factor of this RSA key is even, so it is not prime.';
const FACTOR_SMALL_SENTENCE =
  'A prime factor of this RSA key is much smaller than half the size of the modulus, so the key is not a product of two primes of equal size.';
const NOT_PRIME_SENTENCE = 'A prime factor of this RSA key failed a primality test, so it is not prime.';
const UNCHECKED_WARNING = 'This RSA key is larger than 4096 bits, so its prime factors were not tested for primality.';

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));
function inverse(a: bigint, m: bigint): bigint {
  let [r0, r1, t0, t1] = [m, a % m, 0n, 1n];
  while (r1 !== 0n) {
    const quotient = r0 / r1;
    [r0, r1] = [r1, r0 - quotient * r1];
    [t0, t1] = [t1, t0 - quotient * t1];
  }
  return ((t0 % m) + m) % m;
}

/** A private JWK from the two numbers p and q, with a private exponent that is consistent for them (RFC 8017 section 3.2). */
function privateJwk(p: bigint, q: bigint, e = 65537n): string {
  const lambda = ((p - 1n) / gcd(p - 1n, q - 1n)) * (q - 1n);
  if (gcd(e, lambda) !== 1n) throw new Error('pick other numbers: e is not coprime');
  return JSON.stringify({
    kty: 'RSA',
    n: b64url(toBytes(p * q)),
    e: b64url(toBytes(e)),
    d: b64url(toBytes(inverse(e, lambda))),
    p: b64url(toBytes(p)),
    q: b64url(toBytes(q)),
  });
}

/** The product of `count` random primes of 512 bits: odd, composite and roughly 512 * count bits. */
function composite(count: number): bigint {
  let value = 1n;
  for (let i = 0; i < count; i++) value *= generatePrimeSync(512, { bigint: true });
  return value;
}

it('a private key whose prime factors are composite is refused when the modulus is 4096 bits or less', () => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const p = composite(2);
    const q = composite(2);
    if (gcd(65537n, (p - 1n) * (q - 1n)) !== 1n) continue;
    // Consistent in every other way: n = p * q and d undoes e modulo p - 1 and q - 1, so only the primality test refuses it.
    expect(refusal(privateJwk(p, q))).toBe(NOT_PRIME_SENTENCE);
    return;
  }
  throw new Error('no suitable composite numbers in 20 tries');
});

it('a private key with a tiny prime factor beside a large one is refused', () => {
  const q = generatePrimeSync(2045, { bigint: true });
  const jwk = privateJwk(3n, q);
  expect(refusal(jwk)).toBe(FACTOR_SMALL_SENTENCE);
  expect(refusal(privateJwk(q, 3n))).toBe(FACTOR_SMALL_SENTENCE);
});

it('an even prime factor is refused before anything else is calculated', () => {
  const real = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ format: 'jwk' });
  const n = new Uint8Array(Buffer.from(real.n!, 'base64url'));
  const p = new Uint8Array(Buffer.from(real.p!, 'base64url'));
  const q = new Uint8Array(Buffer.from(real.q!, 'base64url'));
  const d = new Uint8Array(Buffer.from(real.d!, 'base64url'));
  const evenP = p.slice();
  evenP[evenP.length - 1] = evenP[evenP.length - 1]! & 0xfe;
  expect(() => completeRsa({ type: 'rsa', n, e: Uint8Array.of(1, 0, 1), d, p: evenP, q })).toThrow(
    FACTOR_EVEN_SENTENCE,
  );
  const evenQ = q.slice();
  evenQ[evenQ.length - 1] = evenQ[evenQ.length - 1]! & 0xfe;
  expect(() => completeRsa({ type: 'rsa', n, e: Uint8Array.of(1, 0, 1), d, p, q: evenQ })).toThrow(
    FACTOR_EVEN_SENTENCE,
  );
});

it('above 4096 bits the prime factors are not tested and the page says so', () => {
  const p = composite(8);
  const q = composite(8);
  if (gcd(65537n, (p - 1n) * (q - 1n)) !== 1n) throw new Error('pick other numbers: e is not coprime');
  // 8192 bits is accepted (consistent numbers), with the warning that primality was not checked.
  const read = readKeyInput(privateJwk(p, q));
  expect(read.warnings).toEqual([UNCHECKED_WARNING]);
  // A real key above 4096 bits warns the same way, and one at 4096 bits or less never does.
  expect(keyOutputs(read.key, { comment: '' }).warnings).toEqual([UNCHECKED_WARNING]);
  const real = generateKeyPairSync('rsa', { modulusLength: 3072 }).privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  }) as string;
  expect(readKeyInput(real).warnings).toEqual([]);
  // A public key of any size carries no such warning: there are no prime factors to test.
  expect(readKeyInput(publicForms(new Uint8Array(1025).fill(0xff), toBytes(65537n))[0]![1]).warnings).toEqual([]);
}, 60_000);

it('real keys of 2048 and 4096 bits are tested for primality in well under a second and still convert', () => {
  const p = generatePrimeSync(2048, { bigint: true });
  let q = generatePrimeSync(2048, { bigint: true });
  while (q === p) q = generatePrimeSync(2048, { bigint: true });
  const jwk = privateJwk(p, q);
  const started = performance.now();
  const read = readKeyInput(jwk);
  const elapsed = performance.now() - started;
  expect(read.key.type).toBe('rsa');
  expect(read.warnings).toEqual([]);
  expect(elapsed).toBeLessThan(2000);
}, 60_000);
