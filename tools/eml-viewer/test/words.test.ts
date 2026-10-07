/**
 * Encoded words and attachment digests.
 *
 * Expected values come from RFC 2047 section 8 (the examples and the parenthesis table, retyped here) and from Node
 * crypto and Buffer, which share no code with the package. The welcome message is an invented message stored in
 * fixtures/rfc/messages.json as a JSON string with CRLF escapes.
 */
import { createHash } from 'node:crypto';
import { it, expect } from 'vitest';
import { analyzeMessage, decodeEncodedWords } from '../src/index';
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
