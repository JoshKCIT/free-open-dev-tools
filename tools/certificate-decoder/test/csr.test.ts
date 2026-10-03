import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readCsr } from '../src/csr';
import { CertificateError, MAX_FILE_BYTES, checkFileSize, decodeInput } from '../src/index';
import { readCertificate } from '../src/x509';
import { CERTIFICATES, REQUESTS } from './fixtures/certs';
import {
  bitString,
  context,
  integer,
  name,
  oid,
  octetString,
  rdn,
  seq,
  set,
  utf8,
  rsaSpki,
  ALGORITHMS,
} from './fixtures/der-build';
import { NOW_MS, certificateDer, certificatePem, pemText, requestDer } from './fixtures/helpers';

/**
 * Certification requests (RFC 2986) and files. Every expected value is something OpenSSL 3.5.5 printed, recorded in
 * test/fixtures/certs.ts with the commands that made it (test/fixtures/make-fixtures.sh).
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

/** The text after a label on the first line of OpenSSL's printed request that has it. */
function printed(name: string, label: string): string | undefined {
  for (const line of REQUESTS[name]!.text) {
    const trimmed = line.trim();
    if (trimmed.startsWith(label)) return trimmed.slice(label.length).trim();
  }
  return undefined;
}

/** The lines OpenSSL printed under one header of the requested extensions (header text without its colon). */
function printedExtension(name: string, header: string): string[] {
  const text = REQUESTS[name]!.text;
  const at = text.findIndex((line) => line.trim() === `${header}:` || line.trim() === `${header}: `);
  if (at < 0) return [];
  const indent = text[at]!.length - text[at]!.trimStart().length;
  const lines: string[] = [];
  for (let i = at + 1; i < text.length && text[i]!.length - text[i]!.trimStart().length > indent; i++) {
    lines.push(text[i]!.trim());
  }
  return lines;
}

it('RSA, P-256 and Ed25519 requests show subject, key, signature algorithm and requested extensions as openssl req prints them', () => {
  for (const name of ['rsa', 'ec', 'ed']) {
    const printedRequest = REQUESTS[name]!;
    const info = readCsr(requestDer(name));
    expect(info.kind, name).toBe('request');
    expect(info.version, name).toBe(1);
    // The subject: the RFC 4514 form OpenSSL printed with -nameopt RFC2253, and the written form of its text output.
    expect(info.subject.rfc4514, name).toBe(printedRequest.subjectRfc2253);
    expect(info.subject.display, name).toBe(printed(name, 'Subject:'));
    // The key and the signature algorithm, in OpenSSL's words (it writes the Ed25519 name in capitals).
    const algorithm = printed(name, 'Public Key Algorithm:')!;
    const keyType = { rsaEncryption: 'RSA', 'id-ecPublicKey': 'EC', ED25519: 'Ed25519' }[algorithm]!;
    expect(info.publicKey.type, name).toBe(keyType);
    const bits = /^\((\d+) bit\)$/.exec(printed(name, 'Public-Key:') ?? '');
    if (bits !== null) expect(info.publicKey.bits, name).toBe(Number(bits[1]));
    if (name === 'rsa') expect(info.publicKey.exponent).toBe('65537');
    if (name === 'ec') expect(info.publicKey.curve).toBe(printed(name, 'NIST CURVE:'));
    expect(info.signatureAlgorithm.name.toLowerCase(), name).toBe(printed(name, 'Signature Algorithm:')!.toLowerCase());
    // Nothing is claimed about the signature, and a good request has no warning.
    expect(info.warnings, name).toEqual([]);
  }

  // The extensions the RSA request asks for, in the order OpenSSL printed them, with the values it printed.
  const rsa = readCsr(requestDer('rsa'));
  expect(rsa.extensions.map((extension) => extension.name)).toEqual([
    'subjectAltName',
    'basicConstraints',
    'keyUsage',
    'extKeyUsage',
  ]);
  const names = printedExtension('rsa', 'X509v3 Subject Alternative Name')[0]!.split(', ');
  expect(rsa.sans.map((san) => san.value)).toEqual(names.map((entry) => entry.slice(entry.indexOf(':') + 1)));
  expect(rsa.sans.map((san) => san.type)).toEqual(['dNSName', 'dNSName', 'iPAddress', 'rfc822Name']);
  const find = (name: string) => rsa.extensions.find((extension) => extension.name === name)!;
  expect(find('basicConstraints').value).toEqual(printedExtension('rsa', 'X509v3 Basic Constraints'));
  expect(printedExtension('rsa', 'X509v3 Key Usage')).toEqual(['Digital Signature, Key Encipherment']);
  expect(find('keyUsage').value).toEqual(['digitalSignature, keyEncipherment']);
  expect(printedExtension('rsa', 'X509v3 Extended Key Usage')).toEqual(['TLS Web Server Authentication']);
  expect(find('extKeyUsage').value).toEqual(['serverAuth']);
  // A request with no attributes asks for nothing.
  for (const name of ['ec', 'ed']) {
    const bare = readCsr(requestDer(name));
    expect(bare.attributes, name).toEqual([]);
    expect(bare.extensions, name).toEqual([]);
    expect(bare.sans, name).toEqual([]);
  }
  // The attribute list of the RSA request holds the extension request and says where its extensions are.
  expect(rsa.attributes.map((attribute) => [attribute.oid, attribute.name])).toEqual([
    ['1.2.840.113549.1.9.14', 'extensionRequest'],
  ]);
});

it('the request SHA-256 equals openssl dgst over the request DER', () => {
  for (const name of ['rsa', 'ec', 'ed', 'pw']) {
    const expected = REQUESTS[name]!.requestSha256Hex;
    expect(expected, name).toMatch(/^[0-9a-f]{64}$/);
    expect(readCsr(requestDer(name)).requestSha256, name).toBe(expected);
    // Through the entry point, from PEM text with either label and from the DER bytes.
    for (const label of ['CERTIFICATE REQUEST', 'NEW CERTIFICATE REQUEST']) {
      const pasted = pemText(label, REQUESTS[name]!.derB64);
      const item = decodeInput(pasted, { nowMs: NOW_MS }).items[0]!;
      expect(item.kind, `${name} ${label}`).toBe('request');
      expect(item.kind === 'request' ? item.requestSha256 : '', `${name} ${label}`).toBe(expected);
    }
    const fromBytes = decodeInput(requestDer(name), { nowMs: NOW_MS }).items[0]!;
    expect(fromBytes.kind === 'request' ? fromBytes.requestSha256 : '', name).toBe(expected);
  }
  // A certificate and a request in one paste: each is read as what it is, and the order only covers the certificate.
  const mixed = decodeInput(certificatePem('leaf') + pemText('CERTIFICATE REQUEST', REQUESTS['rsa']!.derB64), {
    nowMs: NOW_MS,
  });
  expect(mixed.items.map((item) => item.kind)).toEqual(['certificate', 'request']);
  expect(mixed.chains).toHaveLength(1);
  expect(mixed.chains[0]!.order).toEqual([0]);
});

it('a challenge password attribute is reported as present and never shown', () => {
  const line = REQUESTS['pw']!.text.find((entry) => entry.trim().startsWith('challengePassword'))!;
  const secret = line.slice(line.indexOf(':') + 1).trim();
  expect(secret.length).toBeGreaterThan(10);
  // The text really is in the request's bytes, so the check below can fail.
  const der = requestDer('pw');
  expect(Buffer.from(der).includes(Buffer.from(secret, 'utf8'))).toBe(true);

  const info = readCsr(der);
  const byName = new Map(info.attributes.map((attribute) => [attribute.name, attribute]));
  expect(byName.get('challengePassword')!.value).toEqual(['present, not shown']);
  expect(byName.get('unstructuredName')!.value).toEqual(['Unstructured Test Name']);
  // Not in any field of the model, any line, any warning or the serialised whole (the DER bytes aside, which are the input).
  const shown = JSON.stringify({
    subject: info.subject,
    attributes: info.attributes,
    extensions: info.extensions,
    sans: info.sans,
    warnings: info.warnings,
    signatureAlgorithm: info.signatureAlgorithm,
  });
  expect(shown.includes(secret)).toBe(false);
  expect(info.warnings.some((warning) => warning.includes(secret))).toBe(false);

  // A cut request that holds the password is refused with a sentence that holds no part of it.
  const cut = der.subarray(0, der.length - 40);
  let message = '';
  try {
    decodeInput(pemText('CERTIFICATE REQUEST', Buffer.from(cut).toString('base64')), { nowMs: NOW_MS });
  } catch (err) {
    expect(err).toBeInstanceOf(CertificateError);
    message = (err as Error).message;
  }
  expect(message).not.toBe('');
  expect(message.includes(secret)).toBe(false);
  expect(message.includes('FODT')).toBe(false);
});

it('DER and PEM inputs of one certificate give the same result and repeated decodes keep no state', () => {
  for (const name of Object.keys(CERTIFICATES)) {
    const der = certificateDer(name);
    const fromBytes = decodeInput(der, { nowMs: NOW_MS });
    const fromPem = decodeInput(certificatePem(name), { nowMs: NOW_MS });
    expect(fromBytes, name).toEqual(fromPem);
    const item = fromBytes.items[0]!;
    expect(item.kind === 'certificate' ? item.fingerprints.sha256 : '', name).toBe(CERTIFICATES[name]!.sha256);
  }
  // A request, from its bytes and from PEM text.
  for (const name of Object.keys(REQUESTS)) {
    expect(decodeInput(requestDer(name), { nowMs: NOW_MS }), name).toEqual(
      decodeInput(pemText('CERTIFICATE REQUEST', REQUESTS[name]!.derB64), { nowMs: NOW_MS }),
    );
  }

  // No state is kept between calls: the same input gives equal results however many other decodes came in between, and a
  // failed decode in the middle changes nothing.
  const first = decodeInput(certificatePem('leaf') + certificatePem('int'), { nowMs: NOW_MS });
  decodeInput(requestDer('rsa'), { nowMs: NOW_MS + 86_400_000 });
  expect(() => decodeInput(new Uint8Array([0x30, 0x03, 0x01]), { nowMs: NOW_MS })).toThrow(CertificateError);
  decodeInput(certificatePem('root'), { nowMs: NOW_MS });
  const again = decodeInput(certificatePem('leaf') + certificatePem('int'), { nowMs: NOW_MS });
  expect(again).toEqual(first);
  // The result is new on every call: changing one never changes the next.
  first.items.length = 0;
  first.chains.length = 0;
  expect(decodeInput(certificatePem('leaf') + certificatePem('int'), { nowMs: NOW_MS }).chains).toHaveLength(1);
  // The certificate model does not change with the bytes' owner: reading twice from one array gives equal values.
  const der = certificateDer('ec256');
  expect(readCertificate(der, NOW_MS)).toEqual(readCertificate(der, NOW_MS));
});

it('a file over 1048576 bytes is refused by its size', () => {
  expect(MAX_FILE_BYTES).toBe(1048576);
  expect(() => checkFileSize(0)).not.toThrow();
  expect(() => checkFileSize(1048576)).not.toThrow();
  let message = '';
  try {
    checkFileSize(1048577);
  } catch (err) {
    expect(err).toBeInstanceOf(CertificateError);
    message = (err as Error).message;
  }
  expect(message).toBe('This file is 1,048,577 bytes. The limit is 1 MiB because larger files are not certificates.');
  // The entry point refuses the same bytes by the same rule before reading any of them, and reads exactly 1 MiB.
  expect(() => decodeInput(new Uint8Array(1048577), { nowMs: NOW_MS })).toThrow(message);
  let atLimit = '';
  try {
    decodeInput(new Uint8Array(1048576).fill(0x20), { nowMs: NOW_MS });
  } catch (err) {
    atLimit = (err as Error).message;
  }
  expect(atLimit).toMatch(/^No certificate or request was found in this file\./);
  expect(atLimit).not.toMatch(/limit/);
}, 60_000);

it('a file is read as DER or as text by its first bytes, and an empty file gives nothing', () => {
  const der = certificateDer('ec256');
  const pem = new TextEncoder().encode(certificatePem('ec256'));
  const sha = CERTIFICATES['ec256']!.sha256;
  const sha256Of = (bytes: Uint8Array): string => {
    const item = decodeInput(bytes, { nowMs: NOW_MS }).items[0]!;
    return item.kind === 'certificate' ? item.fingerprints.sha256 : 'not a certificate';
  };
  expect(sha256Of(der)).toBe(sha);
  expect(sha256Of(pem)).toBe(sha);
  // A byte order mark, CRLF line ends and text before the block do not matter for a text file.
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...pem]);
  expect(sha256Of(bom)).toBe(sha);
  const crlf = new TextEncoder().encode(certificatePem('ec256', 64, '\r\n'));
  expect(sha256Of(crlf)).toBe(sha);
  const labelled = new TextEncoder().encode('Bag Attributes\n    friendlyName: test\n' + certificatePem('ec256'));
  expect(sha256Of(labelled)).toBe(sha);
  // The hex of the DER saved as a text file, which begins with the character 0 (the byte 0x30 that begins DER), is text.
  const hex = new TextEncoder().encode(Buffer.from(der).toString('hex'));
  expect(hex[0]).toBe(0x33);
  expect(sha256Of(hex)).toBe(sha);
  const zeroFirst = new TextEncoder().encode('0' + Buffer.from(der).toString('hex'));
  expect(() => decodeInput(zeroFirst, { nowMs: NOW_MS })).toThrow(CertificateError);
  // An empty file reads as nothing, like an empty paste.
  expect(decodeInput(new Uint8Array(0), { nowMs: NOW_MS }).items).toEqual([]);
  // A cut DER file gets the reader's sentence about lengths, not the sentence about a missing certificate.
  let message = '';
  try {
    decodeInput(der.subarray(0, 40), { nowMs: NOW_MS });
  } catch (err) {
    message = (err as Error).message;
  }
  expect(message).toMatch(/^The certificate could not be read: /);
});

/** A request built here, byte by byte, with the given attributes: nothing in it was made by the package. */
function buildRequest(attributes: Uint8Array[]): Uint8Array {
  const info = seq(
    integer('00'),
    name(rdn('2.5.4.3', utf8('built.example.com'))),
    rsaSpki('c1'.repeat(128)),
    context(
      0,
      attributes.flatMap((attribute) => Array.from(attribute)),
    ),
  );
  return seq(info, ALGORITHMS.sha256Rsa, bitString(new Uint8Array(8).fill(0xab)));
}

it('attributes are cut at 200 with a note, and odd attribute values never stop the request', () => {
  const many = Array.from({ length: 250 }, (_, i) => seq(oid('1.3.6.1.4.1.99999.' + (i + 1)), set(utf8('value ' + i))));
  const info = readCsr(buildRequest(many));
  expect(info.attributes).toHaveLength(200);
  expect(info.attributes[0]!.value).toEqual(['value 0']);
  expect(info.warnings).toContain('50 of 250 attributes are not shown.');
  // A value that is not a character string is shown as hex; more than 20 values are counted.
  const odd = readCsr(
    buildRequest([
      seq(oid('1.3.6.1.4.1.99999.1'), set(octetString([1, 2, 3]))),
      seq(oid('1.3.6.1.4.1.99999.2'), set(...Array.from({ length: 25 }, (_, i) => utf8('v' + i)))),
      seq(oid('1.2.840.113549.1.9.7'), set(utf8('hunter2-marker'))),
    ]),
  );
  expect(odd.attributes[0]!.value).toEqual(['0403010203']);
  expect(odd.attributes[1]!.value).toHaveLength(21);
  expect(odd.attributes[1]!.value[20]).toBe('and 5 more values are not shown.');
  expect(JSON.stringify(odd.attributes).includes('hunter2')).toBe(false);
});
