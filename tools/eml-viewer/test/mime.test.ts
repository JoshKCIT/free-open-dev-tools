/**
 * MIME structure, boundaries, order, character sets, transfer encodings and the empty message.
 *
 * Expected values come from RFC 2045 to 2049 (the Appendix A message of RFC 2049 is retyped in fixtures/rfc/messages.json),
 * from the WHATWG Encoding Standard tables for the character sets, and from Node's Buffer for the transfer encodings.
 */
import { it, expect } from 'vitest';
import {
  EmlViewerError,
  analyzeMessage,
  decodeBase64Lenient,
  decodeBytes,
  decodeQuotedPrintable,
  parseMime,
  type PartNode,
} from '../src/index';
import { CRLF, build, bytesOf, messageBytes, mulberry32, multipart } from './helpers';

function shape(node: PartNode): unknown {
  return node.children.length === 0 ? node.contentType : { [node.contentType]: node.children.map(shape) };
}

function walk(node: PartNode): PartNode[] {
  const out: PartNode[] = [];
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    out.push(current);
    for (let i = current.children.length - 1; i >= 0; i--) {
      const child = current.children[i];
      if (child !== undefined) stack.push(child);
    }
  }
  return out;
}

const text = (bytes: Uint8Array, node: PartNode): string =>
  new TextDecoder().decode(bytes.subarray(node.bodyStart, node.bodyEnd));

it('the RFC 2049 Appendix A message gives its MIME tree', async () => {
  const bytes = messageBytes('rfc2049-appendix-a');
  const root = parseMime(bytes);
  expect(shape(root)).toEqual({
    'multipart/mixed': [
      'text/plain',
      'text/plain',
      { 'multipart/parallel': ['audio/basic', 'image/jpeg'] },
      'text/enriched',
      { 'message/rfc822': ['text/plain'] },
    ],
  });
  expect(walk(root).map((n) => n.path)).toEqual(['', '1', '2', '3', '3.1', '3.2', '4', '5', '5.1']);
  expect(walk(root).map((n) => n.depth)).toEqual([1, 2, 2, 2, 3, 3, 2, 2, 3]);

  // The first part has no header fields at all: it is plain text in US-ASCII by default (RFC 2045 section 5.2).
  const first = root.children[0]!;
  expect(first.fields).toHaveLength(0);
  expect(text(bytes, first)).toContain('... Some text appears here ...');
  // The preamble before the first delimiter belongs to no part.
  expect(
    walk(root)
      .slice(1)
      .some((n) => text(bytes, n).includes('preamble area')),
  ).toBe(false);
  // The explicit parameters read as written, the encoding name in lower case.
  expect(root.children[1]!.type.params.find((p) => p.name === 'charset')?.value).toBe('US-ASCII');
  const nested = root.children[4]!.children[0]!;
  expect(nested.type.params.find((p) => p.name === 'charset')?.value).toBe('ISO-8859-1');
  expect(nested.transferEncoding).toBe('quoted-printable');
  expect(nested.fields.map((f) => f.name)).toEqual([
    'From',
    'To',
    'Subject',
    'Content-Type',
    'Content-Transfer-Encoding',
  ]);

  // The same message through the analysis: a tree that matches, no attachment, and the first text part as the body.
  const analysis = await analyzeMessage(bytes);
  expect(analysis.tree?.label).toBe('multipart/mixed');
  expect(analysis.tree?.children.map((c) => c.label)).toEqual([
    'text/plain',
    'text/plain',
    'multipart/parallel',
    'text/enriched',
    'message/rfc822',
  ]);
  expect(analysis.tree?.children[4]?.children.map((c) => c.label)).toEqual(['text/plain']);
  expect(analysis.textBody?.text).toContain('... Some text appears here ...');
  // The audio and image parts are not text bodies, so they are the attachments (named attachment-1 and attachment-2).
  expect(analysis.attachments.map((a) => a.declaredType)).toEqual(['audio/basic', 'image/jpeg', 'text/enriched']);
  expect(analysis.attachments.map((a) => a.name)).toEqual(['attachment-1', 'attachment-2', 'attachment-3']);
  expect(analysis.partCount).toBe(6);
});

it('a delimiter must be the whole boundary, so a longer boundary that starts the same is not a delimiter', () => {
  const body = [
    '--BOUNDARY-1',
    'Content-Type: text/plain',
    '',
    'first',
    '--BOUNDARY-10',
    'still first',
    '--BOUNDARY-1--x',
    'still first too',
    '---BOUNDARY-1',
    'also first',
    '--BOUNDARY-1 \t',
    'Content-Type: text/plain',
    '',
    'second',
    '--BOUNDARY-1--',
    'epilogue that is not a part',
  ].join(CRLF);
  const bytes = build(['Content-Type: multipart/mixed; boundary="BOUNDARY-1"'], body);
  const root = parseMime(bytes);
  expect(root.children).toHaveLength(2);
  expect(text(bytes, root.children[0]!)).toBe(
    ['first', '--BOUNDARY-10', 'still first', '--BOUNDARY-1--x', 'still first too', '---BOUNDARY-1', 'also first'].join(
      CRLF,
    ),
  );
  // Transport padding after a delimiter is tolerated, and the closing delimiter ends the parts.
  expect(text(bytes, root.children[1]!)).toBe('second');
  expect(root.notes).toEqual([]);

  // The same with bare line feeds, which many files have.
  const lf = bytesOf(new TextDecoder().decode(bytes).split(CRLF).join('\n'));
  const lfRoot = parseMime(lf);
  expect(lfRoot.children).toHaveLength(2);
  expect(text(lf, lfRoot.children[1]!)).toBe('second');
});

it('a missing closing delimiter is tolerated and said, a multipart with no parts gives a note and a digest part is a message', async () => {
  // Tolerated: the last part runs to the end, and the note says the message may be cut.
  const open = build(
    ['Content-Type: multipart/mixed; boundary=b'],
    multipart('b', [{ headers: ['Content-Type: text/plain'], body: 'only part' }], false),
  );
  const openRoot = parseMime(open);
  expect(openRoot.children).toHaveLength(1);
  expect(openRoot.notes.join(' ')).toContain('closing boundary line');
  const analysis = await analyzeMessage(open);
  expect(analysis.textBody?.text).toContain('only part');
  expect(analysis.notes.join(' ')).toContain('closing boundary line');

  // No part: the boundary line never appears, or only the closing one does.
  for (const body of ['nothing here', '--b--']) {
    const none = build(['Content-Type: multipart/mixed; boundary=b'], body);
    expect(parseMime(none).children).toHaveLength(0);
    const result = await analyzeMessage(none);
    expect(result.notes.join(' ')).toContain('no part in it');
    expect(result.partCount).toBe(0);
    expect(result.tree?.label).toBe('multipart/mixed');
  }
  // No boundary at all.
  const noBoundary = await analyzeMessage(build(['Content-Type: multipart/mixed'], 'x'));
  expect(noBoundary.notes.join(' ')).toContain('no boundary');

  // multipart/digest: a part with no Content-Type is message/rfc822 (RFC 2046 section 5.1.5), one level deeper again.
  const digest = build(
    ['Content-Type: multipart/digest; boundary=d'],
    multipart('d', [
      { body: ['Subject: inner', '', 'inner body'].join(CRLF) },
      { headers: ['Content-Type: text/plain'], body: 'plain' },
    ]),
  );
  const digestRoot = parseMime(digest);
  expect(shape(digestRoot)).toEqual({ 'multipart/digest': [{ 'message/rfc822': ['text/plain'] }, 'text/plain'] });
  expect(walk(digestRoot).map((n) => n.depth)).toEqual([1, 2, 3, 2]);
  expect(digestRoot.children[0]!.children[0]!.fields.map((f) => f.name)).toEqual(['Subject']);
});

it('headers, parts and attachments keep message order', async () => {
  const names = ['zeta.txt', 'alpha.txt', 'mid.txt', 'beta.txt'];
  const parts = names.map((name) => ({
    headers: [`Content-Type: text/plain; name="${name}"`, `Content-Disposition: attachment; filename="${name}"`],
    body: name,
  }));
  const bytes = build(
    [
      'Received: from c.example by d.example; Tue, 06 Oct 2026 10:00:09 +0000',
      'Received: from b.example by c.example; Tue, 06 Oct 2026 10:00:05 +0000',
      'X-Repeat: one',
      'Received: from a.example by b.example; Tue, 06 Oct 2026 10:00:01 +0000',
      'X-Repeat: two',
      'Content-Type: multipart/mixed; boundary=m',
    ],
    multipart('m', [{ headers: ['Content-Type: text/plain'], body: 'the body' }, ...parts]),
  );
  const analysis = await analyzeMessage(bytes);
  expect(analysis.headers.map((h) => h.name)).toEqual([
    'Received',
    'Received',
    'X-Repeat',
    'Received',
    'X-Repeat',
    'Content-Type',
  ]);
  expect(analysis.headers.map((h) => h.index)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(analysis.headers.filter((h) => h.name === 'Received').map((h) => h.value.slice(5, 14))).toEqual([
    'c.example',
    'b.example',
    'a.example',
  ]);
  expect(analysis.headers.filter((h) => h.name === 'X-Repeat').map((h) => h.value)).toEqual(['one', 'two']);
  expect(analysis.attachments.map((a) => a.name)).toEqual(names);
  expect(analysis.attachments.map((a) => a.path)).toEqual(['2', '3', '4', '5']);
  expect(analysis.attachments.map((a) => a.index)).toEqual([1, 2, 3, 4]);
  // The first text/plain part that is not an attachment is the body, even when attachments come first.
  const attachmentFirst = build(
    ['Content-Type: multipart/mixed; boundary=m'],
    multipart('m', [
      {
        headers: ['Content-Type: text/plain; name="a.txt"', 'Content-Disposition: attachment; filename="a.txt"'],
        body: 'not the body',
      },
      { headers: ['Content-Type: text/plain'], body: 'the real body' },
      { headers: ['Content-Type: text/plain'], body: 'a later text part' },
    ]),
  );
  const second = await analyzeMessage(attachmentFirst);
  expect(second.textBody?.text).toBe('the real body');
  expect(second.textBody?.path).toBe('2');
  // A text part inside a forwarded message is never the body of the outer message.
  const forwarded = build(
    ['Content-Type: multipart/mixed; boundary=m'],
    multipart('m', [
      {
        headers: ['Content-Type: message/rfc822'],
        body: ['Subject: inner', 'Content-Type: text/plain', '', 'inner text'].join(CRLF),
      },
      { headers: ['Content-Type: text/plain'], body: 'outer text' },
    ]),
  );
  expect((await analyzeMessage(forwarded)).textBody?.text).toBe('outer text');
});

it('an empty message is refused and a message with headers only gives a summary and no parts', async () => {
  for (const empty of [new Uint8Array(0), bytesOf(CRLF + '   ' + CRLF + '\t')]) {
    const error = await analyzeMessage(empty).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(EmlViewerError);
    expect((error as EmlViewerError).part).toBe('message');
    expect((error as EmlViewerError).message).toBe('The message is empty, so there is nothing to read.');
  }

  // Headers and a blank line, nothing after it.
  for (const headerOnly of [
    bytesOf(
      ['From: Jose <jose@example.com>', 'Subject: just headers', 'Date: Tue, 06 Oct 2026 09:59:58 +0000'].join(CRLF) +
        CRLF +
        CRLF,
    ),
    // A pasted block of headers with no blank line at all.
    bytesOf(
      ['From: Jose <jose@example.com>', 'Subject: just headers', 'Date: Tue, 06 Oct 2026 09:59:58 +0000'].join('\n'),
    ),
  ]) {
    const analysis = await analyzeMessage(headerOnly);
    expect(new Map(analysis.summary).get('Subject')).toBe('just headers');
    expect(new Map(analysis.summary).get('From')).toBe('Jose <jose@example.com>');
    expect(new Map(analysis.summary).get('Parts')).toBe('0');
    expect(analysis.partCount).toBe(0);
    expect(analysis.tree).toBeNull();
    expect(analysis.textBody).toBeNull();
    expect(analysis.htmlBody).toBeNull();
    expect(analysis.attachments).toEqual([]);
    expect(analysis.headers).toHaveLength(3);
    expect(analysis.notes).toContain('The message has headers and no body.');
  }
});

it('character sets are read with the browser decoder and an unknown label is shown as escaped bytes', async () => {
  const withBody = (charset: string, bytes: number[]) => {
    const head = bytesOf(`Content-Type: text/plain; charset=${charset}${CRLF}${CRLF}`);
    const all = new Uint8Array(head.length + bytes.length);
    all.set(head, 0);
    all.set(bytes, head.length);
    return all;
  };
  // us-ascii and iso-8859-1 are windows-1252 in the WHATWG table: 0x80 is the euro sign and 0x93 a curved quote.
  for (const label of ['us-ascii', 'iso-8859-1', 'US-ASCII', 'windows-1252']) {
    const analysis = await analyzeMessage(withBody(label, [0x80, 0x93, 0x41]));
    expect(analysis.textBody?.text, label).toBe(`${String.fromCodePoint(0x20ac)}${String.fromCodePoint(0x201c)}A`);
  }
  // Other sets: ISO-8859-2 0xB1 is a with an ogonek, EUC-KR 0xB0 0xA1 is the Hangul syllable ga, GB18030 0xC4 0xE3 is a Han character.
  expect((await analyzeMessage(withBody('iso-8859-2', [0xb1]))).textBody?.text).toBe(String.fromCodePoint(0x105));
  expect((await analyzeMessage(withBody('euc-kr', [0xb0, 0xa1]))).textBody?.text).toBe(String.fromCodePoint(0xac00));
  expect((await analyzeMessage(withBody('gb18030', [0xc4, 0xe3]))).textBody?.text).toBe(String.fromCodePoint(0x4f60));
  expect((await analyzeMessage(withBody('"UTF-8"', [0xc3, 0xa9]))).textBody?.text).toBe(String.fromCodePoint(0xe9));
  // No label at all is the RFC 2045 default, us-ascii, read the same way.
  const unlabelled = await analyzeMessage(bytesOf(`Content-Type: text/plain${CRLF}${CRLF}plain`));
  expect(unlabelled.textBody?.text).toBe('plain');

  // A label the decoder does not know: the bytes are shown escaped and the label is named in a note.
  for (const label of ['utf-7', 'x-unknown']) {
    const analysis = await analyzeMessage(withBody(label, [0x41, 0x2b, 0xe9, 0x5c, 0x00]));
    expect(analysis.textBody?.text, label).toBe(
      `A+${String.fromCharCode(92)}xE9${String.fromCharCode(92, 92)}${String.fromCharCode(92)}x00`,
    );
    expect(analysis.notes.join(' '), label).toContain(`The character set ${label} is not one this page can read`);
  }
  // The labels the browser maps to its no-output set count as unknown too.
  expect(decodeBytes(bytesOf('abc'), 'hz-gb-2312').known).toBe(false);
  expect(decodeBytes(bytesOf('abc'), 'iso-2022-kr').text).toBe('abc');
  // A long label is echoed in a note at most 40 characters.
  const long = await analyzeMessage(withBody('x-' + 'z'.repeat(120), [0x41]));
  const note = long.notes.find((n) => n.startsWith('The character set'));
  expect(note).toBeDefined();
  expect(note).not.toContain('z'.repeat(60));
});

it('transfer encodings decode like Node and read broken input leniently', () => {
  const generator = mulberry32(20261006);
  for (let i = 0; i < 50; i++) {
    const size = Math.floor(generator() * 300);
    const raw = Buffer.alloc(size);
    for (let j = 0; j < size; j++) raw[j] = Math.floor(generator() * 256);
    const wrapped = raw.toString('base64').replace(/(.{76})/g, '$1\r\n');
    expect(Buffer.from(decodeBase64Lenient(bytesOf(wrapped))).equals(raw)).toBe(true);
    // Missing padding is accepted.
    expect(Buffer.from(decodeBase64Lenient(bytesOf(raw.toString('base64').replace(/=+$/, '')))).equals(raw)).toBe(true);
  }
  // Line noise is skipped, data ends at the first padding character, and a lone character carries no byte.
  expect(new TextDecoder().decode(decodeBase64Lenient(bytesOf('SGVs\r\n bG8*!gd29ybGQ=')))).toBe('Hello world');
  expect(new TextDecoder().decode(decodeBase64Lenient(bytesOf('SGVsbG8=trailing text')))).toBe('Hello');
  expect(decodeBase64Lenient(bytesOf('A'))).toHaveLength(0);
  expect(decodeBase64Lenient(bytesOf(''))).toHaveLength(0);

  const qp = (input: string): string => new TextDecoder().decode(decodeQuotedPrintable(bytesOf(input)));
  expect(qp('caf=C3=A9 and =c3=a9')).toBe(`caf${String.fromCodePoint(0xe9)} and ${String.fromCodePoint(0xe9)}`);
  // Soft line breaks (CRLF, LF) are removed, and so is a trailing = at the very end of the data.
  expect(qp('one =\r\ntwo=\nthree=')).toBe('one twothree');
  // A = that does not start a valid sequence stays, and so does a hard line break.
  expect(qp('a=ZZb=4')).toBe('a=ZZb=4');
  expect(qp('line one\r\nline two')).toBe('line one\r\nline two');
  // Spaces and tabs before a hard line break are padding, but =20 is a real space.
  expect(qp('end   \t\r\nnext=20\r\n')).toBe('end\r\nnext \r\n');
  expect(qp('keep =\r\nthis')).toBe('keep this');
});

it('a quoted-printable soft line break followed by spaces or tabs before the line end is still a soft break, RFC 2045 section 6.7', () => {
  // RFC 2045 section 6.7: a qp-segment ends in "=" followed by transport-padding and CRLF, and rule (3) deletes white
  // space at the end of a line before decoding, so "=" then spaces or tabs then the line end joins the two lines.
  const qp = (input: string): string => new TextDecoder().decode(decodeQuotedPrintable(bytesOf(input)));
  expect(qp('abc=  \r\ndef')).toBe('abcdef');
  expect(qp('abc=\t \ndef')).toBe('abcdef');
  expect(qp('abc= \t\rdef')).toBe('abcdef');
  // At the very end of the data the padded = is dropped, as a bare trailing = is.
  expect(qp('abc=  ')).toBe('abc');
  expect(qp('abc=\t')).toBe('abc');
  // White space before the = belongs to the text and is kept; the next line break is a hard one.
  expect(qp('keep  =  \r\n\r\nnext')).toBe('keep  \r\nnext');
  expect(qp('keep  =\r\n\r\nnext')).toBe('keep  \r\nnext');
  expect(qp('keep  = \n\nnext')).toBe('keep  \nnext');
  // An = followed by white space and then more text is not a soft break and stays as written.
  expect(qp('a= b')).toBe('a= b');
  expect(qp('a= 4F')).toBe('a= 4F');
  expect(qp('a=\t41')).toBe('a=\t41');
  expect(qp('a=  \tb\r\n')).toBe('a=  \tb\r\n');
  // A quoted-printable attachment written with padded soft breaks is saved with the bytes its sender meant.
  const bytes = decodeQuotedPrintable(bytesOf('=00=01=  \r\n=02=FF=\t\r\n=80'));
  expect(Array.from(bytes)).toEqual([0x00, 0x01, 0x02, 0xff, 0x80]);
});
