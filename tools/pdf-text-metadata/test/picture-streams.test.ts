import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { EXPANSION_MESSAGE, PdfToolError, checkExpansion } from '../src/index';
import { deflateZeros, pageWith, streamObject, type RawObject } from './bombs';
import { pageWithManyPictures, pageWithObjects, pictureStream } from './picture-builders';

/**
 * A stream whose dictionary says `/Subtype /Image` is left out of the memory check when it is only drawn as a picture,
 * and counted when something a reader decodes uses it: ISO 32000-1:2008 section 7.8.2 (a page's `/Contents` is one
 * content stream or an array of them), section 7.3.8 (streams), section 7.5.7 (object streams), section 7.3.10 (an
 * indirect reference is `number generation R`), section 7.3.5 (a name can write any character as `#` and two hexadecimal
 * digits), sections 9.6 to 9.10 (fonts, embedded font programs, `/ToUnicode` maps, CMaps named by `/Encoding`), section
 * 9.7.4 (`/CIDToGIDMap`) and section 9.6.6 (Type 3 `/CharProcs`). The readers do not look at `/Subtype` when they decode
 * such a stream: the repository's pdfjs-dist 6.3.289 was run on a 150 MiB picture-labelled stream under each key
 * (eight executed probes, recorded in the plan's SUMMARY) and its peak memory rose by 250 MB to over 4 GB each time, while
 * the same file without the key stayed at 85 MB. pdf-lib decodes every object stream whatever its label (research probe).
 *
 * Every title is a top-level `it(...)` call (see index.test.ts for why). To keep runs fast the cap is 1 MiB for one
 * stream and the data is 2 MiB of zeros written as Flate by the platform's zlib (the second opinion, never the code under
 * test), as expansion.test.ts does.
 */
const MIB = 1024 * 1024;
const LIMITS = { perStream: 1 * MIB };
const BOMB = deflateSync(Buffer.alloc(2 * MIB));

async function refusal(promise: Promise<unknown>): Promise<PdfToolError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(PdfToolError);
    return err as PdfToolError;
  }
  throw new Error('The check accepted a file it should have refused.');
}

/** The file is refused with the plain sentence under the small cap and accepted, with one picture counted, under a big one. */
async function expectCounted(name: string, bytes: Uint8Array): Promise<void> {
  const error = await refusal(checkExpansion(bytes, { limits: LIMITS }));
  expect(error.kind, name).toBe('size');
  expect(error.message, name).toBe(EXPANSION_MESSAGE);
  const report = await checkExpansion(bytes, { limits: { perStream: 4 * MIB } });
  expect(report.picturesCounted, name).toBe(1);
  expect(report.images, name).toBe(0);
}

const picture = (number: number, data: Uint8Array = BOMB): RawObject => ({ number, body: pictureStream('', data) });
const plainContent = (number: number): RawObject => ({
  number,
  body: streamObject('', Buffer.from('BT /F1 12 Tf 10 10 Td (hi) Tj ET')),
});

it('a picture-labelled stream used as page content that expands past the cap is refused with the plain message', async () => {
  const bomb = pageWith('/Contents 4 0 R', [picture(4)]);
  const error = await refusal(checkExpansion(bomb, { limits: { perStream: 1 * MIB } }));
  expect(error.kind).toBe('size');
  expect(error.message).toBe('This PDF expands to more data than this page can hold in memory.');
  expect(error.message).toBe(EXPANSION_MESSAGE);

  // Under the cap the same file is accepted, and the picture is counted as used, not as an image.
  const report = await checkExpansion(bomb, { limits: { perStream: 4 * MIB } });
  expect(report.picturesCounted).toBe(1);
  expect(report.decoded).toBe(1);
  expect(report.images).toBe(0);
  expect(report.decodedBytes).toBe(2 * MIB);
});

it('a picture-labelled stream reached through a content array, an indirect array or an object stream is refused', async () => {
  const cases: [string, Uint8Array][] = [
    ['array, second entry', pageWith('/Contents [4 0 R 5 0 R]', [plainContent(4), picture(5)])],
    ['array over several lines', pageWith('/Contents [\n4 0 R\r\n5 0 R\n]', [plainContent(4), picture(5)])],
    [
      'indirect array',
      pageWith('/Contents 6 0 R', [plainContent(4), picture(5), { number: 6, body: Buffer.from('[4 0 R 5 0 R]') }]),
    ],
    ['page held in an object stream', pageWithObjects('/Contents 4 0 R', [picture(4)])],
    ['array in a page held in an object stream', pageWithObjects('/Contents [3 0 R 4 0 R]', [picture(4)])],
    [
      'indirect array held in an object stream',
      pageWithObjects('/Contents 6 0 R', [picture(4)], [{ number: 6, text: '[5 0 R 4 0 R]' }]),
    ],
  ];
  for (const [name, bytes] of cases) await expectCounted(name, bytes);
});

it('a picture-labelled stream used by a font, a ToUnicode map, a CIDToGIDMap, an Encoding or CharProcs is refused', async () => {
  const type1 = (extra: string): Buffer => Buffer.from(`<< /Type /Font /Subtype /Type1 /BaseFont /Foo ${extra} >>`);
  const descriptor = (extra: string): Buffer =>
    Buffer.from(`<< /Type /FontDescriptor /FontName /Foo /Flags 4 /FontBBox [0 0 1000 1000] ${extra} >>`);
  const cidFont = (extra: string): Buffer =>
    Buffer.from(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Foo /FontDescriptor 7 0 R ${extra} >>`);
  const cases: [string, RawObject[]][] = [
    ['ToUnicode', [picture(5), { number: 6, body: type1('/ToUnicode 5 0 R') }]],
    [
      'FontFile',
      [
        picture(5),
        { number: 6, body: type1('/FontDescriptor 7 0 R') },
        { number: 7, body: descriptor('/FontFile 5 0 R') },
      ],
    ],
    [
      'FontFile2',
      [
        picture(5),
        { number: 6, body: type1('/FontDescriptor 7 0 R') },
        { number: 7, body: descriptor('/FontFile2 5 0 R') },
      ],
    ],
    [
      'FontFile3',
      [
        picture(5),
        { number: 6, body: type1('/FontDescriptor 7 0 R') },
        { number: 7, body: descriptor('/FontFile3 5 0 R') },
      ],
    ],
    [
      'CIDToGIDMap',
      [
        picture(5),
        { number: 6, body: Buffer.from('<< /Type /Font /Subtype /Type0 /BaseFont /Foo /DescendantFonts [8 0 R] >>') },
        { number: 7, body: descriptor('') },
        { number: 8, body: cidFont('/CIDToGIDMap 5 0 R') },
      ],
    ],
    [
      'Encoding',
      [
        picture(5),
        {
          number: 6,
          body: Buffer.from(
            '<< /Type /Font /Subtype /Type0 /BaseFont /Foo /Encoding 5 0 R /DescendantFonts [8 0 R] >>',
          ),
        },
        { number: 7, body: descriptor('') },
        { number: 8, body: cidFont('') },
      ],
    ],
    [
      'CharProcs',
      [
        picture(5),
        {
          number: 6,
          body: Buffer.from(
            '<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1000 1000] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << /b 9 0 R /a 5 0 R >> /Encoding << /Differences [97 /a] >> /FirstChar 97 /LastChar 97 /Widths [1000] >>',
          ),
        },
      ],
    ],
  ];
  for (const [name, objects] of cases) {
    await expectCounted(name, pageWith('/Resources << /Font << /F1 6 0 R >> >>', objects));
  }
});

it('name escapes and generation numbers do not hide a reference to a picture-labelled stream', async () => {
  const descriptor = (key: string, reference: string): Buffer =>
    Buffer.from(`<< /Type /FontDescriptor /FontName /Foo /Flags 4 ${key} ${reference} >>`);
  const cases: [string, Uint8Array][] = [
    ['escaped Contents', pageWith('/Cont#65nts 4 0 R', [picture(4)])],
    ['escaped first letter', pageWith('/#43ontents 4 0 R', [picture(4)])],
    ['escaped in lower case digits', pageWith('/Conte#6et#73 4 0 R', [picture(4)])],
    [
      'escaped FontFile2',
      pageWith('/Resources << /Font << /F1 6 0 R >> >>', [
        picture(5),
        { number: 6, body: Buffer.from('<< /Type /Font /Subtype /TrueType /FontDescriptor 7 0 R >>') },
        { number: 7, body: descriptor('/Font#46ile2', '5 0 R') },
      ]),
    ],
    ['generation number', pageWith('/Contents 4 1 R', [picture(4)])],
    ['several digits of generation', pageWith('/Contents 4 65535 R', [picture(4)])],
    ['line ends between the parts', pageWith('/Contents 4\r\n0\nR', [picture(4)])],
    ['tabs and form feeds between the parts', pageWith('/Contents\t4\f0\t\fR', [picture(4)])],
    ['no space after the key', pageWith('/Contents[4 0 R]', [picture(4)])],
    [
      'a nul byte as white space',
      pageWith(`/Contents${String.fromCharCode(0)}4${String.fromCharCode(0)}0 R`, [picture(4)]),
    ],
    ['array with a closing bracket right after R', pageWith('/Contents [4 0 R]/Rotate 0', [picture(4)])],
  ];
  for (const [name, bytes] of cases) await expectCounted(name, bytes);

  // A key name that only starts like Contents is another key and finds nothing, and so does a longer number.
  const other = pageWith('/ContentsOther 4 0 R /Probe 4 0 R', [picture(4)]);
  const report = await checkExpansion(other, { limits: LIMITS });
  expect(report.images).toBe(1);
  expect(report.picturesCounted).toBe(0);
  const longer = pageWith('/Contents 14 0 R', [picture(4)]);
  expect((await checkExpansion(longer, { limits: LIMITS })).images).toBe(1);
  const longerStart = pageWith('/Contents 24 0 R', [picture(4)]);
  expect((await checkExpansion(longerStart, { limits: LIMITS })).images).toBe(1);
  // A reference that starts in the middle of a longer number is not a reference to the object the digits end with.
  const midNumber = pageWith('/Contents [99999999994 0 R]', [picture(4)]);
  expect((await checkExpansion(midNumber, { limits: LIMITS })).images).toBe(1);
});

it('an object stream or a cross-reference stream labelled as a picture is always counted', async () => {
  const cases: [string, string][] = [
    ['object stream', '/Type /ObjStm /Subtype /Image /N 1 /First 5 /Filter /FlateDecode'],
    ['cross-reference stream', '/Type /XRef /Subtype /Image /W [1 2 1] /Size 4 /Filter /FlateDecode'],
    ['object stream with an escaped type', '/Type /Obj#53tm /Subtype /Image /N 1 /First 5 /Filter /FlateDecode'],
    ['cross-reference stream with an escaped type', '/Type/X#52ef /Subtype/Image /Size 4 /Filter /FlateDecode'],
  ];
  for (const [name, dictionary] of cases) {
    // Nothing refers to the stream at all.
    const bytes = pageWith('', [{ number: 4, body: streamObject(dictionary, BOMB) }]);
    const error = await refusal(checkExpansion(bytes, { limits: LIMITS }));
    expect(error.kind, name).toBe('size');
    expect(error.message, name).toBe(EXPANSION_MESSAGE);
    const report = await checkExpansion(bytes, { limits: { perStream: 4 * MIB } });
    expect(report.picturesCounted, name).toBe(1);
    expect(report.decoded, name).toBe(1);
    expect(report.images, name).toBe(0);
    expect(report.decodedBytes, name).toBe(2 * MIB);
  }
});

it('a picture label written inside a string does not exempt a content stream', async () => {
  const dictionary = '/Probe (/Subtype /Image) /Filter /FlateDecode';
  const used = pageWith('/Contents 4 0 R', [{ number: 4, body: streamObject(dictionary, BOMB) }]);
  const error = await refusal(checkExpansion(used, { limits: LIMITS }));
  expect(error.kind).toBe('size');
  expect(error.message).toBe(EXPANSION_MESSAGE);
  const report = await checkExpansion(used, { limits: { perStream: 4 * MIB } });
  expect(report.picturesCounted).toBe(1);
  expect(report.images).toBe(0);

  // A stream that nothing uses stays out, whatever its dictionary says.
  const unused = pageWith('', [{ number: 4, body: streamObject(dictionary, BOMB) }]);
  const unusedReport = await checkExpansion(unused, { limits: LIMITS });
  expect(unusedReport.images).toBe(1);
  expect(unusedReport.picturesCounted).toBe(0);
  expect(unusedReport.decodedBytes).toBe(0);
});

it('pictures used only as images, soft masks or masks are still left out and counted as images', async () => {
  const drawn = pageWith('/Resources << /XObject << /Im0 4 0 R >> >>', [picture(4)]);
  const report = await checkExpansion(drawn, { limits: { perStream: 1 * MIB } });
  expect(report.streams).toBe(1);
  expect(report.images).toBe(1);
  expect(report.decoded).toBe(0);
  expect(report.picturesCounted).toBe(0);
  expect(report.decodedBytes).toBe(0);

  // An image with a soft mask and a stencil mask: three pictures, none of them used by content, a font or an object stream.
  const masked = pageWith('/Resources << /XObject << /Im0 4 0 R >> >>', [
    { number: 4, body: pictureStream('/SMask 5 0 R /Mask 6 0 R', BOMB) },
    picture(5),
    picture(6),
  ]);
  const maskedReport = await checkExpansion(masked, { limits: LIMITS });
  expect(maskedReport.streams).toBe(3);
  expect(maskedReport.images).toBe(3);
  expect(maskedReport.decoded).toBe(0);
  expect(maskedReport.decodedBytes).toBe(0);

  // A font that names its encoding, an array of other references and a picture that nothing names are not uses either.
  const named = pageWith('/Resources << /Font << /F1 6 0 R >> /XObject << /Im0 4 0 R >> >> /Annots [4 0 R]', [
    picture(4),
    {
      number: 6,
      body: Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
    },
  ]);
  expect((await checkExpansion(named, { limits: LIMITS })).images).toBe(1);

  // Three images of 600 KiB whose total passes the total cap: still free.
  const flate600 = deflateSync(Buffer.alloc(600 * 1024));
  const three = pageWith('/Resources << /XObject << /A 4 0 R /B 5 0 R /C 6 0 R >> >>', [
    picture(4, flate600),
    picture(5, flate600),
    picture(6, flate600),
  ]);
  const threeReport = await checkExpansion(three, { limits: { perStream: 1 * MIB, total: 1.5 * MIB } });
  expect(threeReport.images).toBe(3);
  expect(threeReport.decodedBytes).toBe(0);
});

it('a used picture exactly at the per-stream cap is accepted and one byte more is refused', async () => {
  const exact = pageWith('/Contents 4 0 R', [picture(4, deflateSync(Buffer.alloc(1 * MIB)))]);
  const report = await checkExpansion(exact, { limits: LIMITS });
  expect(report.picturesCounted).toBe(1);
  expect(report.decodedBytes).toBe(1 * MIB);

  const over = pageWith('/Contents 4 0 R', [picture(4, deflateSync(Buffer.alloc(1 * MIB + 1)))]);
  const error = await refusal(checkExpansion(over, { limits: LIMITS }));
  expect(error.kind).toBe('size');
  expect(error.message).toBe(EXPANSION_MESSAGE);
});

it('a used picture counts toward the total cap together with every other stream', async () => {
  const flate600 = deflateSync(Buffer.alloc(600 * 1024));
  const three = pageWith('/Contents [4 0 R 5 0 R 6 0 R]', [
    picture(4, flate600),
    picture(5, flate600),
    picture(6, flate600),
  ]);
  // Each picture is under 1 MiB and the three together are over 1.5 MiB.
  const accepted = await checkExpansion(three, { limits: { perStream: 1 * MIB, total: 2 * MIB } });
  expect(accepted.decodedBytes).toBe(3 * 600 * 1024);
  expect(accepted.picturesCounted).toBe(3);
  expect((await refusal(checkExpansion(three, { limits: { perStream: 1 * MIB, total: 1.5 * MIB } }))).kind).toBe(
    'size',
  );

  // One ordinary stream and two pictures: the pictures' share is what tips the total over.
  const mixed = pageWith('/Contents [4 0 R 5 0 R 6 0 R]', [
    { number: 4, body: streamObject('/Filter /FlateDecode', flate600) },
    picture(5, flate600),
    picture(6, flate600),
  ]);
  const mixedReport = await checkExpansion(mixed, { limits: { perStream: 1 * MIB, total: 2 * MIB } });
  expect(mixedReport.decoded).toBe(3);
  expect(mixedReport.picturesCounted).toBe(2);
  expect(mixedReport.decodedBytes).toBe(3 * 600 * 1024);
  const error = await refusal(checkExpansion(mixed, { limits: { perStream: 1 * MIB, total: 1.5 * MIB } }));
  expect(error.message).toBe(EXPANSION_MESSAGE);
});

it('a picture referenced twice is decoded and counted once', async () => {
  // Used as page content, drawn as an image and named as a ToUnicode map: 2 MiB, not 4 MiB or 6 MiB.
  const bytes = pageWith('/Contents 4 0 R /Resources << /XObject << /Im0 4 0 R >> /Font << /F1 5 0 R >> >>', [
    picture(4),
    { number: 5, body: Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Foo /ToUnicode 4 0 R >>') },
  ]);
  const report = await checkExpansion(bytes, { limits: { perStream: 4 * MIB, total: 3 * MIB } });
  expect(report.picturesCounted).toBe(1);
  expect(report.decoded).toBe(1);
  expect(report.decodedBytes).toBe(2 * MIB);

  const twice = pageWith('/Contents [4 0 R 4 0 R]', [picture(4)]);
  const twiceReport = await checkExpansion(twice, { limits: { perStream: 4 * MIB, total: 3 * MIB } });
  expect(twiceReport.decodedBytes).toBe(2 * MIB);
  expect(twiceReport.picturesCounted).toBe(1);
});

/** The median of five timings of the check, after one run to warm the code up. */
async function medianMilliseconds(bytes: Uint8Array): Promise<number> {
  await checkExpansion(bytes);
  const times: number[] = [];
  for (let run = 0; run < 5; run++) {
    const started = performance.now();
    await checkExpansion(bytes);
    times.push(performance.now() - started);
  }
  return times.sort((a, b) => a - b)[2]!;
}

it('twenty thousand unused pictures and one used one are checked in linear time', async () => {
  const tiny = deflateSync(Buffer.alloc(16));
  // The used picture is the first of 20,001; the check holds 20,000 pictures, so it is among them.
  const full = pageWithManyPictures(20_000, tiny);
  const report = await checkExpansion(full);
  expect(report.streams).toBe(20_001);
  expect(report.picturesCounted).toBe(1);
  expect(report.decoded).toBe(1);
  expect(report.images).toBe(20_000);
  expect(report.decodedBytes).toBe(16);

  // Linear: twice the pictures take less than three times as long, four times as many less than twelve times.
  const small = await medianMilliseconds(pageWithManyPictures(4_000, tiny));
  const double = await medianMilliseconds(pageWithManyPictures(8_000, tiny));
  const quadruple = await medianMilliseconds(pageWithManyPictures(16_000, tiny));
  expect(double / Math.max(small, 1), `${small} ms, ${double} ms, ${quadruple} ms`).toBeLessThan(3);
  expect(quadruple / Math.max(small, 1), `${small} ms, ${double} ms, ${quadruple} ms`).toBeLessThan(12);
}, 120_000);

it('a 400 MB picture-labelled content stream is refused quickly without exhausting memory', async () => {
  const flate = await deflateZeros(400);
  const bomb = pageWith('/Contents 4 0 R', [picture(4, flate)]);
  expect(bomb.length).toBeLessThan(500 * 1024);
  let peak = process.memoryUsage().rss;
  const sampler = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
  }, 5);
  const before = process.memoryUsage().rss;
  const started = performance.now();
  let error: PdfToolError;
  try {
    error = await refusal(checkExpansion(bomb));
  } finally {
    clearInterval(sampler);
  }
  const elapsed = performance.now() - started;
  expect(error.kind).toBe('size');
  expect(error.message).toBe(EXPANSION_MESSAGE);
  expect(elapsed).toBeLessThan(20_000);
  // The check stops at the 64 MiB cap and holds a few chunks: nowhere near the 400 MB the stream would decode to.
  expect(peak - before).toBeLessThan(300 * MIB);
}, 60_000);

it('a used picture that does not inflate is left for the reader to judge', async () => {
  const junk = Buffer.from('this is not zlib data at all, whatever the dictionary says');
  const broken = deflateSync(Buffer.alloc(5000));
  const middle = Math.floor(broken.length / 2);
  broken.writeUInt8(broken.readUInt8(middle) ^ 0xff, middle);
  const bytes = pageWith('/Contents [4 0 R 5 0 R]', [picture(4, junk), picture(5, broken)]);
  const report = await checkExpansion(bytes);
  expect(report.streams).toBe(2);
  expect(report.decoded).toBe(2);
  expect(report.picturesCounted).toBe(2);
  expect(report.images).toBe(0);
});

it('a file with no pictures, an empty used picture or a reference to a missing object is accepted', async () => {
  const none = pageWith('/Contents 4 0 R', [plainContent(4)]);
  const noneReport = await checkExpansion(none, { limits: LIMITS });
  expect(noneReport.picturesCounted).toBe(0);
  expect(noneReport.images).toBe(0);

  const empty = pageWith('/Contents 4 0 R', [picture(4, new Uint8Array(0))]);
  const emptyReport = await checkExpansion(empty, { limits: LIMITS });
  expect(emptyReport.streams).toBe(1);
  expect(emptyReport.picturesCounted).toBe(1);
  expect(emptyReport.decodedBytes).toBe(0);

  // A picture with no filter has nothing to decode and costs nothing, used or not.
  const unfiltered = pageWith('/Contents 4 0 R', [{ number: 4, body: pictureStream('', Buffer.from('raw'), '') }]);
  const unfilteredReport = await checkExpansion(unfiltered, { limits: LIMITS });
  expect(unfilteredReport.picturesCounted).toBe(0);
  expect(unfilteredReport.decodedBytes).toBe(0);

  // A reference to an object that does not exist, with a picture that nothing uses.
  const missing = pageWith('/Contents 99 0 R', [picture(4)]);
  const missingReport = await checkExpansion(missing, { limits: LIMITS });
  expect(missingReport.images).toBe(1);
  expect(missingReport.picturesCounted).toBe(0);
  expect(missingReport.decodedBytes).toBe(0);

  // No stream at all.
  const nothing = await checkExpansion(pageWith('', []));
  expect(nothing).toEqual({ streams: 0, decoded: 0, images: 0, picturesCounted: 0, decodedBytes: 0 });
});

it('the limits say which pictures are counted and what a crafted file can still hide', () => {
  const meta = JSON.parse(readFileSync(new URL('../src/meta.json', import.meta.url), 'utf8')) as { limits: string[] };
  const entry = meta.limits.find((limit) => limit.includes('in memory'));
  expect(entry).toBeDefined();
  const text = entry!;
  // The first sentence is the one every earlier version of this folder said, up to the words "in memory".
  expect(
    text.startsWith(
      'A file whose compressed streams would decode to more than 64 MiB in one stream, or 256 MiB in all, is refused before it is read, with the message that it expands to more data than this page can hold in memory',
    ),
  ).toBe(true);
  for (const phrase of ['page content', 'a font', 'a character map', 'an object stream', '20,000', '32 MiB']) {
    expect(text, phrase).toContain(phrase);
  }
  expect(text).toContain('A crafted file can still hide a stream from this check');
  expect(text).not.toContain('pictures are not counted');
});
