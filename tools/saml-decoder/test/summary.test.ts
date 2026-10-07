// Expected values here are the SAML V2.0 Technical Overview Committee Draft 02 messages (section 5.1.2), retyped under
// test/fixtures/oasis with their notice, the xs:dateTime rules of XML Schema, SAML Core sections 2 and 3, and Node Date.parse as
// the second opinion on the time reader. Messages for the checks that the published examples do not reach are built here from
// parts, so each test changes one thing.
import { expect, it } from 'vitest';
import { decodeSaml, describeTime, formatUtc, parseDateTime } from '../src/index';
import { NOW_OVERVIEW, fixture, mulberry32, pairsOf, redirectUrl, responseXml } from './helpers';

const NOW = NOW_OVERVIEW;

it('the Technical Overview Response summary gives its issuer, destination, audience, validity window, subject and signed assertion', () => {
  const report = decodeSaml(fixture('overview-response.xml'), { now: NOW });
  expect(report.binding).toBe('Raw XML (no binding)');
  const pairs = pairsOf(report);
  expect(pairs.get('Message')).toBe('SAML 2.0 Response');
  expect(pairs.get('Issuer')).toBe('https://idp.example.org/SAML2');
  expect(pairs.get('Destination')).toBe('https://sp.example.com/SAML2/SSO/POST');
  expect(pairs.get('InResponseTo')).toBe('identifier_1');
  expect(pairs.get('Status')).toBe('Success');
  expect(pairs.get('Audience')).toBe('https://sp.example.com/SAML2');
  expect(pairs.get('Valid from')).toBe('2004-12-05T09:17:05Z');
  expect(pairs.get('Valid until')).toBe('2004-12-05T09:27:05Z');
  expect(pairs.get('Subject identifier')).toBe('3f7b3dcf-1674-4ecd-92c8-1544f346baf8');
  expect(pairs.get('Subject identifier format')).toBe('urn:oasis:names:tc:SAML:2.0:nameid-format:transient');
  expect(pairs.get('Confirmation method')).toBe('urn:oasis:names:tc:SAML:2.0:cm:bearer');
  expect(pairs.get('Confirmation recipient')).toBe('https://sp.example.com/SAML2/SSO/POST');
  expect(pairs.get('Authentication context')).toBe('urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport');
  expect(pairs.get('Session index')).toBe('identifier_3');
  expect(pairs.get('Assertion ID')).toBe('identifier_3');
  expect(pairs.get('Time window')).toContain('Inside the window');

  // The signature is listed as present on the Assertion, never as checked.
  expect(report.signatures.signatures).toHaveLength(1);
  const signature = report.signatures.signatures[0]!;
  expect(signature.parent).toBe('saml:Assertion');
  expect(signature.parentId).toBe('identifier_3');
  expect(pairs.get('Signatures')).toContain('identifier_3');
  expect(pairs.get('Signatures')).toContain('not verified');
  for (const row of report.signatures.rows) expect(row.join(' ')).toContain('Present, not verified');
  // The document's own placeholder holds no SignedInfo and no certificate, and that is said.
  expect(report.signatures.notes.join(' ')).toContain('no SignedInfo');
  expect(report.signatures.certificatePem).toBeUndefined();

  // The times are shown as written and in UTC, judged against the time given with no clock skew.
  const row = (prefix: string) => report.summary.times.find((r) => r.field.startsWith(prefix));
  expect(row('NotBefore')).toMatchObject({ value: '2004-12-05T09:17:05Z', utc: '2004-12-05T09:17:05Z' });
  expect(row('NotBefore')?.status).toContain('Reached');
  expect(row('NotOnOrAfter (Conditions)')?.status).toContain('Still open');
  expect(row('NotOnOrAfter (Conditions)')?.status).toContain('in 4 min 35 s');
  // A comment between elements is not a comment inside a text value.
  expect(report.notes.join(' ')).not.toContain('comment');

  // Judged ten minutes later and an hour before.
  const later = decodeSaml(fixture('overview-response.xml'), { now: NOW + 10 * 60_000 });
  expect(later.summary.times.find((r) => r.field.startsWith('NotOnOrAfter (Conditions)'))?.status).toContain('Expired');
  expect(pairsOf(later).get('Time window')).toContain('After the window');
  const earlier = decodeSaml(fixture('overview-response.xml'), { now: NOW - 3_600_000 });
  expect(earlier.summary.times.find((r) => r.field.startsWith('NotBefore'))?.status).toContain('Not yet');
  expect(pairsOf(earlier).get('Time window')).toContain('Before the window');

  // The AuthnRequest of the same document, in a redirect address.
  const request = decodeSaml(redirectUrl(fixture('overview-authnrequest.xml')), { now: NOW });
  const requestPairs = pairsOf(request);
  expect(request.binding).toBe('HTTP-Redirect');
  expect(requestPairs.get('Message')).toBe('SAML 2.0 AuthnRequest');
  expect(requestPairs.get('ID')).toBe('identifier_1');
  expect(requestPairs.get('Issuer')).toBe('https://sp.example.com/SAML2');
  expect(requestPairs.get('AssertionConsumerServiceIndex')).toBe('1');
  expect(requestPairs.get('NameIDPolicy')).toContain('urn:oasis:names:tc:SAML:2.0:nameid-format:transient');
  expect(requestPairs.get('NameIDPolicy')).toContain('AllowCreate true');
  expect(requestPairs.get('Signatures')).toBe('None present');
  expect(request.notes.join(' ')).toContain('No signature');
});

it('a comment inside a NameID is shown with both readings and a warning', () => {
  // Pitfall from the SAML Core text: an element's text is not one string when a comment splits it, and readers differ.
  const assertion = `<saml:Assertion ID="a1" Version="2.0" IssueInstant="2004-12-05T09:22:05Z"><saml:Issuer>https://idp.example.org/SAML2</saml:Issuer><saml:Subject><saml:NameID>user@example.com<!---->.evil.com</saml:NameID></saml:Subject></saml:Assertion>`;
  const report = decodeSaml(responseXml({ assertion }), { now: NOW });
  const pairs = pairsOf(report);
  expect(pairs.get('Subject identifier (first text node)')).toBe('user@example.com');
  expect(pairs.get('Subject identifier (whole text)')).toBe('user@example.com.evil.com');
  expect(pairs.has('Subject identifier')).toBe(false);
  const warning = report.notes.find((note) => note.includes('comment'));
  expect(warning).toContain('NameID');
  expect(warning).toContain('user@example.com');

  // The same in a LogoutRequest, which has its own NameID.
  const logout = `<samlp:LogoutRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns="urn:oasis:names:tc:SAML:2.0:assertion" ID="l1" Version="2.0" IssueInstant="2004-01-21T19:00:49Z"><NameID>a<!-- x -->b</NameID></samlp:LogoutRequest>`;
  const logoutPairs = pairsOf(decodeSaml(logout, { now: NOW }));
  expect(logoutPairs.get('Subject identifier (first text node)')).toBe('a');
  expect(logoutPairs.get('Subject identifier (whole text)')).toBe('ab');

  // A comment inside an attribute value is noted too, and a comment between elements is not.
  const attribute = `<saml:Assertion ID="a1" Version="2.0" IssueInstant="2004-12-05T09:22:05Z"><saml:Issuer>i</saml:Issuer><!-- fine here --><saml:AttributeStatement><saml:Attribute Name="mail"><saml:AttributeValue>x<!--y-->z</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion>`;
  const attributed = decodeSaml(responseXml({ assertion: attribute }), { now: NOW });
  expect(attributed.notes.filter((note) => note.includes('comment'))).toHaveLength(1);
  expect(attributed.notes.find((note) => note.includes('comment'))).toContain('AttributeValue');
  expect(attributed.summary.attributes[0]?.value).toBe('xz');

  // Whitespace and the same text with no comment give one plain reading and no warning.
  const plain = decodeSaml(
    responseXml({
      assertion: assertion.replace('<!---->', ''),
    }),
    { now: NOW },
  );
  expect(pairsOf(plain).get('Subject identifier')).toBe('user@example.com.evil.com');
  expect(plain.notes.join(' ')).not.toContain('comment');
});

it('the same message and the same time give the same summary every time', () => {
  // WEB-07 concurrency: no state is kept between calls, so any order of the same inputs gives the same answers.
  const inputs = [
    { text: fixture('overview-response.xml'), now: NOW },
    { text: fixture('redirect-logout-request.txt').trim(), now: Date.UTC(2004, 0, 21, 19, 5, 0) },
    { text: fixture('post-logout-response.html'), now: Date.UTC(2030, 0, 1) },
    { text: redirectUrl(fixture('overview-authnrequest.xml'), '&RelayState=abc'), now: NOW },
  ];
  const first = inputs.map((input) => decodeSaml(input.text, { now: input.now }));
  const orders = [
    [0, 1, 2, 3],
    [3, 2, 1, 0],
    [1, 3, 0, 2],
    [2, 0, 3, 1],
    [0, 0, 1, 1],
  ];
  for (const order of orders) {
    for (const index of order) {
      const again = decodeSaml(inputs[index]!.text, { now: inputs[index]!.now });
      expect(again).toStrictEqual(first[index]);
    }
  }
  // A refusal in between shows no part of an earlier message, and the next message is unaffected.
  const marker = 'QZXMARKERQZX';
  const secret = decodeSaml(responseXml({ attrs: ` ${marker}x="1"` }), { now: NOW });
  expect(secret.xml).toContain(marker);
  let message = '';
  try {
    decodeSaml('<a><b></a>', { now: NOW });
  } catch (err) {
    message = (err as Error).message;
  }
  expect(message).not.toContain(marker);
  expect(message).not.toContain('identifier_3');
  expect(decodeSaml(inputs[0]!.text, { now: inputs[0]!.now })).toStrictEqual(first[0]);
  // Different times give different judgments of the same message, never a remembered one.
  const a = decodeSaml(inputs[0]!.text, { now: NOW });
  const b = decodeSaml(inputs[0]!.text, { now: NOW + 3_600_000 });
  expect(a.summary.times).not.toStrictEqual(b.summary.times);
  expect(decodeSaml(inputs[0]!.text, { now: NOW }).summary.times).toStrictEqual(a.summary.times);
});

it('times are read as strict xs:dateTime values and judged against the time given with no clock skew', () => {
  // XML Schema Part 2, dateTime: four digit year, two digit fields, T, optional fraction, optional Z or hh:mm offset.
  const valid = [
    '2004-12-05T09:17:05Z',
    '2004-12-05T09:17:05.123Z',
    '2004-12-05T09:17:05.5+02:00',
    '2004-12-05T09:17:05-05:30',
    '2004-02-29T00:00:00Z',
    '2000-02-29T23:59:59Z',
    '1999-12-31T23:59:59+14:00',
    '2004-12-05T09:17:05.123456789012Z',
  ];
  for (const text of valid) {
    const parsed = parseDateTime(text);
    expect(parsed, text).not.toBeNull();
    // The second opinion: Node reads the same text to the same millisecond (the fraction beyond milliseconds is cut).
    const reference = Date.parse(text.replace(/(\.\d{3})\d+/, '$1'));
    expect(parsed?.ms, text).toBe(reference);
  }
  const invalid = [
    '',
    'yesterday',
    '2003-02-29T00:00:00Z',
    '1900-02-29T00:00:00Z',
    '2004-13-01T00:00:00Z',
    '2004-00-10T00:00:00Z',
    '2004-12-32T00:00:00Z',
    '2004-12-05T24:00:00Z',
    '2004-12-05T09:60:00Z',
    '2004-12-05T09:17:60Z',
    '2004-12-05 09:17:05Z',
    '2004-12-05T09:17Z',
    '04-12-05T09:17:05Z',
    '2004-12-05T09:17:05z',
    '2004-12-05T09:17:05+2:00',
    '2004-12-05T09:17:05+15:00',
    '2004-12-05T09:17:05+02:60',
    '2004-12-05T09:17:05.Z',
    '2004-12-05T09:17:05Zjunk',
    '2004-12-05T09:17:05+0200',
    '2004-12-05T09:17:05.1234567890123Z',
  ];
  for (const text of invalid) expect(parseDateTime(text), text).toBeNull();
  // Zones: Z and +00:00 are UTC, an offset is not, and no zone is read as UTC but said.
  expect(parseDateTime('2004-12-05T09:17:05Z')).toMatchObject({ utc: true, hadZone: true, offsetMinutes: 0 });
  expect(parseDateTime('2004-12-05T09:17:05+00:00')).toMatchObject({ utc: true, hadZone: true });
  expect(parseDateTime('2004-12-05T11:17:05+02:00')).toMatchObject({ utc: false, offsetMinutes: 120 });
  expect(parseDateTime('2004-12-05T09:17:05')).toMatchObject({ utc: true, hadZone: false });
  expect(parseDateTime('2004-12-05T11:17:05+02:00')?.ms).toBe(parseDateTime('2004-12-05T09:17:05Z')?.ms);
  // A seeded run of 300 dates against Node.
  const random = mulberry32(7);
  for (let i = 0; i < 300; i++) {
    const ms = Math.floor(random() * 4_000_000_000_000) - 1_000_000_000_000;
    const text = new Date(ms).toISOString();
    expect(parseDateTime(text)?.ms).toBe(ms);
    expect(formatUtc(ms)).toBe(text.endsWith('.000Z') ? text.slice(0, -5) + 'Z' : text);
  }
  // Relative words.
  const base = Date.UTC(2004, 11, 5, 9, 22, 30);
  expect(describeTime(base, base)).toBe('now');
  expect(describeTime(base + 400, base)).toBe('now');
  expect(describeTime(base + 45_000, base)).toBe('in 45 s');
  expect(describeTime(base - 5 * 60_000, base)).toBe('5 min ago');
  expect(describeTime(base - (3 * 3600 + 4 * 60) * 1000, base)).toBe('3 h 4 min ago');
  expect(describeTime(base + 26 * 3_600_000, base)).toBe('in 1 d 2 h');
  expect(describeTime(base - 21 * 365 * 86_400_000, base)).toBe('about 21 years ago');

  // The window edges allow no skew: NotBefore is reached at that instant, NotOnOrAfter has passed at that instant.
  const conditions = (nb: string, noa: string) =>
    responseXml({
      assertion: `<saml:Assertion ID="a1" Version="2.0" IssueInstant="2004-12-05T09:00:00Z"><saml:Issuer>i</saml:Issuer><saml:Conditions NotBefore="${nb}" NotOnOrAfter="${noa}"><saml:AudienceRestriction><saml:Audience>a</saml:Audience></saml:AudienceRestriction></saml:Conditions></saml:Assertion>`,
    });
  const edge = (now: number) => {
    const report = decodeSaml(conditions('2004-12-05T09:10:00Z', '2004-12-05T09:20:00Z'), { now });
    return {
      from: report.summary.times.find((r) => r.field.startsWith('NotBefore'))?.status ?? '',
      until: report.summary.times.find((r) => r.field.startsWith('NotOnOrAfter'))?.status ?? '',
      window: pairsOf(report).get('Time window') ?? '',
    };
  };
  const from = Date.UTC(2004, 11, 5, 9, 10, 0);
  const until = Date.UTC(2004, 11, 5, 9, 20, 0);
  expect(edge(from - 1).from).toContain('Not yet');
  expect(edge(from - 1).window).toContain('Before the window');
  expect(edge(from).from).toContain('Reached');
  expect(edge(from).window).toContain('Inside the window');
  expect(edge(until - 1).until).toContain('Still open');
  expect(edge(until - 1).window).toContain('Inside the window');
  expect(edge(until).until).toContain('Expired');
  expect(edge(until).window).toContain('After the window');

  // An offset other than UTC is flagged in the table and in the notes, and the UTC column shows the same instant in UTC.
  const offset = decodeSaml(conditions('2004-12-05T11:10:00+02:00', '2004-12-05T09:20:00Z'), { now: NOW });
  const offsetRow = offset.summary.times.find((r) => r.field.startsWith('NotBefore'));
  expect(offsetRow?.value).toBe('2004-12-05T11:10:00+02:00');
  expect(offsetRow?.utc).toBe('2004-12-05T09:10:00Z');
  expect(offsetRow?.status).toContain('not UTC');
  expect(offset.notes.join(' ')).toContain('offset other than UTC');
  // A time with no zone and one that is not a time at all.
  const none = decodeSaml(conditions('2004-12-05T09:10:00', 'tomorrow'), { now: NOW });
  expect(none.summary.times.find((r) => r.field.startsWith('NotBefore'))?.status).toContain('no time zone');
  const bad = none.summary.times.find((r) => r.field.startsWith('NotOnOrAfter'));
  expect(bad?.utc).toBe('');
  expect(bad?.status).toContain('xs:dateTime');
  expect(none.notes.join(' ')).toContain('xs:dateTime');
});

it('every ds:Signature is listed as present with its parent and where each Reference points, and wrapping shapes are flagged', () => {
  // XML Signature Syntax and Processing section 4.4.3: a Reference URI of #id names the element with that ID.
  const sig = (references: string, certificate = '') =>
    `<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignedInfo><ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/><ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>${references}</ds:SignedInfo><ds:SignatureValue>AAAA</ds:SignatureValue>${certificate}</ds:Signature>`;
  const ref = (uri: string | null) =>
    `<ds:Reference${uri === null ? '' : ` URI="${uri}"`}><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/></ds:Transforms><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>AAAA</ds:DigestValue></ds:Reference>`;
  const assertionWith = (signature: string, extra = '') =>
    `<saml:Assertion ID="a1" Version="2.0" IssueInstant="2004-12-05T09:22:05Z"><saml:Issuer>i</saml:Issuer>${signature}${extra}</saml:Assertion>`;
  const points = (signature: string, extra = '', extraResponse = '') => {
    const report = decodeSaml(responseXml({ assertion: assertionWith(signature, extra), extra: extraResponse }), {
      now: NOW,
    });
    return { report, reference: report.signatures.signatures[0]?.references[0] };
  };

  // A Reference to the parent is the normal shape and raises no note.
  const normal = points(sig(ref('#a1')));
  expect(normal.reference).toMatchObject({ uri: '#a1', points: 'parent' });
  expect(normal.report.signatures.notes.join(' ')).not.toContain('wrapping');
  expect(normal.report.signatures.signedElements).toEqual(['saml:Assertion a1']);
  expect(normal.report.signatures.signatures[0]).toMatchObject({
    parent: 'saml:Assertion',
    parentId: 'a1',
    canonicalization: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    signatureMethod: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
  });
  expect(normal.report.signatures.rows[0]?.join(' ')).toContain('its parent element');

  // A Reference to another element that exists is the shape signature wrapping uses.
  const other = points(sig(ref('#evil')), '<saml:Advice ID="evil"/>');
  expect(other.reference).toMatchObject({ points: 'other', target: 'saml:Advice' });
  expect(other.report.signatures.notes.join(' ')).toContain('signature-wrapping');
  expect(other.report.signatures.rows[0]?.join(' ')).toContain('another element');
  // A Reference to an element that is not in the message, one that matches two elements, no URI, a URI outside the message
  // and an XPointer.
  expect(points(sig(ref('#nothere'))).reference).toMatchObject({ points: 'missing' });
  const duplicate = points(sig(ref('#a1')), '<saml:Advice ID="a1"/>');
  expect(duplicate.reference).toMatchObject({ points: 'duplicate' });
  expect(duplicate.report.signatures.notes.join(' ')).toContain('more than one element');
  expect(points(sig(ref(null))).reference).toMatchObject({ points: 'none' });
  expect(points(sig(ref('https://example.test/doc.xml'))).reference).toMatchObject({ points: 'outside' });
  expect(points(sig(ref("#xpointer(id('a1'))"))).reference).toMatchObject({ points: 'xpointer' });
  // An empty URI is the whole document: the parent only when the parent is the root.
  expect(points(sig(ref(''))).reference).toMatchObject({ points: 'document' });
  expect(points(sig(ref(''))).report.signatures.notes.join(' ')).toContain('signature-wrapping');
  const rootSigned = decodeSaml(responseXml({ extra: sig(ref('')) }), { now: NOW });
  expect(rootSigned.signatures.signatures[0]?.references[0]).toMatchObject({ points: 'parent' });
  expect(rootSigned.signatures.notes.join(' ')).not.toContain('signature-wrapping');
  // Two Signatures, one on the Assertion and one on the Response.
  const both = decodeSaml(responseXml({ assertion: assertionWith(sig(ref('#a1'))), extra: sig(ref('#r1')) }), {
    now: NOW,
  });
  expect(both.signatures.signatures.map((s) => s.parent)).toEqual(['saml:Assertion', 'samlp:Response']);
  expect(pairsOf(both).get('Signatures')).toContain('2 present, not verified');
  expect(both.signatures.signedElements).toEqual(['saml:Assertion a1', 'samlp:Response r1']);
  // Names that are also object keys are plain IDs.
  for (const name of ['__proto__', 'constructor', 'toString']) {
    const keyed = decodeSaml(
      responseXml({
        assertion: `<saml:Assertion ID="${name}" Version="2.0" IssueInstant="2004-12-05T09:22:05Z"><saml:Issuer>i</saml:Issuer>${sig(ref(`#${name}`))}</saml:Assertion>`,
      }),
      { now: NOW },
    );
    expect(keyed.signatures.signatures[0]?.references[0]).toMatchObject({ points: 'parent' });
    expect(points(sig(ref(`#${name}`))).reference).toMatchObject({ points: 'missing' });
  }
});

it('the first embedded certificate is shown as PEM text and never read', () => {
  const random = mulberry32(99);
  const bytes = Buffer.from(Array.from({ length: 300 }, () => Math.floor(random() * 256)));
  const text = bytes.toString('base64');
  const spaced = text.replace(/(.{40})/g, '$1\r\n   ');
  const cert = (value: string) => `<ds:X509Data><ds:X509Certificate>${value}</ds:X509Certificate></ds:X509Data>`;
  const message = (certificates: string) =>
    responseXml({
      assertion: `<saml:Assertion ID="a1" Version="2.0" IssueInstant="2004-12-05T09:22:05Z"><saml:Issuer>i</saml:Issuer><ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignedInfo><ds:Reference URI="#a1"/></ds:SignedInfo><ds:SignatureValue>AAAA</ds:SignatureValue><ds:KeyInfo>${certificates}</ds:KeyInfo></ds:Signature></saml:Assertion>`,
    });
  const report = decodeSaml(message(cert(spaced) + cert('QUJD')), { now: NOW });
  const pem = report.signatures.certificatePem ?? '';
  const lines = pem.split('\n');
  expect(lines[0]).toBe('-----BEGIN CERTIFICATE-----');
  expect(lines[lines.length - 1]).toBe('-----END CERTIFICATE-----');
  for (const line of lines.slice(1, -2)) expect(line).toHaveLength(64);
  expect(lines.slice(1, -1).join('')).toBe(text);
  expect(Buffer.from(lines.slice(1, -1).join(''), 'base64').equals(bytes)).toBe(true);
  // Only the first certificate is shown.
  expect(pem).not.toContain('QUJD');
  expect(report.signatures.notes.join(' ')).toContain('first certificate');
  // Text that is not Base64 is not shown as a certificate, and the placeholder of the Technical Overview holds none.
  const notBase64 = decodeSaml(message(cert('not base64 at all!')), { now: NOW });
  expect(notBase64.signatures.certificatePem).toBeUndefined();
  expect(notBase64.signatures.notes.join(' ')).toContain('not Base64');
  expect(decodeSaml(message(''), { now: NOW }).signatures.certificatePem).toBeUndefined();
});

it('attributes are listed with their name, format, friendly name, value and type', () => {
  const assertion = `<saml:Assertion ID="a1" Version="2.0" IssueInstant="2004-12-05T09:22:05Z" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xs="http://www.w3.org/2001/XMLSchema"><saml:Issuer>i</saml:Issuer><saml:AttributeStatement><saml:Attribute Name="urn:oid:0.9.2342.19200300.100.1.3" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:uri" FriendlyName="mail"><saml:AttributeValue xsi:type="xs:string">user@example.com</saml:AttributeValue><saml:AttributeValue xsi:type="xs:string">second@example.com</saml:AttributeValue></saml:Attribute><saml:Attribute Name="groups"><saml:AttributeValue><x:g xmlns:x="urn:x">nested</x:g></saml:AttributeValue></saml:Attribute><saml:Attribute Name="empty"/></saml:AttributeStatement></saml:Assertion>`;
  const report = decodeSaml(responseXml({ assertion }), { now: NOW });
  expect(report.summary.attributes).toEqual([
    {
      assertion: '1',
      name: 'urn:oid:0.9.2342.19200300.100.1.3',
      nameFormat: 'urn:oasis:names:tc:SAML:2.0:attrname-format:uri',
      friendlyName: 'mail',
      value: 'user@example.com',
      type: 'xs:string',
    },
    {
      assertion: '1',
      name: 'urn:oid:0.9.2342.19200300.100.1.3',
      nameFormat: 'urn:oasis:names:tc:SAML:2.0:attrname-format:uri',
      friendlyName: 'mail',
      value: 'second@example.com',
      type: 'xs:string',
    },
    {
      assertion: '1',
      name: 'groups',
      nameFormat: '',
      friendlyName: '',
      value: '(holds XML elements: see the formatted XML)',
      type: '',
    },
    { assertion: '1', name: 'empty', nameFormat: '', friendlyName: '', value: '(no value)', type: '' },
  ]);
  expect(pairsOf(report).get('Attributes')).toBe('3 attributes, 3 values');
  // The table is capped, with a count of what was left out.
  const values = Array.from({ length: 1200 }, (_, i) => `<saml:AttributeValue>v${i}</saml:AttributeValue>`).join('');
  const many = decodeSaml(
    responseXml({
      assertion: `<saml:Assertion ID="a1" Version="2.0" IssueInstant="2004-12-05T09:22:05Z"><saml:Issuer>i</saml:Issuer><saml:AttributeStatement><saml:Attribute Name="n">${values}</saml:Attribute></saml:AttributeStatement></saml:Assertion>`,
    }),
    { now: NOW },
  );
  expect(many.summary.attributes).toHaveLength(1000);
  expect(many.summary.attributesOmitted).toBe(200);
  expect(many.summary.attributes[999]?.value).toBe('v999');
});

it('several assertions, a missing audience or conditions, a missing InResponseTo and an encrypted assertion are noted', () => {
  const one = (id: string, extra = '') =>
    `<saml:Assertion ID="${id}" Version="2.0" IssueInstant="2004-12-05T09:22:05Z"><saml:Issuer>https://idp.example.org/SAML2</saml:Issuer>${extra}</saml:Assertion>`;
  const noted = (xml: string) => decodeSaml(xml, { now: NOW }).notes.join(' | ');
  expect(noted(responseXml({ assertion: one('a1') }))).toContain('no Conditions');
  expect(
    noted(responseXml({ assertion: one('a1', '<saml:Conditions NotOnOrAfter="2004-12-05T09:27:05Z"/>') })),
  ).toContain('no Audience');
  expect(noted(responseXml({ assertion: one('a1', '<saml:Conditions/>') }))).toContain('no NotOnOrAfter');
  expect(noted(responseXml({ assertion: one('a1') + one('a2') }))).toContain('2 assertions');
  const two = decodeSaml(responseXml({ assertion: one('a1') + one('a2') }), { now: NOW });
  expect(pairsOf(two).get('Assertion ID (assertion 1)')).toBe('a1');
  expect(pairsOf(two).get('Assertion ID (assertion 2)')).toBe('a2');
  expect(noted(responseXml())).toContain('no InResponseTo');
  expect(noted(responseXml({ attrs: ' InResponseTo="q1"' }))).not.toContain('no InResponseTo');
  const encrypted = noted(responseXml({ assertion: '<saml:EncryptedAssertion><x/></saml:EncryptedAssertion>' }));
  expect(encrypted).toContain('encrypted');
  expect(encrypted).toContain('does not decrypt');
  expect(noted(responseXml({ assertion: '' }))).toContain('holds no Assertion');
  // A signed Response with no Destination, and an Issuer that differs between the Response and its Assertion.
  const signedNoDestination = responseXml({
    extra: '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"/>',
    assertion: one('a1'),
  });
  expect(noted(signedNoDestination)).toContain('Destination');
  expect(
    noted(responseXml({ assertion: one('a1').replace('https://idp.example.org/SAML2', 'https://other.example.org') })),
  ).toContain('differs');
  // A Version other than 2.0.
  expect(noted(responseXml().replace('Version="2.0"', 'Version="1.1"'))).toContain('Version');
  // A message that is signed by its redirect parameter is not called unsigned.
  const redirect = decodeSaml(
    redirectUrl(
      responseXml(),
      '&SigAlg=http%3A%2F%2Fwww.w3.org%2F2001%2F04%2Fxmldsig-more%23rsa-sha256&Signature=AAAA',
    ),
    { now: NOW },
  );
  expect(redirect.notes.join(' ')).not.toContain('No signature');
  expect(redirect.summary.pairs.find(([name]) => name === 'Signatures')?.[1]).toContain('redirect');
  // A RelayState over 80 bytes (Bindings sections 3.4.3 and 3.5.3).
  const long = decodeSaml(redirectUrl(responseXml(), `&RelayState=${'r'.repeat(81)}`), { now: NOW });
  expect(long.notes.join(' ')).toContain('80 bytes');
  const exact = decodeSaml(redirectUrl(responseXml(), `&RelayState=${'r'.repeat(80)}`), { now: NOW });
  expect(exact.notes.join(' ')).not.toContain('80 bytes');
});

it('SAML 1.x, other XML and message types the summary does not cover are said plainly', () => {
  const v1 = (() => {
    try {
      decodeSaml(
        '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:1.0:protocol" ResponseID="r1" MajorVersion="1" MinorVersion="1"/>',
        { now: NOW },
      );
    } catch (err) {
      return (err as Error).message;
    }
    return '';
  })();
  expect(v1).toContain('SAML 1.x');
  expect(v1).toContain('Only SAML 2.0');
  const other = decodeSaml('<note><to>x</to></note>', { now: NOW });
  expect(pairsOf(other).get('Message')).toBe('An XML document that is not a SAML 2.0 message');
  expect(pairsOf(other).get('Root element')).toBe('note');
  const resolve = decodeSaml(
    '<samlp:ArtifactResolve xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="x1" Version="2.0" IssueInstant="2004-12-05T09:22:05Z"/>',
    { now: NOW },
  );
  expect(pairsOf(resolve).get('Message')).toBe('SAML 2.0 ArtifactResolve (the summary does not cover this type)');
  expect(pairsOf(resolve).get('ID')).toBe('x1');
  // A bare Assertion is read as one.
  const bare = decodeSaml(
    '<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="b1" Version="2.0" IssueInstant="2004-12-05T09:22:05Z"><saml:Issuer>i</saml:Issuer><saml:Subject><saml:NameID>n</saml:NameID></saml:Subject></saml:Assertion>',
    { now: NOW },
  );
  expect(pairsOf(bare).get('Message')).toBe('SAML 2.0 Assertion');
  expect(pairsOf(bare).get('Subject identifier')).toBe('n');
});

it('the formatted XML keeps attribute order, comments and text, and is cut at 20,000 lines with a count', () => {
  const xml =
    '<a z="1" b="2 &quot;q&quot; &amp; &lt;"><!-- c --><b>text &amp; more &lt;x&gt;</b><c/><d><![CDATA[x<y]]></d><?pi data?><p>one<e>two</e>three</p><w>  </w></a>';
  const report = decodeSaml(xml, { now: NOW });
  expect(report.formatted.text).toBe(
    [
      '<a z="1" b="2 &quot;q&quot; &amp; &lt;">',
      '  <!-- c -->',
      '  <b>text &amp; more &lt;x&gt;</b>',
      '  <c/>',
      '  <d><![CDATA[x<y]]></d>',
      '  <?pi data?>',
      '  <p>',
      '    one',
      '    <e>two</e>',
      '    three',
      '  </p>',
      '  <w>  </w>',
      '</a>',
    ].join('\n'),
  );
  expect(report.formatted.omitted).toBe(0);
  // Namespaces are kept as written, with prefixes.
  const prefixed = decodeSaml(fixture('overview-authnrequest.xml'), { now: NOW });
  expect(prefixed.formatted.text.split('\n')[0]).toBe(
    '<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="identifier_1" Version="2.0" IssueInstant="2004-12-05T09:21:59Z" AssertionConsumerServiceIndex="1">',
  );
  // Cut at 20,000 lines with the count of what was left out.
  const big = `<r>${'<i/>'.repeat(25_000)}</r>`;
  const cut = decodeSaml(big, { now: NOW });
  expect(cut.formatted.text.split('\n')).toHaveLength(20_000);
  expect(cut.formatted.lines).toBe(25_002);
  expect(cut.formatted.omitted).toBe(5_002);
});
