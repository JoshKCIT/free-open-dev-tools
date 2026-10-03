import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CertificateError, decodeInput } from '../src/index';
import { CERTIFICATES } from './fixtures/certs';
import { NOW_MS, certificateOf, certificatePem } from './fixtures/helpers';

/**
 * The package entry: what a paste turns into. The expected fingerprints are OpenSSL's, recorded in test/fixtures.
 */

// The package prints nothing, whatever it is given.
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

/** The decoder keeps a byte for byte copy of the key converter's reader and scanner (never an import across folders). */
const HERE = new URL('./', import.meta.url);
const CANONICAL = new URL('../../key-converter/src/', HERE);
const canonicalHere = existsSync(new URL('der.ts', CANONICAL));

// Skipped only when this folder has been copied out of the repository on its own, where the key converter is not beside it.
it.skipIf(!canonicalHere)('der.ts and pem.ts are byte-for-byte copies of the key converter files', () => {
  for (const file of ['der.ts', 'pem.ts']) {
    const mine = readFileSync(new URL(`../src/${file}`, HERE));
    const theirs = readFileSync(new URL(file, CANONICAL));
    expect(mine.equals(theirs), file).toBe(true);
  }
});

it('an empty paste returns nothing and text without a certificate gets one plain sentence', () => {
  for (const blank of ['', '   ', '\n\r\n\t ']) {
    expect(decodeInput(blank, { nowMs: NOW_MS })).toEqual({
      items: [],
      chains: [],
      duplicates: [],
      ignored: [],
      warnings: [],
    });
  }
  // The last two are valid Base64 and valid hex, and are not DER, so they get the same sentence.
  for (const text of [
    'hello, this is plain text',
    'this is not a certificate',
    '{"a": 1}',
    'ssh-ed25519 AAAA',
    'dGhpcyBpcyBwbGFpbiB0ZXh0',
    '48 65 6c 6c 6f',
  ]) {
    let message = '';
    let error: unknown;
    try {
      decodeInput(text, { nowMs: NOW_MS });
    } catch (err) {
      error = err;
      message = (err as Error).message;
    }
    expect(error, text).toBeInstanceOf(CertificateError);
    expect(message, text).toMatch(/^No certificate was found in this paste\./);
    // One sentence of advice, no line break, and no part of what was pasted.
    expect(message).not.toContain('\n');
    expect(message).not.toContain('hello');
    expect(message.match(/\. /g)?.length ?? 0).toBeLessThanOrEqual(1);
  }
});

it('a pasted PEM block decodes to the certificate OpenSSL printed', () => {
  const result = decodeInput(certificatePem('ec256'), { nowMs: NOW_MS });
  expect(result.items).toHaveLength(1);
  const cert = certificateOf(result);
  expect(cert.fingerprints.sha256).toBe(CERTIFICATES['ec256']!.sha256);
  expect(cert.fingerprints.sha1).toBe(CERTIFICATES['ec256']!.sha1);
  expect(cert.serialHex).toBe(CERTIFICATES['ec256']!.serial);
  expect(result.ignored).toEqual([]);
});

it('a certificate cut short is refused with a sentence that names the problem and holds none of the paste', () => {
  const cut = certificatePem('ec256').split('\n').slice(0, 4).join('\n') + '\n-----' + 'END ' + 'CERTIFICATE-----\n';
  let error: unknown;
  try {
    decodeInput(cut, { nowMs: NOW_MS });
  } catch (err) {
    error = err;
  }
  expect(error).toBeInstanceOf(CertificateError);
  expect((error as Error).message).toMatch(/^The certificate could not be read: /);
});

it('a BEGIN line with no matching END is refused with the number of its line', () => {
  const pasted = 'notes before the certificate\n\n' + certificatePem('ec256').split('\n').slice(0, 3).join('\n') + '\n';
  let error: unknown;
  try {
    decodeInput(pasted, { nowMs: NOW_MS });
  } catch (err) {
    error = err;
  }
  expect(error).toBeInstanceOf(CertificateError);
  expect((error as CertificateError).line).toBe(3);
  expect((error as Error).message).toBe('The BEGIN line has no END line after it.');
});

it('a single certificate shows as one entry and two certificates as two', () => {
  expect(decodeInput(certificatePem('leaf'), { nowMs: NOW_MS }).items).toHaveLength(1);
  const two = certificatePem('leaf') + '\nsome text between\n' + certificatePem('int', 76, '\r\n');
  const result = decodeInput(two, { nowMs: NOW_MS });
  expect(result.items.map((_, at) => certificateOf(result, at).fingerprints.sha256)).toEqual([
    CERTIFICATES['leaf']!.sha256,
    CERTIFICATES['int']!.sha256,
  ]);
});
