import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readPkcs8, readSpki, writePkcs8, writeSpki } from '../src/formats';
import { generateEc, generateEd25519 } from '../src/generate';
import { KeyConverterError, type Curve } from '../src/model';
import { sshPublicLine } from '../src/openssh';

/**
 * Specification: RFC 8032 section 7.1 (TEST 1: a seed and the public key it gives), RFC 8410 (the Ed25519 PKCS#8 and
 * SubjectPublicKeyInfo layouts and the examples of its sections 4 and 7), RFC 8709 (the ssh-ed25519 line) and the W3C Web
 * Cryptography API (ECDSA key generation). Randomness is checked by watching the two places it may come from.
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

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const fromHex = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'hex'));
const fromBase64 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'base64'));

// RFC 8032 section 7.1, TEST 1.
const TEST1_SEED = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const TEST1_PUBLIC = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';

// RFC 8410 section 4 (the public key example) and section 7 (the private key example), as Base64 of the DER.
const RFC8410_PUBLIC_B64 = 'MCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDFw4rXAxZuE=';
const RFC8410_PRIVATE_B64 = 'MC4CAQAwBQYDK2VwBCIEINTuctv5E1hK1bbY8fdp+K06/nwoy/HU++CXqI9EdVhC';

it('Ed25519 from the RFC 8032 test 1 seed gives the published public key and a 48 byte PKCS8', () => {
  // The generator asks the browser's generator for 32 bytes; here that generator hands back the RFC 8032 seed.
  // @noble/curves 2.4.0 asks the same generator for 16 bytes of its own (blinding) while it computes a public key, so only
  // the request for the 32 byte seed is answered with the RFC 8032 seed, and every other request goes to the real one.
  const realRandom = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  const random = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(((array: Uint8Array) => {
    if (array.length !== 32) return realRandom(array);
    array.set(fromHex(TEST1_SEED));
    return array;
  }) as typeof globalThis.crypto.getRandomValues);
  let key;
  try {
    key = generateEd25519();
  } finally {
    random.mockRestore();
  }
  expect(key.type).toBe('ed25519');
  expect(hex(key.seed!)).toBe(TEST1_SEED);
  expect(hex(key.pub)).toBe(TEST1_PUBLIC);

  // RFC 8410 section 7: SEQUENCE { INTEGER 0, SEQUENCE { OID 1.3.101.112 }, OCTET STRING { OCTET STRING seed } }.
  const pkcs8 = writePkcs8(key);
  expect(pkcs8.length).toBe(48);
  expect(hex(pkcs8)).toBe('302e020100300506032b657004220420' + TEST1_SEED);
  // RFC 8410 section 4: SEQUENCE { SEQUENCE { OID 1.3.101.112 }, BIT STRING key }.
  const spki = writeSpki(key);
  expect(spki.length).toBe(44);
  expect(hex(spki)).toBe('302a300506032b6570032100' + TEST1_PUBLIC);

  // The RFC's own two examples read back and are written again byte for byte.
  const examplePrivate = readPkcs8(fromBase64(RFC8410_PRIVATE_B64));
  expect(examplePrivate.type).toBe('ed25519');
  if (examplePrivate.type !== 'ed25519') throw new Error('not an Ed25519 key');
  expect(hex(examplePrivate.seed!)).toBe('d4ee72dbf913584ad5b6d8f1f769f8ad3afe7c28cbf1d4fbe097a88f44755842');
  expect(Buffer.from(writePkcs8(examplePrivate)).toString('base64')).toBe(RFC8410_PRIVATE_B64);
  const examplePublic = readSpki(fromBase64(RFC8410_PUBLIC_B64));
  expect(examplePublic.type).toBe('ed25519');
  expect(Buffer.from(writeSpki(examplePublic)).toString('base64')).toBe(RFC8410_PUBLIC_B64);

  // RFC 8709: the line for the RFC 8032 public key, as ssh-keygen 10.2p1 reads it.
  expect(sshPublicLine({ type: 'ed25519', pub: fromHex(TEST1_PUBLIC) }, '')).toBe(
    'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINdamAGCsQq31Uv+08lkBzoO4XLz2qYjJa8CGmj3B1Ea',
  );
});

it('generateEd25519 takes its seed from crypto.getRandomValues and generateEc from Web Crypto', async () => {
  const mathRandom = vi.spyOn(Math, 'random');
  const random = vi.spyOn(globalThis.crypto, 'getRandomValues');
  const generate = vi.spyOn(globalThis.crypto.subtle, 'generateKey');
  try {
    const key = generateEd25519();
    // Every request for random bytes in the run went to crypto.getRandomValues. Exactly one asked for 32 bytes, which is
    // the seed; the others are the 16 bytes @noble/curves asks for itself while it computes the public key.
    const requests = random.mock.calls.map((call) => call[0] as Uint8Array);
    for (const request of requests) expect(request).toBeInstanceOf(Uint8Array);
    const seedRequests = requests.filter((request) => request.length === 32);
    expect(seedRequests.length).toBe(1);
    expect(hex(key.seed!)).toBe(hex(seedRequests[0]!));
    // Two keys are two different seeds, and a seed is never all zeros.
    const other = generateEd25519();
    expect(hex(other.seed!)).not.toBe(hex(key.seed!));
    expect(hex(key.seed!)).not.toBe('00'.repeat(32));

    for (const curve of ['P-256', 'P-384', 'P-521'] as Curve[]) {
      generate.mockClear();
      const ec = await generateEc(curve);
      expect(generate).toHaveBeenCalledTimes(1);
      const [algorithm, extractable, usages] = generate.mock.calls[0]!;
      expect(algorithm).toEqual({ name: 'ECDSA', namedCurve: curve });
      expect(extractable).toBe(true);
      expect(usages).toEqual(['sign', 'verify']);
      expect(ec.type).toBe('ec');
      expect(ec.curve).toBe(curve);
    }
    // No non-cryptographic random source was touched by any of it.
    expect(mathRandom).not.toHaveBeenCalled();
  } finally {
    mathRandom.mockRestore();
    random.mockRestore();
    generate.mockRestore();
  }

  // And none exists in the package: no other source of randomness, no clock and no Node-only module in src.
  const sourceDir = new URL('../src/', import.meta.url);
  const forbidden = [
    'Math.random',
    'randomBytes',
    'randomUUID',
    'randomInt',
    'Date.now',
    'performance.now',
    'node:crypto',
    'from "crypto"',
    "from 'crypto'",
    'utils.randomSecretKey',
    'utils.randomPrivateKey',
    'keygen(',
  ];
  let sawGetRandomValues = 0;
  for (const name of readdirSync(sourceDir).filter((file) => file.endsWith('.ts'))) {
    const text = readFileSync(new URL(name, sourceDir), 'utf8');
    for (const word of forbidden) expect(text.includes(word), `${name} uses ${word}`).toBe(false);
    if (text.includes('getRandomValues(')) sawGetRandomValues++;
  }
  expect(sawGetRandomValues).toBe(1);
}, 60_000);

it('a generated ECDSA key is refused when the public part the engine gives is not the private key public part', async () => {
  const foreign = await globalThis.crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const foreignSpki = new Uint8Array(
    await globalThis.crypto.subtle.exportKey('spki', (foreign as CryptoKeyPair).publicKey),
  );
  const realExport = globalThis.crypto.subtle.exportKey.bind(globalThis.crypto.subtle);
  const exportSpy = vi
    .spyOn(globalThis.crypto.subtle, 'exportKey')
    .mockImplementation((async (format: string, key: CryptoKey) =>
      format === 'spki'
        ? foreignSpki.buffer.slice(0)
        : realExport(format as 'pkcs8', key)) as typeof globalThis.crypto.subtle.exportKey);
  let outcome: unknown;
  try {
    outcome = await generateEc('P-256').then(
      () => 'made a key',
      (err: unknown) => err,
    );
  } finally {
    exportSpy.mockRestore();
  }
  expect(outcome).toBeInstanceOf(KeyConverterError);
  expect((outcome as KeyConverterError).message).toMatch(/does not belong/i);
  // Nothing but the three curves is offered.
  const refused = await generateEc('P-192' as Curve).then(
    () => 'made a key',
    (err: unknown) => err,
  );
  expect(refused).toBeInstanceOf(KeyConverterError);
}, 60_000);

it('an Ed25519 key is made where crypto.subtle is missing, because it needs only getRandomValues', async () => {
  const real = globalThis.crypto;
  // A page that is not in a secure context has getRandomValues but no crypto.subtle.
  vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) });
  try {
    const key = generateEd25519();
    expect(key.type).toBe('ed25519');
    expect(key.seed).toHaveLength(32);
    // The generators that do need Web Crypto still say so in one plain sentence.
    await expect(generateEc('P-256')).rejects.toThrow(/crypto\.subtle\) is not available here/);
  } finally {
    vi.unstubAllGlobals();
  }
  // With no random generator at all, the refusal is a plain sentence of the package, not a TypeError.
  vi.stubGlobal('crypto', undefined);
  try {
    expect(() => generateEd25519()).toThrow(KeyConverterError);
    expect(() => generateEd25519()).toThrow(/random number generator/);
  } finally {
    vi.unstubAllGlobals();
  }
});
