import { expect, it } from 'vitest';
import {
  EXPANSION_MESSAGE,
  MAX_STREAM_DECODED_BYTES,
  MAX_TOTAL_DECODED_BYTES,
  PdfToolError,
  checkExpansion,
  expansionCheckAvailable,
  extractPageTexts,
} from '../src/index';
import { deflateSync } from 'node:zlib';
import { buildMinimalPdf } from './minimal-pdf';
import { openWithPdfJs } from './pdfjs-node';
import { fixtureBytes } from './scan';
import {
  F1_FULL,
  F1_FULL_NO_OBJSTM,
  F1_PLAIN,
  F2_INCREMENTAL,
  F3_OWNER_ENCRYPTED,
  F4_USER_ENCRYPTED,
  F5_CLEAN_NO_INFO,
  F6_UNICODE,
  F7_BIDI,
  F8_NESTED,
} from './fixtures/pdfs';
import {
  asciiHexEncode,
  ascii85Encode,
  contentStreamBomb,
  deflateZeros,
  lzwEncode,
  objectStreamBomb,
  pageWith,
  runLengthEncode,
  streamObject,
} from './bombs';

/**
 * Every title below is a top-level `it(...)` call (see index.test.ts for why). The expected numbers are the sizes the
 * builders were given (a stream written from N bytes decodes to N bytes), the caps this folder states in its limits, and
 * the two probe files a reviewer measured: an 815 KB file that made pdf-lib hold 1.75 GB and a 408 KB file that made
 * PDF.js hold 1.38 GB. Where a browser or Node has no streaming inflater the check cannot run, so the tests say so.
 */
const MIB = 1024 * 1024;

async function refusal(promise: Promise<unknown>): Promise<PdfToolError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(PdfToolError);
    return err as PdfToolError;
  }
  throw new Error('The check accepted a file it should have refused.');
}

it('this runtime can inflate as a stream, so the expansion check runs', () => {
  expect(expansionCheckAvailable()).toBe(true);
  expect(MAX_STREAM_DECODED_BYTES).toBe(64 * MIB);
  expect(MAX_TOTAL_DECODED_BYTES).toBe(256 * MIB);
});

it('an 815 KB PDF whose object stream inflates to 800 MB is refused quickly with a plain message', async () => {
  const bomb = await objectStreamBomb(800);
  expect(bomb.length).toBeLessThan(900 * 1024);
  const started = performance.now();
  const error = await refusal(checkExpansion(bomb));
  const elapsed = performance.now() - started;
  expect(error.kind).toBe('size');
  expect(error.message).toBe('This PDF expands to more data than this page can hold in memory.');
  expect(error.message).toBe(EXPANSION_MESSAGE);
  expect(elapsed).toBeLessThan(20_000);
}, 60_000);

it('a 408 KB PDF whose page content stream inflates to 400 MB is refused quickly', async () => {
  const bomb = await contentStreamBomb(400);
  expect(bomb.length).toBeLessThan(500 * 1024);
  const started = performance.now();
  const error = await refusal(checkExpansion(bomb));
  const elapsed = performance.now() - started;
  expect(error.kind).toBe('size');
  expect(error.message).toBe(EXPANSION_MESSAGE);
  expect(elapsed).toBeLessThan(20_000);
}, 60_000);

it('a doubled Flate filter is refused: the second stage is counted as well as the first', async () => {
  const inner = await deflateZeros(200);
  const outer = deflateSync(inner);
  const bomb = pageWith('/Contents 4 0 R', [
    { number: 4, body: streamObject('/Filter [/FlateDecode /FlateDecode]', outer) },
  ]);
  const error = await refusal(checkExpansion(bomb));
  expect(error.kind).toBe('size');
});

it('every stage of a filter chain counts toward the total, not only the last one', async () => {
  // Zlib data written as stored blocks is as long as what it holds, so the first stage of this chain decodes to about
  // 700 KB (the zlib data) and the second to 700 KB of zeros: 1.4 MB in all, though neither stage passes 1 MiB alone.
  const zeros = Buffer.alloc(700 * 1024);
  const middle = deflateSync(zeros, { level: 0 });
  const outer = deflateSync(middle);
  const bomb = pageWith('/Contents 4 0 R', [
    { number: 4, body: streamObject('/Filter [/FlateDecode /FlateDecode]', outer) },
  ]);
  const limits = { perStream: 1 * MIB, total: 1 * MIB };
  expect((await checkExpansion(bomb, { limits: { perStream: 1 * MIB, total: 2 * MIB } })).decodedBytes).toBe(
    middle.length + zeros.length,
  );
  expect((await refusal(checkExpansion(bomb, { limits }))).kind).toBe('size');
});

it('the cap on one stream and the cap on the total are separate', async () => {
  const flate = deflateSync(Buffer.alloc(600 * 1024));
  const three = pageWith('/Contents [4 0 R 5 0 R 6 0 R]', [
    { number: 4, body: streamObject('/Filter /FlateDecode', flate) },
    { number: 5, body: streamObject('/Filter /FlateDecode', flate) },
    { number: 6, body: streamObject('/Filter /FlateDecode', flate) },
  ]);
  // Each stream is under 1 MiB and the three together are over 1.5 MiB.
  expect((await checkExpansion(three, { limits: { perStream: 1 * MIB, total: 2 * MIB } })).decodedBytes).toBe(
    3 * 600 * 1024,
  );
  expect((await refusal(checkExpansion(three, { limits: { perStream: 1 * MIB, total: 1.5 * MIB } }))).kind).toBe(
    'size',
  );
  expect((await refusal(checkExpansion(three, { limits: { perStream: 500 * 1024, total: 100 * MIB } }))).kind).toBe(
    'size',
  );
});

it('every PDF fixture and every built PDF of this folder is accepted, and object streams are counted', async () => {
  const fixtures = [
    F1_PLAIN,
    F1_FULL,
    F1_FULL_NO_OBJSTM,
    F2_INCREMENTAL,
    F3_OWNER_ENCRYPTED,
    F4_USER_ENCRYPTED,
    F5_CLEAN_NO_INFO,
    F6_UNICODE,
    F7_BIDI,
    F8_NESTED,
  ].map(fixtureBytes);
  fixtures.push(buildMinimalPdf({ pages: [{ text: 'one' }, { text: 'two' }, { text: 'three' }] }));
  for (const bytes of fixtures) {
    const report = await checkExpansion(bytes);
    expect(report.streams).toBeGreaterThanOrEqual(0);
    expect(report.decodedBytes).toBeLessThan(MIB);
  }
  // The file with an object stream (written by pikepdf) decodes at least the text of the nine objects it holds.
  const withObjStm = await checkExpansion(fixtureBytes(F1_FULL));
  expect(withObjStm.decoded).toBeGreaterThan(0);
  expect(withObjStm.decodedBytes).toBeGreaterThan(300);
});

it('a legitimate large Flate image does not count, while the same bytes as anything else do', async () => {
  const flate = await deflateZeros(200);
  const image = pageWith('/Resources << /XObject << /Im0 4 0 R >> >>', [
    {
      number: 4,
      body: streamObject(
        '/Type /XObject /Subtype /Image /Width 10000 /Height 20000 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode',
        flate,
      ),
    },
  ]);
  const report = await checkExpansion(image);
  expect(report.images).toBe(1);
  expect(report.decoded).toBe(0);
  expect(report.decodedBytes).toBe(0);

  const notAnImage = pageWith('/Contents 4 0 R', [{ number: 4, body: streamObject('/Filter /FlateDecode', flate) }]);
  expect((await refusal(checkExpansion(notAnImage))).kind).toBe('size');
});

it('a Flate stream written with an escaped filter name, an array, an abbreviation or a reference is still counted', async () => {
  const flate = deflateSync(Buffer.alloc(2 * MIB));
  const limits = { perStream: 1 * MIB };
  for (const dictionary of [
    '/Filter /F#6Cate#44ecode',
    '/Filter [ /FlateDecode ]',
    '/Filter /Fl',
    '/Filter 9 0 R',
    '/Filter/FlateDecode',
  ]) {
    const bytes = pageWith('/Contents 4 0 R', [{ number: 4, body: streamObject(dictionary, flate) }]);
    expect((await refusal(checkExpansion(bytes, { limits }))).kind).toBe('size');
  }
  // With no filter at all nothing is decoded and nothing is counted.
  const plain = pageWith('/Contents 4 0 R', [{ number: 4, body: streamObject('', flate) }]);
  expect((await checkExpansion(plain, { limits })).decoded).toBe(0);
});

it('a stream that does not inflate is left for the reader to judge, not refused here', async () => {
  const junk = Buffer.from('this is not zlib data at all, whatever the dictionary says');
  const broken = deflateSync(Buffer.alloc(5000));
  const middle = Math.floor(broken.length / 2);
  broken.writeUInt8(broken.readUInt8(middle) ^ 0xff, middle);
  const bytes = pageWith('/Contents [4 0 R 5 0 R]', [
    { number: 4, body: streamObject('/Filter /FlateDecode', junk) },
    { number: 5, body: streamObject('/Filter /FlateDecode', broken) },
  ]);
  const report = await checkExpansion(bytes);
  expect(report.streams).toBe(2);
  expect(report.decoded).toBe(2);
});

it('LZW data is decoded to count it: a text that grows the table past 512 and 1024 entries, with either EarlyChange', async () => {
  const text = Buffer.from('BT /F1 12 Tf 10 10 Td (hello lzw) Tj ET\n'.repeat(400) + 'x'.repeat(3000) + 'END');
  for (const early of [1, 0]) {
    const encoded = lzwEncode(text, early);
    expect(encoded.length).toBeLessThan(text.length / 2);
    const dictionary = early === 1 ? '/Filter /LZWDecode' : '/Filter /LZWDecode /DecodeParms << /EarlyChange 0 >>';
    const bytes = pageWith('/Contents 4 0 R', [{ number: 4, body: streamObject(dictionary, encoded) }]);
    const report = await checkExpansion(bytes);
    expect(report.decodedBytes).toBe(text.length);
  }
});

it('LZW data agrees with PDF.js: a content stream written by the test encoder reads back as its text', async () => {
  const content = Buffer.from('BT /F1 12 Tf 10 10 Td (hello lzw) Tj ET\n'.repeat(300));
  const bytes = pageWith('/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >>', [
    { number: 4, body: streamObject('/Filter /LZWDecode', lzwEncode(content)) },
    { number: 5, body: Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>') },
  ]);
  const pdf = await openWithPdfJs(bytes);
  try {
    const result = await extractPageTexts(pdf.doc, [1], {
      signal: new AbortController().signal,
      onPage: () => undefined,
    });
    expect(result.pages[0]!.text.split('hello lzw').length - 1).toBe(300);
  } finally {
    await pdf.destroy();
  }
  expect((await checkExpansion(bytes)).decodedBytes).toBe(content.length);
});

it('an LZW stream that expands past the cap is refused', async () => {
  const bytes = pageWith('/Contents 4 0 R', [
    { number: 4, body: streamObject('/Filter /LZWDecode', lzwEncode(Buffer.alloc(3 * MIB))) },
  ]);
  expect((await refusal(checkExpansion(bytes, { limits: { perStream: 1 * MIB } }))).kind).toBe('size');
  expect((await checkExpansion(bytes)).decodedBytes).toBe(3 * MIB);
});

it('ASCII85, ASCII hex and run-length data are decoded to count them, alone and in front of Flate', async () => {
  const data = Buffer.concat([
    Buffer.from('The quick brown fox jumps over the lazy dog. '.repeat(40)),
    Buffer.alloc(8),
    Buffer.from('zzz'),
  ]);
  const cases: [string, Uint8Array][] = [
    ['/Filter /ASCII85Decode', ascii85Encode(data)],
    ['/Filter [/A85]', ascii85Encode(data)],
    ['/Filter /ASCIIHexDecode', asciiHexEncode(data)],
    ['/Filter /AHx', asciiHexEncode(data)],
    ['/Filter /RunLengthDecode', runLengthEncode(data)],
    ['/Filter /RL', runLengthEncode(data)],
    ['/Filter [/ASCII85Decode /FlateDecode]', ascii85Encode(deflateSync(data))],
    ['/Filter [/ASCIIHexDecode /FlateDecode]', asciiHexEncode(deflateSync(data))],
  ];
  for (const [dictionary, encoded] of cases) {
    const bytes = pageWith('/Contents 4 0 R', [{ number: 4, body: streamObject(dictionary, encoded) }]);
    const report = await checkExpansion(bytes);
    const last = dictionary.includes('Flate') ? data.length + deflateSync(data).length : data.length;
    expect(report.decodedBytes, dictionary).toBe(last);
  }
});

it('an ASCII85 stream in front of a Flate bomb is refused', async () => {
  const flate = await deflateZeros(3);
  const bytes = pageWith('/Contents 4 0 R', [
    { number: 4, body: streamObject('/Filter [/ASCII85Decode /FlateDecode]', ascii85Encode(flate)) },
  ]);
  expect((await refusal(checkExpansion(bytes, { limits: { perStream: 1 * MIB } }))).kind).toBe('size');
});

it('a run-length stream that repeats one byte is counted at its decoded size', async () => {
  const bytes = pageWith('/Contents 4 0 R', [
    { number: 4, body: streamObject('/Filter /RunLengthDecode', runLengthEncode(Buffer.alloc(100_000, 0x41))) },
  ]);
  expect((await checkExpansion(bytes)).decodedBytes).toBe(100_000);
  expect((await refusal(checkExpansion(bytes, { limits: { perStream: 50_000 } }))).kind).toBe('size');
});

it('a stream whose data holds the word endstream, or whose Length is missing or wrong, is still read to its end', async () => {
  const inner = Buffer.concat([Buffer.from('endstream\n'), Buffer.alloc(2 * MIB, 0x20)]);
  const flate = deflateSync(inner);
  const limits = { perStream: 1 * MIB };
  // Right Length: the data is taken by its length, so a word inside it ends nothing.
  const honest = pageWith('/Contents 4 0 R', [{ number: 4, body: streamObject('/Filter /FlateDecode', flate) }]);
  expect((await refusal(checkExpansion(honest, { limits }))).kind).toBe('size');
  // No Length: the data ends at the first endstream, which is what a reader falls back to as well.
  const bare = pageWith('/Contents 4 0 R', [{ number: 4, body: streamObject('/Filter /FlateDecode', flate, false) }]);
  const report = await checkExpansion(bare, { limits: { perStream: 100 * MIB } });
  expect(report.streams).toBe(1);
  // A Length that is far too short is ignored in favour of the end marker.
  const lying = pageWith('/Contents 4 0 R', [
    {
      number: 4,
      body: Buffer.concat([
        Buffer.from('<< /Filter /FlateDecode /Length 3 >>\nstream\n'),
        deflateSync(Buffer.alloc(2 * MIB)),
        Buffer.from('\nendstream'),
      ]),
    },
  ]);
  expect((await refusal(checkExpansion(lying, { limits }))).kind).toBe('size');
});

it('the check can be cancelled', async () => {
  const bomb = await contentStreamBomb(100);
  const controller = new AbortController();
  controller.abort(new Error('stop'));
  await expect(checkExpansion(bomb, { signal: controller.signal })).rejects.toThrow('stop');
});

it('progress is reported while a large stream is counted', async () => {
  const flate = await deflateZeros(40);
  const bytes = pageWith('/Contents 4 0 R', [{ number: 4, body: streamObject('/Filter /FlateDecode', flate) }]);
  let calls = 0;
  const report = await checkExpansion(bytes, { onProgress: () => (calls += 1) });
  expect(report.decodedBytes).toBe(40 * MIB);
  expect(calls).toBeGreaterThanOrEqual(30);
}, 60_000);
