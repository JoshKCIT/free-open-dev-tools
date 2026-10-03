import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readKeyInput } from '../src/detect';
import { keyOutputs } from '../src/index';
import { armour } from './fixtures/fixture-list';

/**
 * Specification: RFC 8032 section 5.1.5 (a public key is a point of the curve, and a key pair made by section 5.1.5 never
 * gives a point of small order) and RFC 8032 section 7.1, TEST 1 for an ordinary key. The identity point and the point of
 * order 2 are valid encodings that no key pair makes; they are read, with a warning, and not refused.
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

const WARNING =
  'This Ed25519 public key is a point of small order, which no real key pair has. Do not use it to check signatures.';

/** The encoding of the identity point (y = 1) and of the point of order 2 (y = -1, that is p - 1), little endian. */
const IDENTITY = Uint8Array.from({ length: 32 }, (_unused, i) => (i === 0 ? 1 : 0));
const ORDER_TWO = Uint8Array.from({ length: 32 }, (_unused, i) => (i === 0 ? 0xec : i === 31 ? 0x7f : 0xff));
const TEST1_PUBLIC = Uint8Array.from(
  Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'hex'),
);

const concat = (...parts: Uint8Array[]): Uint8Array => Uint8Array.from(parts.flatMap((part) => Array.from(part)));
const sshString = (bytes: Uint8Array): Uint8Array => concat(Uint8Array.of(0, 0, 0, bytes.length), bytes);

function forms(point: Uint8Array): [string, string][] {
  const spki = concat(Uint8Array.from(Buffer.from('302a300506032b6570032100', 'hex')), point);
  const blob = concat(sshString(new TextEncoder().encode('ssh-ed25519')), sshString(point));
  return [
    ['SPKI', armour('PUBLIC KEY', Buffer.from(spki).toString('base64'))],
    ['OpenSSH', `ssh-ed25519 ${Buffer.from(blob).toString('base64')}`],
    ['JWK', JSON.stringify({ kty: 'OKP', crv: 'Ed25519', x: Buffer.from(point).toString('base64url') })],
  ];
}

it('a small-order Ed25519 public key is read with a warning in every form, and an ordinary key without one', () => {
  for (const point of [IDENTITY, ORDER_TWO]) {
    for (const [name, text] of forms(point)) {
      const read = readKeyInput(text);
      expect(read.key.type, name).toBe('ed25519');
      expect(read.warnings, name).toEqual([WARNING]);
      // The outputs carry the same warning, so the page shows it beside what it wrote.
      expect(keyOutputs(read.key, { comment: '' }).warnings, name).toEqual([WARNING]);
    }
  }
  for (const [name, text] of forms(TEST1_PUBLIC)) expect(readKeyInput(text).warnings, name).toEqual([]);
});
