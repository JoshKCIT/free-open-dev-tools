import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { checkExpansion } from '../src/index';
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
  ascii85Encode,
  asciiHexEncode,
  contentStreamBomb,
  deflateZeros,
  lzwEncode,
  objectStreamBomb,
  pageWith,
  runLengthEncode,
  streamObject,
} from './bombs';
import { buildMinimalPdf } from './minimal-pdf';
import { fixtureBytes } from './scan';

/**
 * The expansion report of every PDF fixture and every PDF this folder's earlier tests build, recorded from the module as
 * it was BEFORE streams labelled as pictures were counted when a page or a font uses them (D-243, plan 21-01).
 * `src/expansion.ts` is not touched by the commit that adds this file; every later commit that changes it must keep all of
 * these answers, so a fix for the one thing it is meant to change cannot silently change another answer.
 *
 * The expected numbers are the ones the unchanged module gave (recorded, never computed here). Recording is explicit:
 * with RECORD_GOLDEN=1 the file is written when it does not exist; an existing file is never overwritten, so a later run
 * cannot "update" the answers to whatever the new code says. The recording lives in test/fixtures and is read with
 * node:fs from a URL next to this file, so the folder still works when copied out alone.
 *
 * Sizes are kept small on purpose: no case here decodes more than about 4 MiB, because only the counts are recorded and
 * the large bombs of expansion.test.ts are refusals, which carry no report.
 */
const GOLDEN = new URL('./fixtures/expansion-goldens.json', import.meta.url);

/**
 * Cases whose recorded report is allowed to differ after the fix, by name. Empty and meant to stay empty: no earlier
 * fixture uses a stream labelled as a picture as page content, as a font or as any other part of the document that a
 * reader decodes, and the legitimate image cases below keep counting as images. A name added here later must carry the
 * reason in a comment next to it.
 */
const INTENDED_CHANGES: readonly string[] = [];

const MIB = 1024 * 1024;

interface Case {
  name: string;
  bytes: Uint8Array;
}

interface Golden {
  recordedAt: string;
  head: string;
  reports: { name: string; streams: number; decoded: number; images: number; decodedBytes: number }[];
}

/** Every case, in a fixed order with fixed names. Built at run time; nothing here depends on the clock. */
async function cases(): Promise<Case[]> {
  const out: Case[] = [];
  const add = (name: string, bytes: Uint8Array): void => {
    out.push({ name, bytes });
  };

  // The ten PDF fixtures of test/fixtures/pdfs.ts.
  const fixtures: [string, string][] = [
    ['fixture F1_PLAIN', F1_PLAIN],
    ['fixture F1_FULL', F1_FULL],
    ['fixture F1_FULL_NO_OBJSTM', F1_FULL_NO_OBJSTM],
    ['fixture F2_INCREMENTAL', F2_INCREMENTAL],
    ['fixture F3_OWNER_ENCRYPTED', F3_OWNER_ENCRYPTED],
    ['fixture F4_USER_ENCRYPTED', F4_USER_ENCRYPTED],
    ['fixture F5_CLEAN_NO_INFO', F5_CLEAN_NO_INFO],
    ['fixture F6_UNICODE', F6_UNICODE],
    ['fixture F7_BIDI', F7_BIDI],
    ['fixture F8_NESTED', F8_NESTED],
  ];
  for (const [name, base64] of fixtures) add(name, fixtureBytes(base64));

  // Files built with buildMinimalPdf in the earlier tests (the 501 page and 3000 page files are sized down or left out).
  add('minimal three pages', buildMinimalPdf({ pages: [{ text: 'one' }, { text: 'two' }, { text: 'three' }] }));
  add(
    'minimal 501 pages',
    buildMinimalPdf({ pages: Array.from({ length: 501 }, (_, i) => ({ text: `Page ${i + 1}` })) }),
  );
  add('minimal CJK font page', buildMinimalPdf({ pages: [{ text: 'Latin text', cjkText: true }] }));
  add('minimal blank page then text', buildMinimalPdf({ pages: [{}, { text: 'Hello' }] }));
  add('minimal titled', buildMinimalPdf({ pages: [{ text: 'titled' }], title: 'GOLDEN-TITLE' }));
  add(
    'minimal with open action script',
    buildMinimalPdf({ pages: [{ text: 'script' }], openActionJavaScript: 'app.alert(1)' }),
  );
  add('minimal user password', buildMinimalPdf({ pages: [{ text: 'locked' }], userPassword: 'golden' }));

  // Small versions of the two probe files: the decoded counts, not the refusals.
  add('object stream of 2 MiB', await objectStreamBomb(2));
  add('content stream of 2 MiB', await contentStreamBomb(2));
  add('content stream of 3 MiB', await contentStreamBomb(3));

  // A legitimate large image is left out and counted as an image (the case at expansion.test.ts line 156, sized down).
  const imageFlate = await deflateZeros(2);
  const imageDictionary =
    '/Type /XObject /Subtype /Image /Width 10000 /Height 20000 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode';
  add(
    'image used as an image',
    pageWith('/Resources << /XObject << /Im0 4 0 R >> >>', [
      { number: 4, body: streamObject(imageDictionary, imageFlate) },
    ]),
  );
  add('image not drawn by the page', pageWith('', [{ number: 4, body: streamObject(imageDictionary, imageFlate) }]));
  add(
    'the same bytes as page content',
    pageWith('/Contents 4 0 R', [{ number: 4, body: streamObject('/Filter /FlateDecode', imageFlate) }]),
  );

  // Filter spellings (expansion.test.ts line 176): escaped name, array, abbreviation, reference, no space, no filter.
  const flate2 = deflateSync(Buffer.alloc(2 * MIB));
  for (const dictionary of [
    '/Filter /F#6Cate#44ecode',
    '/Filter [ /FlateDecode ]',
    '/Filter /Fl',
    '/Filter 9 0 R',
    '/Filter/FlateDecode',
    '',
  ]) {
    add(
      `filter spelling ${dictionary === '' ? 'none' : dictionary}`,
      pageWith('/Contents 4 0 R', [{ number: 4, body: streamObject(dictionary, flate2) }]),
    );
  }

  // A doubled Flate filter and a chain whose first stage is stored blocks (lines 86 and 96, sized down).
  const inner = await deflateZeros(3);
  add(
    'doubled flate',
    pageWith('/Contents 4 0 R', [
      { number: 4, body: streamObject('/Filter [/FlateDecode /FlateDecode]', deflateSync(inner)) },
    ]),
  );
  const middle = deflateSync(Buffer.alloc(700 * 1024), { level: 0 });
  add(
    'two stage chain of stored blocks',
    pageWith('/Contents 4 0 R', [
      { number: 4, body: streamObject('/Filter [/FlateDecode /FlateDecode]', deflateSync(middle)) },
    ]),
  );
  const flate600 = deflateSync(Buffer.alloc(600 * 1024));
  add(
    'three streams of 600 KiB',
    pageWith('/Contents [4 0 R 5 0 R 6 0 R]', [
      { number: 4, body: streamObject('/Filter /FlateDecode', flate600) },
      { number: 5, body: streamObject('/Filter /FlateDecode', flate600) },
      { number: 6, body: streamObject('/Filter /FlateDecode', flate600) },
    ]),
  );

  // Streams that do not inflate (line 194).
  const junk = Buffer.from('this is not zlib data at all, whatever the dictionary says');
  const broken = deflateSync(Buffer.alloc(5000));
  const half = Math.floor(broken.length / 2);
  broken.writeUInt8(broken.readUInt8(half) ^ 0xff, half);
  add(
    'two streams that do not inflate',
    pageWith('/Contents [4 0 R 5 0 R]', [
      { number: 4, body: streamObject('/Filter /FlateDecode', junk) },
      { number: 5, body: streamObject('/Filter /FlateDecode', broken) },
    ]),
  );

  // LZW with either EarlyChange, LZW with a font, and a 3 MiB LZW stream (lines 208, 220, 250).
  const lzwText = Buffer.from('BT /F1 12 Tf 10 10 Td (hello lzw) Tj ET\n'.repeat(400) + 'x'.repeat(3000) + 'END');
  for (const early of [1, 0]) {
    const dictionary = early === 1 ? '/Filter /LZWDecode' : '/Filter /LZWDecode /DecodeParms << /EarlyChange 0 >>';
    add(
      `LZW early change ${early}`,
      pageWith('/Contents 4 0 R', [{ number: 4, body: streamObject(dictionary, lzwEncode(lzwText, early)) }]),
    );
  }
  const lzwContent = Buffer.from('BT /F1 12 Tf 10 10 Td (hello lzw) Tj ET\n'.repeat(300));
  add(
    'LZW content with a font',
    pageWith('/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >>', [
      { number: 4, body: streamObject('/Filter /LZWDecode', lzwEncode(lzwContent)) },
      { number: 5, body: Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>') },
    ]),
  );
  add(
    'LZW stream of 3 MiB',
    pageWith('/Contents 4 0 R', [
      { number: 4, body: streamObject('/Filter /LZWDecode', lzwEncode(Buffer.alloc(3 * MIB))) },
    ]),
  );

  // ASCII85, ASCII hex and run-length, alone and in front of Flate (line 270).
  const data = Buffer.concat([
    Buffer.from('The quick brown fox jumps over the lazy dog. '.repeat(40)),
    Buffer.alloc(8),
    Buffer.from('zzz'),
  ]);
  const encoded: [string, Uint8Array][] = [
    ['/Filter /ASCII85Decode', ascii85Encode(data)],
    ['/Filter [/A85]', ascii85Encode(data)],
    ['/Filter /ASCIIHexDecode', asciiHexEncode(data)],
    ['/Filter /AHx', asciiHexEncode(data)],
    ['/Filter /RunLengthDecode', runLengthEncode(data)],
    ['/Filter /RL', runLengthEncode(data)],
    ['/Filter [/ASCII85Decode /FlateDecode]', ascii85Encode(deflateSync(data))],
    ['/Filter [/ASCIIHexDecode /FlateDecode]', asciiHexEncode(deflateSync(data))],
  ];
  for (const [dictionary, bytes] of encoded)
    add(`encoding ${dictionary}`, pageWith('/Contents 4 0 R', [{ number: 4, body: streamObject(dictionary, bytes) }]));
  const zeros3 = await deflateZeros(3);
  add(
    'ASCII85 in front of Flate zeros',
    pageWith('/Contents 4 0 R', [
      { number: 4, body: streamObject('/Filter [/ASCII85Decode /FlateDecode]', ascii85Encode(zeros3)) },
    ]),
  );
  add(
    'run-length of one byte',
    pageWith('/Contents 4 0 R', [
      { number: 4, body: streamObject('/Filter /RunLengthDecode', runLengthEncode(Buffer.alloc(100_000, 0x41))) },
    ]),
  );

  // The word endstream inside the data, a missing Length and a wrong Length (line 290).
  const withWord = deflateSync(Buffer.concat([Buffer.from('endstream\n'), Buffer.alloc(2 * MIB, 0x20)]));
  add(
    'endstream inside the data, right Length',
    pageWith('/Contents 4 0 R', [{ number: 4, body: streamObject('/Filter /FlateDecode', withWord) }]),
  );
  add(
    'endstream inside the data, no Length',
    pageWith('/Contents 4 0 R', [{ number: 4, body: streamObject('/Filter /FlateDecode', withWord, false) }]),
  );
  add(
    'Length far too short',
    pageWith('/Contents 4 0 R', [
      {
        number: 4,
        body: Buffer.concat([
          Buffer.from('<< /Filter /FlateDecode /Length 3 >>\nstream\n'),
          deflateSync(Buffer.alloc(2 * MIB)),
          Buffer.from('\nendstream'),
        ]),
      },
    ]),
  );

  // Progress case (line 316, sized down) and a file with no stream at all.
  add(
    'flate zeros of 4 MiB',
    pageWith('/Contents 4 0 R', [{ number: 4, body: streamObject('/Filter /FlateDecode', await deflateZeros(4)) }]),
  );
  add('no stream at all', pageWith('', []));
  return out;
}

it('every PDF fixture and built PDF gives the expansion report recorded before pictures were counted', async () => {
  const all = await cases();
  expect(new Set(all.map((c) => c.name)).size).toBe(all.length);

  const reports: Golden['reports'] = [];
  for (const { name, bytes } of all) {
    const r = await checkExpansion(bytes);
    reports.push({ name, streams: r.streams, decoded: r.decoded, images: r.images, decodedBytes: r.decodedBytes });
  }

  if (process.env.RECORD_GOLDEN === '1' && !existsSync(GOLDEN)) {
    const recorded: Golden = {
      recordedAt: new Date().toISOString(),
      head: process.env.GOLDEN_HEAD ?? 'unknown',
      reports,
    };
    mkdirSync(new URL('.', GOLDEN), { recursive: true });
    writeFileSync(GOLDEN, JSON.stringify(recorded, null, 2) + '\n');
  }

  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Golden;
  expect(typeof golden.recordedAt).toBe('string');
  expect(golden.head.length).toBeGreaterThan(0);
  expect(golden.reports.map((r) => r.name)).toEqual(reports.map((r) => r.name));
  for (const now of reports) {
    if (INTENDED_CHANGES.includes(now.name)) continue;
    const before = golden.reports.find((r) => r.name === now.name);
    expect(now, now.name).toEqual(before);
  }
}, 120_000);
