// Expected values in this file are the examples the OASIS SAML 2.0 Bindings document prints (section 3.4.8 and 3.5.8, an
// OASIS Standard of 15 March 2005), retyped under test/fixtures/oasis with their notice, and Node zlib as the second opinion on
// the DEFLATE layer. Nothing here is taken from running the package.
import { deflateRawSync, deflateSync, gzipSync, inflateRawSync } from 'node:zlib';
import { expect, it, vi } from 'vitest';
import { DOCTYPE_REFUSAL_MESSAGE, MAX_XML_BYTES, SamlDecoderError, decodeSaml, inflateCapped } from '../src/index';
import { ENTITY_REFUSAL_MESSAGE } from '../src/xml-entity';
import { NOW_LOGOUT as NOW, base64Of, fixture, mulberry32, normalise, pairsOf, postForm, refusal } from './helpers';

it('the OASIS Bindings 2.0 logout request redirect address inflates to the specification message', () => {
  // OASIS Bindings 2.0 section 3.4.8: the address of document lines 723 to 733 carries the message of lines 694 to 702.
  const address = fixture('redirect-logout-request.txt').trim();
  const report = decodeSaml(address, { now: NOW });
  expect(report.binding).toBe('HTTP-Redirect');
  expect(report.kind).toBe('redirect');
  expect(normalise(report.xml)).toBe(normalise(fixture('logout-request.xml')));
  const pairs = pairsOf(report);
  expect(pairs.get('Message')).toBe('SAML 2.0 LogoutRequest');
  expect(pairs.get('ID')).toBe('d2b7c388cec36fa7c39c28fd298644a8');
  expect(pairs.get('IssueInstant')).toBe('2004-01-21T19:00:49Z');
  expect(pairs.get('Version')).toBe('2.0');
  expect(pairs.get('Issuer')).toBe('https://IdentityProvider.com/SAML');
  expect(pairs.get('Subject identifier')).toBe('005a06e0-ad82-110d-a556-004005b13a2b');
  expect(pairs.get('Subject identifier format')).toBe('urn:oasis:names:tc:SAML:2.0:nameid-format:persistent');
  expect(pairs.get('SessionIndex')).toBe('1');
  // The second opinion: Node zlib reads the same address to the same text.
  const query = new URLSearchParams(address.slice(address.indexOf('?') + 1));
  const second = inflateRawSync(Buffer.from(query.get('SAMLRequest') ?? '', 'base64')).toString('utf8');
  expect(normalise(report.xml)).toBe(normalise(second));
  // The page can say what was done to the text.
  const steps = report.steps.join(' ');
  expect(steps).toContain('SAMLRequest');
  expect(steps).toContain('URL encoding');
  expect(steps).toContain('Inflated');
});

it('the OASIS logout response redirect address and POST form decode to the same LogoutResponse', () => {
  // OASIS Bindings 2.0 section 3.4.8 (lines 742 to 751) and section 3.5.8 (lines 956 to 971) carry the message of lines 703 to 713.
  const redirect = decodeSaml(fixture('redirect-logout-response.txt').trim(), { now: NOW });
  const post = decodeSaml(fixture('post-logout-response.html'), { now: NOW });
  expect(redirect.binding).toBe('HTTP-Redirect');
  expect(post.binding).toBe('HTTP-POST');
  expect(post.kind).toBe('post');
  const expected = normalise(fixture('logout-response.xml'));
  expect(normalise(redirect.xml)).toBe(expected);
  expect(normalise(post.xml)).toBe(expected);
  for (const report of [redirect, post]) {
    const pairs = pairsOf(report);
    expect(pairs.get('Message')).toBe('SAML 2.0 LogoutResponse');
    expect(pairs.get('ID')).toBe('b0730d21b628110d8b7e004005b13a2b');
    expect(pairs.get('InResponseTo')).toBe('d2b7c388cec36fa7c39c28fd298644a8');
    expect(pairs.get('Issuer')).toBe('https://ServiceProvider.com/SAML');
    expect(pairs.get('Status')).toBe('Success');
    expect(report.transport?.relayState).toBe('0043bfc1bc45110dae17004005b13a2b');
  }
  // The two summaries agree row for row, except that the redirect address carries a Signature parameter and the form does not.
  const withoutSignatures = (report: typeof redirect) => report.summary.pairs.filter(([name]) => name !== 'Signatures');
  expect(withoutSignatures(redirect)).toEqual(withoutSignatures(post));
  expect(pairsOf(redirect).get('Signatures')).toBe('a Signature parameter is in the redirect address, not verified');
  expect(pairsOf(post).get('Signatures')).toBe('None present');
  // The second opinion: Node reads the printed Base64 (wrapped at 64 columns, 466 bytes) to the same text.
  const printed = fixture('post-logout-response.html').split('value="')[2]?.split('"')[0] ?? '';
  expect(printed.split('\n').length).toBe(10);
  const bytes = Buffer.from(printed.replace(/\s+/g, ''), 'base64');
  expect(bytes.length).toBe(466);
  expect(normalise(bytes.toString('utf8'))).toBe(expected);
  const query = new URLSearchParams(fixture('redirect-logout-response.txt').trim().split('?')[1]);
  const inflated = inflateRawSync(Buffer.from(query.get('SAMLResponse') ?? '', 'base64')).toString('utf8');
  expect(normalise(inflated)).toBe(expected);
  // The POST form says it was not compressed, so nothing was inflated.
  expect(post.steps.join(' ')).toContain('was not inflated');
});

it('the signed string is the original URL-encoded SAMLRequest, RelayState and SigAlg as pasted', () => {
  // OASIS Bindings 2.0 section 3.4.4.1: the signed octets are the original URL-encoded values, in this order, never re-encoded.
  const address = fixture('redirect-logout-request.txt').trim();
  const expected = address.slice(address.indexOf('SAMLRequest='), address.indexOf('&Signature='));
  expect(expected).toMatch(
    /^SAMLRequest=fVFdS8MwFH0f7D%2BUvG.*%3D%3D&RelayState=0043bfc1bc45110dae17004005b13a2b&SigAlg=http%3A%2F%2Fwww\.w3\.org%2F200%2F09%2Fxmldsig%23rsa-sha1$/,
  );
  const report = decodeSaml(address, { now: NOW });
  expect(report.transport?.signedString).toBe(expected);
  expect(report.transport?.relayState).toBe('0043bfc1bc45110dae17004005b13a2b');
  expect(report.transport?.signatureLength).toContain('41 characters');

  // The parameters in another order, with a parameter the binding does not define, and with lower-case hex in the percent
  // codes: the string is still the three substrings exactly as pasted, in the binding's order.
  const canonical = address.slice(
    address.indexOf('SAMLRequest=') + 'SAMLRequest='.length,
    address.indexOf('&RelayState='),
  );
  // The message value is pasted with lower-case hex in its percent codes: a signer that wrote it that way signed it that way.
  const value = canonical.replace(/%[0-9A-F]{2}/g, (code) => code.toLowerCase());
  expect(value).not.toBe(canonical);
  const odd = `https://sp.example.test/slo?Signature=AAAA&extra=1&SigAlg=http%3a%2f%2fexample.test%2falg&RelayState=a%2fb%20c&SAMLRequest=${value}`;
  const reordered = decodeSaml(odd, { now: NOW });
  expect(reordered.transport?.signedString).toBe(
    `SAMLRequest=${value}&RelayState=a%2fb%20c&SigAlg=http%3a%2f%2fexample.test%2falg`,
  );
  expect(reordered.transport?.relayState).toBe('a/b c');
  expect(reordered.transport?.sigAlg).toBe('http://example.test/alg');

  // Without a RelayState the string is two substrings; without a SigAlg there is no string to show.
  const noRelay = decodeSaml(`https://sp.example.test/slo?SAMLRequest=${value}&SigAlg=x`, { now: NOW });
  expect(noRelay.transport?.signedString).toBe(`SAMLRequest=${value}&SigAlg=x`);
  const noAlg = decodeSaml(`https://sp.example.test/slo?SAMLRequest=${value}&RelayState=r&Signature=AAAA`, {
    now: NOW,
  });
  expect(noAlg.transport?.signedString).toBeUndefined();
  expect(noAlg.warnings.join(' ')).toContain('no SigAlg');
});

it('the SigAlg of the OASIS example is shown exactly as written', () => {
  // OASIS Bindings 2.0 section 3.4.8 prints 200/09 where the XML Signature namespace has 2000/09; it is shown as printed.
  const report = decodeSaml(fixture('redirect-logout-request.txt').trim(), { now: NOW });
  expect(report.transport?.sigAlg).toBe('http://www.w3.org/200/09/xmldsig#rsa-sha1');
  expect(report.transport?.sigAlgNote).toContain('Not an address this page knows');
  expect(report.transport?.sigAlgNote).not.toContain('2000/09');
  const response = decodeSaml(fixture('redirect-logout-response.txt').trim(), { now: NOW });
  expect(response.transport?.sigAlg).toBe('http://www.w3.org/200/09/xmldsig#rsa-sha1');
  // The XML Signature address spelled correctly is known and named.
  const value = fixture('redirect-logout-request.txt').split('SAMLRequest=')[1]?.split('&')[0] ?? '';
  const right = decodeSaml(
    `https://sp.example.test/slo?SAMLRequest=${value}&SigAlg=http%3A%2F%2Fwww.w3.org%2F2000%2F09%2Fxmldsig%23rsa-sha1&Signature=AAAA`,
    { now: NOW },
  );
  expect(right.transport?.sigAlg).toBe('http://www.w3.org/2000/09/xmldsig#rsa-sha1');
  expect(right.transport?.sigAlgNote).toContain('RSA with SHA-1');
});

it('Node zlib round trips 100 generated messages through the same inflate', () => {
  // The second opinion on the DEFLATE layer: Node zlib compresses, inflateCapped and decodeSaml read the result back.
  const random = mulberry32(20260920);
  const pick = (n: number): number => Math.floor(random() * n);
  const words = ['alpha', 'béta', 'γάμμα', 'delta', '日本語', 'epsilon', 'a&b', '<tag>', 'x'.repeat(40)];
  for (let i = 0; i < 100; i++) {
    let body = '';
    const count = 1 + pick(60);
    for (let j = 0; j < count; j++) {
      const text = words[pick(words.length)]!.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      body += `<item n="${j}" k="${pick(1000)}">${text}</item>`;
    }
    const xml = `<samlp:LogoutRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="g${i}" Version="2.0" IssueInstant="2004-01-21T19:00:49Z">${body}</samlp:LogoutRequest>`;
    const bytes = Buffer.from(xml, 'utf8');
    const level = [0, 1, 6, 9][i % 4]!;
    const raw = deflateRawSync(bytes, { level });
    const inflated = inflateCapped(new Uint8Array(raw), MAX_XML_BYTES);
    expect(inflated.container).toBe('raw');
    expect(Buffer.from(inflated.bytes).toString('utf8')).toBe(xml);
    const report = decodeSaml(`https://sp.example.test/slo?SAMLRequest=${encodeURIComponent(raw.toString('base64'))}`, {
      now: NOW,
    });
    expect(report.xml).toBe(xml);
    expect(pairsOf(report).get('ID')).toBe(`g${i}`);
    // A zlib wrapper and a gzip wrapper are read when the header is there, and named.
    const wrapped = i % 2 === 0 ? deflateSync(bytes, { level }) : gzipSync(bytes, { level });
    const container = inflateCapped(new Uint8Array(wrapped), MAX_XML_BYTES);
    expect(container.container).toBe(i % 2 === 0 ? 'zlib' : 'gzip');
    expect(Buffer.from(container.bytes).toString('utf8')).toBe(xml);
  }
}, 60_000);

it('refusals and parser errors are fixed sentences that never repeat pasted markup', () => {
  const MARK = 'QZXMARKERQZX';
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  // A DOCTYPE with an entity declaration is refused with the fixed sentence, whose line and column are found, and the
  // declaration is never echoed.
  const doctype = refusal(`<!DOCTYPE a [ <!ENTITY ${MARK} "x"> ]><a/>`);
  expect(doctype.message).toBe(DOCTYPE_REFUSAL_MESSAGE);
  expect(doctype.message).not.toContain(MARK);
  expect(doctype.message).not.toContain('ENTITY');
  expect([doctype.line, doctype.column]).toEqual([1, 1]);

  // An entity declaration with no DOCTYPE in front of it is refused too.
  const entity = refusal(`<a/>\n<!ENTITY ${MARK} "x">`);
  expect(entity.message).toBe(ENTITY_REFUSAL_MESSAGE);
  expect(entity.message).not.toContain(MARK);
  expect(entity.message).not.toContain('ENTITY');
  expect(entity.line).toBe(2);

  // Parser errors say what kind of problem it is and where, and nothing of what was written.
  for (const markup of [
    `<a><${MARK}></a>`,
    `<${MARK}:a/>`,
    `<a ${MARK}="1" ${MARK}="2"/>`,
    `<a>&${MARK};</a>`,
    `<a/><${MARK}/>`,
  ]) {
    const refused = refusal(markup);
    expect(refused.message).not.toContain(MARK);
    expect(refused.message).toMatch(/\(line 1, column \d+\)/);
    expect(refused.message).toMatch(/was not read\.$/);
    expect(refused.part).toBe('message');
  }

  // A problem the reader accepts is a warning with the same rule.
  const accepted = decodeSaml(`<a ${MARK}=1/>`, { now: NOW });
  expect(accepted.warnings.length).toBeGreaterThan(0);
  for (const warning of accepted.warnings) {
    expect(warning).not.toContain(MARK);
    expect(warning).toMatch(/line 1/);
  }

  // Wrapper and encoding problems name a position or a kind, never the text.
  const sentences: string[] = [];
  const inputs = [
    `https://example.test/sso?SAMLRequest=ab*${MARK}`,
    `https://example.test/sso?SAMLRequest=ab%${MARK}`,
    `https://example.test/sso?SAMLRequest=${MARK}`,
    `${MARK}=${MARK}`,
    `https://example.test/${MARK}`,
    `https://example.test/sso?SAMLart=${MARK}`,
    `<form><input name="SAMLResponse" value="${MARK}!"/></form>`,
    `<form><input name="SAMLart" value="${MARK}"/></form>`,
    `SAMLRequest=${Buffer.from(`${MARK} is not deflate data at all, just words`).toString('base64')}`,
  ];
  for (const input of inputs) {
    const refused = refusal(input);
    sentences.push(refused.message);
    expect(refused.message).not.toContain(MARK);
    expect(refused.message.length).toBeLessThan(400);
  }
  expect(sentences.some((s) => s.includes('artifact'))).toBe(true);

  // Warnings from the wrappers never hold the text either.
  const wrapped = decodeSaml(
    `https://example.test/sso?SAMLRequest=${encodeURIComponent(Buffer.from(`<a ${MARK}="1"/>`).toString('base64'))}`,
    { now: NOW },
  );
  for (const warning of wrapped.warnings) expect(warning).not.toContain(MARK);

  // A thrown error is always the package's own class.
  try {
    decodeSaml(`<a><${MARK}>`, { now: NOW });
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(SamlDecoderError);
  }

  // Nothing is printed by the package.
  expect(log).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

it('wrapped, padded and doubly encoded values are read, each with its own warning or step', () => {
  // Wrapper variations the binding documents do not print but real senders produce. The message is one generated Response
  // and every variation must read to exactly that text.
  const base = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="w1" Version="2.0" IssueInstant="2004-01-21T19:00:49Z"><saml:Issuer>https://idp.example.org/SAML2?a=1&amp;b=2</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>`;
  let seeded = '';
  let deflated = '';
  for (let i = 0; i < 2000; i++) {
    seeded = `${base}<!-- ${'padding to make the Base64 hold plus and slash characters '.repeat(2)}${i} --></samlp:Response>`;
    deflated = deflateRawSync(Buffer.from(seeded, 'utf8')).toString('base64');
    if (deflated.includes('+') && deflated.includes('/')) break;
  }
  expect(deflated).toMatch(/\+/);
  expect(deflated).toMatch(/\//);
  const decode = (text: string) => decodeSaml(text, { now: NOW });

  // The plain redirect value, the plus signs and slashes percent-encoded, the plus signs turned into spaces.
  const raw = `https://sp.example.test/acs?SAMLRequest=${deflated}`;
  expect(decode(raw).xml).toBe(seeded);
  expect(decode(`https://sp.example.test/acs?SAMLRequest=${encodeURIComponent(deflated)}`).xml).toBe(seeded);
  const spaced = decode(`https://sp.example.test/acs?SAMLRequest=${deflated.replace(/\+/g, ' ')}`);
  expect(spaced.xml).toBe(seeded);
  expect(spaced.warnings.join(' ')).toContain('plus signs');
  // URL-encoded twice.
  const twice = decode(`https://sp.example.test/acs?SAMLRequest=${encodeURIComponent(encodeURIComponent(deflated))}`);
  expect(twice.xml).toBe(seeded);
  expect(twice.warnings.join(' ')).toContain('URL-encoded twice');
  // A copied address that wrapped, with a header word in front of it and a fragment after it.
  const lines = `Location:\n${raw.slice(0, 40)}\n${raw.slice(40, 90)}\r\n\t${raw.slice(90)}#fragment`;
  const wrappedUrl = decode(lines);
  expect(wrappedUrl.xml).toBe(seeded);
  expect(wrappedUrl.steps.join(' ')).toContain('Removed line breaks');
  // The HTML copy of an address, with &amp; between the parameters.
  const htmlCopy = decode(`https://sp.example.test/acs?SAMLRequest=${encodeURIComponent(deflated)}&amp;RelayState=r1`);
  expect(htmlCopy.xml).toBe(seeded);
  expect(htmlCopy.transport?.relayState).toBe('r1');
  expect(htmlCopy.warnings.join(' ')).toContain('&amp;');
  // A bare query string and a bare value, with the percent-encoding left on, and with the padding missing.
  expect(decode(`SAMLRequest=${encodeURIComponent(deflated)}`).xml).toBe(seeded);
  const bare = decode(deflated);
  expect(bare.xml).toBe(seeded);
  expect(bare.kind).toBe('base64');
  expect(bare.binding).toBe('HTTP-Redirect encoding (value only)');
  expect(decode(encodeURIComponent(deflated)).xml).toBe(seeded);
  const unpadded = deflated.replace(/=+$/, '');
  expect(decode(unpadded).xml).toBe(seeded);
  if (unpadded !== deflated) expect(decode(unpadded).warnings.join(' ')).toContain('padding');
  // The URL-safe alphabet.
  const urlSafe = decode(deflated.replace(/\+/g, '-').replace(/\//g, '_'));
  expect(urlSafe.xml).toBe(seeded);
  expect(urlSafe.warnings.join(' ')).toContain('URL-safe');

  // A POST value wrapped at 76 columns, with the plus signs and slashes written as character references, a form body that
  // came from a network trace, and a form written with odd quoting and capital letters.
  const plain = Buffer.from(seeded, 'utf8').toString('base64');
  const wrapped76 = plain
    .replace(/(.{76})/g, '$1\n')
    .replace(/\+/g, '&#43;')
    .replace(/\//g, '&#x2f;');
  const post = decode(`<form method="post"><input type="hidden" name="SAMLResponse" value="${wrapped76}"/></form>`);
  expect(post.xml).toBe(seeded);
  expect(post.binding).toBe('HTTP-POST');
  const body = decode(`SAMLResponse=${encodeURIComponent(plain)}&RelayState=abc`);
  expect(body.xml).toBe(seeded);
  expect(body.binding).toBe('HTTP-POST');
  expect(body.transport?.relayState).toBe('abc');
  const odd = decode(`<FORM><INPUT TYPE=hidden NAME='SAMLResponse' VALUE=${plain.replace(/=+$/, '')}></FORM>`);
  expect(odd.xml).toBe(seeded);

  // An already inflated message in a redirect parameter, a zlib-wrapped one and a gzip-wrapped one, and a compressed one
  // in a POST form.
  const notCompressed = decode(
    `https://sp.example.test/acs?SAMLRequest=${encodeURIComponent(Buffer.from(seeded, 'utf8').toString('base64'))}`,
  );
  expect(notCompressed.xml).toBe(seeded);
  expect(notCompressed.warnings.join(' ')).toContain('not compressed');
  const zlibWrapped = decode(
    `https://sp.example.test/acs?SAMLRequest=${encodeURIComponent(deflateSync(Buffer.from(seeded, 'utf8')).toString('base64'))}`,
  );
  expect(zlibWrapped.xml).toBe(seeded);
  expect(zlibWrapped.warnings.join(' ')).toContain('zlib');
  const gzipWrapped = decode(
    `https://sp.example.test/acs?SAMLRequest=${encodeURIComponent(gzipSync(Buffer.from(seeded, 'utf8')).toString('base64'))}`,
  );
  expect(gzipWrapped.xml).toBe(seeded);
  expect(gzipWrapped.warnings.join(' ')).toContain('gzip');
  const compressedPost = decode(`<input name="SAMLResponse" value="${deflated}">`);
  expect(compressedPost.xml).toBe(seeded);
  expect(compressedPost.warnings.join(' ')).toContain('does not compress');
});

it('raw XML that holds an input tag in a comment, a CDATA section or as an element is read as the XML pasted', () => {
  const message = (id: string, issuer: string, inside = '') =>
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="2004-12-05T09:22:05Z"><saml:Issuer>${issuer}</saml:Issuer>${inside}</samlp:Response>`;
  const decoy = base64Of(message('other', 'https://attacker.example'));
  const input = `<input name="SAMLResponse" value="${decoy}">`;
  const pasted = [
    ['a comment', message('real', 'https://idp.example.org', `<!-- ${input} -->`)],
    ['a comment before the root', `<!-- ${input} -->${message('real', 'https://idp.example.org')}`],
    [
      'an XML declaration and a comment',
      `<?xml version="1.0"?>\n<!-- ${input} -->\n${message('real', 'https://idp.example.org')}`,
    ],
    [
      'a CDATA section',
      message('real', 'https://idp.example.org', `<samlp:Extensions><![CDATA[${input}]]></samlp:Extensions>`),
    ],
    [
      'an element named input',
      message(
        'real',
        'https://idp.example.org',
        `<samlp:Extensions><input name="SAMLResponse" value="${decoy}"/></samlp:Extensions>`,
      ),
    ],
  ] as const;
  for (const [where, text] of pasted) {
    const report = decodeSaml(text, { now: NOW });
    expect(report.kind, where).toBe('xml');
    expect(report.binding, where).toBe('Raw XML (no binding)');
    expect(pairsOf(report).get('ID'), where).toBe('real');
    expect(pairsOf(report).get('Issuer'), where).toBe('https://idp.example.org');
  }
  // A message that starts with an XML DOCTYPE is not a form either, even with an input element in it, so it is refused
  // as a DOCTYPE; only a DOCTYPE that names html starts a page.
  for (const doctype of [
    '<!DOCTYPE samlp:Response>',
    '<!doctype htmlx>',
    `<!DOCTYPE samlp:Response [<!-- ${input} -->]>`,
  ]) {
    const text = `${doctype}${message('real', 'x', `<samlp:Extensions><input name="SAMLResponse" value="${decoy}"/></samlp:Extensions>`)}`;
    expect(refusal(text).message, doctype).toBe(DOCTYPE_REFUSAL_MESSAGE);
  }
  // Forms are still read: a whole page, a form, a div, a bare input, upper case, a comment first, and a decoy in a
  // comment of the form is skipped for the real input after it.
  const real = base64Of(message('form', 'https://idp.example.org'));
  for (const text of [
    postForm(real),
    `<!DOCTYPE html>\n<html><body onload="document.forms[0].submit()">${postForm(real)}</body></html>`,
    `<html><head><title>t</title></head><body>${postForm(real)}</body></html>`,
    `<div>${postForm(real)}</div>`,
    `<input type="hidden" name="SAMLResponse" value="${real}"/>`,
    `<FORM METHOD="POST"><INPUT TYPE="hidden" NAME="SAMLResponse" VALUE="${real}"></FORM>`,
    `<!-- the identity provider's page -->\n${postForm(real)}`,
    `<form><!-- ${input} --><input name="SAMLResponse" value="${real}"/></form>`,
  ]) {
    const report = decodeSaml(text, { now: NOW });
    expect(report.kind, text.slice(0, 40)).toBe('post');
    expect(pairsOf(report).get('ID'), text.slice(0, 40)).toBe('form');
  }
});
