/**
 * Encoded words and attachment digests.
 *
 * Expected values come from RFC 2047 section 8 (the examples and the parenthesis table, retyped here) and from Node
 * crypto and Buffer, which share no code with the package. The welcome message is an invented message stored in
 * fixtures/rfc/messages.json as a JSON string with CRLF escapes.
 */
import { createHash } from 'node:crypto';
import { it, expect } from 'vitest';
import { analyzeMessage, decodeEncodedWords, findParam, parseMime, parseParameters } from '../src/index';
import { messageBytes, messageText } from './helpers';

const decode = (text: string): string => decodeEncodedWords(text).text;

it('the RFC 2047 section 8 encoded words decode as the RFC says, joining adjacent words', () => {
  // RFC 2047 section 8, the header examples.
  expect(decode('=?US-ASCII?Q?Keith_Moore?= <moore@cs.utk.edu>')).toBe('Keith Moore <moore@cs.utk.edu>');
  expect(decode('=?ISO-8859-1?Q?Keld_J=F8rn_Simonsen?= <keld@dkuug.dk>')).toBe(
    `Keld J${String.fromCodePoint(0xf8)}rn Simonsen <keld@dkuug.dk>`,
  );
  expect(decode('=?ISO-8859-1?Q?Andr=E9?= Pirard <PIRARD@vm1.ulg.ac.be>')).toBe(
    `Andr${String.fromCodePoint(0xe9)} Pirard <PIRARD@vm1.ulg.ac.be>`,
  );
  // The two-word subject: two charsets, and the text between the words (a fold) is dropped.
  expect(
    decode('=?ISO-8859-1?B?SWYgeW91IGNhbiByZWFkIHRoaXMgeW8=?= =?ISO-8859-2?B?dSB1bmRlcnN0YW5kIHRoZSBleGFtcGxlLg==?='),
  ).toBe('If you can read this you understand the example.');

  // RFC 2047 section 8, the table of encoded forms and what is displayed.
  expect(decode('(=?ISO-8859-1?Q?a?=)')).toBe('(a)');
  expect(decode('(=?ISO-8859-1?Q?a?= b)')).toBe('(a b)');
  expect(decode('(=?ISO-8859-1?Q?a?= =?ISO-8859-1?Q?b?=)')).toBe('(ab)');
  expect(decode('(=?ISO-8859-1?Q?a?=  =?ISO-8859-1?Q?b?=)')).toBe('(ab)');
  expect(decode('(=?ISO-8859-1?Q?a?=\r\n       =?ISO-8859-1?Q?b?=)')).toBe('(ab)');
  expect(decode('(=?ISO-8859-1?Q?a_b?=)')).toBe('(a b)');
  expect(decode('(=?ISO-8859-1?Q?a?= =?ISO-8859-2?Q?_b?=)')).toBe('(a b)');

  // An encoded word next to plain text keeps the space around it.
  expect(decode('x =?ISO-8859-1?Q?a?= y')).toBe('x a y');
  expect(decode('=?ISO-8859-1?Q?a?= plain =?ISO-8859-1?Q?b?=')).toBe('a plain b');

  // RFC 2231 section 5: a language after an asterisk in the charset is allowed.
  expect(decode('=?US-ASCII*EN?Q?Keith_Moore?=')).toBe('Keith Moore');

  // The welcome message's two-byte characters, through Base64 and through Q.
  expect(decode('=?UTF-8?B?Sm9zw6kgQmFrZXI=?= <jose@example.com>')).toBe(
    `Jos${String.fromCodePoint(0xe9)} Baker <jose@example.com>`,
  );
  expect(decode('=?UTF-8?Q?Caf=C3=A9_menu?=')).toBe(`Caf${String.fromCodePoint(0xe9)} menu`);
});

it('attachment digests are the SHA-256 of the decoded bytes and agree with Node crypto', async () => {
  const analysis = await analyzeMessage(messageBytes('welcome'));
  expect(analysis.attachments).toHaveLength(1);
  const attachment = analysis.attachments[0]!;
  expect(attachment.name).toBe('report.txt');

  // Node's own Base64 decoder and hash, applied to the Base64 text typed in the stored message.
  const encoded = /\r\n\r\n(UXVhcnRlcmx5[A-Za-z0-9+/=]+)\r\n--BOUNDARY-1--/.exec(messageText('welcome'))?.[1] ?? '';
  expect(encoded).not.toBe('');
  const expectedBytes = Buffer.from(encoded, 'base64');
  const expectedDigest = createHash('sha256').update(expectedBytes).digest('hex');
  expect(expectedDigest).toBe('bc7a08d145d092e10bd36bf54fc04bbc54b5782f06a16769d72eca8a4bb358bd');

  expect(attachment.sha256).toBe(expectedDigest);
  expect(attachment.size).toBe(expectedBytes.length);
  expect(Buffer.from(attachment.bytes).equals(expectedBytes)).toBe(true);
  expect(new TextDecoder().decode(attachment.bytes)).toBe('Quarterly figures: 42 units shipped.\n');
});

it('the RFC 2231 continuations and charset and language values decode, and a gap or a leading zero is shown raw', () => {
  const typeOf = (name: string) => parseMime(messageBytes(name)).type;

  // RFC 2231 section 3: two quoted sections join, and the other parameter is untouched.
  const section3 = typeOf('rfc2231-section-3-continuation');
  expect(section3.primary).toBe('message/external-body');
  expect(findParam(section3, 'url')?.value).toBe('ftp://cs.utk.edu/pub/moore/bulk-mailer/bulk-mailer.tar');
  expect(findParam(section3, 'url')?.continued).toBe(true);
  expect(findParam(section3, 'access-type')?.value).toBe('URL');

  // RFC 2231 section 4: a character set and a language, then percent-encoded text.
  const section4 = findParam(typeOf('rfc2231-section-4-extended'), 'title');
  expect(section4?.value).toBe('This is ***fun***');
  expect(section4?.charset).toBe('us-ascii');
  expect(section4?.language).toBe('en-us');
  expect(section4?.extended).toBe(true);

  // RFC 2231 section 4.1: continuations, encoded and not, with the charset only in the first section.
  const section41 = findParam(typeOf('rfc2231-section-4.1-combined'), 'title');
  expect(section41?.value).toBe("This is even more ***fun*** isn't it!");
  expect(section41?.charset).toBe('us-ascii');
  expect(section41?.language).toBe('en');
  expect(section41?.continued).toBe(true);

  // A multi-byte character in another set, split across two sections: the bytes are joined before they are read.
  const split = parseParameters("attachment; filename*0*=utf-8''caf%C3; filename*1*=%A9.txt");
  expect(findParam(split, 'filename')?.value).toBe(`caf${String.fromCodePoint(0xe9)}.txt`);

  // The name precedence input: filename* and filename both present give two entries, extended first.
  const both = parseParameters("attachment; filename=plain.txt; filename*=utf-8''ext%20name.txt");
  expect(findParam(both, 'filename')?.value).toBe('ext name.txt');
  expect(both.params.map((p) => p.extended)).toEqual([false, true]);

  // A gap, a missing first section, a leading zero and a section number far past the limit are not joined: each piece raw.
  for (const written of [
    'title*0="a"; title*2="c"',
    'title*1="b"',
    'title*00="a"; title*1="b"',
    'title*99999999="x"',
  ]) {
    const parsed = parseParameters(`application/x-stuff; ${written}`);
    expect(findParam(parsed, 'title'), written).toBeUndefined();
    expect(parsed.params.length, written).toBeGreaterThan(0);
    for (const entry of parsed.params) {
      expect(entry.raw, written).toBe(true);
      expect(entry.rawName?.startsWith('title*'), written).toBe(true);
    }
    expect(parsed.notes.join(' '), written).toContain('shown as written');
  }
  // More than 100 sections are not joined either.
  const many = Array.from({ length: 101 }, (_, i) => `t*${i}="x"`).join('; ');
  expect(findParam(parseParameters(`a/b; ${many}`), 't')).toBeUndefined();
  const hundred = Array.from({ length: 100 }, (_, i) => `t*${i}="x"`).join('; ');
  expect(findParam(parseParameters(`a/b; ${hundred}`), 't')?.value).toBe('x'.repeat(100));
});
