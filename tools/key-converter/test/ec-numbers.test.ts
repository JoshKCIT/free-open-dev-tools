import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readKeyInput } from '../src/detect';
import { KeyConverterError } from '../src/model';

/**
 * A JWK for an elliptic curve key holds x and y (public coordinates) and d (the private number), each as large as the
 * curve's field or order (RFC 7518 section 6.2.1). A number that is too long is refused, and the sentence names the member
 * that was too long: a public coordinate is not a private number.
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

const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');
const long = (size: number): Uint8Array => Uint8Array.from({ length: size }, (_unused, i) => (i === 0 ? 1 : 7));

function refusal(text: string): string {
  try {
    readKeyInput(text);
  } catch (err) {
    expect(err).toBeInstanceOf(KeyConverterError);
    return (err as KeyConverterError).message;
  }
  throw new Error('expected a refusal');
}

it('a JWK x or y that is too long is called a public coordinate and a d that is too long a private number', () => {
  const jwk = (members: Record<string, string>): string => JSON.stringify({ kty: 'EC', crv: 'P-256', ...members });
  const ok = b64url(long(32));
  expect(refusal(jwk({ x: b64url(long(33)), y: ok }))).toBe(
    'A public key coordinate is longer than this curve allows.',
  );
  expect(refusal(jwk({ x: ok, y: b64url(long(33)) }))).toBe(
    'A public key coordinate is longer than this curve allows.',
  );
  // A real point, so that the private number is the only thing wrong.
  const real = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'jwk' });
  expect(refusal(jwk({ x: real.x!, y: real.y!, d: b64url(long(33)) }))).toBe(
    'The private number is longer than this curve allows.',
  );
});
