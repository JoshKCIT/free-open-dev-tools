import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { decodeInput } from '../src/index';
import { visible } from '../src/names';
import {
  ALGORITHMS,
  base64,
  bitString,
  buildCertificate,
  concat,
  context,
  extension,
  integer,
  name,
  oid,
  rdn,
  rsaSpki,
  seq,
  utf8,
  type Bytes,
} from './fixtures/der-build';
import { NOW_MS, certificateOf, pemText } from './fixtures/helpers';

/**
 * Specification: Unicode Standard Annex 9 (the bidirectional formatting characters U+061C, U+200E, U+200F, U+202A to
 * U+202E and U+2066 to U+2069) and the C0 and C1 control ranges of ISO/IEC 6429. A name or an alternative name is
 * attacker text; whatever it holds, what is shown and copied must not reorder the text around it, move the cursor or
 * start a new line. The characters are written at run time with String.fromCodePoint, so this file holds none of them.
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

const ch = (code: number): string => String.fromCodePoint(code);
const escaped = (code: number): string => '\\u{' + code.toString(16).padStart(4, '0') + '}';
const BIDI = [0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];
const WARNING =
  'Some text in this certificate holds control characters or characters that change the direction of text. They are shown as escapes such as \\u{202e}.';
const REQUEST_WARNING =
  'Some text in this request holds control characters or characters that change the direction of text. They are shown as escapes such as \\u{202e}.';

/** True when the text holds any character the page must never show as it is. */
function holdsHidden(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || BIDI.includes(code)) return true;
  }
  return false;
}

const ascii = (text: string): Bytes => Uint8Array.from(Array.from(text, (c) => c.charCodeAt(0)));
const dns = (text: string): Bytes => context(2, ascii(text), false);
const withNames = (...names: Bytes[]): Bytes =>
  buildCertificate({ extensions: [extension('2.5.29.17', false, seq(...names))] });
const decode = (der: Bytes): ReturnType<typeof certificateOf> =>
  certificateOf(decodeInput(pemText('CERTIFICATE', base64(der)), { nowMs: NOW_MS }));

it('visible() writes every control and bidi character as an escape and leaves ordinary text alone', () => {
  // Every C0 control, DEL and every C1 control.
  for (let code = 0; code < 0x20; code++)
    expect(visible('a' + ch(code) + 'b'), String(code)).toBe('a' + escaped(code) + 'b');
  expect(visible(ch(0x7f))).toBe(escaped(0x7f));
  for (let code = 0x80; code <= 0x9f; code++) expect(visible(ch(code)), String(code)).toBe(escaped(code));
  // Every bidi formatting character.
  for (const code of BIDI) expect(visible(ch(code)), code.toString(16)).toBe(escaped(code));
  // Ordinary text, accents, CJK, an emoji and the space are not touched, and nothing is added to an empty string.
  const plain =
    'Caf' + ch(0xe9) + ' ' + ch(0x4e2d) + ch(0x6587) + ' ' + ch(0x1f510) + ' a.b-c_d/e ' + ch(0xa0) + ch(0xa1);
  expect(visible(plain)).toBe(plain);
  expect(visible('')).toBe('');
  // The result never holds a hidden character, whatever went in.
  const everything = Array.from({ length: 0x2100 }, (_unused, code) =>
    code >= 0xd800 && code <= 0xdfff ? '' : ch(code),
  ).join('');
  expect(holdsHidden(visible(everything))).toBe(false);
});

it('a subject and an issuer with bidi marks, NUL, line breaks and ESC are shown escaped, with one warning', () => {
  const trick =
    'paypal.com' +
    ch(0x202e) +
    ch(0x2066) +
    'moc.live.evil' +
    ch(0x202c) +
    ch(0x2069) +
    ch(0x061c) +
    ch(0x200e) +
    ch(0x200f);
  const lines = 'Ok' + ch(10) + 'Issuer=Fake CA' + ch(13) + ch(0) + ch(0x1b) + '[2J';
  const certificate = buildCertificate({
    subject: name(rdn('2.5.4.3', utf8(trick)), rdn('2.5.4.10', utf8(lines))),
    issuer: name(rdn('2.5.4.3', utf8('CA ' + ch(0x202e) + 'tset')), rdn('2.5.4.10', utf8('O' + ch(0x85) + 'x'))),
  });
  const item = decode(certificate);

  const expectedTrick =
    'paypal.com' +
    escaped(0x202e) +
    escaped(0x2066) +
    'moc.live.evil' +
    escaped(0x202c) +
    escaped(0x2069) +
    escaped(0x61c) +
    escaped(0x200e) +
    escaped(0x200f);
  expect(item.subject.display).toBe(
    `CN=${expectedTrick}, O=Ok${escaped(10)}Issuer=Fake CA${escaped(13)}${escaped(0)}${escaped(0x1b)}[2J`,
  );
  expect(item.subject.commonName).toBe(expectedTrick);
  expect(item.issuer.display).toBe(`CN=CA ${escaped(0x202e)}tset, O=O${escaped(0x85)}x`);
  expect(item.issuer.commonName).toBe(`CA ${escaped(0x202e)}tset`);
  // The RFC 4514 line keeps its own escapes for C0 controls and now escapes the bidi marks and C1 controls too.
  for (const text of [item.subject.rfc4514, item.issuer.rfc4514]) expect(holdsHidden(text)).toBe(false);
  expect(item.subject.rfc4514).toContain('\\0a');
  expect(item.subject.rfc4514).toContain(escaped(0x202e));
  expect(item.warnings.filter((warning) => warning === WARNING)).toEqual([WARNING]);
});

it('alternative names with NUL, line breaks, ESC, DEL and tab are shown escaped, in the names and in the extension lines', () => {
  const item = decode(
    withNames(
      dns('bank.com' + ch(0) + '.evil.example'),
      dns('a' + ch(13) + ch(10) + 'b' + ch(0x1b) + '[2J'),
      context(1, ascii('user' + ch(0x7f) + 'moc.evil@example.test'), false),
      context(6, ascii('https://example.test/' + ch(9) + 'x'), false),
    ),
  );
  expect(item.sans.map((san) => san.value)).toEqual([
    `bank.com${escaped(0)}.evil.example`,
    `a${escaped(13)}${escaped(10)}b${escaped(0x1b)}[2J`,
    `user${escaped(0x7f)}moc.evil@example.test`,
    `https://example.test/${escaped(9)}x`,
  ]);
  const lines = item.extensions.find((entry) => entry.oid === '2.5.29.17')!.value;
  expect(lines).toEqual(item.sans.map((san) => `${san.type}: ${san.value}`));
  for (const line of lines) expect(holdsHidden(line)).toBe(false);
  expect(item.warnings.filter((warning) => warning === WARNING)).toEqual([WARNING]);
});

it('a directory name, a user notice and an other name with hidden characters are shown escaped', () => {
  const directory = context(4, name(rdn('2.5.4.3', utf8('Dir' + ch(0x202e) + 'x'))));
  const notice = extension(
    '2.5.29.32',
    false,
    seq(seq(oid('1.3.6.1.4.1.99999.1'), seq(seq(oid('1.3.6.1.5.5.7.2.2'), seq(utf8('Read' + ch(0x1b) + '[0m')))))),
  );
  const upn = context(0, concat(oid('1.3.6.1.4.1.311.20.2.3'), context(0, utf8('me' + ch(0x202e) + '@example.test'))));
  const item = decode(
    buildCertificate({
      extensions: [extension('2.5.29.17', false, seq(directory, upn)), notice],
    }),
  );
  const [first, second] = item.sans;
  expect(first!.value).toBe(`CN=Dir${escaped(0x202e)}x`);
  expect(second!.value).toBe(`userPrincipalName: me${escaped(0x202e)}@example.test`);
  const policy = item.extensions.find((entry) => entry.oid === '2.5.29.32')!.value;
  expect(policy).toEqual(['Policy: 1.3.6.1.4.1.99999.1', `User notice: Read${escaped(0x1b)}[0m`]);
  expect(item.warnings).toContain(WARNING);
});

it('ordinary names, accents and CJK text give no escape and no warning', () => {
  const item = decode(
    buildCertificate({
      subject: name(rdn('2.5.4.3', utf8('Caf' + ch(0xe9) + ' ' + ch(0x4e2d) + ch(0x6587) + ' example.test'))),
      extensions: [extension('2.5.29.17', false, seq(dns('example.test'), dns('www.example.test')))],
    }),
  );
  expect(item.subject.display).toBe('CN=Caf' + ch(0xe9) + ' ' + ch(0x4e2d) + ch(0x6587) + ' example.test');
  expect(item.warnings.filter((warning) => warning.includes('control characters'))).toEqual([]);
});

it('a request subject with hidden characters is shown escaped, with one warning', () => {
  const info = seq(
    integer('00'),
    name(rdn('2.5.4.3', utf8('req' + ch(0x202e) + 'x' + ch(0)))),
    rsaSpki('c1'.repeat(128)),
    context(0, []),
  );
  const request = seq(info, ALGORITHMS.sha256Rsa, bitString(new Uint8Array(8).fill(0xab)));
  const result = decodeInput(pemText('CERTIFICATE REQUEST', base64(request)), { nowMs: NOW_MS });
  const item = result.items[0]!;
  if (item.kind !== 'request') throw new Error('expected a request');
  expect(item.subject.display).toBe(`CN=req${escaped(0x202e)}x${escaped(0)}`);
  expect(item.subject.commonName).toBe(`req${escaped(0x202e)}x${escaped(0)}`);
  expect(holdsHidden(item.subject.rfc4514)).toBe(false);
  expect(item.warnings.filter((warning) => warning === REQUEST_WARNING)).toEqual([REQUEST_WARNING]);
});
