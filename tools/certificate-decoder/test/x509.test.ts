import { createHash, X509Certificate } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readDer } from '../src/der';
import { EXTENSION_DECODERS } from '../src/extensions';
import { decodeInput } from '../src/index';
import { readName, type NameInfo } from '../src/names';
import { CURVE_BITS, KEY_TYPE_NAMES, OID_NAMES, oidLabel, oidName } from '../src/oids';
import { readCertificate, type CertificateInfo, type ExtensionInfo } from '../src/x509';
import { CERTIFICATES } from './fixtures/certs';
import {
  bitString,
  boolean,
  buildCertificate,
  context,
  extension,
  generalizedTime,
  ia5,
  integer,
  name,
  nul,
  octetString,
  oid,
  bmp,
  printable,
  rdn,
  rsaSpki,
  seq,
  set,
  teletex,
  tlv,
  universal,
  utcTime,
  utf8,
  type Bytes,
} from './fixtures/der-build';
import {
  NOW_MS,
  base64Bytes,
  certificateDer,
  certificatePem,
  opensslDate,
  pemText,
  textValue,
} from './fixtures/helpers';

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

// ---------------------------------------------------------------------------------------------------------------------
// The single certificate complete (every name form, every extension, key details, status, other pastes).
// ---------------------------------------------------------------------------------------------------------------------

/** The replacement character, written as a code point so no invisible or look-alike character sits in this file. */
const REPLACEMENT = String.fromCodePoint(0xfffd);

const DC = '0.9.2342.19200300.100.1.25';
const UID = '0.9.2342.19200300.100.1.1';
const CN = '2.5.4.3';
const OU = '2.5.4.11';

/** The read form of a Name built here, through the same entry the certificate reader uses. */
function nameInfo(...rdns: Bytes[]): NameInfo {
  const bytes = name(...rdns);
  return readName(bytes, readDer(bytes));
}

/** A certificate made here with the given parts, read as the decoder reads every certificate. */
function readBuilt(parts: Parameters<typeof buildCertificate>[0]): CertificateInfo {
  return readCertificate(buildCertificate(parts), NOW_MS);
}

const cnOf = (value: Bytes): Bytes => rdn(CN, value);

it('subject and issuer show as written and in RFC 4514 form with section 2.4 escaping and every DER string type', () => {
  // What OpenSSL printed for every fixture, in its RFC 2253 form (reverse order, escaped) and its one-line form.
  for (const fixture of EVERY) {
    const printed = CERTIFICATES[fixture]!;
    const cert = readCertificate(certificateDer(fixture), NOW_MS);
    expect(cert.subject.rfc4514, fixture).toBe(printed.subjectRfc2253);
    expect(cert.issuer.rfc4514, fixture).toBe(printed.issuerRfc2253);
    expect(cert.subject.display, fixture).toBe(printed.subjectOneline);
    expect(cert.issuer.display, fixture).toBe(printed.issuerOneline);
  }
  const leaf = readCertificate(certificateDer('leaf'), NOW_MS);
  expect(leaf.subject.display).toContain('O=Müller & Söhne GmbH');
  expect(leaf.subject.rfc4514).toContain('O=Müller & Söhne GmbH');
  expect(leaf.subject.replaced).toBe(false);

  // RFC 4514 section 4: the examples, written out as DER (the sequence in the certificate runs the other way round).
  const dc = (value: string): Bytes => rdn(DC, ia5(value));
  const one = nameInfo(dc('net'), dc('example'), rdn(UID, utf8('jsmith')));
  expect(one.rfc4514).toBe('UID=jsmith,DC=example,DC=net');
  expect(one.display).toBe('DC=net, DC=example, UID=jsmith');
  const multi = nameInfo(dc('net'), dc('example'), set(seq(oid(OU), utf8('Sales')), seq(oid(CN), utf8('J.  Smith'))));
  expect(multi.rfc4514).toBe('OU=Sales+CN=J.  Smith,DC=example,DC=net');
  expect(multi.display).toBe('DC=net, DC=example, OU=Sales + CN=J.  Smith');
  expect(nameInfo(dc('net'), dc('example'), cnOf(utf8('James "Jim" Smith, III'))).rfc4514).toBe(
    'CN=James \\"Jim\\" Smith\\, III,DC=example,DC=net',
  );
  expect(nameInfo(dc('net'), dc('example'), cnOf(utf8('Before\rAfter'))).rfc4514).toBe(
    'CN=Before\\0dAfter,DC=example,DC=net',
  );
  expect(nameInfo(rdn('1.3.6.1.4.1.1466.0', octetString([0x48, 0x69]))).rfc4514).toBe('1.3.6.1.4.1.1466.0=#04024869');

  // Section 2.4: a space or number sign at the start, a space at the end, and the characters " + , ; < > and backslash.
  const escaped = (text: string): string => nameInfo(cnOf(utf8(text))).rfc4514;
  expect(escaped('#hash')).toBe('CN=\\#hash');
  expect(escaped(' lead')).toBe('CN=\\ lead');
  expect(escaped('trail ')).toBe('CN=trail\\ ');
  expect(escaped('a;b<c>d+e\\f')).toBe('CN=a\\;b\\<c\\>d\\+e\\\\f');
  expect(escaped('nul\u0000char')).toBe('CN=nul\\00char');
  // Only those need it: an equals sign, a space inside and a number sign inside stay as they are.
  expect(escaped('a=b c#d')).toBe('CN=a=b c#d');
  // The one-line form shows the text as written, with nothing escaped.
  expect(nameInfo(cnOf(utf8('a, b'))).display).toBe('CN=a, b');

  // Every string type a name can use.
  const text = (value: Bytes): NameInfo => nameInfo(cnOf(value));
  expect(text(utf8('Müller & Söhne')).rfc4514).toBe('CN=Müller & Söhne');
  expect(text(printable('Example Ltd')).rfc4514).toBe('CN=Example Ltd');
  expect(text(ia5('a@b.example')).rfc4514).toBe('CN=a@b.example');
  expect(text(teletex([0x4d, 0xe9, 0x72])).rfc4514).toBe('CN=Mér');
  expect(text(bmp('Ünï€')).rfc4514).toBe('CN=Ünï€');
  expect(text(universal('a\u{1f600}b')).rfc4514).toBe('CN=a\u{1f600}b');
  for (const fine of [utf8('x'), printable('x'), ia5('x'), teletex([0x78]), bmp('x'), universal('x')]) {
    expect(text(fine).replaced).toBe(false);
  }
  // Bytes that do not belong to the type become U+FFFD, are marked, and never stop the reading.
  const badUtf8 = text(tlv(0x0c, [0x61, 0xc3, 0x28, 0x62]));
  expect(badUtf8.rfc4514).toBe(`CN=a${REPLACEMENT}(b`);
  expect(badUtf8.replaced).toBe(true);
  const badIa5 = text(tlv(0x16, [0x61, 0xe9]));
  expect(badIa5.display).toBe(`CN=a${REPLACEMENT}`);
  expect(badIa5.replaced).toBe(true);
  const cert = readBuilt({ subject: name(cnOf(tlv(0x0c, [0x61, 0xc3, 0x28, 0x62]))) });
  expect(cert.subject.replaced).toBe(true);
  expect(cert.warnings.some((warning) => warning.includes('U+FFFD'))).toBe(true);
  expect(cert.fingerprints.sha256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  // A value that is not text at all, and a string in a form this reader does not accept, are shown as their DER in hex.
  expect(text(tlv(0x02, [0x05])).rfc4514).toBe('CN=#020105');
  expect(text(tlv(0x2c, utf8('x'))).display).toBe('CN=#2c030c0178');
  // The name keeps its own DER bytes, so one name can be compared with another without comparing text.
  const bytes = name(cnOf(utf8('Same')));
  expect(Buffer.from(readName(bytes, readDer(bytes)).der).toString('hex')).toBe(Buffer.from(bytes).toString('hex'));
});

/** The parts of a printed OpenSSL extension: the line after its header and the indented lines beneath it. */
function printedSection(text: string[], header: string): { rest: string; lines: string[] } | undefined {
  const index = text.findIndex((line) => line.trim().startsWith(header));
  if (index < 0) return undefined;
  const indent = text[index]!.length - text[index]!.trimStart().length;
  const lines: string[] = [];
  for (let i = index + 1; i < text.length; i++) {
    const line = text[i]!;
    if (line.trim() === '') continue;
    if (line.length - line.trimStart().length <= indent) break;
    lines.push(line.trim());
  }
  return {
    rest: text[index]!.trim()
      .slice(header.length)
      .replace(/^\s*:?/, '')
      .trim(),
    lines,
  };
}

/** Parses an IPv6 address written with `::` or in full into its 16 bytes, so two spellings can be compared as bytes. */
function ipv6Bytes(text: string): number[] {
  const [head, tail] = text.split('::');
  const groups = (part: string | undefined): number[] =>
    part === undefined || part === '' ? [] : part.split(':').map((group) => parseInt(group, 16));
  const first = groups(head);
  const last = groups(tail);
  const middle = text.includes('::') ? new Array<number>(8 - first.length - last.length).fill(0) : [];
  return [...first, ...middle, ...last].flatMap((group) => [group >> 8, group & 255]);
}

it('the nine subject alternative name types of the leaf decode with IPv6 bytes equal to OpenSSL', () => {
  const printed = CERTIFICATES['leaf']!;
  const cert = readCertificate(certificateDer('leaf'), NOW_MS);
  expect(cert.sans.map((san) => san.type)).toEqual([
    'dNSName',
    'dNSName',
    'iPAddress',
    'iPAddress',
    'rfc822Name',
    'uniformResourceIdentifier',
    'otherName',
    'directoryName',
    'registeredID',
  ]);
  // OpenSSL's one line: DNS:..., IP Address:..., email:..., URI:..., othername: UPN:..., DirName:/A=b/C=d, Registered ID:...
  const line = printedSection(printed.text, 'X509v3 Subject Alternative Name:')!.lines[0]!;
  const parts = line.split(', ');
  expect(parts).toHaveLength(9);
  const value = (index: number): string => cert.sans[index]!.value;
  expect(`DNS:${value(0)}`).toBe(parts[0]);
  expect(`DNS:${value(1)}`).toBe(parts[1]);
  expect(`IP Address:${value(2)}`).toBe(parts[2]);
  expect(ipv6Bytes(value(3))).toEqual(ipv6Bytes(parts[3]!.slice('IP Address:'.length)));
  // The decoder writes RFC 5952 form (compressed, lower case); OpenSSL writes all eight groups in upper case.
  expect(value(3)).toBe('2001:db8::1');
  expect(`email:${value(4)}`).toBe(parts[4]);
  expect(`URI:${value(5)}`).toBe(parts[5]);
  expect(`othername: UPN:${value(6).replace('userPrincipalName: ', '')}`).toBe(parts[6]);
  expect(value(6)).toBe('userPrincipalName: user@example.com');
  expect(`DirName:/${value(7).split(', ').join('/')}`).toBe(parts[7]);
  expect(`Registered ID:${value(8)}`).toBe(parts[8]);
  // The extension row holds the same names, one per line.
  const row = cert.extensions.find((extension) => extension.name === 'subjectAltName')!;
  expect(row.value).toHaveLength(9);
  expect(row.value[2]).toBe('iPAddress: 192.0.2.1');
});

it('RFC 5952 writes IPv6 addresses compressed, in lower case, with the longest run of zeros and no single group', () => {
  const written = (text: string): string => {
    const cert = readBuilt({
      extensions: [extension('2.5.29.17', false, seq(context(7, ipv6Bytes(text), false)))],
    });
    return cert.sans[0]!.value;
  };
  // RFC 5952 section 4.2.2 and section 4.2.3: the examples of what is and is not compressed.
  expect(written('2001:db8:0:0:1:0:0:1')).toBe('2001:db8::1:0:0:1');
  expect(written('2001:0:0:1:0:0:0:1')).toBe('2001:0:0:1::1');
  expect(written('2001:db8:0:1:1:1:1:1')).toBe('2001:db8:0:1:1:1:1:1');
  expect(written('2001:0:0:1:0:0:1:1')).toBe('2001::1:0:0:1:1');
  expect(written('0:0:0:0:0:0:0:1')).toBe('::1');
  expect(written('0:0:0:0:0:0:0:0')).toBe('::');
  expect(written('2001:db8::')).toBe('2001:db8::');
  expect(written('ABCD:EF01:2345:6789:ABCD:EF01:2345:6789')).toBe('abcd:ef01:2345:6789:abcd:ef01:2345:6789');
});

it('named extensions decode to the values openssl x509 -text prints and unknown ones show OID, critical flag and capped hex', () => {
  /** What a section of OpenSSL's text says, with spaces, dashes and case ignored so only the words are compared. */
  const squash = (text: string): string => text.toLowerCase().replace(/[^a-z0-9.:/]/g, '');
  const find = (cert: CertificateInfo, extensionName: string): ExtensionInfo => {
    const found = cert.extensions.find((extension) => extension.name === extensionName);
    if (found === undefined) throw new Error(`no ${extensionName} extension`);
    return found;
  };
  const KEY_USAGES = new Map([
    ['Digital Signature', 'digitalSignature'],
    ['Non Repudiation', 'nonRepudiation'],
    ['Key Encipherment', 'keyEncipherment'],
    ['Data Encipherment', 'dataEncipherment'],
    ['Key Agreement', 'keyAgreement'],
    ['Certificate Sign', 'keyCertSign'],
    ['CRL Sign', 'cRLSign'],
  ]);
  const EXTENDED = new Map([
    ['TLS Web Server Authentication', 'serverAuth'],
    ['TLS Web Client Authentication', 'clientAuth'],
    ['Code Signing', 'codeSigning'],
    ['E-mail Protection', 'emailProtection'],
  ]);
  const HEADERS = new Map([
    ['X509v3 Basic Constraints', 'basicConstraints'],
    ['X509v3 Key Usage', 'keyUsage'],
    ['X509v3 Extended Key Usage', 'extKeyUsage'],
    ['X509v3 Subject Key Identifier', 'subjectKeyIdentifier'],
    ['X509v3 Authority Key Identifier', 'authorityKeyIdentifier'],
    ['X509v3 Subject Alternative Name', 'subjectAltName'],
    ['X509v3 CRL Distribution Points', 'cRLDistributionPoints'],
    ['Authority Information Access', 'authorityInfoAccess'],
    ['X509v3 Name Constraints', 'nameConstraints'],
    ['X509v3 Certificate Policies', 'certificatePolicies'],
    ['CT Precertificate SCTs', 'signedCertificateTimestamps'],
  ]);

  for (const fixture of ['root', 'int', 'leaf', 'canary', 'ec256', 'ed25519', 'pss'] as const) {
    const printed = CERTIFICATES[fixture]!;
    const cert = readCertificate(certificateDer(fixture), NOW_MS);
    // The names, in order: OpenSSL's headers at the extension level of its text.
    const section = printed.text.findIndex((line) => line.trim() === 'X509v3 extensions:');
    const headers: string[] = [];
    if (section >= 0) {
      for (let i = section + 1; i < printed.text.length; i++) {
        const line = printed.text[i]!;
        if (line.startsWith('    Signature Algorithm:')) break;
        if (/^ {12}\S/.test(line)) headers.push(line.trim().replace(/:.*$/, ''));
      }
    }
    expect(
      cert.extensions.map((extension) => extension.name),
      fixture,
    ).toEqual(headers.map((header) => HEADERS.get(header)));
    // The critical flag as OpenSSL prints it after the colon.
    for (const [header, extensionName] of HEADERS) {
      const section2 = printedSection(printed.text, header);
      if (section2 === undefined) continue;
      expect(find(cert, extensionName).critical, `${fixture} ${extensionName}`).toBe(section2.rest === 'critical');
    }
  }

  const root = readCertificate(certificateDer('root'), NOW_MS);
  const rootText = CERTIFICATES['root']!.text;
  expect(squash(find(root, 'basicConstraints').value.join(','))).toBe(
    squash(printedSection(rootText, 'X509v3 Basic Constraints:')!.lines.join(',')),
  );
  expect(find(root, 'basicConstraints').value).toEqual(['CA:TRUE, pathlen:1']);
  const usage = printedSection(rootText, 'X509v3 Key Usage:')!.lines[0]!.split(', ');
  expect(find(root, 'keyUsage').value.join(', ')).toBe(usage.map((u) => KEY_USAGES.get(u)).join(', '));
  expect(root.ski).toBe(printedSection(rootText, 'X509v3 Subject Key Identifier:')!.lines[0]);
  expect(root.aki).toBe(printedSection(rootText, 'X509v3 Authority Key Identifier:')!.lines[0]);
  expect(find(root, 'subjectKeyIdentifier').value).toEqual([root.ski]);
  expect(find(root, 'authorityKeyIdentifier').value[0]).toBe(`Key identifier: ${root.aki}`);

  const leaf = readCertificate(certificateDer('leaf'), NOW_MS);
  const leafText = CERTIFICATES['leaf']!.text;
  expect(find(leaf, 'basicConstraints').value).toEqual(['CA:FALSE']);
  const leafUsage = printedSection(leafText, 'X509v3 Key Usage:')!.lines[0]!.split(', ');
  expect(find(leaf, 'keyUsage').value.join(', ')).toBe(leafUsage.map((u) => KEY_USAGES.get(u)).join(', '));
  const purposes = printedSection(leafText, 'X509v3 Extended Key Usage:')!.lines[0]!.split(', ');
  expect(find(leaf, 'extKeyUsage').value).toEqual(purposes.map((purpose) => EXTENDED.get(purpose)));
  expect(leaf.ski).toBe(printedSection(leafText, 'X509v3 Subject Key Identifier:')!.lines[0]);
  expect(leaf.aki).toBe(printedSection(leafText, 'X509v3 Authority Key Identifier:')!.lines[0]);
  // The addresses are text: each is the address OpenSSL printed, after the words that say what it is.
  const distribution = printedSection(leafText, 'X509v3 CRL Distribution Points:')!.lines;
  const crl = distribution.find((line) => line.startsWith('URI:'))!.slice(4);
  expect(find(leaf, 'cRLDistributionPoints').value).toEqual([`Full name: uniformResourceIdentifier: ${crl}`]);
  const access = printedSection(leafText, 'Authority Information Access:')!.lines;
  const methods = access.map((line) => /^(OCSP|CA Issuers) - URI:(.*)$/.exec(line)!);
  expect(find(leaf, 'authorityInfoAccess').value).toEqual(
    methods.map((m) => `${m[1]} - uniformResourceIdentifier: ${m[2]}`),
  );
  const policies = printedSection(leafText, 'X509v3 Certificate Policies:')!.lines.map((l) =>
    l.replace('Policy: ', ''),
  );
  expect(find(leaf, 'certificatePolicies').value).toEqual([
    'Policy: domain-validated (2.23.140.1.2.1)',
    'Policy: 1.3.6.1.4.1.99999.1',
  ]);
  expect(policies).toEqual(['2.23.140.1.2.1', '1.3.6.1.4.1.99999.1']);
  // An extension whose OID has a name but no decoder here, and whose bytes are not what its name says, shows its bytes.
  const sct = find(leaf, 'signedCertificateTimestamps');
  expect(sct.oid).toBe('1.3.6.1.4.1.11129.2.4.2');
  expect(sct.value).toEqual(['0500']);

  const int = readCertificate(certificateDer('int'), NOW_MS);
  const intText = CERTIFICATES['int']!.text;
  expect(find(int, 'basicConstraints').value).toEqual(['CA:TRUE, pathlen:0']);
  expect(find(int, 'certificatePolicies').value).toEqual(['Policy: anyPolicy (2.5.29.32.0)']);
  expect(printedSection(intText, 'X509v3 Certificate Policies:')!.lines).toEqual(['Policy: X509v3 Any Policy']);
  expect(find(int, 'nameConstraints').value).toEqual([
    'Permitted: dNSName: example.com',
    'Excluded: iPAddress: 10.0.0.0/255.0.0.0',
  ]);
  expect(printedSection(intText, 'X509v3 Name Constraints:')!.lines).toEqual([
    'Permitted:',
    'DNS:example.com',
    'Excluded:',
    'IP:10.0.0.0/255.0.0.0',
  ]);

  // The addresses a certificate names stay text, in every extension that holds one.
  const canary = readCertificate(certificateDer('canary'), NOW_MS);
  const where = 'http://127.0.0.1:65535';
  expect(find(canary, 'cRLDistributionPoints').value).toEqual([`Full name: uniformResourceIdentifier: ${where}/crl`]);
  expect(find(canary, 'authorityInfoAccess').value).toEqual([
    `OCSP - uniformResourceIdentifier: ${where}/ocsp`,
    `CA Issuers - uniformResourceIdentifier: ${where}/issuer.crt`,
  ]);
  expect(find(canary, 'certificatePolicies').value).toEqual(['Policy: 1.3.6.1.4.1.99999.1', `CPS: ${where}/cps`]);
  expect(canary.sans.map((san) => san.value)).toEqual(['canary.example.test', `${where}/san-uri`]);

  // An extension no decoder here knows shows its OID, whether it is critical, and the hex of its bytes up to 256 bytes.
  const weak = readCertificate(certificateDer('weak'), NOW_MS);
  const unknown = weak.extensions.find((extension) => extension.oid === '1.3.6.1.4.1.99999.3')!;
  expect(unknown.name).toBeUndefined();
  expect(unknown.critical).toBe(true);
  expect(unknown.decoded).toBe(false);
  let expected = '';
  for (let i = 0; i < 256; i++) expected += (i % 256).toString(16).padStart(2, '0');
  expect(unknown.value).toEqual([`${expected} and 44 more bytes`]);
  // An extension a decoder knows but cannot read shows its hex and one plain note, and the certificate still decodes.
  const broken = readBuilt({ extensions: [extension('2.5.29.19', true, [0x02, 0x01, 0x05])] });
  expect(broken.extensions).toHaveLength(1);
  expect(broken.extensions[0]).toMatchObject({
    oid: '2.5.29.19',
    name: 'basicConstraints',
    critical: true,
    decoded: false,
    value: ['020105'],
    note: 'This extension could not be decoded; its bytes are shown.',
  });
  expect(broken.subject.display).toBe('CN=Test Subject');
});

it('smaller extensions decode: the key usage bits, issuer alternative names, TLS feature, policy qualifiers and name constraint masks', () => {
  const only = (extnId: string, value: Bytes): ExtensionInfo =>
    readBuilt({ extensions: [extension(extnId, false, value)] }).extensions[0]!;
  // RFC 5280 section 4.2.1.3: bit 0 is digitalSignature, the first bit of the first byte; bit 8 is decipherOnly.
  expect(only('2.5.29.15', bitString([0xff, 0x80], 7)).value).toEqual([
    'digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment, keyAgreement, keyCertSign, cRLSign, encipherOnly, decipherOnly',
  ]);
  expect(only('2.5.29.15', bitString([0x80], 7)).value).toEqual(['digitalSignature']);
  // RFC 7633: a TLS feature extension is a sequence of integers; 5 is status_request.
  expect(only('1.3.6.1.5.5.7.1.24', seq(integer('05'), integer('11'))).value).toEqual([
    'status_request',
    'status_request_v2',
  ]);
  expect(only('1.3.6.1.5.5.7.1.24', seq(integer('2a'))).value).toEqual(['42']);
  // RFC 5280 section 4.2.1.7: issuer alternative name has the same shape as subject alternative name.
  expect(only('2.5.29.18', seq(context(2, [0x61, 0x2e, 0x62], false))).value).toEqual(['dNSName: a.b']);
  // Name constraints with an IPv6 range hold 32 octets: the address, then the mask.
  const range = [...ipv6Bytes('2001:db8::'), ...ipv6Bytes('ffff:ffff::')];
  const constraints = only('2.5.29.30', seq(context(1, seq(context(7, range, false)))));
  expect(constraints.value).toEqual(['Excluded: iPAddress: 2001:db8::/ffff:ffff::']);
  // Policy qualifiers: a CPS address and a user notice with its text.
  const policy = seq(
    seq(
      oid('1.3.6.1.4.1.99999.2'),
      seq(
        seq(oid('1.3.6.1.5.5.7.2.1'), ia5('https://example.test/cps')),
        seq(oid('1.3.6.1.5.5.7.2.2'), seq(utf8('Read the terms'))),
        seq(oid('1.3.6.1.4.1.99999.9'), octetString([1, 2, 3])),
      ),
    ),
  );
  expect(only('2.5.29.32', policy).value).toEqual([
    'Policy: 1.3.6.1.4.1.99999.2',
    'CPS: https://example.test/cps',
    'User notice: Read the terms',
    '1.3.6.1.4.1.99999.9: 0403010203',
  ]);
  // Basic constraints with a path length that does not fit a small number stays exact.
  expect(only('2.5.29.19', seq(boolean(true), integer('0100000000000000000000'))).value).toEqual([
    'CA:TRUE, pathlen:1208925819614629174706176',
  ]);
  // A critical flag written as 01 instead of ff is accepted as true, as real certificates have it.
  const lenient = buildCertificate({
    extensions: [seq(oid('2.5.29.19'), tlv(0x01, [0x01]), octetString(seq()))],
  });
  expect(readCertificate(lenient, NOW_MS).extensions[0]!.critical).toBe(true);
});

it('key types, sizes, curves, RSA-PSS parameters and weak signature warnings are reported', () => {
  const key = (fixture: string) => readCertificate(certificateDer(fixture), NOW_MS).publicKey;
  // RSA: bits and the exponent as a decimal number.
  expect(key('leaf')).toMatchObject({ type: 'RSA', bits: 2048, exponent: '65537' });
  expect(key('root')).toMatchObject({ type: 'RSA', bits: 3072, exponent: '65537' });
  expect(key('pss')).toMatchObject({ type: 'RSA-PSS', bits: 2048, exponent: '65537' });
  expect(key('weak')).toMatchObject({ type: 'RSA', bits: 1024, exponent: '65537' });
  // EC: the curve by name and the size of its field.
  expect(key('ec256')).toMatchObject({ type: 'EC', curve: 'P-256', bits: 256 });
  expect(key('int')).toMatchObject({ type: 'EC', curve: 'P-384', bits: 384 });
  expect(key('ec521')).toMatchObject({ type: 'EC', curve: 'P-521', bits: 521 });
  expect(key('ed25519')).toMatchObject({ type: 'Ed25519', bits: 256 });
  expect(key('ed25519').curve).toBeUndefined();
  // The public key as PEM is the SubjectPublicKeyInfo OpenSSL hashed.
  const pem = key('leaf').pem.split('\n');
  expect(pem[0]).toBe('-----' + 'BEGIN ' + 'PUBLIC KEY-----');
  expect(pem[pem.length - 2]).toBe('-----' + 'END ' + 'PUBLIC KEY-----');
  const spki = Buffer.from(pem.slice(1, -2).join(''), 'base64');
  expect(createHash('sha256').update(spki).digest('hex')).toBe(CERTIFICATES['leaf']!.spkiSha256Hex);

  // RSA-PSS: the hash, the mask function and the salt length, as OpenSSL printed them.
  const pss = readCertificate(certificateDer('pss'), NOW_MS).signatureAlgorithm;
  expect(pss.name).toBe('RSASSA-PSS');
  expect(pss.oid).toBe('1.2.840.113549.1.1.10');
  expect(pss.params).toBe('hash SHA-256, mask MGF1 with SHA-1, salt length 32');
  const pssText = CERTIFICATES['pss']!.text;
  expect(textValue(pssText, 'Hash Algorithm:')).toBe('sha256');
  expect(textValue(pssText, 'Mask Algorithm:')).toBe('mgf1 with sha1 (default)');
  expect(textValue(pssText, 'Salt Length:')).toBe('0x20');
  expect(readCertificate(certificateDer('leaf'), NOW_MS).signatureAlgorithm.params).toBeUndefined();
  // RFC 4055 section 3.1: a field left out takes its default (SHA-1, MGF1 with SHA-1, salt length 20); one written wins.
  const pssWith = (params?: Bytes): string | undefined =>
    readBuilt({ signature: seq(oid('1.2.840.113549.1.1.10'), ...(params === undefined ? [] : [params])) })
      .signatureAlgorithm.params;
  expect(pssWith()).toBe('hash SHA-1, mask MGF1 with SHA-1, salt length 20');
  expect(pssWith(nul())).toBe('hash SHA-1, mask MGF1 with SHA-1, salt length 20');
  expect(pssWith(seq(context(2, integer('10'))))).toBe('hash SHA-1, mask MGF1 with SHA-1, salt length 16');
  const sha512 = seq(oid('2.16.840.1.101.3.4.2.3'), nul());
  const mgf1 = seq(oid('1.2.840.113549.1.1.8'), sha512);
  expect(pssWith(seq(context(0, sha512), context(1, mgf1), context(2, integer('40'))))).toBe(
    'hash SHA-512, mask MGF1 with SHA-512, salt length 64',
  );

  // Warnings: a short RSA key and a SHA-1 signature are named; a strong certificate has none.
  const weak = readCertificate(certificateDer('weak'), NOW_MS);
  expect(weak.signatureAlgorithm.name).toBe('sha1WithRSAEncryption');
  expect(weak.warnings.some((w) => w.includes('1024 bits'))).toBe(true);
  expect(weak.warnings.some((w) => w.includes('SHA-1'))).toBe(true);
  expect(weak.notAfter.iso).toBe('2054-02-18T04:38:00Z');
  for (const strong of ['leaf', 'root', 'int', 'ec256', 'ed25519', 'ec521', 'pss', 'canary']) {
    expect(readCertificate(certificateDer(strong), NOW_MS).warnings, strong).toEqual([]);
  }

  // Algorithms OpenSSL did not make a certificate for here, with the sizes their standards fix.
  const sizes = (spki: Bytes) => readBuilt({ spki }).publicKey;
  const algorithm = (id: string, withNull = false): Bytes => seq(oid(id), ...(withNull ? [nul()] : []));
  expect(sizes(seq(algorithm('1.3.101.113'), bitString(new Uint8Array(57))))).toMatchObject({
    type: 'Ed448',
    bits: 456,
  });
  expect(sizes(seq(algorithm('1.3.101.110'), bitString(new Uint8Array(32))))).toMatchObject({
    type: 'X25519',
    bits: 255,
  });
  const mlDsa = sizes(seq(algorithm('2.16.840.1.101.3.4.3.18'), bitString(new Uint8Array(1952))));
  expect(mlDsa.type).toBe('ML-DSA-65');
  expect(mlDsa.bits).toBeUndefined();
  expect(mlDsa.keyBytes).toBe(1952);
  const unknown = sizes(seq(algorithm('1.2.3.4'), bitString(new Uint8Array(10))));
  expect(unknown.type).toBe('1.2.3.4');
  expect(unknown.keyBytes).toBe(10);
  expect(sizes(rsaSpki('c1'.repeat(64), '03'))).toMatchObject({ type: 'RSA', bits: 512, exponent: '3' });
  expect(readBuilt({ spki: rsaSpki('c1'.repeat(64)) }).warnings.some((w) => w.includes('512 bits'))).toBe(true);
  expect(readBuilt({ spki: rsaSpki('01' + '00'.repeat(63)) }).publicKey.bits).toBe(505);
  // A key that cannot be read in detail keeps its type, loses its size, and is reported.
  const damaged = readBuilt({
    spki: seq(algorithm('1.2.840.113549.1.1.1', true), bitString([0x30, 0x03, 0x01, 0x01])),
  });
  expect(damaged.publicKey.type).toBe('RSA');
  expect(damaged.publicKey.bits).toBeUndefined();
  expect(damaged.warnings.some((w) => w.includes('could not be read in detail'))).toBe(true);
  // A named curve the page does not know is shown by its identifier.
  const strange = seq(seq(oid('1.2.840.10045.2.1'), oid('1.2.3.4.5')), bitString([4, 1, 2]));
  expect(sizes(strange)).toMatchObject({ type: 'EC', curve: '1.2.3.4.5' });
});

it('the status changes exactly at notBefore and one millisecond after notAfter', () => {
  const printed = CERTIFICATES['leaf']!;
  const notBefore = opensslDate(printed.notBefore);
  const notAfter = opensslDate(printed.notAfter);
  const at = (now: number) => readCertificate(certificateDer('leaf'), now).status;
  expect(at(notBefore - 1)).toEqual({ state: 'not-yet-valid', days: 0 });
  expect(at(notBefore)).toMatchObject({ state: 'valid' });
  expect(at(notAfter)).toEqual({ state: 'valid', days: 0 });
  expect(at(notAfter + 1)).toEqual({ state: 'expired', days: 0 });
  // Whole days: 88 days and a bit left, 12 days and a bit gone, 3 days and a bit to wait.
  const day = 86_400_000;
  expect(at(notAfter - 88 * day - 5)).toEqual({ state: 'valid', days: 88 });
  expect(at(notAfter + 12 * day + 5)).toEqual({ state: 'expired', days: 12 });
  expect(at(notBefore - 3 * day - 5)).toEqual({ state: 'not-yet-valid', days: 3 });
  expect(at(notAfter + day - 1)).toEqual({ state: 'expired', days: 0 });
  expect(at(notAfter + day)).toEqual({ state: 'expired', days: 1 });
  // The two time types: UTCTime (50 to 99 is 19xx, below 50 is 20xx) and GeneralizedTime.
  const old = readBuilt({ notBefore: utcTime('990101000000Z'), notAfter: generalizedTime('20500101000000Z') });
  expect(old.notBefore.iso).toBe('1999-01-01T00:00:00Z');
  expect(old.notAfter.iso).toBe('2050-01-01T00:00:00Z');
  expect(readBuilt({ notBefore: utcTime('491231235959Z') }).notBefore.iso).toBe('2049-12-31T23:59:59Z');
  expect(readBuilt({ notBefore: utcTime('500101000000Z') }).notBefore.iso).toBe('1950-01-01T00:00:00Z');
});

/** Node's own list of root certificates, read by Node's own X509Certificate: an OpenSSL-backed second opinion. */
it('every root certificate Node ships decodes with fingerprint, serial and validity end equal to Node X509Certificate', () => {
  expect(rootCertificates.length).toBeGreaterThan(100);
  const curves = new Map([
    ['prime256v1', 'P-256'],
    ['secp384r1', 'P-384'],
    ['secp521r1', 'P-521'],
  ]);
  // Node writes a name one attribute per line and escapes a comma or a plus sign with a backslash, as RFC 2253 does.
  const unescaped = (multiline: string): string =>
    multiline
      .split('\n')
      .join(', ')
      .replace(/\\([,+\\<>;"# =])/g, '$1');
  const problems: string[] = [];
  let decoded = 0;
  for (const pem of rootCertificates) {
    const node = new X509Certificate(pem);
    const label = node.subject.replace(/\n/g, ', ').slice(0, 60);
    try {
      const body = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
      const cert = readCertificate(base64Bytes(body), NOW_MS);
      decoded++;
      const check = (field: string, mine: unknown, theirs: unknown): void => {
        if (mine !== theirs) problems.push(`${label}: ${field} ${String(mine)} is not ${String(theirs)}`);
      };
      check('SHA-256', cert.fingerprints.sha256, node.fingerprint256);
      check('SHA-1', cert.fingerprints.sha1, node.fingerprint);
      // Node prints the serial 0 as 0 where OpenSSL prints 00: Node's hex is padded to whole bytes here.
      check('serial', cert.serialHex, node.serialNumber.length % 2 === 1 ? '0' + node.serialNumber : node.serialNumber);
      check('valid to', cert.notAfter.epochMs, opensslDate(node.validTo));
      check('valid from', cert.notBefore.epochMs, opensslDate(node.validFrom));
      check('subject', cert.subject.display.replace(/ \+ /g, ', '), unescaped(node.subject));
      check('issuer', cert.issuer.display.replace(/ \+ /g, ', '), unescaped(node.issuer));
      const details = node.publicKey.asymmetricKeyDetails;
      if (node.publicKey.asymmetricKeyType === 'rsa') {
        check('key type', cert.publicKey.type, 'RSA');
        check('key size', cert.publicKey.bits, details?.modulusLength);
        check('exponent', cert.publicKey.exponent, String(details?.publicExponent));
      } else if (node.publicKey.asymmetricKeyType === 'ec') {
        check('key type', cert.publicKey.type, 'EC');
        check('curve', cert.publicKey.curve, curves.get(details?.namedCurve ?? ''));
      }
    } catch (err) {
      problems.push(`${label}: ${(err as Error).message}`);
    }
  }
  expect(problems).toEqual([]);
  expect(decoded).toBe(rootCertificates.length);
}, 60_000);

it('Base64 and hex DER pastes give the same fingerprints as the PEM and a private key block is ignored without echo', () => {
  const printed = CERTIFICATES['leaf']!;
  const sha = (text: string): string => decodeInput(text, { nowMs: NOW_MS }).items[0]!.fingerprints.sha256;
  const der = certificateDer('leaf');
  expect(sha(certificatePem('leaf'))).toBe(printed.sha256);
  expect(sha(printed.derB64)).toBe(printed.sha256);
  expect(sha(printed.derB64.replace(/(.{40})/g, '$1\r\n'))).toBe(printed.sha256);
  const plainHex = Buffer.from(der).toString('hex');
  expect(sha(plainHex)).toBe(printed.sha256);
  expect(sha(plainHex.toUpperCase())).toBe(printed.sha256);
  expect(sha(plainHex.replace(/(..)/g, '$1:').slice(0, -1))).toBe(printed.sha256);
  expect(sha(plainHex.replace(/(.{32})/g, '$1\n'))).toBe(printed.sha256);
  expect(sha(`\n\n  ${printed.derB64}  \n`)).toBe(printed.sha256);
  expect(sha(printed.derB64.replace(/=+$/, ''))).toBe(printed.sha256);

  // A private key block beside a certificate: counted, skipped, and nothing of it in the result.
  const marker = 'PRIVATE-MARKER-0123456789-abcdefghij';
  const markerBase64 = Buffer.from(marker).toString('base64');
  for (const label of [
    'PRIVATE KEY',
    'RSA PRIVATE KEY',
    'EC PRIVATE KEY',
    'ENCRYPTED PRIVATE KEY',
    'OPENSSH PRIVATE KEY',
  ]) {
    const result = decodeInput(certificatePem('leaf') + pemText(label, markerBase64), { nowMs: NOW_MS });
    expect(result.items).toHaveLength(1);
    expect(result.ignored).toEqual([{ label, count: 1 }]);
    const everything = JSON.stringify(result, (_key, value) =>
      value instanceof Uint8Array ? Array.from(value) : value,
    );
    expect(everything).not.toContain(marker);
    expect(everything).not.toContain(markerBase64);
  }
  const twice = decodeInput(
    pemText('PRIVATE KEY', markerBase64) + certificatePem('ec256') + pemText('PRIVATE KEY', markerBase64),
    {
      nowMs: NOW_MS,
    },
  );
  expect(twice.ignored).toEqual([{ label: 'PRIVATE KEY', count: 2 }]);
  // Only a private key: no certificate, one plain sentence that holds no key text.
  let message = '';
  try {
    decodeInput(pemText('PRIVATE KEY', markerBase64), { nowMs: NOW_MS });
  } catch (err) {
    message = (err as Error).message;
  }
  expect(message).toMatch(/^No certificate was found in this paste\./);
  expect(message).not.toContain(marker);
  expect(message).not.toContain(markerBase64.slice(0, 12));
  // A private key block with bad Base64 inside is reported by its label only.
  const bad = pemText('PRIVATE KEY', '!!!' + markerBase64);
  try {
    decodeInput(bad, { nowMs: NOW_MS });
    message = '';
  } catch (err) {
    message = (err as Error).message;
  }
  expect(message).toContain('PRIVATE KEY');
  expect(message).not.toContain(markerBase64.slice(0, 12));
  // Any other label is refused by the name of its label only.
  try {
    decodeInput(pemText('X509 CRL', markerBase64), { nowMs: NOW_MS });
    message = '';
  } catch (err) {
    message = (err as Error).message;
  }
  expect(message).toBe('This paste holds a block labelled X509 CRL, which this page does not read.');
});

it('fingerprints do not change with line width, CRLF or Base64 wrapping of the paste', () => {
  const printed = CERTIFICATES['int']!;
  const variants: string[] = [
    certificatePem('int', 64),
    certificatePem('int', 76),
    certificatePem('int', 20),
    certificatePem('int', 4096),
    certificatePem('int', 64, '\r\n'),
    certificatePem('int', 76, '\r\n'),
    certificatePem('int', 10, '\r'),
    '\n\n' + certificatePem('int') + '\n\n\n',
    certificatePem('int').replace(/\n/g, '\n\n'),
    'some words before\n' + certificatePem('int') + 'some words after\n',
  ];
  // The long-line and bare-CR variants hold the Base64 on lines the scanner has to accept, so only the line ends change.
  for (const variant of variants) {
    const cert = decodeInput(variant, { nowMs: NOW_MS }).items[0]!;
    expect(cert.fingerprints.sha256).toBe(printed.sha256);
    expect(cert.fingerprints.sha1).toBe(printed.sha1);
    expect(cert.fingerprints.md5).toBe(printed.md5);
  }
});

it('prototype-named OIDs and attribute types decode as unknown values', () => {
  for (const typed of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    expect(OID_NAMES.get(typed), typed).toBeUndefined();
    expect(oidName(typed), typed).toBeUndefined();
    expect(oidLabel(typed), typed).toBe(typed);
    expect(KEY_TYPE_NAMES.get(typed), typed).toBeUndefined();
    expect(CURVE_BITS.get(typed), typed).toBeUndefined();
    expect(EXTENSION_DECODERS.get(typed), typed).toBeUndefined();
  }
  // An attribute type or extension nobody named is shown by its dotted identifier, whatever its value says.
  const odd = nameInfo(rdn('1.2.3.4', utf8('__proto__')), rdn('1.2.3.5', utf8('constructor')));
  expect(odd.rfc4514).toBe('1.2.3.5=#0c0b636f6e7374727563746f72,1.2.3.4=#0c095f5f70726f746f5f5f');
  expect(odd.display).toBe('1.2.3.4=__proto__, 1.2.3.5=constructor');
  const cert = readBuilt({ extensions: [extension('1.2.3.4', false, [1, 2, 3])] });
  expect(cert.extensions[0]).toMatchObject({ oid: '1.2.3.4', decoded: false, value: ['010203'] });
  expect(cert.extensions[0]!.name).toBeUndefined();
  // Every name in the table belongs to one identifier only, so a name can never change what an identifier means.
  const identifiers = new Set(Array.from(OID_NAMES.keys()));
  expect(identifiers.size).toBe(OID_NAMES.size);
  for (const identifier of identifiers) expect(identifier).toMatch(/^[0-2](\.\d+)+$/);
  // The names RFC 5280 gives its own extensions are in the table.
  expect(OID_NAMES.get('2.5.29.19')).toBe('basicConstraints');
  expect(OID_NAMES.get('2.16.840.1.101.3.4.3.18')).toBe('ML-DSA-65');
});
