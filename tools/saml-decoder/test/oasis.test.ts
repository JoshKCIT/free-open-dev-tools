// Expected values in this file are the examples the OASIS SAML 2.0 Bindings document prints (section 3.4.8, an OASIS
// Standard of 15 March 2005), retyped under test/fixtures/oasis with their notice, and Node zlib as the second opinion on
// the DEFLATE layer. Nothing here is taken from running the package.
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { expect, it, vi } from 'vitest';
import { DOCTYPE_REFUSAL_MESSAGE, SamlDecoderError, decodeSaml } from '../src/index';
import { ENTITY_REFUSAL_MESSAGE } from '../src/xml-entity';

const NOW = Date.UTC(2004, 0, 21, 19, 5, 0);

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/oasis/${name}`, import.meta.url), 'utf8');
}

/** The decoded messages hold CRLF while git stores the retyped files with LF, so line endings are normalised. */
function normalise(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

function refusal(text: string): SamlDecoderError {
  try {
    decodeSaml(text, { now: NOW });
  } catch (err) {
    expect(err).toBeInstanceOf(SamlDecoderError);
    return err as SamlDecoderError;
  }
  throw new Error('the message was not refused');
}

it('the OASIS Bindings 2.0 logout request redirect address inflates to the specification message', () => {
  // OASIS Bindings 2.0 section 3.4.8: the address of document lines 723 to 733 carries the message of lines 694 to 702.
  const address = fixture('redirect-logout-request.txt').trim();
  const report = decodeSaml(address, { now: NOW });
  expect(report.binding).toBe('HTTP-Redirect');
  expect(report.kind).toBe('redirect');
  expect(normalise(report.xml)).toBe(normalise(fixture('logout-request.xml')));
  const pairs = new Map(report.summary.pairs);
  expect(pairs.get('Message')).toBe('SAML 2.0 LogoutRequest');
  expect(pairs.get('ID')).toBe('d2b7c388cec36fa7c39c28fd298644a8');
  expect(pairs.get('IssueInstant')).toBe('2004-01-21T19:00:49Z');
  expect(pairs.get('Version')).toBe('2.0');
  expect(pairs.get('Issuer')).toBe('https://IdentityProvider.com/SAML');
  expect(pairs.get('Name identifier')).toBe('005a06e0-ad82-110d-a556-004005b13a2b');
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

  // A value that is not Base64 is refused by its position, never by showing it.
  const notBase64 = refusal(`https://example.test/sso?SAMLRequest=ab*${MARK}`);
  expect(notBase64.message).not.toContain(MARK);
  expect(notBase64.message).toMatch(/character 3/);

  // Nothing is printed by the package.
  expect(log).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
