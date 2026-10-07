/**
 * Hostile input: caps, refusals that never repeat message text, names that could be prototype keys, and linear time.
 * Every hostile input is built here at run time; none is stored. Deep or large HTML is only ever given to the pre-scan.
 */
import { it, expect, vi } from 'vitest';
import {
  EmlViewerError,
  MAX_DEPTH,
  MAX_HEADER_BYTES,
  MAX_HEADERS,
  MAX_MESSAGE_BYTES,
  MAX_PARTS,
  MAX_PASTE_CHARACTERS,
  analyzeMessage,
  checkFileSize,
  checkPasteSize,
  decodeBase64Lenient,
  decodeBytes,
  decodeEncodedWords,
  decodeQuotedPrintable,
  findParam,
  parseMime,
  parseParameters,
  previewHtml,
  safeAttachmentName,
  scanHtml,
  showBody,
  splitHeaderBlock,
  withCommas,
  type PartNode,
} from '../src/index';
import { HOSTILE, scalingRatio } from './scaling';
import { CRLF, build, bytesOf, makeWindow, multipart } from './helpers';

/** `levels` nested multiparts with a text leaf in the innermost one: the leaf is at depth levels + 1. */
function chain(levels: number, kind: 'multipart' | 'message' = 'multipart'): Uint8Array {
  let part = ['Content-Type: text/plain', '', 'deepest'].join(CRLF);
  for (let i = levels - 1; i >= 0; i--) {
    part =
      kind === 'multipart'
        ? [`Content-Type: multipart/mixed; boundary="b${i}"`, '', `--b${i}`, part, `--b${i}--`].join(CRLF)
        : ['Content-Type: message/rfc822', '', part].join(CRLF);
  }
  return bytesOf(['MIME-Version: 1.0', part].join(CRLF));
}

function maxDepth(node: PartNode): number {
  let deepest = 0;
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    deepest = Math.max(deepest, current.depth);
    stack.push(...current.children);
  }
  return deepest;
}

it('nesting over 16 levels, more than 1,000 parts and more than 2,000 headers stop the reading there with a note', async () => {
  // Depth: the message is level 1, so 15 nested multiparts put a leaf at level 16 (read) and 16 put it at level 17 (not read).
  const fits = await analyzeMessage(chain(MAX_DEPTH - 1));
  expect(fits.textBody?.text).toBe('deepest');
  expect(fits.notes.join(' ')).not.toContain('deeper than');
  expect(maxDepth(parseMime(chain(MAX_DEPTH - 1)))).toBe(MAX_DEPTH);

  for (const kind of ['multipart', 'message'] as const) {
    const bytes = chain(MAX_DEPTH, kind);
    const root = parseMime(bytes);
    expect(maxDepth(root), kind).toBe(MAX_DEPTH);
    expect(root.notes.join(' '), kind).toContain('nested deeper than 16 levels');
    const analysis = await analyzeMessage(bytes);
    expect(analysis.textBody, kind).toBeNull();
    expect(analysis.notes.join(' '), kind).toContain('nested deeper than 16 levels');
    // What was read is kept: the tree is there to the last level read.
    expect(analysis.tree?.label, kind).toBe(kind === 'multipart' ? 'multipart/mixed' : 'message/rfc822');
  }
  // A very deep chain is stopped at the same level, quickly, and never recursed over.
  const veryDeep = parseMime(chain(5_000));
  expect(maxDepth(veryDeep)).toBe(MAX_DEPTH);

  // Parts: 1,000 are read, the 1,001st is not.
  const manyParts = (count: number) =>
    build(
      ['Content-Type: multipart/mixed; boundary=m'],
      multipart(
        'm',
        Array.from({ length: count }, (_, i) => ({ headers: ['Content-Type: text/plain'], body: `part ${i + 1}` })),
      ),
    );
  const atLimit = await analyzeMessage(manyParts(MAX_PARTS));
  expect(atLimit.partCount).toBe(MAX_PARTS);
  expect(atLimit.notes.join(' ')).not.toContain('more than 1,000 parts');
  const overLimit = await analyzeMessage(manyParts(MAX_PARTS + 1));
  expect(overLimit.partCount).toBe(MAX_PARTS);
  expect(overLimit.notes.join(' ')).toContain('more than 1,000 parts');
  expect(overLimit.textBody?.text).toBe('part 1');
  expect(parseMime(manyParts(MAX_PARTS + 1)).children).toHaveLength(MAX_PARTS);

  // Headers: 2,000 are read, the 2,001st is not, and the body after them is still found.
  const manyHeaders = (count: number) =>
    bytesOf(
      Array.from({ length: count }, (_, i) => `X-N${i}: ${i}`).join(CRLF) + `${CRLF}${CRLF}the body after the headers`,
    );
  const headersAtLimit = await analyzeMessage(manyHeaders(MAX_HEADERS));
  expect(headersAtLimit.headers).toHaveLength(MAX_HEADERS);
  expect(headersAtLimit.notes.join(' ')).not.toContain('more than 2,000 headers');
  const headersOver = await analyzeMessage(manyHeaders(MAX_HEADERS + 1));
  expect(headersOver.headers).toHaveLength(MAX_HEADERS);
  expect(headersOver.headers[MAX_HEADERS - 1]?.name).toBe(`X-N${MAX_HEADERS - 1}`);
  expect(headersOver.notes.join(' ')).toContain('more than 2,000 headers');
  expect(headersOver.textBody?.text).toBe('the body after the headers');

  // A header over 64 KiB: the headers before it are kept, it and the ones after it are not read, the body is still found.
  const huge = bytesOf(
    ['From: before@example.test', `X-Big: ${'a'.repeat(70_000)}`, 'Subject: after'].join(CRLF) +
      `${CRLF}${CRLF}body of the huge header`,
  );
  const hugeAnalysis = await analyzeMessage(huge);
  expect(hugeAnalysis.headers.map((h) => h.name)).toEqual(['From']);
  expect(hugeAnalysis.notes.join(' ')).toContain('longer than 65,536 bytes');
  expect(hugeAnalysis.textBody?.text).toBe('body of the huge header');
  // The same when the long header is folded over many lines.
  const folded = bytesOf(
    [
      'From: before@example.test',
      `X-Big: a`,
      ...Array.from({ length: 100 }, () => ` ${'b'.repeat(1_000)}`),
      'Subject: after',
    ].join(CRLF) + `${CRLF}${CRLF}body of the folded header`,
  );
  const foldedAnalysis = await analyzeMessage(folded);
  expect(foldedAnalysis.headers.map((h) => h.name)).toEqual(['From']);
  expect(foldedAnalysis.textBody?.text).toBe('body of the folded header');
  expect(MAX_HEADER_BYTES).toBe(65_536);
  // Right under the limit the header is read whole.
  const edge = splitHeaderBlock(bytesOf(`X-Edge: ${'z'.repeat(MAX_HEADER_BYTES - 8)}${CRLF}${CRLF}`));
  expect(edge.fields).toHaveLength(1);
  expect(edge.notes).toEqual([]);

  // Encoded words: 200 are decoded, the 201st and the rest are left as written, and 100,000 =? start nothing.
  const words = Array.from({ length: 201 }, (_, i) => `=?UTF-8?Q?w${i}?=`).join(' ');
  const decoded = decodeEncodedWords(words);
  expect(decoded.words).toBe(200);
  expect(decoded.cut).toBe(true);
  expect(decoded.text.endsWith('=?UTF-8?Q?w200?=')).toBe(true);
  expect(decoded.text.startsWith('w0w1w2')).toBe(true);
  const subject = await analyzeMessage(bytesOf(`Subject: ${words}${CRLF}${CRLF}x`));
  expect(subject.notes.join(' ')).toContain('more than 200 encoded words');
  const noise = decodeEncodedWords('=?'.repeat(100_000));
  expect(noise.words).toBe(0);
  expect(noise.text).toHaveLength(200_000);
});

it('a message over 25 MiB is refused before it is read', async () => {
  // An object that has a length and nothing else: any attempt to read it would throw a TypeError, not the refusal.
  const unreadable = { length: MAX_MESSAGE_BYTES + 1 } as unknown as Uint8Array;
  const error = await analyzeMessage(unreadable).then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(EmlViewerError);
  expect((error as EmlViewerError).part).toBe('message');
  expect((error as EmlViewerError).message).toBe(
    `The message is ${withCommas(MAX_MESSAGE_BYTES + 1)} bytes. The limit is ${withCommas(MAX_MESSAGE_BYTES)} (25 MiB), so it was not read.`,
  );

  // The file and paste checks the page makes before any worker starts: bytes for a file, characters for a paste.
  expect(() => checkFileSize(MAX_MESSAGE_BYTES)).not.toThrow();
  expect(() => checkFileSize(MAX_MESSAGE_BYTES + 1)).toThrow(EmlViewerError);
  expect(() => checkPasteSize(MAX_PASTE_CHARACTERS)).not.toThrow();
  expect(() => checkPasteSize(MAX_PASTE_CHARACTERS + 1)).toThrow(EmlViewerError);
  expect(MAX_MESSAGE_BYTES).toBe(25 * 1024 * 1024);
  expect(MAX_PASTE_CHARACTERS).toBe(5 * 1024 * 1024);
  try {
    checkFileSize(MAX_MESSAGE_BYTES + 5);
  } catch (e) {
    expect((e as EmlViewerError).part).toBe('file');
    expect((e as EmlViewerError).message).toContain('25 MiB');
  }
  try {
    checkPasteSize(MAX_PASTE_CHARACTERS + 5);
  } catch (e) {
    expect((e as EmlViewerError).part).toBe('pasted message');
    expect((e as EmlViewerError).message).toContain('5 MiB');
  }

  // Exactly 25 MiB is read: a header, then one line with no line end, cut for display at 256 KiB.
  const head = bytesOf(`Subject: edge${CRLF}${CRLF}`);
  const edge = new Uint8Array(MAX_MESSAGE_BYTES).fill(0x78);
  edge.set(head, 0);
  const analysis = await analyzeMessage(edge);
  expect(analysis.size).toBe(MAX_MESSAGE_BYTES);
  expect(analysis.textBody?.text).toHaveLength(262_144);
  expect(analysis.textBody?.cut).toBe(true);
  expect(analysis.notes).toContain('The plain text body is cut at 256 KiB.');
  // A single line of 25 MiB with no line end and no header in it is all body.
  const oneLine = await analyzeMessage(new Uint8Array(MAX_MESSAGE_BYTES).fill(0x61));
  expect(oneLine.headers).toEqual([]);
  expect(oneLine.partCount).toBe(1);
}, 30_000);

it('refusals name the part and never repeat message text', async () => {
  const marker = 'MARKER-8f3c1d-secret-looking-text';
  const messages: string[] = [];

  // Refusals: too large and empty, with the message made of one repeated, recognisable text.
  const filler = new Uint8Array(MAX_MESSAGE_BYTES + 1).fill(0x41);
  const parts: string[] = [];
  for (const input of [filler, bytesOf(' '.repeat(150)), new Uint8Array(0)]) {
    try {
      await analyzeMessage(input);
    } catch (e) {
      expect(e).toBeInstanceOf(EmlViewerError);
      parts.push((e as EmlViewerError).part);
      messages.push((e as EmlViewerError).message);
    }
  }
  expect(parts).toEqual(['message', 'message', 'message']);
  expect(messages.join('\n')).not.toContain('A'.repeat(20));
  expect(messages.join('\n')).not.toContain(' '.repeat(20));

  // Notes about a malformed message: the marker sits in every place a note could be tempted to quote.
  const malformed = [
    'X-First: ok',
    `Content-Type: ${marker}`,
    `Content-Transfer-Encoding: ${marker}`,
    `Content-Disposition: ${marker}; filename*0=${marker}; filename*2=${marker}`,
    `X-Header: =?${marker}?Q?=ZZ?= =?utf-8?B?${marker}?=`,
    '',
    `--${marker}`,
    `Content-Type: multipart/mixed; boundary="${marker}"`,
    '',
    `--${marker}`,
    `Content-Type: multipart/mixed`,
    '',
    marker,
  ].join(CRLF);
  const analysis = await analyzeMessage(bytesOf(malformed));
  messages.push(...analysis.notes);
  const second = await analyzeMessage(
    build(
      ['Content-Type: multipart/mixed; boundary=m', `X-Mark: ${marker}`],
      multipart('m', [
        { headers: [`Content-Type: ${marker}`, `Content-Transfer-Encoding: ${marker}`], body: marker },
        { headers: ['Content-Type: multipart/digest; boundary=zz'], body: marker },
      ]),
    ),
  );
  messages.push(...second.notes);
  expect(messages.length).toBeGreaterThan(3);
  for (const message of messages) {
    expect(message, message).not.toContain(marker);
    expect(message, message).not.toContain('MARKER-8f3c');
  }
  // The one place a note names text of the message is a character set label, and it is cut at 40 characters.
  const third = await analyzeMessage(build([`Content-Type: text/plain; charset=${'q'.repeat(100)}`], marker));
  const named = third.notes.find((n) => n.includes('character set'));
  expect(named).toBeDefined();
  expect(named).not.toContain('q'.repeat(41));

  // The package prints nothing, whatever it reads.
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
  try {
    await analyzeMessage(bytesOf(malformed));
    previewHtml('<p>x</p><img src="https://t.example/a.gif">', makeWindow(), []);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

it('header and parameter names __proto__, constructor and toString are plain names', async () => {
  const names = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];
  const headerLines = names.map((name, i) => `${name}: value ${i}`);
  const params = names.map((name, i) => `${name}=param${i}`).join('; ');
  const bytes = build(
    [...headerLines, `Content-Type: multipart/mixed; boundary=m; ${params}`],
    multipart('m', [
      { headers: ['Content-Type: text/plain'], body: 'body' },
      {
        headers: [
          'Content-Type: application/octet-stream',
          'Content-ID: <__proto__>',
          `Content-Disposition: attachment; __proto__="evil.txt"; filename="constructor"; toString=x`,
        ],
        body: 'data',
      },
    ]),
  );
  const analysis = await analyzeMessage(bytes);
  expect(analysis.headers.map((h) => h.name).slice(0, 5)).toEqual(names);
  expect(analysis.headers.slice(0, 5).map((h) => h.value)).toEqual(names.map((_, i) => `value ${i}`));
  const root = parseMime(bytes);
  for (let i = 0; i < names.length; i++) expect(findParam(root.type, names[i]!.toLowerCase())?.value).toBe(`param${i}`);
  expect(findParam(root.type, 'boundary')?.value).toBe('m');
  expect(analysis.attachments[0]?.name).toBe('constructor');
  expect(analysis.cidParts.map((c) => c.id)).toEqual(['__proto__']);

  // Nothing leaked into Object.prototype, and plain objects have no inherited names.
  const probe: Record<string, unknown> = {};
  expect(Object.keys(Object.prototype)).toEqual([]);
  for (const name of ['evil', 'value', 'param0', 'toString2']) expect(probe[name]).toBeUndefined();
  expect(Object.getPrototypeOf(analysis.headers[0])).toBe(Object.prototype);

  // Parameter names in a continuation, as the base of a section number, and as names that are only a prefix.
  const continued = parseParameters('x/y; __proto__*0="a"; __proto__*1="b"; constructor*="us-ascii\'\'c%2Fd"');
  expect(findParam(continued, '__proto__')?.value).toBe('ab');
  expect(findParam(continued, 'constructor')?.value).toBe('c/d');
  expect(findParam(continued, 'hasOwnProperty')).toBeUndefined();
  // Attachment names that look like prototype keys are ordinary names and may repeat.
  const taken = new Set<string>();
  expect(safeAttachmentName('__proto__', 1, taken).name).toBe('__proto__');
  expect(safeAttachmentName('__proto__', 2, taken).name).toBe('__proto__ (2)');
  expect(safeAttachmentName('constructor', 3, taken).name).toBe('constructor');
  expect(safeAttachmentName('toString', 4, taken).name).toBe('toString');
});

const bytesFn =
  <T>(fn: (bytes: Uint8Array) => T) =>
  (input: string): T =>
    fn(bytesOf(input));

const OWN_HOSTILE: ReadonlyArray<readonly [string, (n: number) => string]> = [
  ['many short lines', (n) => 'a\r\n'.repeat(Math.floor(n / 3))],
  ['many header lines', (n) => 'X: y\r\n'.repeat(Math.floor(n / 6))],
  ['many folded lines', (n) => 'X: y\r\n '.repeat(Math.floor(n / 7))],
  ['one long header', (n) => `X: ${'y'.repeat(n)}`],
  ['encoded words', (n) => '=?utf-8?Q?x?= '.repeat(Math.floor(n / 15))],
  ['unclosed encoded words', (n) => '=?utf-8?Q?x'.repeat(Math.floor(n / 11))],
  ['open comments', (n) => '('.repeat(n)],
  ['many parameters', (n) => 'a/b' + '; k=v'.repeat(Math.floor(n / 5))],
  ['many quotes', (n) => 'a/b; k="' + '\\"'.repeat(Math.floor(n / 2))],
  ['continuation sections', (n) => 'a/b' + '; t*0=x'.repeat(Math.floor(n / 8))],
  [
    'boundary lines',
    (n) => 'Content-Type: multipart/mixed; boundary=b\r\n\r\n' + '--b\r\nX: y\r\n\r\nz\r\n'.repeat(Math.floor(n / 16)),
  ],
  [
    'nested boundaries',
    (n) =>
      'Content-Type: multipart/mixed; boundary=b\r\n\r\n' +
      '--b\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n'.repeat(Math.floor(n / 52)),
  ],
  ['one very long boundary-like line', (n) => 'Content-Type: multipart/mixed; boundary=b\r\n\r\n--' + 'b'.repeat(n)],
  ['base64 noise', (n) => 'A= '.repeat(Math.floor(n / 3))],
  ['soft breaks', (n) => '=\r\n'.repeat(Math.floor(n / 3))],
  ['trailing white space', (n) => ' \t'.repeat(Math.floor(n / 2)) + '\r\n'],
  ['tags', (n) => '<'.repeat(n)],
  ['open tags', (n) => '<a>'.repeat(Math.floor(n / 3))],
  ['optional end tags', (n) => '<p>'.repeat(Math.floor(n / 3))],
  ['end tags', (n) => '</a>'.repeat(Math.floor(n / 4))],
  ['unclosed comments', (n) => '<!--'.repeat(Math.floor(n / 4))],
  ['long attribute lists', (n) => '<a ' + 'b '.repeat(Math.floor(n / 2))],
  ['hidden characters', (n) => String.fromCodePoint(0x202e).repeat(n)],
  ['dots and slashes', (n) => '/.'.repeat(Math.floor(n / 2))],
];

it('every parser stays linear on hostile input', () => {
  const parsers: ReadonlyArray<readonly [string, (input: string) => unknown]> = [
    ['splitHeaderBlock', bytesFn((b) => splitHeaderBlock(b, 0, b.length, true))],
    ['parseMime', bytesFn((b) => parseMime(b))],
    ['decodeEncodedWords', (s) => decodeEncodedWords(s)],
    ['parseParameters', (s) => parseParameters(s)],
    ['decodeBase64Lenient', bytesFn((b) => decodeBase64Lenient(b))],
    ['decodeQuotedPrintable', bytesFn((b) => decodeQuotedPrintable(b))],
    ['decodeBytes', bytesFn((b) => decodeBytes(b, 'utf-8'))],
    ['safeAttachmentName', (s) => safeAttachmentName(s, 1, new Set())],
    ['scanHtml', (s) => scanHtml(s)],
    ['showBody', (s) => showBody(s)],
  ];
  const inputs: ReadonlyArray<readonly [string, (n: number) => string]> = [
    ...HOSTILE.map((make, i) => [`shared string ${i + 1}`, make] as const),
    ...OWN_HOSTILE,
  ];
  const slow: string[] = [];
  let measured = 0;
  for (const [parserName, parser] of parsers) {
    // A parser that is a single native call (the browser's decoder) takes microseconds at 20,000 characters, so a pause of
    // the machine decides the ratio there; it is measured on a size where the work dominates the noise.
    const size = parserName === 'decodeBytes' ? 400_000 : 20_000;
    for (const [inputName, make] of inputs) {
      let ratio = scalingRatio(parser, make, size);
      // The limit is not loosened. A ratio over it is measured twice more and the median of the three is judged, so one
      // slow moment cannot fail a parser while a parser that really grows too fast fails all three.
      if (ratio > 6) {
        const again = [ratio, scalingRatio(parser, make, size), scalingRatio(parser, make, size)].sort((a, b) => a - b);
        ratio = again[1] ?? ratio;
      }
      measured++;
      if (ratio > 6) slow.push(`${parserName} on ${inputName}: ${ratio.toFixed(1)}`);
    }
  }
  expect(measured).toBe(parsers.length * inputs.length);
  expect(slow).toEqual([]);
}, 180_000);
