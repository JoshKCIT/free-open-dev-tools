import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readCertificate } from '../src/x509';
import { CERTIFICATES } from './fixtures/certs';
import { NOW_MS, certificateDer, opensslDate, textValue } from './fixtures/helpers';

/**
 * Specification: RFC 5280 section 4.1 (the certificate), ITU-T X.690 (DER). Every expected value below is what OpenSSL 3.5.5
 * printed for the same certificate (see test/fixtures/README.md); nothing is computed by the code under test.
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

/** The seven fresh certificates: RSA 2048 and 3072, P-256, P-384, P-521, Ed25519 and RSA-PSS. */
const SEVEN = ['leaf', 'root', 'ec256', 'int', 'ec521', 'ed25519', 'pss'] as const;
const EVERY = Object.keys(CERTIFICATES);

/** OpenSSL's name for a public key algorithm, and what the decoder calls the same key type. */
const KEY_TYPES = new Map<string, string>([
  ['rsaEncryption', 'RSA'],
  ['id-ecPublicKey', 'EC'],
  ['ED25519', 'Ed25519'],
  ['rsassaPss', 'RSA-PSS'],
]);

/** The signature algorithm names compared without case or hyphens (OpenSSL prints ED25519, the decoder Ed25519). */
const plain = (name: string): string => name.toLowerCase().replace(/-/g, '');

it('seven OpenSSL certificates give the serial, subject, issuer, dates, key and signature algorithm OpenSSL printed', () => {
  for (const name of SEVEN) {
    const printed = CERTIFICATES[name]!;
    const cert = readCertificate(certificateDer(name), NOW_MS);
    expect(cert.kind, name).toBe('certificate');
    expect(cert.version, name).toBe(3);
    expect(cert.serialHex, name).toBe(printed.serial);
    expect(cert.subject.display, name).toBe(printed.subjectOneline);
    expect(cert.issuer.display, name).toBe(printed.issuerOneline);
    expect(cert.notBefore.epochMs, name).toBe(opensslDate(printed.notBefore));
    expect(cert.notAfter.epochMs, name).toBe(opensslDate(printed.notAfter));
    expect(cert.notBefore.iso, name).toBe(new Date(opensslDate(printed.notBefore)).toISOString().replace('.000Z', 'Z'));

    const algorithm = textValue(printed.text, 'Public Key Algorithm:')!;
    expect(cert.publicKey.type, name).toBe(KEY_TYPES.get(algorithm));
    const bits = /Public-Key: \((\d+) bit\)/.exec(printed.text.join('\n'));
    if (bits !== null) expect(cert.publicKey.bits, name).toBe(Number(bits[1]));
    const curve = textValue(printed.text, 'NIST CURVE:');
    if (curve !== undefined) expect(cert.publicKey.curve, name).toBe(curve);

    const signature = textValue(printed.text, 'Signature Algorithm:')!;
    expect(plain(cert.signatureAlgorithm.name), name).toBe(plain(signature));
  }
});

it('SHA-256, SHA-1 and MD5 fingerprints equal openssl x509 -fingerprint for every fixture', () => {
  expect(EVERY.length).toBe(9);
  for (const name of EVERY) {
    const printed = CERTIFICATES[name]!;
    const cert = readCertificate(certificateDer(name), NOW_MS);
    expect(cert.fingerprints.sha256, name).toBe(printed.sha256);
    expect(cert.fingerprints.sha1, name).toBe(printed.sha1);
    expect(cert.fingerprints.md5, name).toBe(printed.md5);
    // The pin is the SHA-256 of the SubjectPublicKeyInfo in Base64; OpenSSL printed the same digest as hex.
    expect(Buffer.from(cert.fingerprints.spkiSha256, 'base64').toString('hex'), name).toBe(printed.spkiSha256Hex);
  }
});

it('the 0x0abcdef0123456789 serial shows as written, without a sign octet', () => {
  const der = certificateDer('leaf');
  // The INTEGER holds 00 ab cd ef 01 23 45 67 89: the high bit of the first real byte is set, so DER adds a sign octet.
  const wire = Buffer.from(der).toString('hex');
  expect(wire).toContain('020900abcdef0123456789');
  const cert = readCertificate(der, NOW_MS);
  expect(cert.serialHex).toBe('ABCDEF0123456789');
  expect(cert.serialHex).toBe(CERTIFICATES['leaf']!.serial);
  // OpenSSL prints a serial that needs no sign octet as it is, here serial 1.
  expect(readCertificate(certificateDer('root'), NOW_MS).serialHex).toBe(CERTIFICATES['root']!.serial);
});
