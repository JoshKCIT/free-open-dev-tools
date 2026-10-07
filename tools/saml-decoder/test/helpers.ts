// Builders the tests use to wrap a message the way each binding does. Node zlib and Buffer are the independent opinion on
// the DEFLATE and Base64 layers; none of this code is shared with the package.
import { readFileSync } from 'node:fs';
import { deflateRawSync, deflateSync, gzipSync } from 'node:zlib';
import { expect } from 'vitest';
import { SamlDecoderError, decodeSaml, type SamlReport } from '../src/index';

/** The time the OASIS logout examples are judged against: five minutes after their IssueInstant. */
export const NOW_LOGOUT = Date.UTC(2004, 0, 21, 19, 5, 0);
/** The time the Technical Overview Response is judged against: inside its window. */
export const NOW_OVERVIEW = Date.UTC(2004, 11, 5, 9, 22, 30);

export function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/oasis/${name}`, import.meta.url), 'utf8');
}

/** The decoded messages hold CRLF while git stores the retyped files with LF, so line endings are normalised. */
export function normalise(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

/** The message as the HTTP-Redirect binding writes it: raw DEFLATE, Base64, then URL-encoded. */
export function redirectValue(xml: string): string {
  return encodeURIComponent(deflateRawSync(Buffer.from(xml, 'utf8')).toString('base64'));
}

export function redirectUrl(xml: string, extra = ''): string {
  return `https://sp.example.test/acs?SAMLRequest=${redirectValue(xml)}${extra}`;
}

export function base64Of(xml: string): string {
  return Buffer.from(xml, 'utf8').toString('base64');
}

export function deflatedBase64(xml: string): string {
  return deflateRawSync(Buffer.from(xml, 'utf8')).toString('base64');
}

export function zlibBase64(xml: string): string {
  return deflateSync(Buffer.from(xml, 'utf8')).toString('base64');
}

export function gzipBase64(xml: string): string {
  return gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
}

/** The message as the HTTP-POST binding writes it: Base64 in a hidden form control. */
export function postForm(value: string, relayState?: string): string {
  const relay = relayState === undefined ? '' : `<input type="hidden" name="RelayState" value="${relayState}"/>`;
  return `<form action="https://sp.example.test/acs" method="post">${relay}<input type="hidden" name="SAMLResponse" value="${value}"/></form>`;
}

/** UTF-16 bytes of a text, little endian, with or without a byte order mark. */
export function utf16le(text: string, bom: boolean): Buffer {
  const body = Buffer.from(text, 'utf16le');
  return bom ? Buffer.concat([Buffer.from([0xff, 0xfe]), body]) : body;
}

export function utf16be(text: string, bom: boolean): Buffer {
  const le = Buffer.from(text, 'utf16le');
  const be = Buffer.alloc(le.length);
  for (let i = 0; i + 1 < le.length; i += 2) {
    be[i] = le[i + 1]!;
    be[i + 1] = le[i]!;
  }
  return bom ? Buffer.concat([Buffer.from([0xfe, 0xff]), be]) : be;
}

/** A small deterministic generator, so a failing case can be replayed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Decodes and returns the refusal, failing the test when the text was not refused. */
export function refusal(text: string, now = NOW_LOGOUT): SamlDecoderError {
  try {
    decodeSaml(text, { now });
  } catch (err) {
    expect(err).toBeInstanceOf(SamlDecoderError);
    return err as SamlDecoderError;
  }
  throw new Error('the message was not refused');
}

export function pairsOf(report: SamlReport): Map<string, string> {
  return new Map(report.summary.pairs);
}

/** A minimal SAML 2.0 Response with one assertion, built from parts so each test changes only what it studies. */
export function responseXml(parts: { assertion?: string; attrs?: string; extra?: string } = {}): string {
  const assertion =
    parts.assertion ??
    `<saml:Assertion ID="a1" Version="2.0" IssueInstant="2004-12-05T09:22:05Z"><saml:Issuer>https://idp.example.org/SAML2</saml:Issuer><saml:Subject><saml:NameID>user@example.com</saml:NameID></saml:Subject></saml:Assertion>`;
  return `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="r1" Version="2.0" IssueInstant="2004-12-05T09:22:05Z"${parts.attrs ?? ''}><saml:Issuer>https://idp.example.org/SAML2</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${assertion}${parts.extra ?? ''}</samlp:Response>`;
}
