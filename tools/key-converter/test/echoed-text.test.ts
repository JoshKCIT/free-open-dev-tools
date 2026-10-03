import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readKeyInput } from '../src/detect';
import { KeyConverterError } from '../src/model';
import { armour } from './fixtures/fixture-list';

/**
 * A message may name what it could not read, but it must not copy a long pasted value back: an algorithm identifier or a
 * block label is shown only up to 40 characters, and a short, ordinary one is shown whole.
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

function tlv(tag: number, ...parts: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const header =
    length < 128 ? [tag, length] : length < 256 ? [tag, 0x81, length] : [tag, 0x82, length >> 8, length & 255];
  const out = new Uint8Array(header.length + length);
  out.set(header);
  let at = header.length;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A SubjectPublicKeyInfo whose algorithm identifier is the given content bytes (the first arc pair, then more arcs). */
function spkiWithAlgorithm(oidContent: Uint8Array): string {
  const der = tlv(0x30, tlv(0x30, tlv(0x06, oidContent)), tlv(0x03, Uint8Array.of(0, 1, 2, 3)));
  return armour('PUBLIC KEY', Buffer.from(der).toString('base64'));
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

it('an unknown algorithm identifier is named whole when short and cut at 40 characters when long', () => {
  // 1.2.3.4 is 2a 03 04.
  expect(refusal(spkiWithAlgorithm(Uint8Array.of(0x2a, 3, 4)))).toBe(
    'This key uses the algorithm 1.2.3.4, which this page does not read.',
  );
  // 500 arcs of 1 to 99 give an identifier of well over a thousand characters.
  const long = new Uint8Array(501);
  long[0] = 0x2a;
  for (let i = 1; i < long.length; i++) long[i] = 99;
  const message = refusal(spkiWithAlgorithm(long));
  expect(message.length).toBeLessThan(110);
  const shown = /^This key uses the algorithm (\S+), which this page does not read\.$/.exec(message)?.[1];
  expect(shown).toBe('1.2' + '.99'.repeat(12) + '.' + '...');
});

it('a block label is named whole when short and cut at 40 characters when long', () => {
  const body = '!!!!';
  const short = armour('PRIVATE KEY', body);
  expect(refusal(short)).toBe('The PRIVATE KEY block holds invalid Base64 at position ' + short.indexOf('!!!!') + '.');
  const label = 'A'.repeat(60);
  const message = refusal(armour(label, body));
  expect(message).toContain(`The ${'A'.repeat(40)}... block holds invalid Base64 at position `);
  expect(message).not.toContain('A'.repeat(41));
});
